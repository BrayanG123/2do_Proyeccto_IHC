import { useEffect, useState } from 'react'
import api from '../api/axios'
import { formatSchedule } from '../utils/schedule'
import '../styles/Reschedule.css'

export default function RescheduleDialog({ session, changes, isOrganizer, onSaved, onClose }) {
  const [date, setDate] = useState(session.date)
  const [time, setTime] = useState(session.time || '')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pendingCount = changes[0]?.pending_count || 0

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose, saving])

  const saveReschedule = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api.post(`/sessions/${session.id}/reschedule`, { date, time: time || null, reason })
      await onSaved()
      onClose()
    } catch (error) {
      const detail = error?.response?.data?.detail
      setError(Array.isArray(detail) ? detail.map(item => item.msg).join('. ') : detail || 'No se pudo reprogramar la sesión.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal reschedule-modal" role="dialog" aria-modal="true" aria-labelledby="reschedule-title">
        <header className="reschedule-header">
          <h2 id="reschedule-title">{isOrganizer ? 'Reprogramar sesión' : 'Cambios de la sesión'}</h2>
          <button type="button" className="btn-cancel" aria-label="Cerrar reprogramación" disabled={saving} onClick={onClose}>✕</button>
        </header>
        <p>{session.name}</p>
        {isOrganizer && (
          <form onSubmit={saveReschedule}>
            <p>Los participantes conservarán su cupo mientras confirman el cambio o se retiran.</p>
            {pendingCount > 0 && (
              <p role="status">Faltan {pendingCount} respuestas. Podrás reprogramar cuando todas estén resueltas.</p>
            )}
            <fieldset disabled={saving || pendingCount > 0 || session.status !== 'abierta'}>
              <legend>Nuevo encuentro</legend>
              <label htmlFor="reschedule-date">Nueva fecha</label>
              <input id="reschedule-date" type="date" value={date} onChange={e => setDate(e.target.value)} required />
              <label htmlFor="reschedule-time">Nueva hora</label>
              <input id="reschedule-time" type="time" step="1" value={time} onChange={e => setTime(e.target.value)} />
              <label htmlFor="reschedule-reason">Motivo del cambio</label>
              <textarea id="reschedule-reason" value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={1000} />
              <button type="submit" className="btn-confirm-edit" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar reprogramación'}
              </button>
            </fieldset>
            {error && <p role="alert">{error}</p>}
          </form>
        )}
        {changes.length > 0 && (
          <section aria-label="Historial de reprogramaciones">
            <h3>Historial de cambios</h3>
            <ol className="reschedule-history">
              {changes.map(change => (
                <li key={change.id}>
                  <dl>
                    <div><dt>Anterior</dt><dd>{formatSchedule(change.old_date, change.old_time)}</dd></div>
                    <div><dt>Nuevo</dt><dd>{formatSchedule(change.new_date, change.new_time)}</dd></div>
                    <div><dt>Motivo</dt><dd>{change.reason}</dd></div>
                  </dl>
                  <p>{change.pending_count} {change.pending_count === 1 ? 'respuesta pendiente' : 'respuestas pendientes'}</p>
                  {change.own_status && <p>Tu respuesta · {change.own_status}</p>}
                  {change.responses.length > 0 && (
                    <ul>
                      {change.responses.map(response => (
                        <li key={response.user_id}>{response.user_name} · {response.status}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  )
}
