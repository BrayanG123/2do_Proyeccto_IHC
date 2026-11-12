import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios'
import ThemeToggle from '../components/ThemeToggle'
import '../styles/Analytics.css'

const reasonLabels = {
  validacion_fallida: 'Validación fallida',
  acceso_denegado: 'Acceso denegado',
  permiso_denegado: 'Permiso denegado',
  recurso_no_disponible: 'Recurso no disponible',
  estado_incompatible: 'Estado incompatible',
  limite_de_intentos: 'Límite de intentos',
  servicio_no_disponible: 'Servicio no disponible',
}

const formatNumber = new Intl.NumberFormat('es-BO')
const formatDate = new Intl.DateTimeFormat('es-BO', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/La_Paz',
})

function largestDrop(funnels) {
  let largest = null
  for (const funnel of funnels) {
    for (const [index, step] of funnel.steps.entries()) {
      if (!step.lost) continue
      if (!largest || step.drop_rate > largest.step.drop_rate ||
          (step.drop_rate === largest.step.drop_rate && step.lost > largest.step.lost)) {
        largest = { funnel, step, previous: funnel.steps[index - 1] }
      }
    }
  }
  return largest
}

function FunnelCard({ funnel }) {
  const total = funnel.steps[0].count
  return (
    <article className="analytics-funnel" aria-labelledby={`funnel-${funnel.id}`}>
      <h3 id={`funnel-${funnel.id}`}>{funnel.label}</h3>
      <ol className="analytics-steps">
        {funnel.steps.map(step => (
          <li key={step.event}>
            <div className="analytics-step-label">
              <span>{step.label}</span>
              <strong data-testid={step.event}>{formatNumber.format(step.count)}</strong>
            </div>
            <div className="analytics-step-track" aria-hidden="true">
              <div style={{ width: `${total ? step.count / total * 100 : 0}%` }} />
            </div>
            {step.drop_rate !== null && (
              <p className="analytics-drop" data-testid={`drop-${step.event}`}>
                Caída de {formatNumber.format(step.drop_rate)} % · {formatNumber.format(step.lost)} sin avanzar
              </p>
            )}
          </li>
        ))}
      </ol>
      {total === 0 && <p className="analytics-note">Sin intentos registrados.</p>}
      {funnel.empty_results !== null && <p className="analytics-note">Sin resultados · <strong>{formatNumber.format(funnel.empty_results)}</strong></p>}
      {funnel.blockers.length > 0 && (
        <div className="analytics-blockers">
          <h4>Bloqueos registrados</h4>
          <ul>
            {funnel.blockers.map(({ reason, count }) => (
              <li key={reason}><span>{reasonLabels[reason]}</span><strong>{formatNumber.format(count)}</strong></li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}

export default function Analytics() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadSummary = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.get('/analytics/funnels')
      setSummary(response.data)
    } catch {
      setError('No se pudo cargar la analítica. Intenta actualizar el panel.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadSummary() }, [loadSummary])

  const drop = summary && largestDrop(summary.funnels)

  return (
    <main className="analytics-page">
      <header className="analytics-header">
        <div>
          <Link to="/dashboard">Volver al Dashboard</Link>
          <h1>Analítica de StudyMatch</h1>
        </div>
        <ThemeToggle />
      </header>
      <button type="button" className="analytics-refresh" onClick={loadSummary} disabled={loading}>
        {loading ? 'Cargando…' : 'Actualizar panel'}
      </button>
      {error && <p role="alert">{error}</p>}
      {!error && summary && (
        <>
          {drop && (
            <section className="analytics-largest" aria-label="Mayor caída observada">
              <h2>Mayor caída observada</h2>
              <p><strong>{drop.funnel.label}</strong> · {drop.previous.label} → {drop.step.label}</p>
              <p>{formatNumber.format(drop.step.drop_rate)} % · {formatNumber.format(drop.step.lost)} de {formatNumber.format(drop.previous.count)} intentos aún sin avanzar</p>
            </section>
          )}
          <section aria-labelledby="analytics-funnels">
            <h2 id="analytics-funnels">Embudos por flujo</h2>
            <p className="analytics-note">Cada intento se cuenta una vez por paso. La caída se calcula sobre los intentos del paso anterior.</p>
            <div className="analytics-grid">
              {summary.funnels.map(funnel => <FunnelCard key={funnel.id} funnel={funnel} />)}
            </div>
          </section>
          <h2>Últimos eventos</h2>
          {summary.recent_events.length === 0 ? <p>Aún no hay eventos registrados.</p> : (
            <div className="analytics-table-wrapper">
              <table>
                <caption>Hora de Bolivia</caption>
                <thead><tr><th scope="col">Evento</th><th scope="col">Detalle</th><th scope="col">Fecha y hora</th></tr></thead>
                <tbody>
                  {summary.recent_events.map(event => (
                    <tr key={event.id}>
                      <td>{event.event}</td><td>{event.reason ? reasonLabels[event.reason] : (event.modality || '—')}</td>
                      <td>{formatDate.format(new Date(event.created_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  )
}
