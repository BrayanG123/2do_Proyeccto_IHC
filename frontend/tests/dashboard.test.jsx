// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import './dialog-environment'
import api from '../src/api/axios'
import { startFlow, recordSearchResult } from '../src/api/analytics'
import { AuthProvider } from '../src/context/AuthContext'
import { ThemeProvider } from '../src/context/ThemeContext'
import Dashboard from '../src/pages/Dashboard'

vi.mock('../src/api/axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), request: vi.fn() },
}))
vi.mock('../src/api/analytics', () => ({
  startFlow: vi.fn(),
  recordInvalid: vi.fn(),
  recordSearchResult: vi.fn(),
  attemptConfig: (attempt) => attempt && ({ headers: { 'X-Analytics-Attempt': attempt.id } }),
}))

const user = { id: 17, first_name: 'Carla', last_name: 'Rojas', full_name: 'Carla Rojas', email: 'carla@example.com' }
const attendee = { user_id: user.id, user_name: user.full_name, user_email: user.email, status: 'ausente', history: [] }
const session = (overrides = {}) => ({
  id: 42, name: 'Repaso de programación', creator_id: 15, creator_name: 'Ana Torres',
  modality: 'Virtual', subject: 'Programación II', date: '2030-12-10', time: '15:00:00',
  status: 'abierta', participants_count: 0, spots: 3, ...overrides,
})
const ownerSession = (overrides = {}) => session({ creator_id: user.id, creator_name: user.full_name, ...overrides })
const request = (overrides = {}) => ({
  id: 9, session_id: 42, user_id: 18, user_name: 'Ana Torres', user_email: 'ana@example.com',
  status: 'pendiente', ...overrides,
})
const change = {
  id: 3, session_id: 42, old_date: '2030-12-08', new_date: '2030-12-10',
  old_time: '15:00:00', new_time: null, reason: 'Cambio de aula',
  own_status: 'pendiente', pending_count: 1, responses: [],
}

function fill(input, value) {
  fireEvent.change(input, { target: { value } })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-18T16:00:00Z'))
  localStorage.setItem('token', 'token-de-prueba')
  localStorage.setItem('user', JSON.stringify(user))
  startFlow.mockImplementation(flow => ({ flow, id: flow }))
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function renderDashboard(data = {}, onlyMyRequests = false) {
  const state = {
    sessions: [session()], own: [], changes: [], attendance: [], cancellation: {},
    managed: [], roster: [], ...data,
  }
  api.get.mockImplementation(async (url, options) => {
    if (url === '/sessions/' && state.search) return { data: await state.search(options.params) }
    const payload = {
      '/subjects/': [{ id: 1, name: 'Programación II', emoji: '📚' }],
      '/sessions/': state.sessions,
      '/sessions/requests/me': state.own,
      '/sessions/reschedules/me': state.changes,
      '/sessions/attendance/me': state.attendance,
      '/sessions/cancellations/me': state.cancellation,
      '/sessions/42/requests': state.managed,
      '/sessions/42/attendance': state.roster,
    }[url]
    if (payload instanceof Error) throw payload
    if (payload === undefined) throw new Error(`Solicitud inesperada: ${url}`)
    return { data: payload }
  })
  const view = render(
    <MemoryRouter initialEntries={[onlyMyRequests ? '/mis-solicitudes' : '/dashboard']}>
      <ThemeProvider><AuthProvider><Dashboard onlyMyRequests={onlyMyRequests} /></AuthProvider></ThemeProvider>
    </MemoryRouter>,
  )
  return { state, ...view }
}

async function findCard(name = 'Repaso de programación') {
  return (await screen.findByRole('heading', { name })).closest('.session-card')
}

function click(name, withinNode = document.body) {
  fireEvent.click(within(withinNode).getByRole('button', { name }))
}

test('los avisos de cupos quedan limitados a sesiones abiertas y vigentes', async () => {
  renderDashboard({ sessions: [
    session({ id: 40, name: 'Último cupo', spots: 1 }),
    session({ id: 41, name: 'Sesión llena', spots: 1, participants_count: 1 }),
    session({ id: 42, name: 'Sesión cerrada', status: 'cerrada', spots: 1 }),
    session({ id: 43, name: 'Sesión pasada', date: '2020-01-01', spots: 1 }),
    session({ id: 44, name: 'Sesión finalizada', finished_at: '2026-11-18T15:00:00Z', spots: 1 }),
    session({ id: 45, name: 'Sesión cancelada', status: 'cancelada', spots: 1, modality: 'Híbrida' }),
  ] })
  const lastSpot = await findCard('Último cupo')
  expect(lastSpot.textContent).toMatch(/Último cupo disponible/i)
  for (const name of ['Sesión llena', 'Sesión cerrada', 'Sesión pasada', 'Sesión finalizada', 'Sesión cancelada']) {
    expect((await findCard(name)).textContent).not.toMatch(/Último cupo disponible/i)
  }
  expect((await findCard('Sesión llena')).textContent).toMatch(/entrarás en la lista de espera/)
  expect((await findCard('Sesión cancelada')).textContent).toMatch(/ya no admite solicitudes/)
})

test('Mis solicitudes filtra por la cuenta y conserva motivo y lugar en la cola', async () => {
  renderDashboard({
    sessions: [session(), session({ id: 43, name: 'Encuentro cancelado', status: 'cancelada' }), session({ id: 44, name: 'Otra sesión' })],
    own: [request({ status: 'en_espera', queue_position: 2 }), request({ id: 10, session_id: 43, status: 'cancelada' })],
    cancellation: { 43: 'El aula se cerró por mantenimiento.' },
  }, true)
  expect((await findCard()).textContent).toContain('En espera · posición 2')
  expect((await findCard('Encuentro cancelado')).textContent).toContain('El aula se cerró por mantenimiento.')
  expect(screen.queryByRole('heading', { name: 'Otra sesión' })).toBeNull()
})

test('permite reintentar la carga y registra la búsqueda sin resultados', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const search = vi.fn().mockRejectedValueOnce(new Error('offline'))
    .mockImplementation(async params => params.search ? [] : [session()])
  renderDashboard({ search })
  expect((await screen.findByRole('alert')).textContent).toMatch(/No se pudieron cargar las sesiones/)
  click('Reintentar')
  await findCard()
  fireEvent.change(screen.getByPlaceholderText('Buscar sesiones por nombre...'), { target: { value: '   una búsqueda   ' } })
  await waitFor(() => expect(search).toHaveBeenLastCalledWith({ search: 'una búsqueda' }))
  await waitFor(() => expect(recordSearchResult).toHaveBeenCalledWith(expect.objectContaining({ flow: 'buscar_sesiones' }), false))
  click(/Limpiar filtros/)
  await findCard()
  expect(warning).toHaveBeenCalledOnce()
})

test('una solicitud fallida queda abierta para reintentar y el envío correcto cambia el estado', async () => {
  const internalName = '[E2E] Repaso 312284fa-b618-414f-971b-8daf916126d9'
  api.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: request() })
  renderDashboard({ sessions: [session({ name: internalName, participants_count: 3 })] })
  const card = await findCard(internalName)
  click('Solicitar Inscribirme', card)
  const send = screen.getByRole('button', { name: 'Enviar solicitud' })
  expect(screen.getByText('Sesión de estudio', { exact: true })).toBeTruthy()
  fireEvent.click(send)
  expect(await screen.findByText('No se pudo enviar la solicitud. Inténtalo nuevamente.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Enviar solicitud' })).toBeTruthy()
  fireEvent.click(send)
  expect(await within(card).findByText('Estado: Pendiente de aprobación')).toBeTruthy()
  expect(api.post).toHaveBeenLastCalledWith('/sessions/42/requests', undefined, {
    headers: { 'X-Analytics-Attempt': 'solicitar_unirse' },
  })
  expect(screen.queryByRole('button', { name: 'Enviar solicitud' })).toBeNull()
})

test('el organizador puede reintentar una decisión y la ficha se actualiza', async () => {
  const { state } = renderDashboard({ sessions: [ownerSession()], managed: [request()] })
  api.patch.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async () => {
    state.managed = [request({ status: 'aceptada' })]
    return {}
  })
  click('Gestionar solicitudes', await findCard())
  const dialog = screen.getByRole('dialog', { name: 'Solicitudes de Repaso de programación' })
  await within(dialog).findByRole('listitem', { name: 'Solicitud de ana@example.com' })
  click('Aceptar', dialog)
  expect((await within(dialog).findByRole('alert')).textContent).toBe('No se pudo guardar la decisión.')
  click('Aceptar', dialog)
  expect(await within(dialog).findByText('Estado: Confirmado')).toBeTruthy()
  expect(api.patch).toHaveBeenLastCalledWith('/sessions/42/requests/9', { decision: 'aceptar' }, {
    headers: { 'X-Analytics-Attempt': 'gestionar_solicitudes' },
  })
  click('Cerrar solicitudes', dialog)
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('la sesión cancelada ofrece el historial de solicitudes sin acciones de aprobación', async () => {
  renderDashboard({
    sessions: [ownerSession({ status: 'cancelada' })], managed: [request({ status: 'cancelada' })],
    cancellation: { 42: 'Cambio de aula' },
  })
  const card = await findCard()
  expect(within(card).queryByRole('button', { name: 'Cancelar sesión' })).toBeNull()
  click('Ver solicitudes', card)
  const dialog = screen.getByRole('dialog', { name: 'Solicitudes de Repaso de programación' })
  expect(await within(dialog).findByText('Estado: Cancelada')).toBeTruthy()
  expect(within(dialog).queryByRole('button', { name: 'Aceptar' })).toBeNull()
  expect(startFlow).not.toHaveBeenCalledWith('gestionar_solicitudes')
})

test('se puede volver a confirmar después de un error y salir de la sesión confirmada', async () => {
  const { state } = renderDashboard({ own: [request({ status: 'aceptada' })], changes: [change] }, true)
  api.post
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(async () => {
      state.changes = [{ ...change, own_status: 'confirmada' }]
      return {}
    })
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(async () => {
      state.own = [request({ status: 'retirada' })]
      return {}
    })
  const card = await findCard()
  expect(card.textContent).toMatch(/Tu cupo está reservado/)
  click('Ver reprogramaciones', card)
  click('Cerrar reprogramación', screen.getByRole('dialog', { name: 'Cambios de la sesión' }))
  click('Confirmar asistencia', card)
  expect(await screen.findByText('No se pudo reconfirmar.')).toBeTruthy()
  click('Confirmar asistencia', card)
  expect(await within(card).findByText('Estado: Confirmado')).toBeTruthy()
  click('Salir de la sesión', card)
  expect(await screen.findByText('No se pudo salir de la sesión.')).toBeTruthy()
  click('Salir de la sesión', card)
  expect(await within(card).findByText('Estado: Saliste de la sesión')).toBeTruthy()
  expect(api.post.mock.calls.map(([path]) => path)).toEqual([
    '/sessions/42/reschedules/3/confirm', '/sessions/42/reschedules/3/confirm',
    '/sessions/42/leave', '/sessions/42/leave',
  ])
})

test('el organizador cancela a través del diálogo y el listado muestra la información actualizada', async () => {
  const { state } = renderDashboard({ sessions: [ownerSession()] })
  api.post.mockImplementationOnce(async () => {
    state.sessions = [ownerSession({ status: 'cancelada' })]
    state.cancellation = { 42: 'Aula cerrada' }
    return {}
  })
  click('Cancelar sesión', await findCard())
  let dialog = screen.getByRole('dialog', { name: 'Cancelar sesión' })
  click('Volver', dialog)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(api.post).not.toHaveBeenCalled()
  click('Cancelar sesión', await findCard())
  dialog = screen.getByRole('dialog', { name: 'Cancelar sesión' })
  fireEvent.change(within(dialog).getByLabelText('Motivo de cancelación'), { target: { value: 'Aula cerrada' } })
  click('Confirmar cancelación', dialog)
  expect(await screen.findByText('Aula cerrada')).toBeTruthy()
  expect(api.post).toHaveBeenCalledWith('/sessions/42/cancel', { reason: 'Aula cerrada' }, {
    headers: { 'X-Analytics-Attempt': 'cancelar_sesion' },
  })
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('el participante consulta su asistencia y envía una justificación', async () => {
  const { state } = renderDashboard({
    sessions: [session({ status: 'cerrada', date: '2025-12-10', finished_at: '2025-12-10T20:00:00Z' })],
    own: [request({ status: 'aceptada' })], attendance: [42], roster: [attendee],
  }, true)
  api.request.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async () => {
    state.roster = [{
      ...attendee, justification: 'Consulta médica', justification_status: 'pendiente',
      history: [{ id: 1, actor_name: user.full_name, action: 'justificacion', previous_status: null,
        new_status: 'pendiente', note: 'Consulta médica', created_at: '2025-12-10T22:00:00Z' }],
    }]
    return {}
  })
  const card = await findCard()
  expect(card.textContent).toMatch(/Consulta tu asistencia/)
  click('Consultar mi asistencia', card)
  const dialog = screen.getByRole('dialog', { name: 'Asistencia y justificaciones' })
  const field = await within(dialog).findByLabelText('Justifica tu ausencia')
  fireEvent.invalid(field)
  fireEvent.change(field, { target: { value: 'Consulta médica' } })
  click('Enviar justificación', dialog)
  expect((await within(dialog).findByRole('alert')).textContent).toBe('No se pudo guardar el cambio.')
  click('Enviar justificación', dialog)
  expect(await within(dialog).findByText('Justificación · Pendiente de revisión')).toBeTruthy()
  expect(api.request).toHaveBeenLastCalledWith({
    url: '/sessions/42/attendance/justification', method: 'post', data: { text: 'Consulta médica' },
    headers: { 'X-Analytics-Attempt': 'enviar_justificacion' },
  })
  click('Cerrar asistencia', dialog)
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('crear comprueba campos, cupos y materia nueva antes de publicar una sesión con hora', async () => {
  const published = ownerSession({ id: 73, name: 'Nuevo grupo de estudio', subject: 'Algoritmos', time: '16:30:00' })
  api.post.mockImplementation(path => Promise.resolve({
    data: path === '/subjects/' ? { id: 5, name: 'Algoritmos' } : published,
  }))
  renderDashboard()
  await findCard()
  click(/Crear Sesión/)
  const name = screen.getByLabelText('Nombre de la Sesión')
  const form = name.form
  fireEvent.invalid(name)
  fireEvent.submit(form)
  expect(screen.getByText(/completa todos los campos/)).toBeTruthy()
  fill(name, published.name)
  fill(screen.getByLabelText('Fecha', { exact: true }), published.date)
  fill(screen.getByLabelText('Hora opcional'), '16:30')
  const spots = screen.getByLabelText('Cupos disponibles')
  fill(spots, '0')
  fireEvent.submit(form)
  expect(screen.getByText(/deben ser al menos 1/)).toBeTruthy()
  fill(spots, '3')
  fill(screen.getByLabelText('Materia asociada'), '__OTRO__')
  fireEvent.submit(form)
  expect(screen.getByText(/ingresa el nombre de la nueva materia/)).toBeTruthy()
  fill(form.querySelector('input[minlength="3"]'), 'Algoritmos')
  fireEvent.submit(form)
  expect((await findCard(published.name)).textContent).toContain('16:30')
  expect(api.post).toHaveBeenCalledWith('/subjects/', { name: 'Algoritmos' })
  expect(api.post).toHaveBeenCalledWith('/sessions/', expect.objectContaining({
    name: published.name, subject: 'Algoritmos', time: '16:30', spots: 3,
  }), { headers: { 'X-Analytics-Attempt': 'crear_sesion' } })
})

test('edita la hora y exige un nombre cuando se elige una materia nueva', async () => {
  const revised = ownerSession({ time: '17:30:00' })
  api.put.mockResolvedValueOnce({ data: revised })
  renderDashboard({ sessions: [ownerSession()] })
  click(/Editar/, await findCard())
  const time = screen.getByLabelText('Hora opcional')
  const form = time.form
  fireEvent.invalid(time)
  const subject = form.querySelector('select')
  fill(subject, '__OTRO__')
  fireEvent.submit(form)
  expect(screen.getByText(/Por favor ingresa el nombre de la materia/)).toBeTruthy()
  fill(subject, 'Programación II')
  fill(time, '17:30')
  fireEvent.submit(form)
  await waitFor(() => expect(screen.getByText(/actualizada con éxito/)).toBeTruthy())
  expect(api.put).toHaveBeenCalledExactlyOnceWith('/sessions/42', expect.objectContaining({
    subject: 'Programación II', time: '17:30',
  }), { headers: { 'X-Analytics-Attempt': 'editar_sesion' } })
})

test('el organizador reintenta cerrar inscripciones y puede eliminar la sesión por confirmación', async () => {
  api.patch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { status: 'cerrada' } })
  api.delete.mockResolvedValueOnce({})
  renderDashboard({ sessions: [ownerSession()] })
  const card = await findCard()
  click(/Cerrar inscripciones/, card)
  expect(await screen.findByText(/Error al cerrar las inscripciones/)).toBeTruthy()
  click(/Cerrar inscripciones/, card)
  expect(await screen.findByText(/El cambio quedó guardado/)).toBeTruthy()
  click(/Eliminar/, card)
  click('Sí, Eliminar')
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Repaso de programación' })).toBeNull())
  expect(api.delete).toHaveBeenCalledExactlyOnceWith('/sessions/42', {
    headers: { 'X-Analytics-Attempt': 'eliminar_sesion' },
  })
})

test('una solicitud aun sin enviar se puede cerrar con Escape o Cancelar', async () => {
  renderDashboard()
  const card = await findCard()
  click('Solicitar Inscribirme', card)
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Solicitar participar' }), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  click('Solicitar Inscribirme', card)
  click('Cancelar', screen.getByRole('dialog', { name: 'Solicitar participar' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(api.post).not.toHaveBeenCalled()
})

test('un cierre confirmado por el servidor mientras el diálogo está abierto impide registrar la solicitud', async () => {
  const detail = 'Una sesión cerrada no acepta nuevos participantes.'
  api.post.mockRejectedValueOnce(Object.assign(new Error(detail), { response: { data: { detail } } }))
  renderDashboard()
  const card = await findCard()
  click('Solicitar Inscribirme', card)
  click('Enviar solicitud')
  expect(await screen.findByText(detail, { exact: true })).toBeTruthy()
  expect(within(card).queryByText('Estado: Pendiente de aprobación')).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Solicitar participar' })).toBeTruthy()
})

test('el organizador puede cerrar la reprogramación y rechazar sin promover la solicitud', async () => {
  const { state } = renderDashboard({ sessions: [ownerSession()], managed: new Error('offline') })
  const card = await findCard()
  click('Reprogramar sesión', card)
  click('Cerrar reprogramación', screen.getByRole('dialog', { name: 'Reprogramar sesión' }))
  click('Gestionar solicitudes', card)
  const dialog = screen.getByRole('dialog', { name: 'Solicitudes de Repaso de programación' })
  expect((await within(dialog).findByRole('alert')).textContent).toBe('No se pudieron cargar las solicitudes.')
  click('Cerrar solicitudes', dialog)
  state.managed = [request({ status: 'en_espera', queue_position: 1 })]
  api.patch.mockImplementationOnce(async () => {
    state.managed = [request({ status: 'rechazada' })]
    return {}
  })
  click('Gestionar solicitudes', card)
  fireEvent.click(await screen.findByRole('button', { name: 'Rechazar' }))
  expect(await screen.findByText('Estado: Solicitud rechazada')).toBeTruthy()
  expect(api.patch).toHaveBeenCalledWith('/sessions/42/requests/9', { decision: 'rechazar' }, {
    headers: { 'X-Analytics-Attempt': 'gestionar_solicitudes' },
  })
})

test('permite retirarse de un cupo reservado sin reconfirmar el nuevo horario', async () => {
  const { state } = renderDashboard({ own: [request({ status: 'aceptada' })], changes: [change] }, true)
  api.post.mockImplementationOnce(async () => {
    state.own = [request({ status: 'retirada' })]
    state.changes = []
    return {}
  })
  const card = await findCard()
  click('Retirarme', card)
  expect(await within(card).findByText('Estado: Saliste de la sesión')).toBeTruthy()
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/sessions/42/leave', undefined, {
    headers: { 'X-Analytics-Attempt': 'retirarse' },
  })
})

test('el organizador finaliza, registra asistencia y resuelve una justificación', async () => {
  const initial = ownerSession({ date: '2026-11-17' })
  const finished = { ...initial, status: 'cerrada', finished_at: '2026-11-17T20:00:00Z' }
  const member = { user_id: 18, user_name: 'Ana Torres', user_email: 'ana@example.com', status: 'sin_registrar', history: [] }
  const { state } = renderDashboard({ sessions: [initial], roster: new Error('offline') })
  const card = await findCard()
  click('Registrar asistencia', card)
  let dialog = screen.getByRole('dialog', { name: 'Asistencia y justificaciones' })
  expect((await within(dialog).findByRole('alert')).textContent).toBe('No se pudo consultar la asistencia.')
  click('Cerrar asistencia', dialog)
  state.roster = []
  api.post.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async () => {
    state.sessions = [finished]
    state.roster = [member]
    return { data: finished }
  })
  click('Registrar asistencia', card)
  dialog = screen.getByRole('dialog', { name: 'Asistencia y justificaciones' })
  const finalize = await within(dialog).findByRole('button', { name: 'Finalizar sesión y registrar asistencia' })
  fireEvent.click(finalize)
  expect((await within(dialog).findByRole('alert')).textContent).toBe('No se pudo finalizar la sesión.')
  click('Cerrar asistencia', dialog)
  click('Registrar asistencia', card)
  fireEvent.click(await screen.findByRole('button', { name: 'Finalizar sesión y registrar asistencia' }))
  dialog = screen.getByRole('dialog', { name: 'Asistencia y justificaciones' })
  const row = await within(dialog).findByRole('listitem', { name: 'Asistencia de ana@example.com' })
  api.request.mockImplementationOnce(async () => { state.roster = [{ ...member, status: 'presente' }] })
  click('Marcar presente', row)
  expect(await within(row).findByText('Asistencia · Presente')).toBeTruthy()
  api.request.mockImplementationOnce(async () => {
    state.roster = [{ ...member, status: 'ausente', justification_status: 'pendiente', justification: 'Consulta médica' }]
  })
  click('Marcar ausente', row)
  const reason = await within(row).findByLabelText('Motivo de la resolución')
  fireEvent.invalid(reason)
  fill(reason, 'El justificativo es válido')
  api.request.mockImplementationOnce(async () => {
    state.roster = [{ ...member, status: 'ausente', justification_status: 'aceptada', decision_reason: 'El justificativo es válido' }]
  })
  click('Aceptar justificación', row)
  expect(await within(row).findByText('Justificación · Aceptada')).toBeTruthy()
  expect(api.request).toHaveBeenLastCalledWith(expect.objectContaining({
    method: 'patch', url: '/sessions/42/attendance/18/justification',
    data: { decision: 'aceptar', reason: 'El justificativo es válido' },
  }))
})
