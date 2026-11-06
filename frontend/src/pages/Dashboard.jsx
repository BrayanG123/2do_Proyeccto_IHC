import { useState, useMemo, useEffect, useCallback } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from '../components/ThemeToggle'
import api from '../api/axios'
import { getStudentInitials } from '../utils/avatar'
import LogoutIcon from '../components/LogoutIcon'
import RescheduleDialog from '../components/RescheduleDialog'
import { formatSchedule } from '../utils/schedule'
import '../styles/Dashboard.css'

function joinSessionName(session) {
  const automatedName = /^\[E2E\]\s+.+\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return automatedName.test(session.name) ? 'Sesión de estudio' : session.name;
}

export default function Dashboard({ onlyMyRequests = false }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  // ── MATERIAS (PARA ASOCIAR Y FILTRAR) ───────────────
  const [subjects, setSubjects] = useState([])

  // ── SESIONES ──────────────────────────────────────────
  const [sessions, setSessions] = useState([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [sessionsLoadError, setSessionsLoadError] = useState('')
  const [showSessionForm, setShowSessionForm] = useState(false)
  const [sessionForm, setSessionForm] = useState({
    name: '',
    subject: '',
    date: '',
    time: '',
    modality: 'Presencial',
    spots: '',
  })
  const [customSubjectName, setCustomSubjectName] = useState('')
  const [sessionError, setSessionError] = useState('')
  const [sessionSaving, setSessionSaving] = useState(false)
  const [closingSessionId, setClosingSessionId] = useState(null)
  const [toastMessage, setToastMessage] = useState(null)

  // ── FILTROS Y BÚSQUEDA (ISSUE #2) ───────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterSubject, setFilterSubject] = useState('')
  const [filterModality, setFilterModality] = useState('todas')
  const [filterDate, setFilterDate] = useState('todas')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterOnlyAvailable, setFilterOnlyAvailable] = useState(false)

  // ── EDITAR, ELIMINAR Y PARTICIPAR (FLUJO AMPLIADO) ───
  const [editingSession, setEditingSession] = useState(null)
  const [editForm, setEditForm] = useState({
    name: '',
    subject: '',
    date: '',
    time: '',
    modality: 'Presencial',
    spots: '',
    status: 'abierta'
  })
  const [editCustomSubjectName, setEditCustomSubjectName] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [joiningSessionId, setJoiningSessionId] = useState(null)
  const [sessionToJoin, setSessionToJoin] = useState(null)
  const [myRequests, setMyRequests] = useState([])
  const [reschedules, setReschedules] = useState([])
  const [sessionToReschedule, setSessionToReschedule] = useState(null)
  const [managedSession, setManagedSession] = useState(null)
  const [managedRequests, setManagedRequests] = useState([])
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [requestsError, setRequestsError] = useState('')
  const [requestBusy, setRequestBusy] = useState(false)

  const requestLabel = (request) => ({
    pendiente: 'Pendiente de aprobación', aceptada: 'Confirmado',
    en_espera: `En espera · posición ${request.queue_position}`,
    rechazada: 'Solicitud rechazada', retirada: 'Saliste de la sesión',
  }[request.status])

  // Debounce para la búsqueda por texto (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Cargar lista de materias de la BD
  useEffect(() => {
    api.get('/subjects/')
      .then((res) => {
        if (Array.isArray(res.data)) {
          const sorted = [...res.data].sort((a, b) => a.name.localeCompare(b.name))
          setSubjects(sorted)
        }
      })
      .catch((err) => console.warn('No se pudieron cargar las materias:', err))
  }, [])

  // Consulta de sesiones en la BD con todos los filtros combinables
  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true)
    setSessionsLoadError('')
    try {
      const params = {}
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
      if (filterSubject && filterSubject !== 'todas') params.subject = filterSubject
      if (filterModality && filterModality !== 'todas') params.modality = filterModality
      if (filterDate && filterDate !== 'todas') {
        params.date_filter = filterDate
        if (filterDate === 'rango') {
          if (filterDateFrom) params.date_from = filterDateFrom
          if (filterDateTo) params.date_to = filterDateTo
        }
      }
      if (filterOnlyAvailable) params.only_available = true

      const [res, own, changes] = await Promise.all([
        api.get('/sessions/', { params }), api.get('/sessions/requests/me'), api.get('/sessions/reschedules/me'),
      ])
      setMyRequests(own.data)
      setReschedules(changes.data)
      if (Array.isArray(res.data)) {
        // Esta sección reúne las sesiones que tienen una solicitud de la cuenta actual.
        const requestedIds = new Set(own.data.map(request => request.session_id))
        setSessions(onlyMyRequests ? res.data.filter(session => requestedIds.has(session.id)) : res.data)
      }
    } catch (err) {
      console.warn('Error al cargar sesiones filtradas:', err)
      setSessionsLoadError('No se pudieron cargar las sesiones. Intenta nuevamente.')
    } finally {
      setLoadingSessions(false)
    }
  }, [debouncedSearch, filterSubject, filterModality, filterDate, filterDateFrom, filterDateTo, filterOnlyAvailable, onlyMyRequests])

  // Cargar o refrescar sesiones cuando cambien los filtros
  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Al llegar desde otra página (ej. "Buscar sesiones" del historial), ir directo a la sección indicada
  const location = useLocation()
  useEffect(() => {
    if (!location.hash || loadingSessions) return
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' })
  }, [location.hash, loadingSessions])

  // Limpiar todos los filtros (IHC)
  const handleResetFilters = () => {
    setSearchQuery('')
    setDebouncedSearch('')
    setFilterSubject('')
    setFilterModality('todas')
    setFilterDate('todas')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterOnlyAvailable(false)
  }

  // Verifica si hay al menos un filtro activo
  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
    (filterSubject && filterSubject !== 'todas') ||
    (filterModality && filterModality !== 'todas') ||
    (filterDate && filterDate !== 'todas') ||
    filterOnlyAvailable
  )

  // Guarda la nueva sesión en la BD vía POST /sessions/
  const handleSaveSession = async (e) => {
    e.preventDefault()
    setSessionError('')

    if (!sessionForm.name.trim() || !sessionForm.date || !sessionForm.modality || !sessionForm.spots) {
      setSessionError('Por favor completa todos los campos obligatorios.')
      return
    }
    if (parseInt(sessionForm.spots) < 1) {
      setSessionError('Los cupos deben ser al menos 1.')
      return
    }

    let finalSubject = sessionForm.subject
    if (sessionForm.subject === '__OTRO__') {
      if (!customSubjectName.trim()) {
        setSessionError('Por favor ingresa el nombre de la nueva materia.')
        return
      }
      setSessionSaving(true)
      try {
        const subRes = await api.post('/subjects/', { name: customSubjectName.trim() })
        finalSubject = subRes.data.name
        setSubjects((prev) => {
          const exists = prev.some(s => s.name.toLowerCase() === finalSubject.toLowerCase())
          if (exists) return prev
          return [...prev, subRes.data].sort((a, b) => a.name.localeCompare(b.name))
        })
      } catch (err) {
        console.warn('Error al registrar materia:', err)
        finalSubject = customSubjectName.trim()
      }
    }

    setSessionSaving(true)
    try {
      const res = await api.post('/sessions/', {
        name: sessionForm.name.trim(),
        subject: finalSubject || null,
        date: sessionForm.date,
        time: sessionForm.time || null,
        modality: sessionForm.modality,
        spots: parseInt(sessionForm.spots),
      })
      setSessions((prev) => [res.data, ...prev])
      setSessionForm({ name: '', subject: '', date: '', time: '', modality: 'Presencial', spots: '' })
      setCustomSubjectName('')
      setShowSessionForm(false)
      setToastMessage({
        type: 'success',
        text: `Sesión "${res.data.name}" creada exitosamente.`
      })
      setTimeout(() => setToastMessage(null), 4000)
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Error al guardar la sesión.'
      setSessionError(msg)
    } finally {
      setSessionSaving(false)
    }
  }

  // 1. EDITAR: Abrir modal y enviar actualización PUT /sessions/{id}
  const openEditModal = (session) => {
    setEditingSession(session)
    setEditForm({
      name: session.name,
      subject: session.subject || '',
      date: session.date,
      time: session.time || '',
      modality: session.modality,
      spots: session.spots,
      status: session.status || 'abierta',
    })
    setEditCustomSubjectName('')
  }

  const handleUpdateSession = async (e) => {
    e.preventDefault()
    if (!editingSession) return

    let finalSubject = editForm.subject
    if (editForm.subject === '__OTRO__') {
      if (!editCustomSubjectName.trim()) {
        setToastMessage({ type: 'error', text: '⚠️ Por favor ingresa el nombre de la materia.' })
        setTimeout(() => setToastMessage(null), 4000)
        return
      }
      setEditSaving(true)
      try {
        const subRes = await api.post('/subjects/', { name: editCustomSubjectName.trim() })
        finalSubject = subRes.data.name
        setSubjects((prev) => {
          const exists = prev.some(s => s.name.toLowerCase() === finalSubject.toLowerCase())
          if (exists) return prev
          return [...prev, subRes.data].sort((a, b) => a.name.localeCompare(b.name))
        })
      } catch (err) {
        finalSubject = editCustomSubjectName.trim()
      }
    }

    setEditSaving(true)
    try {
      const res = await api.put(`/sessions/${editingSession.id}`, {
        name: editForm.name.trim(),
        subject: finalSubject || null,
        date: editForm.date,
        time: editForm.time || null,
        modality: editForm.modality,
        spots: parseInt(editForm.spots),
        status: editForm.status,
      })
      setSessions((prev) => prev.map((s) => (s.id === editingSession.id ? res.data : s)))
      setEditingSession(null)
      setToastMessage({
        type: 'success',
        text: `Sesión "${res.data.name}" actualizada con éxito.`
      })
      setTimeout(() => setToastMessage(null), 4000)
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Error al actualizar la sesión.'
      setToastMessage({ type: 'error', text: `⚠️ ${msg}` })
      setTimeout(() => setToastMessage(null), 4500)
    } finally {
      setEditSaving(false)
    }
  }

  // 2. ELIMINAR: Con confirmación previa vía DELETE /sessions/{id}
  const handleConfirmDelete = async () => {
    if (!sessionToDelete) return
    setDeletingId(sessionToDelete.id)
    try {
      await api.delete(`/sessions/${sessionToDelete.id}`)
      setSessions((prev) => prev.filter((s) => s.id !== sessionToDelete.id))
      setToastMessage({
        type: 'success',
        text: `Sesión "${sessionToDelete.name}" eliminada de la base de datos.`
      })
      setTimeout(() => setToastMessage(null), 4000)
      setSessionToDelete(null)
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Error al eliminar la sesión.'
      setToastMessage({ type: 'error', text: `⚠️ ${msg}` })
      setTimeout(() => setToastMessage(null), 4500)
    } finally {
      setDeletingId(null)
    }
  }

  const solicitarUnirse = async (session) => {
    if (session.status === 'cerrada') {
      setToastMessage({
        type: 'error',
        text: 'Esta sesion esta cerrada y no acepta solicitudes'
      })
      setTimeout(() => setToastMessage(null), 4500)
      return false
    }

    setJoiningSessionId(session.id)

    try {
      const res = await api.post(`/sessions/${session.id}/requests`)
      setMyRequests(prev => [...prev.filter(item => item.session_id !== session.id), res.data])

      setToastMessage({
        type: 'success',
        text: `Solicitud enviada para "${session.name}". Espera la respuesta del organizador.`
      })

      setTimeout(() => setToastMessage(null), 4500)

      return true;
    } catch (error) {
      const mensaje = error?.response?.data?.detail ||
      'No se pudo enviar la solicitud. Inténtalo nuevamente.'
      
      setToastMessage({
        type: 'error',
        text: mensaje
      })

      setTimeout(() => setToastMessage(null), 4500);

      return false
    } finally {
      setJoiningSessionId(null)
    }

  }


  // Confirmar e inscribirse desde el diálogo modal (Ley de Fitts y Heurística H5)
  const handleConfirmJoin = async () => {
    
    if (!sessionToJoin) return

    const enviada = await solicitarUnirse(sessionToJoin)

    if (enviada)
      setSessionToJoin(null);
  }

  // Acción: Cerrar inscripciones (Transición abierta -> cerrada)
  const handleCloseRegistration = async (sessionId, sessionName) => {
    setClosingSessionId(sessionId)
    try {
      const res = await api.patch(`/sessions/${sessionId}/close`)
      // Actualización reactiva del estado local
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? res.data : s))
      )
      setToastMessage({
        type: 'success',
        text: `Inscripciones cerradas para "${sessionName}". El cambio quedó guardado en la base de datos.`
      })
      setTimeout(() => setToastMessage(null), 4000)
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Error al cerrar las inscripciones.'
      setToastMessage({
        type: 'error',
        text: `⚠️ ${msg}`
      })
      setTimeout(() => setToastMessage(null), 4500)
    } finally {
      setClosingSessionId(null)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const manageRequests = async (session) => {
    setManagedSession(session)
    setManagedRequests([])
    setRequestsError('')
    setRequestsLoading(true)
    try {
      const res = await api.get(`/sessions/${session.id}/requests`)
      setManagedRequests(res.data)
    } catch (error) {
      setRequestsError(error?.response?.data?.detail || 'No se pudieron cargar las solicitudes.')
    } finally { setRequestsLoading(false) }
  }

  const decideRequest = async (request, decision) => {
    setRequestBusy(true)
    setRequestsError('')
    try {
      await api.patch(`/sessions/${managedSession.id}/requests/${request.id}`, { decision })
      const res = await api.get(`/sessions/${managedSession.id}/requests`)
      setManagedRequests(res.data)
      await fetchSessions()
    } catch (error) {
      setRequestsError(error?.response?.data?.detail || 'No se pudo guardar la decisión.')
    } finally { setRequestBusy(false) }
  }

  const leaveSession = async (session) => {
    setRequestBusy(true)
    try {
      await api.post(`/sessions/${session.id}/leave`)
      await fetchSessions()
      setToastMessage({ type: 'success', text: `Saliste de "${session.name}". Si había una lista de espera y la sesión sigue abierta, el primer estudiante fue confirmado.` })
    } catch (error) {
      setToastMessage({ type: 'error', text: error?.response?.data?.detail || 'No se pudo salir de la sesión.' })
    } finally { setRequestBusy(false) }
  }

  const confirmNewSchedule = async (session, change) => {
    setRequestBusy(true)
    try {
      await api.post(`/sessions/${session.id}/reschedules/${change.id}/confirm`)
      await fetchSessions()
      setToastMessage({ type: 'success', text: 'Confirmaste tu asistencia al nuevo encuentro.' })
    } catch (error) {
      setToastMessage({ type: 'error', text: error?.response?.data?.detail || 'No se pudo reconfirmar.' })
    } finally {
      setRequestBusy(false)
    }
  }

  const displayName = user?.first_name || user?.full_name?.split(' ')[0] || 'Estudiante'
  const studentInitials = useMemo(() => getStudentInitials(user), [user])

  const modalityColor = (m) => {
    if (m === 'Virtual')  return 'modality-virtual'
    if (m === 'Híbrida')  return 'modality-hibrida'
    return 'modality-presencial'
  }

  return (
    <div className="dashboard-page">
      {/* Mobile Top Header */}
      <header className="mobile-header">
        <div className="sidebar-logo-container">
          <img src="/logo.png" alt="StudyMatch" className="sidebar-logo" />
        </div>
        <div className="mobile-header-actions">
          <ThemeToggle />
          <div
            className="header-avatar"
            title="Ver mi perfil"
            style={{ cursor: 'pointer' }}
            onClick={() => navigate('/profile')}
          >
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="header-avatar-img" />
            ) : (
              studentInitials
            )}
          </div>
          <button
            className="mobile-logout-btn"
            onClick={() => setShowLogoutConfirm(true)}
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
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
          <Link to="/dashboard" className={`sidebar-item ${onlyMyRequests ? '' : 'active'}`}>🏠 <span>Dashboard</span></Link>
          <Link to="/dashboard#sesiones" className="sidebar-item">📅 <span>Todas las sesiones</span></Link>
          <Link to="/mis-solicitudes" className={`sidebar-item ${onlyMyRequests ? 'active' : ''}`} aria-current={onlyMyRequests ? 'page' : undefined}>📨 <span>Mis solicitudes</span></Link>
          <Link to="/historial" className="sidebar-item">🕘 <span>Mi historial</span></Link>
          <Link to="/profile" className="sidebar-item">👤 <span>Mi perfil</span></Link>
        </nav>
        <div className="sidebar-footer">
          <button className="sidebar-logout" onClick={() => setShowLogoutConfirm(true)}>
            <LogoutIcon /> <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="dashboard-main">
        {/* Toast Notificación de Cambio de Estado */}
        {toastMessage && (
          <div className={`session-toast toast-${toastMessage.type}`} role="alert">
            <span className="toast-icon">
              {toastMessage.type === 'success' ? '✅' : '⚠️'}
            </span>
            <span className="toast-text">{toastMessage.text}</span>
            <button
              className="toast-close"
              onClick={() => setToastMessage(null)}
              aria-label="Cerrar notificación"
            >✕</button>
          </div>
        )}

        {/* Desktop Header */}
        <header className="dashboard-header">
          <div>
            <h1 className="welcome-title">
              {onlyMyRequests ? 'Mis solicitudes' : <>¡Hola, <span className="user-name">{displayName}</span>! 👋</>}
            </h1>
            <p className="welcome-sub">
              {onlyMyRequests ? 'Consulta la respuesta a tus solicitudes de participación.' : 'Sesiones de estudio · StudyMatch'}
            </p>
          </div>
          <div className="dashboard-header-right">
            <ThemeToggle />
            <div
              className="header-avatar"
              title="Ver mi perfil"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate('/profile')}
            >
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt="" className="header-avatar-img" />
              ) : (
                studentInitials
              )}
            </div>
          </div>
        </header>

        {/* Stats Grid */}
        {!onlyMyRequests && <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{sessions.length}</div>
            <div className="stat-label">Total Sesiones</div>
          </div>
          <div className="stat-card">
            <div className="stat-value stat-open">
              {sessions.filter(s => s.status !== 'cerrada').length}
            </div>
            <div className="stat-label">Inscripción Abierta</div>
          </div>
          <div className="stat-card">
            <div className="stat-value stat-closed">
              {sessions.filter(s => s.status === 'cerrada').length}
            </div>
            <div className="stat-label">Inscripciones Cerradas</div>
          </div>
        </div>}

        {/* ── SECCIÓN SESIONES ── */}
        <section id="sesiones" className="sessions-section">
          <div className="sessions-header-bar">
            <div>
              <h2 className="section-title">
                {onlyMyRequests ? 'Sesiones solicitadas' : 'Sesiones de Estudio'}
                <span className="subjects-count-badge">{sessions.length}</span>
              </h2>
              <p className="section-subtitle">
                {onlyMyRequests ? 'En cada tarjeta puedes ver tu estado y las acciones disponibles.' : 'Crea y gestiona tus sesiones de estudio grupales'}
              </p>
            </div>
            {!onlyMyRequests && <button
              id="btn-crear-sesion"
              className="btn-create-session"
              onClick={() => { setShowSessionForm(true); setSessionError(''); setCustomSubjectName('') }}
            >
              + Crear Sesión
            </button>}
          </div>

          {/* ── BARRA DE BÚSQUEDA Y FILTROS (ISSUE #2) ── */}
          {!onlyMyRequests && <div className="sessions-filter-container">
            {/* Fila principal: Búsqueda por texto y selector de materia */}
            <div className="filter-main-row">
              <div className="search-input-wrapper">
                <span className="search-icon">🔍</span>
                <input
                  id="input-search-sessions"
                  type="text"
                  className="search-input"
                  placeholder="Buscar sesiones por nombre..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="search-clear-btn"
                    onClick={() => setSearchQuery('')}
                    title="Borrar búsqueda"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Selector de Materia */}
              <div className="filter-select-wrapper">
                <span className="filter-select-icon">📚</span>
                <select
                  id="select-filter-subject"
                  className="filter-select"
                  value={filterSubject}
                  onChange={(e) => setFilterSubject(e.target.value)}
                >
                  <option value="">Todas las materias</option>
                  {subjects.map((sub) => (
                    <option key={sub.id || sub.code} value={sub.name}>
                      {sub.emoji ? `${sub.emoji} ` : ''}{sub.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Fila secundaria: Modalidad, Fecha y Disponibilidad */}
            <div className="filter-secondary-row">
              {/* Filtro por Modalidad */}
              <div className="filter-group">
                <label className="filter-label">Modalidad:</label>
                <div className="filter-pill-group">
                  {['todas', 'Presencial', 'Virtual'].map((mod) => (
                    <button
                      key={mod}
                      type="button"
                      className={`filter-pill-btn ${filterModality === mod ? 'active' : ''}`}
                      onClick={() => setFilterModality(mod)}
                    >
                      {mod === 'todas' ? 'Todas' : mod === 'Presencial' ? '🏫 Presencial' : '💻 Virtual'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filtro por Fecha */}
              <div className="filter-group">
                <label className="filter-label">Fecha:</label>
                <select
                  id="select-filter-date"
                  className="filter-select date-select"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                >
                  <option value="todas">Cualquier fecha</option>
                  <option value="hoy">📅 Hoy</option>
                  <option value="proximos_7_dias">🗓️ Próximos 7 días</option>
                  <option value="rango">📆 Rango personalizado...</option>
                </select>
              </div>

              {/* Rango de fechas si seleccionó 'rango' */}
              {filterDate === 'rango' && (
                <div className="filter-date-range-inputs">
                  <input
                    type="date"
                    className="filter-date-input"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                    title="Fecha inicio"
                  />
                  <span className="date-range-sep">hasta</span>
                  <input
                    type="date"
                    className="filter-date-input"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                    title="Fecha fin"
                  />
                </div>
              )}

              {/* Filtro por Disponibilidad (Regla Issue #1) */}
              <div className="filter-group filter-availability-toggle">
                <label className="toggle-checkbox-label" title="Muestra solo sesiones con inscripciones abiertas, cupos disponibles y fecha futura (Regla Issue #1)">
                  <input
                    id="checkbox-filter-available"
                    type="checkbox"
                    checked={filterOnlyAvailable}
                    onChange={(e) => setFilterOnlyAvailable(e.target.checked)}
                  />
                  <span className="toggle-text">🟢 Solo disponibles para unirme</span>
                </label>
              </div>
            </div>

            {/* Fila de Filtros Activos (IHC: Chips que se pueden remover individualmente o limpiar todos) */}
            {hasActiveFilters && (
              <div className="active-filters-bar">
                <span className="active-filters-title">Filtros activos:</span>
                <div className="active-filter-chips">
                  {searchQuery.trim() && (
                    <span className="filter-chip">
                      🔍 &quot;{searchQuery}&quot;
                      <button type="button" onClick={() => setSearchQuery('')} aria-label="Quitar filtro de búsqueda">✕</button>
                    </span>
                  )}
                  {filterSubject && filterSubject !== 'todas' && (
                    <span className="filter-chip">
                      📚 {filterSubject}
                      <button type="button" onClick={() => setFilterSubject('')} aria-label="Quitar filtro de materia">✕</button>
                    </span>
                  )}
                  {filterModality && filterModality !== 'todas' && (
                    <span className="filter-chip">
                      {filterModality === 'Virtual' ? '💻' : '🏫'} {filterModality}
                      <button type="button" onClick={() => setFilterModality('todas')} aria-label="Quitar filtro de modalidad">✕</button>
                    </span>
                  )}
                  {filterDate === 'hoy' && (
                    <span className="filter-chip">
                      📅 Hoy
                      <button type="button" onClick={() => setFilterDate('todas')} aria-label="Quitar filtro de fecha">✕</button>
                    </span>
                  )}
                  {filterDate === 'proximos_7_dias' && (
                    <span className="filter-chip">
                      🗓️ Próximos 7 días
                      <button type="button" onClick={() => setFilterDate('todas')} aria-label="Quitar filtro de fecha">✕</button>
                    </span>
                  )}
                  {filterDate === 'rango' && (
                    <span className="filter-chip">
                      📆 Rango: {filterDateFrom || '...'} a {filterDateTo || '...'}
                      <button type="button" onClick={() => { setFilterDate('todas'); setFilterDateFrom(''); setFilterDateTo('') }} aria-label="Quitar filtro de rango">✕</button>
                    </span>
                  )}
                  {filterOnlyAvailable && (
                    <span className="filter-chip chip-available">
                      🟢 Solo disponibles
                      <button type="button" onClick={() => setFilterOnlyAvailable(false)} aria-label="Quitar filtro de disponibilidad">✕</button>
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn-clear-all-filters"
                    onClick={handleResetFilters}
                    title="Restablecer todos los filtros"
                  >
                    🗑️ Limpiar filtros
                  </button>
                </div>
              </div>
            )}

            {/* Indicador de resultados visibles (Heurística H1: Visibilidad del estado del sistema) */}
            <div className="filter-results-status">
              <span className="filter-results-badge">
                {loadingSessions ? '⏳ Buscando sesiones...' : `📋 ${sessions.length} ${sessions.length === 1 ? 'sesión encontrada' : 'sesiones encontradas'}`}
              </span>
            </div>
          </div>}

          {/* Formulario modal de nueva sesión */}
          {showSessionForm && (
            <div className="session-modal-overlay" onClick={() => setShowSessionForm(false)}>
              <div className="session-modal" onClick={(e) => e.stopPropagation()}>
                <div className="session-modal-header">
                  <h3>📅 Nueva Sesión de Estudio</h3>
                  <button
                    className="session-modal-close"
                    onClick={() => setShowSessionForm(false)}
                    aria-label="Cerrar"
                  >✕</button>
                </div>

                <form className="session-form" onSubmit={handleSaveSession}>
                  <div className="session-form-group">
                    <label htmlFor="session-name">Nombre de la Sesión</label>
                    <input
                      id="session-name"
                      type="text"
                      placeholder="Ej: Repaso Vectores Capítulo 3"
                      value={sessionForm.name}
                      onChange={(e) => setSessionForm((p) => ({ ...p, name: e.target.value }))}
                      maxLength={150}
                      required
                    />
                  </div>

                  <div className="session-form-group">
                    <label htmlFor="session-subject-select">Materia asociada</label>
                    <select
                      id="session-subject-select"
                      value={sessionForm.subject}
                      onChange={(e) => setSessionForm((p) => ({ ...p, subject: e.target.value }))}
                      required
                    >
                      <option value="">-- Selecciona una materia --</option>
                      {subjects.map((sub) => (
                        <option key={sub.id || sub.code} value={sub.name}>
                          {sub.emoji ? `${sub.emoji} ` : ''}{sub.name}
                        </option>
                      ))}
                      <option value="__OTRO__">➕ Otra materia...</option>
                    </select>
                  </div>

                  {sessionForm.subject === '__OTRO__' && (
                    <div className="session-form-group custom-subject-group">
                      <label htmlFor="custom-subject-input">Nombre de la nueva materia</label>
                      <input
                        id="custom-subject-input"
                        type="text"
                        placeholder="Ej: Robótica Móvil, Cálculo III..."
                        value={customSubjectName}
                        onChange={(e) => setCustomSubjectName(e.target.value)}
                        required
                        minLength={3}
                      />
                      <small className="form-help-text">
                        💡 Se registrará automáticamente en la base de datos para futuras sesiones y filtros.
                      </small>
                    </div>
                  )}

                  <div className="session-form-row">
                    <div className="session-form-group">
                      <label htmlFor="session-date">Fecha</label>
                      <input
                        id="session-date"
                        type="date"
                        value={sessionForm.date}
                        onChange={(e) => setSessionForm((p) => ({ ...p, date: e.target.value }))}
                        required
                      />
                    </div>

                    <div className="session-form-group">
                      <label htmlFor="session-time">Hora opcional</label>
                      <input id="session-time" type="time" step="1" value={sessionForm.time} onChange={e => setSessionForm(p => ({ ...p, time: e.target.value }))} />
                    </div>

                    <div className="session-form-group">
                      <label htmlFor="session-modality">Modalidad</label>
                      <select
                        id="session-modality"
                        value={sessionForm.modality}
                        onChange={(e) => setSessionForm((p) => ({ ...p, modality: e.target.value }))}
                      >
                        <option value="Presencial">Presencial</option>
                        <option value="Virtual">Virtual</option>
                        <option value="Híbrida">Híbrida</option>
                      </select>
                    </div>
                  </div>

                  <div className="session-form-group">
                    <label htmlFor="session-spots">Cupos disponibles</label>
                    <input
                      id="session-spots"
                      type="number"
                      min="1"
                      max="100"
                      placeholder="Ej: 10"
                      value={sessionForm.spots}
                      onChange={(e) => setSessionForm((p) => ({ ...p, spots: e.target.value }))}
                      required
                    />
                  </div>

                  {sessionError && (
                    <p className="session-form-error">⚠️ {sessionError}</p>
                  )}

                  <div className="session-form-actions">
                    <button
                      type="button"
                      className="btn-cancel"
                      onClick={() => setShowSessionForm(false)}
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="btn-save-session"
                      disabled={sessionSaving}
                    >
                      {sessionSaving ? 'Guardando...' : '💾 Guardar'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {sessionsLoadError ? (
            <div className="no-sessions-placeholder" role="alert">
              <p>{sessionsLoadError}</p>
              <button type="button" className="btn-reset-empty-state" onClick={fetchSessions}>Reintentar</button>
            </div>
          ) : loadingSessions ? (
            <div className="sessions-loading-placeholder">
              <span className="sessions-loading-spinner">⏳</span>
              <p>Consultando sesiones en la base de datos...</p>
            </div>
          ) : sessions.length > 0 ? (
            <div className="sessions-grid">
              {sessions.map((session) => {
                const isClosed = session.status === 'cerrada'
                // Validación por correo electrónico: solo quien creó la sesión puede cerrarla
                const isCreator = Boolean(
                  user && user.email && (
                    (session.creator_email && session.creator_email.trim().toLowerCase() === user.email.trim().toLowerCase()) ||
                    (session.creator_id && Number(session.creator_id) === Number(user.id))
                  )
                )

                // Verifica si el usuario actual ya se encuentra inscrito
                const isEnrolled = Boolean(
                  user && user.email && Array.isArray(session.participant_emails) &&
                  session.participant_emails.map((e) => String(e).toLowerCase().trim()).includes(user.email.trim().toLowerCase())
                )

                // Verifica si la fecha de la sesión ya pasó (comparación local)
                const today = new Date()
                today.setHours(0, 0, 0, 0)
                const sessionDate = new Date(session.date + 'T00:00:00')
                const isPastDate = Boolean(session.date && sessionDate < today)

                // Verifica si los cupos están agotados
                const isFull = Boolean(session.spots && (session.participants_count || 0) >= session.spots)
                const myRequest = myRequests.find(item => item.session_id === session.id)
                const latestChange = reschedules.find(item => item.session_id === session.id)
                const needsReconfirmation = latestChange?.own_status === 'pendiente'

                // Determinar el badge de estado superior coherente (IHC)
                let statusBadgeClass = 'status-open'
                let statusBadgeLabel = '🟢 Inscripción abierta'
                let cardStateClass = 'session-card-open'

                if (isClosed) {
                  statusBadgeClass = 'status-closed'
                  statusBadgeLabel = '🔒 Cerrada'
                  cardStateClass = 'session-card-closed'
                } else if (isPastDate) {
                  statusBadgeClass = 'status-past'
                  statusBadgeLabel = '⌛ Finalizada'
                  cardStateClass = 'session-card-past'
                } else if (isFull) {
                  statusBadgeClass = 'status-full'
                  statusBadgeLabel = '👥 Cupos llenos'
                  cardStateClass = 'session-card-full'
                }

                return (
                  <div
                    key={session.id}
                    className={`session-card ${cardStateClass}`}
                  >
                    <div className="session-card-header">
                      <div className="session-card-tags">
                        <span className={`session-modality-badge ${modalityColor(session.modality)}`}>
                          {session.modality}
                        </span>
                        {session.subject && (
                          <span className="session-subject-badge" title={`Materia: ${session.subject}`}>
                            📚 {session.subject}
                          </span>
                        )}
                      </div>
                      <span
                        className={`session-status-badge ${statusBadgeClass}`}
                        id={`status-badge-${session.id}`}
                      >
                        {statusBadgeLabel}
                      </span>
                    </div>

                    <span className="session-date">
                      📅 {new Date(session.date + 'T00:00:00').toLocaleDateString('es-BO', {
                        day: '2-digit', month: 'long', year: 'numeric'
                      })}
                      {session.time && ` · ${session.time.slice(0, 5)}`}
                    </span>

                    <h3 className="session-name">{session.name}</h3>

                    {session.creator_name && (
                      <div className="session-creator-tag">
                        👤 Organizado por: <strong>{isCreator ? `${session.creator_name} (Tú)` : session.creator_name}</strong>
                      </div>
                    )}

                    <div className="session-spots">
                      👥 <strong>{session.participants_count || 0} / {session.spots}</strong> participantes
                      {isClosed && <span className="session-spots-closed-pill"> (Cupo cerrado)</span>}
                      {!isClosed && !isFull && ((session.spots || 0) - (session.participants_count || 0) === 1) && (
                        <span className="session-spots-urgency-pill"> ⚠️ ¡Último cupo disponible!</span>
                      )}
                      {!isClosed && !isFull && ((session.spots || 0) - (session.participants_count || 0) > 1) && (
                        <span className="session-spots-available-pill"> ({((session.spots || 0) - (session.participants_count || 0))} cupos libres)</span>
                      )}
                    </div>

                    {latestChange && (
                      <section className="reschedule-notice" aria-label="Cambio de fecha">
                        <strong>Sesión reprogramada</strong>
                        <p>Anterior · {formatSchedule(latestChange.old_date, latestChange.old_time)}</p>
                        <p>Nuevo · {formatSchedule(latestChange.new_date, latestChange.new_time)}</p>
                        <p>{latestChange.reason}</p>
                        {isCreator && <p role="status">{latestChange.pending_count} {latestChange.pending_count === 1 ? 'respuesta pendiente' : 'respuestas pendientes'}</p>}
                        <button type="button" className="btn-toolbar-action" onClick={() => setSessionToReschedule(session)}>Ver reprogramaciones</button>
                      </section>
                    )}

                    {/* Acciones exclusivas del creador */}
                    {isCreator && (
                      <div className="session-creator-toolbar">
                        <button type="button" className="btn-toolbar-action" disabled={isClosed} onClick={() => setSessionToReschedule(session)}>
                          Reprogramar sesión
                        </button>
                        <button type="button" className="btn-toolbar-action" onClick={() => manageRequests(session)}>
                          Gestionar solicitudes
                        </button>
                        <button
                          type="button"
                          className="btn-toolbar-action btn-edit-session"
                          onClick={() => openEditModal(session)}
                          title="Editar los datos de esta sesión"
                        >
                          ✏️ Editar
                        </button>
                        <button
                          type="button"
                          className="btn-toolbar-action btn-delete-session"
                          onClick={() => setSessionToDelete(session)}
                          title="Eliminar esta sesión de estudio"
                        >
                          🗑️ Eliminar
                        </button>
                      </div>
                    )}

                    <div className="session-card-footer">
                      {/* Caso 1: Creador de la sesión (no puede unirse a su propia sesión) */}
                      {isCreator ? (
                        <div className="session-creator-footer-box">
                          <div className="creator-notice-badge">
                            👤 Eres el organizador de esta sesión
                          </div>
                          {!isClosed && !isPastDate && (
                            <button
                              id={`btn-close-session-${session.id}`}
                              className="btn-close-registration"
                              onClick={() => handleCloseRegistration(session.id, session.name)}
                              disabled={closingSessionId === session.id}
                              title="Cerrar inscripciones para esta sesión (Solo el creador)"
                            >
                              {closingSessionId === session.id ? (
                                <>⏳ Cerrando...</>
                              ) : (
                                <>🔒 Cerrar inscripciones</>
                              )}
                            </button>
                          )}
                        </div>
                      ) : needsReconfirmation ? (
                        <div className="reschedule-notice">
                          <p role="status">Pendiente de reconfirmación. Tu cupo está reservado.</p>
                          <button type="button" className="btn-confirm-edit" disabled={requestBusy} onClick={() => confirmNewSchedule(session, latestChange)}>
                            Confirmar asistencia
                          </button>
                          <button type="button" className="btn-cancel" disabled={requestBusy} onClick={() => leaveSession(session)}>Retirarme</button>
                        </div>
                      ) : (isEnrolled || myRequest?.status === 'aceptada') ? (
                        <div className="session-status-restricted-box">
                          <p role="status">Estado: Confirmado</p>
                          <button type="button" className="btn-close-registration" disabled={requestBusy} onClick={() => leaveSession(session)}>
                            Salir de la sesión
                          </button>
                        </div>
                      ) : myRequest ? (
                        <div className="session-status-restricted-box">
                          <p role="status">Estado: {requestLabel(myRequest)}</p>
                          <button type="button" className="btn-join-session" disabled>Solicitud registrada</button>
                        </div>
                      ) : isClosed ? (
                        /* Caso 2: Sesión cerrada */
                        <div className="session-status-restricted-box">
                          <button
                            type="button"
                            className="btn-join-session btn-join-disabled"
                            disabled
                            title="Directriz StudyMatch: Una sesión cerrada no acepta nuevos participantes."
                          >
                            ⛔ Inscripción cerrada
                          </button>
                          <span className="restriction-caption">Motivo: Una sesión cerrada no acepta nuevos participantes</span>
                        </div>
                      ) : isPastDate ? (
                        /* Caso 3: Fecha pasada */
                        <div className="session-status-restricted-box">
                          <button
                            type="button"
                            className="btn-join-session btn-join-disabled"
                            disabled
                            title="No puedes unirte a una sesión cuya fecha ya pasó."
                          >
                            📅 Sesión finalizada
                          </button>
                          <span className="restriction-caption">Motivo: La fecha programada para esta sesión ya pasó</span>
                        </div>
                      ) : isFull ? (
                        /* Caso 4: Cupos agotados */
                        <div className="session-status-restricted-box">
                          <button
                            type="button"
                            className="btn-join-session btn-join-active"
                            disabled={joiningSessionId === session.id}
                            onClick={() => setSessionToJoin(session)}
                            title="Solicitar aprobación para entrar en la lista de espera"
                          >
                            Solicitar Inscribirme
                          </button>
                          <span className="restriction-caption">Sesión llena. Si el organizador te acepta, entrarás en la lista de espera.</span>
                        </div>
                      ) : (
                        /* Caso 6: Cumple todos los requisitos para unirse */
                        <div className="session-open-actions">
                          <button
                            type="button"
                            className="btn-join-session btn-join-active"
                            onClick={() => setSessionToJoin(session)}
                            disabled={joiningSessionId === session.id}
                            title="Solicitar unirme a esta sesión de estudio"
                          >
                            {joiningSessionId === session.id ? '⏳ Inscribiendo...' : 'Solicitar Inscribirme'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : onlyMyRequests ? (
            <div className="no-sessions-placeholder">
              <span className="no-sessions-icon">📨</span>
              <h3>Aún no has enviado solicitudes</h3>
              <p>Encuentra una sesión de estudio y solicita participar para consultar su estado aquí.</p>
              <Link to="/dashboard#sesiones" className="btn-reset-empty-state">Buscar sesiones</Link>
            </div>
          ) : hasActiveFilters ? (
            <div className="no-sessions-placeholder filter-empty-state">
              <span className="no-sessions-icon">🔍</span>
              <h3>No se encontraron sesiones coincidentes</h3>
              <p>No hay ninguna sesión que cumpla con los filtros seleccionados (prueba cambiando la materia, la modalidad o el rango de fechas).</p>
              <button
                type="button"
                className="btn-reset-empty-state"
                onClick={handleResetFilters}
              >
                ↺ Restablecer todos los filtros
              </button>
            </div>
          ) : (
            <div className="no-sessions-placeholder">
              <span className="no-sessions-icon">📭</span>
              <h3>No hay sesiones aún</h3>
              <p>Crea tu primera sesión con el botón <strong>"+ Crear Sesión"</strong></p>
            </div>
          )}
        </section>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-bottom-nav">
        <Link to="/dashboard" className={`mobile-nav-item ${onlyMyRequests ? '' : 'active'}`}>
          <span className="mobile-nav-icon">🏠</span>
          <span>Inicio</span>
        </Link>
        <Link to="/dashboard#sesiones" className="mobile-nav-item">
          <span className="mobile-nav-icon">📅</span>
          <span>Sesiones</span>
        </Link>
        <Link to="/mis-solicitudes" className={`mobile-nav-item ${onlyMyRequests ? 'active' : ''}`} aria-label="Mis solicitudes" aria-current={onlyMyRequests ? 'page' : undefined}>
          <span className="mobile-nav-icon">📨</span>
          <span>Solicitudes</span>
        </Link>
        <Link to="/historial" className="mobile-nav-item">
          <span className="mobile-nav-icon">🕘</span>
          <span>Historial</span>
        </Link>
        <Link to="/profile" className="mobile-nav-item">
          <span className="mobile-nav-icon">👤</span>
          <span>Perfil</span>
        </Link>
      </nav>

      {/* Modal para Editar Sesión */}
      {editingSession && (
        <div className="modal-overlay" onClick={() => setEditingSession(null)}>
          <div className="modal edit-session-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <h3>✏️ Editar Sesión de Estudio</h3>
              <button
                type="button"
                className="btn-modal-close-icon"
                onClick={() => setEditingSession(null)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleUpdateSession} className="edit-session-form">
              <div className="form-group">
                <label>Nombre de la sesión</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  placeholder="Ej: Repaso examen final..."
                  required
                  minLength={3}
                />
              </div>

              <div className="form-group" style={{ marginTop: '10px' }}>
                <label>Materia asociada</label>
                <select
                  value={editForm.subject}
                  onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                  required
                >
                  <option value="">-- Selecciona una materia --</option>
                  {subjects.map((sub) => (
                    <option key={sub.id || sub.code} value={sub.name}>
                      {sub.emoji ? `${sub.emoji} ` : ''}{sub.name}
                    </option>
                  ))}
                  <option value="__OTRO__">➕ Otra materia...</option>
                </select>
              </div>

              {editForm.subject === '__OTRO__' && (
                <div className="form-group custom-subject-group">
                  <label>Nombre de la nueva materia</label>
                  <input
                    type="text"
                    placeholder="Ej: Robótica Móvil, Cálculo III..."
                    value={editCustomSubjectName}
                    onChange={(e) => setEditCustomSubjectName(e.target.value)}
                    required
                    minLength={3}
                  />
                  <small className="form-help-text">
                    💡 Se registrará automáticamente en la base de datos para futuras sesiones y filtros.
                  </small>
                </div>
              )}

              <div className="form-row-edit">
                <div className="form-group">
                  <label htmlFor="edit-session-date">Fecha</label>
                  <input
                    id="edit-session-date"
                    type="date"
                    disabled={editingSession.participants_count > 0}
                    value={editForm.date}
                    onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                    required
                  />
                  {editingSession.participants_count > 0 && <small>Para cambiar el encuentro, usa Reprogramar sesión.</small>}
                </div>

                <div className="form-group">
                  <label htmlFor="edit-session-time">Hora opcional</label>
                  <input id="edit-session-time" type="time" step="1" disabled={editingSession.participants_count > 0} value={editForm.time} onChange={e => setEditForm({ ...editForm, time: e.target.value })} />
                </div>

                <div className="form-group">
                  <label>Modalidad</label>
                  <select
                    value={editForm.modality}
                    onChange={(e) => setEditForm({ ...editForm, modality: e.target.value })}
                  >
                    <option value="Presencial">Presencial</option>
                    <option value="Virtual">Virtual</option>
                    <option value="Híbrida">Híbrida</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Cupos totales</label>
                  <input
                    type="number"
                    min={editingSession.participants_count || 1}
                    value={editForm.spots}
                    onChange={(e) => setEditForm({ ...editForm, spots: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-group edit-status-group" style={{ marginTop: '14px' }}>
                <label>Estado de inscripción</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="edit-status-select"
                >
                  <option value="abierta">🟢 Inscripción abierta (Acepta nuevos participantes)</option>
                  <option value="cerrada">🔒 Inscripción cerrada (No acepta nuevos participantes)</option>
                </select>
                <small style={{ display: 'block', marginTop: '4px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {editForm.status === 'abierta'
                    ? '✔️ La sesión volverá a aceptar nuevos inscritos.'
                    : '⛔ La sesión quedará bloqueada para nuevos inscritos.'}
                </small>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setEditingSession(null)}
                  disabled={editSaving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-confirm-edit"
                  disabled={editSaving}
                >
                  {editSaving ? 'Guardando...' : '💾 Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmación para Eliminar Sesión */}
      {sessionToDelete && (
        <div className="modal-overlay" onClick={() => setSessionToDelete(null)}>
          <div className="modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <h3>🗑️ Confirmar Eliminación</h3>
              <button
                type="button"
                className="btn-modal-close-icon"
                onClick={() => setSessionToDelete(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body-content">
              <p>¿Estás seguro de que deseas eliminar permanentemente la sesión:</p>
              <div className="delete-target-preview">
                <strong>"{sessionToDelete.name}"</strong>
              </div>
              <p className="delete-disclaimer">
                ⚠️ Esta acción borrará el registro de la base de datos y no se puede deshacer.
              </p>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setSessionToDelete(null)}
                disabled={deletingId === sessionToDelete.id}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-danger-confirm"
                onClick={handleConfirmDelete}
                disabled={deletingId === sessionToDelete.id}
              >
                {deletingId === sessionToDelete.id ? 'Eliminando...' : 'Sí, Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {sessionToJoin && (
        <div className="modal-overlay" onClick={() => setSessionToJoin(null)}>
          <div
            className="modal modal-join-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="join-title"
            aria-describedby="join-request-explanation"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSessionToJoin(null)
            }}
          >
            <div className="modal-header-row">
              <h3 id="join-title">Solicitar participar</h3>
              <button
                type="button"
                className="btn-modal-close-icon"
                onClick={() => setSessionToJoin(null)}
                aria-label="Cerrar ventana"
                autoFocus
              >
                ✕
              </button>
            </div>

            <div className="join-session-summary-card">
              <h4 className="join-session-name">{joinSessionName(sessionToJoin)}</h4>
              <p className="join-subject">{sessionToJoin.subject || 'General'}</p>
              <dl className="join-session-details-grid">
                <div>
                  <dt>Fecha</dt>
                  <dd>
                    {new Date(sessionToJoin.date + 'T00:00:00').toLocaleDateString('es-BO', {
                      day: 'numeric', month: 'long', year: 'numeric',
                    })}
                    {sessionToJoin.time ? ` · ${sessionToJoin.time.slice(0, 5)}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>Modalidad</dt>
                  <dd>{sessionToJoin.modality}</dd>
                </div>
              </dl>
              <p className="join-availability">
                {Math.max(0, sessionToJoin.spots - (sessionToJoin.participants_count || 0))} de {sessionToJoin.spots} cupos disponibles
              </p>
            </div>

            <p className="join-request-explanation" id="join-request-explanation">
              {(sessionToJoin.participants_count || 0) >= sessionToJoin.spots
                ? 'La sesión está llena. Si el organizador te acepta, entrarás en la lista de espera.'
                : 'Tu solicitud quedará pendiente hasta que el organizador la acepte.'}
            </p>

            {(sessionToJoin.creator_name || sessionToJoin.location) && (
              <details className="join-extra-details">
                <summary>Ver más detalles</summary>
                {sessionToJoin.creator_name && <p>Organiza {sessionToJoin.creator_name}</p>}
                {sessionToJoin.location && <p>Ubicación o enlace · {sessionToJoin.location}</p>}
              </details>
            )}

            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setSessionToJoin(null)}>
                Cancelar
              </button>
              <button
                type="button"
                id="btn-confirm-join-submit"
                className="btn-confirm-join"
                onClick={handleConfirmJoin}
                disabled={joiningSessionId === sessionToJoin.id}
              >
                {joiningSessionId === sessionToJoin.id ? 'Enviando solicitud…' : 'Enviar solicitud'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout confirm modal */}
      {sessionToReschedule && (
        <RescheduleDialog
          session={sessionToReschedule}
          changes={reschedules.filter(change => change.session_id === sessionToReschedule.id)}
          isOrganizer={Number(sessionToReschedule.creator_id) === Number(user.id)}
          onSaved={fetchSessions}
          onClose={() => setSessionToReschedule(null)}
        />
      )}
      {managedSession && (
        <div className="modal-overlay">
          <div className="modal requests-modal" role="dialog" aria-modal="true" aria-labelledby="requests-title">
            <h2 id="requests-title">Solicitudes de {managedSession.name}</h2>
            <p>Aceptar confirma al estudiante si hay cupo. Si está llena, entra al final de la lista de espera.</p>
            {requestsLoading && <p role="status">Cargando solicitudes...</p>}
            {requestsError && <p role="alert">{requestsError}</p>}
            {!requestsLoading && !requestsError && managedRequests.length === 0 && <p>No hay solicitudes todavía.</p>}
            <ul className="requests-list">
              {managedRequests.map(request => (
                <li key={request.id} aria-label={`Solicitud de ${request.user_email}`}>
                  <strong>{request.user_name}</strong>
                  <span>{request.user_email}</span>
                  <p role="status">Estado: {requestLabel(request)}</p>
                  {request.status === 'pendiente' && (
                    <button type="button" className="btn-confirm-edit" disabled={requestBusy || managedSession.status !== 'abierta'} onClick={() => decideRequest(request, 'aceptar')}>Aceptar</button>
                  )}
                  {['pendiente', 'en_espera'].includes(request.status) && (
                    <button type="button" className="btn-cancel" disabled={requestBusy} onClick={() => decideRequest(request, 'rechazar')}>Rechazar</button>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" className="btn-cancel" disabled={requestBusy} onClick={() => setManagedSession(null)}>Cerrar solicitudes</button>
          </div>
        </div>
      )}
      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>¿Cerrar sesión?</h3>
            <p>¿Estás seguro que deseas salir de StudyMatch?</p>
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
