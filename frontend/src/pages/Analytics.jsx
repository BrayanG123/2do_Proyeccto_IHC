import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios'
import ThemeToggle from '../components/ThemeToggle'
import '../styles/Analytics.css'

export default function Analytics() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadSummary = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.get('/analytics/summary')
      setSummary(response.data)
    } catch {
      setError('No se pudo cargar la analítica. Intenta actualizar el panel.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadSummary() }, [loadSummary])

  return (
    <main className="analytics-page">
      <header className="analytics-header">
        <div>
          <Link to="/dashboard">Volver al Dashboard</Link>
          <h1>Analítica de solicitudes</h1>
          <p>Panel de desarrollo · ¿Cuántas solicitudes se empiezan y cuántas se envían?</p>
        </div>
        <ThemeToggle />
      </header>
      <button type="button" className="analytics-refresh" onClick={loadSummary} disabled={loading}>
        {loading ? 'Cargando…' : 'Actualizar panel'}
      </button>
      {error && <p role="alert">{error}</p>}
      {!error && summary && (
        <>
          <section className="analytics-metrics" aria-label="Resumen de solicitudes">
            <article><h2>Solicitudes iniciadas</h2><p data-testid="started-count">{summary.iniciadas}</p></article>
            <article><h2>Solicitudes enviadas</h2><p data-testid="sent-count">{summary.enviadas}</p></article>
            <article><h2>Porcentaje de finalización</h2><p data-testid="completion-rate">{summary.porcentaje_finalizacion} %</p></article>
          </section>
          <p>El porcentaje se calcula como envíos ÷ inicios × 100. Se cuentan eventos acumulados.</p>
          <h2>Últimos eventos</h2>
          {summary.ultimos_eventos.length === 0 ? <p>Aún no hay eventos registrados.</p> : (
            <div className="analytics-table-wrapper">
              <table>
                <caption>Diez registros más recientes · Hora de Bolivia</caption>
                <thead><tr><th>Evento</th><th>Modalidad</th><th>Fecha y hora</th></tr></thead>
                <tbody>
                  {summary.ultimos_eventos.map(event => (
                    <tr key={event.id}>
                      <td>{event.event}</td><td>{event.modality}</td>
                      <td>{new Date(event.created_at).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}</td>
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
