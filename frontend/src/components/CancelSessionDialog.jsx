import { useEffect, useRef, useState } from 'react'
import api from '../api/axios'
import { attemptConfig, recordInvalid } from '../api/analytics'
import { formatSchedule } from '../utils/schedule'

export default function CancelSessionDialog({ session, attempt, onClose, onCancelled }) {
  const dialog = useRef(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => element.close()
  }, [])

  const dismiss = () => {
    dialog.current.close()
    onClose()
  }

  const submit = async event => {
    event.preventDefault()
    const trimmedReason = reason.trim()
    if (!trimmedReason) {
      recordInvalid(attempt)
      setError('Escribe el motivo de la cancelación.')
      return
    }

    setSaving(true)
    setError('')
    try {
      await api.post(`/sessions/${session.id}/cancel`, { reason: trimmedReason }, attemptConfig(attempt))
    } catch (error) {
      const detail = error.response?.data?.detail
      setError(Array.isArray(detail) ? 'Revisa el motivo de la cancelación.' : detail || 'No se pudo cancelar la sesión. Intenta de nuevo.')
      setSaving(false)
      return
    }
    dialog.current.close()
    onCancelled()
  }

  return (
    <dialog
      ref={dialog}
      className="modal cancel-session-dialog"
      aria-labelledby="cancel-session-title"
      aria-describedby="cancel-session-description"
      onCancel={event => {
        event.preventDefault()
        if (!saving) dismiss()
      }}
    >
      <h2 id="cancel-session-title">Cancelar sesión</h2>
      <div className="cancel-session-summary">
        <strong>{session.name}</strong>
        <span>{formatSchedule(session.date, session.time)}</span>
      </div>
      <p id="cancel-session-description">Las personas que solicitaron participar y siguen pendientes, confirmadas o en espera verán el motivo. La sesión dejará de admitir solicitudes y asistencia.</p>
      <form onSubmit={submit} onInvalid={() => recordInvalid(attempt)}>
        <label htmlFor="cancellation-reason">Motivo de cancelación</label>
        <textarea
          id="cancellation-reason"
          value={reason}
          onChange={event => { setReason(event.target.value); setError('') }}
          required
          maxLength={1000}
          disabled={saving}
        />
        {error && <p className="cancel-session-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={dismiss} disabled={saving}>Volver</button>
          <button type="submit" className="btn-danger-confirm" disabled={saving}>
            {saving ? 'Cancelando…' : 'Confirmar cancelación'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
