// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import './dialog-environment'
import api from '../src/api/axios'
import { AuthProvider } from '../src/context/AuthContext'
import { ThemeProvider } from '../src/context/ThemeContext'
import History from '../src/pages/History'
import Profile from '../src/pages/Profile'

vi.mock('../src/api/axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const user = {
  id: 17, first_name: 'Carla', last_name: 'Rojas', full_name: 'Carla Rojas', email: 'carla@example.com',
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.setItem('token', 'token-de-prueba')
  localStorage.setItem('user', JSON.stringify(user))
  api.get.mockResolvedValue({ data: user })
  api.post.mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

function page(element) {
  return render(<MemoryRouter><ThemeProvider><AuthProvider>{element}</AuthProvider></ThemeProvider></MemoryRouter>)
}

function press(name, scope = document.body) {
  fireEvent.click(within(scope).getByRole('button', { name }))
}

test('edita datos con un único intento, valida campos y persiste el perfil devuelto', async () => {
  const updated = { ...user, first_name: 'Carolina', full_name: 'Carolina Rojas' }
  api.put.mockResolvedValueOnce({ data: updated })
  page(<Profile />)
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/me'))
  press(/Editar Datos/i)
  const first = screen.getByLabelText('Nombres *')
  const mail = screen.getByLabelText('Correo Institucional / Personal *')
  fireEvent.invalid(first)
  fireEvent.change(first, { target: { value: ' ' } })
  fireEvent.submit(first.form)
  expect(screen.getByText('Nombres y apellidos son requeridos')).toBeTruthy()
  fireEvent.change(first, { target: { value: ' Carolina ' } })
  fireEvent.change(mail, { target: { value: '' } })
  fireEvent.submit(first.form)
  expect(screen.getByText('El correo electrónico es requerido')).toBeTruthy()
  fireEvent.change(mail, { target: { value: user.email } })
  press(/Guardar Cambios/i)
  expect(await screen.findByRole('heading', { name: 'Carolina Rojas' })).toBeTruthy()
  const [[, attempt]] = api.post.mock.calls
  expect(api.put).toHaveBeenCalledExactlyOnceWith('/auth/profile', {
    first_name: 'Carolina', last_name: 'Rojas', email: user.email,
  }, { headers: { 'X-Analytics-Attempt': attempt.attempt_id } })
  expect(JSON.parse(localStorage.getItem('user')).first_name).toBe('Carolina')
})

test('eliminar la cuenta cierra la sesión y deja el aviso para el próximo ingreso', async () => {
  api.delete.mockResolvedValueOnce({})
  page(<Profile />)
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/me'))
  press('Eliminar mi cuenta')
  const dialog = screen.getByRole('dialog', { name: 'Eliminar cuenta' })
  fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), { target: { value: 'DemoSegura123!' } })
  press('Eliminar cuenta', dialog)
  await waitFor(() => expect(sessionStorage.getItem('accountDeleted')).toBe('true'))
  expect(localStorage.getItem('token')).toBeNull()
  expect(localStorage.getItem('user')).toBeNull()
})

test('el historial distingue un filtro con resultados de uno vacío y cierra detalles al cambiar', async () => {
  api.get.mockResolvedValueOnce({ data: [{
    id: 51, event_type: 'creada', current_status: 'abierta',
    session_name: 'Repaso para el parcial', session_subject: 'Programación II',
    session_date: '2026-11-18', session_modality: 'Virtual', created_at: '2026-11-18T16:00:00Z',
  }] })
  page(<History />)
  const row = await screen.findByRole('button', { name: /Creaste.*Repaso para el parcial/ })
  fireEvent.click(row)
  expect(row.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(screen.getByRole('tab', { name: /Organicé/ }))
  expect(screen.getByRole('button', { name: /Creaste.*Repaso para el parcial/ }).getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(screen.getByRole('tab', { name: /Me uní/ }))
  expect(screen.getByText('Todavía no te uniste a ninguna sesión')).toBeTruthy()
  const results = api.post.mock.calls.filter(([, data]) => data.flow === 'filtrar_historial')
  expect(results.map(([, data]) => data.result)).toEqual(['inicio', 'con_resultados', 'inicio', 'sin_resultados'])
})
