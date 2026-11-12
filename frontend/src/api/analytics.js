import { useRef } from 'react'
import api from './axios'

const publicFlows = new Set(['registro', 'acceso', 'recuperar_acceso'])

export function attemptConfig(attempt) {
  return attempt ? { headers: { 'X-Analytics-Attempt': attempt.id } } : undefined
}

function observe(attempt, result) {
  if (!attempt) return
  const endpoint = publicFlows.has(attempt.flow) ? '/analytics/public-observations' : '/analytics/observations'
  void api.post(endpoint, { flow: attempt.flow, attempt_id: attempt.id, result }, { timeout: 3000 })
    .catch(() => console.warn('No se pudo guardar una observación de analítica.'))
}

export function startFlow(flow, sessionId) {
  if (!globalThis.crypto?.randomUUID) return null
  const attempt = { flow, id: globalThis.crypto.randomUUID() }
  if (flow === 'solicitar_unirse') {
    void api.post('/analytics/start', { session_id: sessionId }, { ...attemptConfig(attempt), timeout: 3000 })
      .catch(() => console.warn('No se pudo guardar el inicio de la solicitud.'))
  } else {
    observe(attempt, 'inicio')
  }
  return attempt
}

export function recordSearchResult(attempt, hasResults) {
  observe(attempt, hasResults ? 'con_resultados' : 'sin_resultados')
}

export function recordInvalid(attempt) {
  if (!attempt || attempt.reportedInvalid) return
  attempt.reportedInvalid = true
  observe(attempt, 'validacion_fallida')
}

export function useFormAttempt(flow) {
  const attempt = useRef(null)
  return () => {
    attempt.current ??= startFlow(flow)
    return attempt.current
  }
}
