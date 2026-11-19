// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import api from '../src/api/axios'
import { startFlow } from '../src/api/analytics'
import { AuthProvider } from '../src/context/AuthContext'
import { ThemeProvider } from '../src/context/ThemeContext'
import Login from '../src/pages/Login'
import Register from '../src/pages/Register'
import ForgotPassword from '../src/pages/ForgotPassword'

vi.mock('../src/api/axios', () => ({ default: { post: vi.fn() } }))

const EMAIL = 'carla@example.com'
const PASSWORD = 'DemoSegura123!'
const authResponse = { data: { access_token: 'token-ficticio', user: { id: 1, email: EMAIL } } }

beforeEach(() => {
  api.post.mockReset().mockResolvedValue({})
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function renderAccess(route) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/dashboard" element={<h1>Área privada</h1>} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

function fill(label, value) {
  const input = screen.getByLabelText(label, { exact: true })
  fireEvent.change(input, { target: { value } })
  return input
}

function click(name) {
  fireEvent.click(screen.getByRole('button', { name }))
}

test('el aviso de cuenta eliminada aparece una vez y se puede reintentar el acceso', async () => {
  sessionStorage.setItem('accountDeleted', 'true')
  let loginCalls = 0
  api.post.mockImplementation(async path => {
    if (path !== '/auth/login') return {}
    if (loginCalls++ === 0) throw new Error('offline')
    return authResponse
  })
  renderAccess('/login')
  expect(screen.getByRole('status').textContent).toBe('Tu cuenta fue eliminada.')
  expect(sessionStorage.getItem('accountDeleted')).toBeNull()
  fireEvent.invalid(fill('Correo electrónico', EMAIL))
  fill('Contraseña', PASSWORD)
  click('Iniciar sesión')
  expect(await screen.findByText('Error al iniciar sesión')).toBeTruthy()
  click('Iniciar sesión')
  expect(await screen.findByRole('heading', { name: 'Área privada' })).toBeTruthy()
  expect(localStorage.getItem('token')).toBe('token-ficticio')
  const attempts = api.post.mock.calls.filter(([path]) => path === '/auth/login')
  expect(attempts[0][2].headers['X-Analytics-Attempt']).toBe(attempts[1][2].headers['X-Analytics-Attempt'])
  const observations = api.post.mock.calls.filter(([path]) => path === '/analytics/public-observations')
  expect(observations.map(([, data]) => data.result)).toEqual(['inicio', 'validacion_fallida'])
})

test('el registro valida nombres y contraseñas antes de enviar y correlaciona los reintentos', async () => {
  let registerCalls = 0
  api.post.mockImplementation(async path => {
    if (path !== '/auth/register') return {}
    if (registerCalls++ === 0) throw { response: { data: { detail: [{ msg: 'Correo ya registrado' }] } } }
    return authResponse
  })
  renderAccess('/register')
  fireEvent.invalid(fill('Nombres', ' '))
  fill('Apellidos', 'Rojas')
  fill('Correo Electrónico', EMAIL)
  fill('Contraseña', 'débil')
  fill('Confirmar Contraseña', 'distinta')
  click('Crear cuenta')
  expect(screen.getByText('Por favor ingresa tus nombres y apellidos')).toBeTruthy()
  fill('Nombres', 'Carla')
  click('Crear cuenta')
  expect(screen.getByText(/La contraseña debe cumplir/)).toBeTruthy()
  fill('Contraseña', PASSWORD)
  click('Crear cuenta')
  expect(screen.getByText('Las contraseñas no coinciden')).toBeTruthy()
  fill('Confirmar Contraseña', PASSWORD)
  click('Crear cuenta')
  expect(await screen.findByText('Correo ya registrado')).toBeTruthy()
  click('Crear cuenta')
  expect(await screen.findByRole('heading', { name: 'Área privada' })).toBeTruthy()
  expect(registerCalls).toBe(2)
  expect(JSON.parse(localStorage.getItem('user')).email).toBe(EMAIL)
})

async function sendCode() {
  fireEvent.invalid(fill('Correo Electrónico', EMAIL))
  click('Enviar código de verificación')
  expect(await screen.findByRole('heading', { name: 'Ingresa el código' })).toBeTruthy()
}

function pasteCode() {
  const digits = screen.getAllByRole('textbox')
  fireEvent.invalid(digits[0])
  fireEvent.paste(digits[0], { clipboardData: { getData: () => 'Código: 123 456' } })
  expect(digits.map(field => field.value).join('')).toBe('123456')
  click('Verificar código')
}

test('recuperación permite corregir el correo y volver a enviar el código tras un error', async () => {
  let outgoing = 0
  api.post.mockImplementation(async path => {
    if (path === '/auth/send-reset-code' && outgoing++ === 0) throw new Error('offline')
    return {}
  })
  renderAccess('/forgot-password')
  fill('Correo Electrónico', EMAIL)
  click('Enviar código de verificación')
  expect(await screen.findByText('No se pudo enviar el código. Verifica tu correo.')).toBeTruthy()
  await sendCode()
  click(/Cambiar correo/)
  expect(screen.getByRole('heading', { name: 'Recuperar contraseña' })).toBeTruthy()
  await sendCode()
  expect(outgoing).toBe(3)
})

test('verifica el código y permite iniciar sesión sin cambiar la contraseña', async () => {
  api.post.mockImplementation(async path => path === '/auth/login-with-code' ? authResponse : {})
  renderAccess('/forgot-password')
  await sendCode()
  const codeField = screen.getAllByRole('textbox')[0]
  fireEvent.submit(codeField.form)
  expect(screen.getByText('Ingresa los 6 dígitos del código de verificación')).toBeTruthy()
  pasteCode()
  expect(await screen.findByRole('heading', { name: 'Nueva contraseña' })).toBeTruthy()
  click(/Iniciar sesi[oó]n|Omitir/i)
  expect(await screen.findByRole('heading', { name: 'Área privada' })).toBeTruthy()
  expect(api.post).toHaveBeenCalledWith('/auth/login-with-code', { email: EMAIL, code: '123456' },
    expect.objectContaining({ headers: expect.objectContaining({ 'X-Analytics-Attempt': expect.any(String) }) }))
})

test('el código se puede reenviar después del tiempo de espera con el mismo intento', async () => {
  vi.useFakeTimers()
  renderAccess('/forgot-password')
  fill('Correo Electrónico', EMAIL)
  await act(async () => click('Enviar código de verificación'))
  expect(screen.queryByRole('button', { name: /Reenviar código/ })).toBeNull()
  await act(async () => vi.advanceTimersByTime(60_000))
  await act(async () => click(/Reenviar código/))
  expect(screen.getByText('Nuevo código enviado. Revisa tu correo.')).toBeTruthy()
  const sendCalls = api.post.mock.calls.filter(([path]) => path === '/auth/send-reset-code')
  expect(sendCalls).toHaveLength(2)
  expect(sendCalls[1]).toEqual(sendCalls[0])
})

test('comprueba requisitos y confirma una contraseña nueva con el código verificado', async () => {
  renderAccess('/forgot-password')
  await sendCode()
  pasteCode()
  expect(await screen.findByRole('heading', { name: 'Nueva contraseña' })).toBeTruthy()
  fireEvent.invalid(fill('Nueva Contraseña', 'débil'))
  fill('Confirmar Contraseña', 'distinta')
  click('Cambiar contraseña')
  expect(screen.getByText(/La contraseña debe cumplir/)).toBeTruthy()
  fill('Nueva Contraseña', PASSWORD)
  click('Cambiar contraseña')
  expect(screen.getByText('Las contraseñas no coinciden')).toBeTruthy()
  fill('Confirmar Contraseña', PASSWORD)
  vi.useFakeTimers()
  await act(async () => click('Cambiar contraseña'))
  expect(screen.getByText('¡Contraseña restablecida con éxito!')).toBeTruthy()
  await act(async () => vi.advanceTimersByTime(2000))
  expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeTruthy()
})

test('si falla la observación de inicio de una solicitud, el intento local sigue disponible', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  api.post.mockRejectedValueOnce(new Error('offline'))
  const attempt = startFlow('solicitar_unirse', 42)
  await Promise.resolve()
  expect(attempt).toMatchObject({ flow: 'solicitar_unirse', id: expect.any(String) })
  expect(warn).toHaveBeenCalledWith('No se pudo guardar el inicio de la solicitud.')
})
