// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import './dialog-environment'
import api from '../src/api/axios'
import { recordInvalid } from '../src/api/analytics'
import CancelSessionDialog from '../src/components/CancelSessionDialog'
import RescheduleDialog from '../src/components/RescheduleDialog'

vi.mock('../src/api/axios', () => ({ default: { post: vi.fn() } }))
vi.mock('../src/api/analytics', () => ({
  attemptConfig: (attempt) => ({ headers: { 'X-Analytics-Attempt': attempt.id } }),
  recordInvalid: vi.fn(),
}))

const session = { id: 42, name: 'Repaso de programación', date: '2026-12-10', time: '15:00:00', status: 'abierta' }
const attempt = { id: 'cambio-prueba' }
const headers = { headers: { 'X-Analytics-Attempt': attempt.id } }
const change = {
  id: 5, old_date: '2026-12-08', old_time: '15:00:00', new_date: session.date,
  new_time: session.time, reason: 'Cambio de aula', pending_count: 1, own_status: 'pendiente',
  responses: [{ user_id: 8, user_name: 'Carla Rojas', status: 'pendiente' }],
}

beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)

function renderCancel() {
  const onClose = vi.fn()
  const onCancelled = vi.fn()
  render(<CancelSessionDialog session={session} attempt={attempt} onClose={onClose} onCancelled={onCancelled} />)
  return { onClose, onCancelled, dialog: screen.getByRole('dialog', { name: 'Cancelar sesión' }) }
}

test('la cancelación exige un motivo y permite volver sin enviarlo', () => {
  const { onClose, dialog } = renderCancel()
  const reason = within(dialog).getByLabelText('Motivo de cancelación')
  fireEvent.invalid(reason)
  fireEvent.change(reason, { target: { value: '  ' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cancelación' }))
  expect(within(dialog).getByRole('alert').textContent).toMatch(/Escribe el motivo/)
  expect(recordInvalid).toHaveBeenCalledWith(attempt)
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Volver' }))
  expect(onClose).toHaveBeenCalledOnce()
})

test('al confirmar se envía el motivo recortado y se bloquea el cierre mientras se guarda', async () => {
  let finish
  api.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { onCancelled, onClose, dialog } = renderCancel()
  fireEvent.change(within(dialog).getByLabelText('Motivo de cancelación'), { target: { value: '  Aula cerrada  ' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cancelación' }))
  expect(within(dialog).getByRole('button', { name: 'Cancelando…' }).disabled).toBe(true)
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(onClose).not.toHaveBeenCalled()
  expect(api.post).toHaveBeenCalledWith('/sessions/42/cancel', { reason: 'Aula cerrada' }, headers)
  finish({})
  await waitFor(() => expect(onCancelled).toHaveBeenCalledOnce())
  expect(dialog.open).toBe(false)
})

test.each([
  [[{ msg: 'Longitud inválida' }], 'Revisa el motivo de la cancelación.'],
  ['La sesión ya finalizó.', 'La sesión ya finalizó.'],
  [undefined, 'No se pudo cancelar la sesión. Intenta de nuevo.'],
])('el rechazo de cancelación mantiene abierto el diálogo (%s)', async (detail, message) => {
  api.post.mockRejectedValueOnce({ response: { data: { detail } } })
  const { onCancelled, onClose, dialog } = renderCancel()
  fireEvent.change(within(dialog).getByLabelText('Motivo de cancelación'), { target: { value: 'Aula cerrada' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cancelación' }))
  expect((await screen.findByRole('alert')).textContent).toBe(message)
  expect(onCancelled).not.toHaveBeenCalled()
  expect(dialog.open).toBe(true)
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(onClose).toHaveBeenCalledOnce()
})

function renderReschedule(props = {}) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(<RescheduleDialog session={session} changes={[]} isOrganizer onSaved={onSaved} onClose={onClose} attempt={attempt} {...props} />)
  return { onSaved, onClose }
}

test('la ficha de cambios del participante muestra su respuesta y no permite editar', () => {
  const { onClose } = renderReschedule({ changes: [change], isOrganizer: false })
  expect(screen.getByRole('dialog', { name: 'Cambios de la sesión' })).toBeTruthy()
  expect(screen.getByText('Tu respuesta · pendiente')).toBeTruthy()
  expect(screen.getByText('Carla Rojas · pendiente')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Guardar reprogramación' })).toBeNull()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
})

test('la confirmación de cambios pendientes impide que el organizador vuelva a reprogramar', () => {
  renderReschedule({ changes: [change] })
  expect(screen.getByRole('status').textContent).toMatch(/Faltan 1 respuestas/)
  expect(screen.getByLabelText('Nueva fecha').matches(':disabled')).toBe(true)
})

test('envía la fecha, los datos nuevos y un valor nulo cuando se quita la hora', async () => {
  api.post.mockResolvedValueOnce({})
  const { onSaved, onClose } = renderReschedule()
  fireEvent.change(screen.getByLabelText('Nueva fecha'), { target: { value: '2026-12-20' } })
  fireEvent.change(screen.getByLabelText('Nueva hora'), { target: { value: '' } })
  const reason = screen.getByLabelText('Motivo del cambio')
  fireEvent.invalid(reason)
  expect(recordInvalid).toHaveBeenCalledWith(attempt)
  fireEvent.change(reason, { target: { value: 'Cambio de aula' } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar reprogramación' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(onSaved).toHaveBeenCalledOnce()
  expect(api.post).toHaveBeenCalledWith('/sessions/42/reschedule', {
    date: '2026-12-20', time: null, reason: 'Cambio de aula',
  }, headers)
})

test.each([
  [[{ msg: 'Revisa la fecha' }, { msg: 'Revisa la hora' }], 'Revisa la fecha. Revisa la hora'],
  ['Ya hay una reconfirmación pendiente.', 'Ya hay una reconfirmación pendiente.'],
  [undefined, 'No se pudo reprogramar la sesión.'],
])('informa por qué falló la reprogramación (%s)', async (detail, message) => {
  api.post.mockRejectedValueOnce({ response: { data: { detail } } })
  const { onSaved, onClose } = renderReschedule()
  fireEvent.change(screen.getByLabelText('Motivo del cambio'), { target: { value: 'Cambio de aula' } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar reprogramación' }))
  expect((await screen.findByRole('alert')).textContent).toBe(message)
  expect(onSaved).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar reprogramación' }))
  expect(onClose).toHaveBeenCalledOnce()
})
