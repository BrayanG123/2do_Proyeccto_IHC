// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import './dialog-environment'
import api from '../src/api/axios'
import { recordInvalid, startFlow } from '../src/api/analytics'
import AccountData from '../src/components/AccountData'

vi.mock('../src/api/axios', () => ({ default: { get: vi.fn(), delete: vi.fn() } }))
vi.mock('../src/api/analytics', () => ({
  startFlow: vi.fn(),
  recordInvalid: vi.fn(),
  attemptConfig: ({ id }) => ({ headers: { 'X-Analytics-Attempt': id } }),
}))

const profile = {
  perfil: { full_name: 'Carla Rojas', email: 'carla@example.com', created_at: '2026-11-18T13:00:00Z' },
  sesiones_organizadas: [], solicitudes: [{ estado: 'confirmada' }], asistencia: [],
  reprogramaciones_organizadas: [], reconfirmaciones: [], historial: [],
}

beforeEach(() => {
  vi.resetAllMocks()
  startFlow.mockReturnValue({ id: 'cuenta-prueba', ready: Promise.resolve() })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('muestra el error de consulta, permite reintentar y oculta los datos propios', async () => {
  api.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: profile })
  render(<AccountData onAccountDeleted={vi.fn()} />)
  const view = screen.getByRole('button', { name: 'Ver mis datos' })
  fireEvent.click(view)
  expect((await screen.findByRole('alert')).textContent).toMatch(/No se pudieron cargar/)
  fireEvent.click(view)
  expect(await screen.findByText('Carla Rojas')).toBeTruthy()
  expect(screen.getByText('2026-11-18')).toBeTruthy()
  expect(screen.getByText('Solicitudes de participación (1)')).toBeTruthy()
  expect(document.querySelector('#account-data-preview').textContent).toContain('confirmada')
  expect(api.get).toHaveBeenLastCalledWith('/auth/me/data')
  fireEvent.click(screen.getByRole('button', { name: 'Ocultar mis datos' }))
  expect(screen.queryByText('Carla Rojas')).toBeNull()
})

test('la descarga usa el nombre de archivo correcto y libera el objeto temporal', async () => {
  vi.useFakeTimers()
  const blob = new Blob(['{}'], { type: 'application/json' })
  const objectUrl = 'blob:studymatch/prueba'
  const createObjectURL = vi.fn().mockReturnValue(objectUrl)
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  api.get.mockResolvedValueOnce({ data: blob })
  render(<AccountData onAccountDeleted={vi.fn()} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Descargar JSON' })))
  expect(startFlow).toHaveBeenCalledWith('descargar_datos')
  expect(api.get).toHaveBeenCalledWith('/auth/me/data/download', {
    headers: { 'X-Analytics-Attempt': 'cuenta-prueba' }, responseType: 'blob',
  })
  expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(blob)
  expect(click).toHaveBeenCalledOnce()
  expect(click.mock.contexts[0].download).toBe('mis-datos-studymatch.json')
  vi.advanceTimersByTime(1000)
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl)
})

test('si falla la descarga permite reintentar y muestra una explicación', async () => {
  api.get.mockRejectedValueOnce(new Error('offline'))
  render(<AccountData onAccountDeleted={vi.fn()} />)
  const download = screen.getByRole('button', { name: 'Descargar JSON' })
  fireEvent.click(download)
  expect((await screen.findByRole('alert')).textContent).toMatch(/No se pudieron descargar/)
  expect(download.disabled).toBe(false)
})

test.each([
  [{ response: { data: { detail: 'Contraseña incorrecta.' } } }, 'Contraseña incorrecta.'],
  [new Error('offline'), 'No se pudo eliminar la cuenta. Inténtalo de nuevo.'],
])('la eliminación mantiene la sesión si hay un error y admite un reintento', async (failure, message) => {
  api.delete.mockRejectedValueOnce(failure).mockResolvedValueOnce({})
  const removed = vi.fn()
  render(<AccountData onAccountDeleted={removed} />)
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }))
  const dialog = screen.getByRole('dialog', { name: 'Eliminar cuenta' })
  const password = within(dialog).getByLabelText('Contraseña actual')
  fireEvent.invalid(password)
  expect(recordInvalid).toHaveBeenCalledWith(expect.objectContaining({ id: 'cuenta-prueba' }))
  fireEvent.change(password, { target: { value: 'incorrecta' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar cuenta' }))
  expect((await within(dialog).findByRole('alert')).textContent).toBe(message)
  expect(removed).not.toHaveBeenCalled()
  fireEvent.change(password, { target: { value: 'DemoSegura123!' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar cuenta' }))
  await waitFor(() => expect(removed).toHaveBeenCalledOnce())
  expect(api.delete).toHaveBeenLastCalledWith('/auth/me', {
    headers: { 'X-Analytics-Attempt': 'cuenta-prueba' }, data: { password: 'DemoSegura123!' },
  })
  expect(dialog.open).toBe(false)
})

test('permite desistir de la eliminación antes de enviar la contraseña', () => {
  render(<AccountData onAccountDeleted={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }))
  const dialog = screen.getByRole('dialog', { name: 'Eliminar cuenta' })
  const field = within(dialog).getByLabelText('Contraseña actual')
  fireEvent.change(field, { target: { value: 'una contraseña de prueba' } })
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Volver' }))
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }))
  expect(field.value).toBe('')
  expect(api.delete).not.toHaveBeenCalled()
})
