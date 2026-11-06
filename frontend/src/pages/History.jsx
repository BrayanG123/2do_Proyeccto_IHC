import { useState, useMemo, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from '../components/ThemeToggle'
import LogoutIcon from '../components/LogoutIcon'
import api from '../api/axios'
import { getStudentInitials } from '../utils/avatar'
import '../styles/Dashboard.css'
import '../styles/History.css'

// Hick: solo tres opciones, agrupadas en un único control (Issue #15)
const FILTERS = [
  { key: 'todos', label: 'Todas', types: null },
  { key: 'unido', label: 'Me uní', types: ['unido'] },
  { key: 'creada', label: 'Organicé', types: ['creada', 'cerrada', 'eliminada'] },
]

// Carga cognitiva: cada tipo de evento se reconoce por ícono y verbo, sin recordar otras pantallas
const EVENT_META = {
  unido: { icon: '✅', verb: 'Te uniste a', tone: 'joined' },
  creada: { icon: '✨', verb: 'Creaste', tone: 'created' },
  cerrada: { icon: '🔒', verb: 'Cerraste las inscripciones de', tone: 'closed' },
  eliminada: { icon: '🗑️', verb: 'Eliminaste', tone: 'deleted' },
}

const STATUS_META = {
  abierta: { label: 'Inscripción abierta', className: 'status-open' },
  cerrada: { label: 'Inscripción cerrada', className: 'status-closed' },
  finalizada: { label: 'Finalizada', className: 'status-finished' },
  eliminada: { label: 'Sesión eliminada', className: 'status-deleted' },
}

const EMPTY_MESSAGES = {
  todos: {
    title: 'Aún no tienes actividad en StudyMatch',
    text: 'Cuando te unas a una sesión de estudio o crees una, aparecerá aquí con su fecha y su estado.',
  },
  unido: {
    title: 'Todavía no te uniste a ninguna sesión',
    text: 'Busca una sesión abierta de tu materia y únete; quedará registrada en tu historial.',
  },
  creada: {
    title: 'Todavía no organizaste ninguna sesión',
    text: 'Crea una sesión desde el panel de sesiones para invitar a tus compañeros.',
  },
}

function relativeTime(iso) {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 7) return `hace ${days} días`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return weeks === 1 ? 'hace 1 semana' : `hace ${weeks} semanas`
  const months = Math.floor(days / 30)
  return months <= 1 ? 'hace 1 mes' : `hace ${months} meses`
}

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-BO', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatSessionDate(isoDate) {
  if (!isoDate) return '—'
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('es-BO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

export default function History() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('todos')
  const [expandedId, setExpandedId] = useState(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  const studentInitials = useMemo(() => getStudentInitials(user), [user])

  const loadHistory = useCallback(() => {
    return api.get('/history/me')
      .then(res => {
        setEvents(res.data)
        setError('')
      })
      .catch(err => {
        setError(err.response?.data?.detail || 'No pudimos cargar tu historial. Revisa tu conexión e inténtalo de nuevo.')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const retry = () => {
    setLoading(true)
    loadHistory()
  }

  const counts = useMemo(() => {
    const result = {}
    FILTERS.forEach(f => {
      result[f.key] = f.types ? events.filter(e => f.types.includes(e.event_type)).length : events.length
    })
    return result
  }, [events])

  const visibleEvents = useMemo(() => {
    const active = FILTERS.find(f => f.key === filter)
    return active.types ? events.filter(e => active.types.includes(e.event_type)) : events
  }, [events, filter])

  const joinedCount = counts.unido
  const organizedCount = events.filter(e => e.event_type === 'creada').length

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const goToSessions = () => navigate('/dashboard#sesiones')

  const empty = EMPTY_MESSAGES[filter]

  return (
    <div className="dashboard-page">
      {/* Mobile Top Header */}
      <header className="mobile-header">
        <div className="sidebar-logo-container">
          <img src="/logo.png" alt="StudyMatch" className="sidebar-logo" />
        </div>
        <div className="mobile-header-actions">
          <ThemeToggle />
          <div className="header-avatar" title="Ver mi perfil" style={{ cursor: 'pointer' }} onClick={() => navigate('/profile')}>
            {user?.avatar_url ? <img src={user.avatar_url} alt="" className="header-avatar-img" /> : studentInitials}
          </div>
          <button className="mobile-logout-btn" onClick={() => setShowLogoutConfirm(true)} title="Cerrar sesión" aria-label="Cerrar sesión">
            <LogoutIcon />
          </button>
        </div>
      </header>

      {/* Desktop / Tablet Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo-container">
            <img src="/logo.png" alt="StudyMatch" className="sidebar-logo" />
          </div>
        </div>
        <nav className="sidebar-nav">
          <Link to="/dashboard" className="sidebar-item">🏠 <span>Dashboard</span></Link>
          <Link to="/dashboard#sesiones" className="sidebar-item">📅 <span>Todas las sesiones</span></Link>
          <Link to="/mis-solicitudes" className="sidebar-item">📨 <span>Mis solicitudes</span></Link>
          <Link to="/historial" className="sidebar-item active" aria-current="page">🕘 <span>Mi historial</span></Link>
          <Link to="/profile" className="sidebar-item">👤 <span>Mi perfil</span></Link>
        </nav>
        <div className="sidebar-footer">
          <button className="sidebar-logout" onClick={() => setShowLogoutConfirm(true)}>
            <LogoutIcon /> <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      <main className="dashboard-main history-main">
        <header className="dashboard-header">
          <div>
            <p className="history-breadcrumb">
              <Link to="/dashboard">Dashboard</Link> / Mi historial
            </p>
            <h1 className="welcome-title">Mi <span className="user-name">historial</span></h1>
            <p className="welcome-sub">Las sesiones de estudio en las que participaste, de la más reciente a la más antigua.</p>
          </div>
          <div className="dashboard-header-right">
            <ThemeToggle />
            <div className="header-avatar" title="Ver mi perfil" style={{ cursor: 'pointer' }} onClick={() => navigate('/profile')}>
              {user?.avatar_url ? <img src={user.avatar_url} alt="" className="header-avatar-img" /> : studentInitials}
            </div>
          </div>
        </header>

        {!loading && !error && events.length > 0 && (
          <p className="history-summary" aria-live="polite">
            Te uniste a <strong>{joinedCount} {joinedCount === 1 ? 'sesión' : 'sesiones'}</strong> y
            organizaste <strong>{organizedCount}</strong>.
          </p>
        )}

        {/* Filtros (Hick): un solo control segmentado de tres opciones */}
        {!loading && !error && events.length > 0 && (
          <div className="history-filters" role="tablist" aria-label="Filtrar historial">
            {FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                className={`history-filter-btn ${filter === f.key ? 'active' : ''}`}
                onClick={() => { setFilter(f.key); setExpandedId(null) }}
              >
                {f.label}
                <span className="history-filter-count">{counts[f.key]}</span>
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="history-state" role="status">⏳ Cargando tu historial...</div>
        )}

        {!loading && error && (
          <div className="history-state history-error" role="alert">
            <p>⚠️ {error}</p>
            <button type="button" className="history-cta" onClick={retry}>↺ Reintentar</button>
          </div>
        )}

        {/* Estado vacío que orienta qué hacer después (Fitts: acción grande y centrada) */}
        {!loading && !error && visibleEvents.length === 0 && (
          <div className="history-empty">
            <span className="history-empty-icon" aria-hidden="true">📭</span>
            <h2>{empty.title}</h2>
            <p>{empty.text}</p>
            <button type="button" className="history-cta" onClick={goToSessions}>
              🔍 Buscar sesiones
            </button>
          </div>
        )}

        {!loading && !error && visibleEvents.length > 0 && (
          <ol className="history-list">
            {visibleEvents.map(event => {
              const meta = EVENT_META[event.event_type] || EVENT_META.unido
              const status = STATUS_META[event.current_status] || STATUS_META.finalizada
              const expanded = expandedId === event.id
              const detailId = `history-detail-${event.id}`

              return (
                <li key={event.id} className={`history-item tone-${meta.tone} ${expanded ? 'expanded' : ''}`}>
                  <button
                    type="button"
                    className="history-item-summary"
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    onClick={() => setExpandedId(expanded ? null : event.id)}
                  >
                    <span className="history-item-icon" aria-hidden="true">{meta.icon}</span>
                    <span className="history-item-body">
                      <span className="history-item-title">
                        {meta.verb} <strong>{event.session_name}</strong>
                      </span>
                      <span className="history-item-meta">
                        {event.session_subject && <span>📚 {event.session_subject}</span>}
                        <time dateTime={event.created_at} title={formatDateTime(event.created_at)}>
                          🕘 {relativeTime(event.created_at)}
                        </time>
                      </span>
                    </span>
                    <span className={`history-status ${status.className}`}>{status.label}</span>
                    <span className="history-chevron" aria-hidden="true">▾</span>
                  </button>

                  {expanded && (
                    <dl className="history-detail" id={detailId}>
                      <div>
                        <dt>Fecha de la sesión</dt>
                        <dd>{formatSessionDate(event.session_date)}</dd>
                      </div>
                      <div>
                        <dt>Modalidad</dt>
                        <dd>{event.session_modality || '—'}</dd>
                      </div>
                      <div>
                        <dt>Organizador</dt>
                        <dd>{event.session_creator_name || '—'}</dd>
                      </div>
                      <div>
                        <dt>Participantes</dt>
                        <dd>
                          {event.participants_count != null
                            ? `${event.participants_count} / ${event.spots}`
                            : 'No disponible (sesión eliminada)'}
                        </dd>
                      </div>
                      <div>
                        <dt>Registrado el</dt>
                        <dd>{formatDateTime(event.created_at)}</dd>
                      </div>
                    </dl>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-bottom-nav">
        <Link to="/dashboard" className="mobile-nav-item">
          <span className="mobile-nav-icon">🏠</span>
          <span>Inicio</span>
        </Link>
        <Link to="/dashboard#sesiones" className="mobile-nav-item">
          <span className="mobile-nav-icon">📅</span>
          <span>Sesiones</span>
        </Link>
        <Link to="/mis-solicitudes" className="mobile-nav-item" aria-label="Mis solicitudes">
          <span className="mobile-nav-icon">📨</span>
          <span>Solicitudes</span>
        </Link>
        <Link to="/historial" className="mobile-nav-item active" aria-current="page">
          <span className="mobile-nav-icon">🕘</span>
          <span>Historial</span>
        </Link>
        <Link to="/profile" className="mobile-nav-item">
          <span className="mobile-nav-icon">👤</span>
          <span>Perfil</span>
        </Link>
      </nav>

      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>¿Cerrar sesión?</h3>
            <p>Tendrás que volver a iniciar sesión para ver tu historial.</p>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowLogoutConfirm(false)}>Cancelar</button>
              <button className="btn-confirm-logout" onClick={handleLogout}>Sí, cerrar sesión</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
