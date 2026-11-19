import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import api from '../src/api/axios'
import { attemptConfig, recordInvalid, recordSearchResult, startFlow } from '../src/api/analytics'

vi.mock('../src/api/axios', () => ({ default: { post: vi.fn() } }))

beforeEach(() => {
  api.post.mockReset().mockResolvedValue({})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('correlaciona el registro y envía un solo evento de validación fallida', async () => {
  const attempt = startFlow('registro')
  await attempt.ready
  recordInvalid(attempt)
  recordInvalid(attempt)

  expect(attemptConfig(attempt)).toEqual({ headers: { 'X-Analytics-Attempt': attempt.id } })
  expect(api.post).toHaveBeenCalledTimes(2)
  expect(api.post).toHaveBeenNthCalledWith(1, '/analytics/public-observations', {
    attempt_id: attempt.id, flow: 'registro', result: 'inicio',
  }, { timeout: 3000 })
  expect(api.post).toHaveBeenNthCalledWith(2, '/analytics/public-observations', {
    attempt_id: attempt.id, flow: 'registro', result: 'validacion_fallida',
  }, { timeout: 3000 })
})

test.each([[true, 'con_resultados'], [false, 'sin_resultados']])(
  'registra la búsqueda autenticada con resultados = %s',
  async (hasResults, result) => {
    const attempt = startFlow('buscar_sesiones')
    await attempt.ready
    recordSearchResult(attempt, hasResults)

    expect(api.post).toHaveBeenLastCalledWith('/analytics/observations', {
      attempt_id: attempt.id, flow: 'buscar_sesiones', result,
    }, { timeout: 3000 })
  },
)

test('asocia el intento de solicitud a la sesión seleccionada', () => {
  const attempt = startFlow('solicitar_unirse', 42)
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/analytics/start', { session_id: 42 }, {
    headers: { 'X-Analytics-Attempt': attempt.id }, timeout: 3000,
  })
})

test('si falla la analítica, el flujo puede continuar', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  api.post.mockRejectedValueOnce(new Error('Sin conexión'))

  await expect(startFlow('acceso').ready).resolves.toBeUndefined()
  expect(warning).toHaveBeenCalledOnce()
})

test('sin un identificador seguro, omite la observación', () => {
  vi.stubGlobal('crypto', undefined)
  const attempt = startFlow('registro')

  expect(attempt).toBeNull()
  expect(attemptConfig(attempt)).toBeUndefined()
  recordInvalid(attempt)
  recordSearchResult(attempt, false)
  expect(api.post).not.toHaveBeenCalled()
})
