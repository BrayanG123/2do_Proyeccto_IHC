import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from '../components/ThemeToggle'
import { getStudentInitials } from '../utils/avatar'
import '../styles/Profile.css'

export default function Profile() {
  const { user, logout, changePassword, refreshUser, updateProfile, uploadAvatar, removeAvatar } = useAuth()
  const navigate = useNavigate()

  // Profile edit states
  const [isEditing, setIsEditing] = useState(false)
  const [editFirstName, setEditFirstName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [profileSuccessMsg, setProfileSuccessMsg] = useState('')
  const [profileErrorMsg, setProfileErrorMsg] = useState('')

  // Avatar upload states
  const fileInputRef = useRef(null)
  const [avatarLoading, setAvatarLoading] = useState(false)

  // Password change states
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // UI states
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  // Refrescar datos del usuario desde la BD al montar
  useEffect(() => {
    refreshUser()
  }, [])

  const handleStartEdit = () => {
    setEditFirstName(user?.first_name || '')
    setEditLastName(user?.last_name || '')
    setEditEmail(user?.email || '')
    setProfileSuccessMsg('')
    setProfileErrorMsg('')
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setProfileErrorMsg('')
  }

  const handleSaveProfile = async (e) => {
    e.preventDefault()
    setProfileSuccessMsg('')
    setProfileErrorMsg('')

    if (!editFirstName.trim() || !editLastName.trim()) {
      setProfileErrorMsg('Nombres y apellidos son requeridos')
      return
    }

    if (!editEmail.trim()) {
      setProfileErrorMsg('El correo electrónico es requerido')
      return
    }

    setEditLoading(true)
    try {
      await updateProfile(editFirstName.trim(), editLastName.trim(), editEmail.trim())
      setProfileSuccessMsg('¡Datos de perfil actualizados exitosamente!')
      setIsEditing(false)
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Error al actualizar el perfil'
      setProfileErrorMsg(msg)
    } finally {
      setEditLoading(false)
    }
  }

  const handleAvatarFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setProfileErrorMsg('Debes seleccionar un archivo de imagen válido (PNG, JPG, WEBP)')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setProfileErrorMsg('La imagen seleccionada no debe superar los 5 MB')
      return
    }

    setAvatarLoading(true)
    setProfileErrorMsg('')
    try {
      await uploadAvatar(file)
      setProfileSuccessMsg('¡Foto de perfil actualizada exitosamente!')
    } catch (err) {
      setProfileErrorMsg(err?.response?.data?.detail || 'Error al subir la foto de perfil')
    } finally {
      setAvatarLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemoveAvatar = async () => {
    setAvatarLoading(true)
    setProfileErrorMsg('')
    try {
      await removeAvatar()
      setProfileSuccessMsg('Foto de perfil eliminada. Ahora se muestran tus iniciales.')
    } catch (err) {
      setProfileErrorMsg('Error al eliminar la foto')
    } finally {
      setAvatarLoading(false)
    }
  }



  // Reglas de validación en tiempo real para la nueva contraseña
  const passwordChecks = useMemo(() => {
    return {
      length: newPassword.length >= 8,
      upper: /[A-Z]/.test(newPassword),
      lower: /[a-z]/.test(newPassword),
      number: /\d/.test(newPassword),
      special: /[!@#$%^&*(),.?":{}|<>_\-+=[\]\\/~`]/.test(newPassword),
      match: newPassword.length > 0 && newPassword === confirmPassword,
    }
  }, [newPassword, confirmPassword])

  const isPasswordValid =
    passwordChecks.length &&
    passwordChecks.upper &&
    passwordChecks.lower &&
    passwordChecks.number &&
    passwordChecks.special

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const handleChangePassword = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')

    if (!currentPassword) {
      setErrorMsg('Debes ingresar tu contraseña actual')
      return
    }

    if (!isPasswordValid) {
      setErrorMsg('La nueva contraseña no cumple con todos los requisitos de seguridad')
      return
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('La confirmación no coincide con la nueva contraseña')
      return
    }

    if (currentPassword === newPassword) {
      setErrorMsg('La nueva contraseña debe ser diferente a la contraseña actual')
      return
    }

    setLoading(true)
    try {
      const res = await changePassword(currentPassword, newPassword)
      setSuccessMsg(res?.message || '¡Tu contraseña ha sido actualizada con éxito!')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      const message =
        err?.response?.data?.detail ||
        'Error al cambiar la contraseña. Revisa tus datos e intenta nuevamente.'
      setErrorMsg(message)
    } finally {
      setLoading(false)
    }
  }

  const studentInitials = useMemo(() => getStudentInitials(user), [user])
  const displayName = user?.first_name || user?.full_name?.split(' ')[0] || 'Estudiante'

  // Formato de fecha legible
  const formattedDate = useMemo(() => {
    if (!user?.created_at) return 'Reciente'
    try {
      const date = new Date(user.created_at)
      return date.toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    } catch {
      return 'Reciente'
    }
  }, [user?.created_at])

  return (
    <div className="profile-page">
      {/* Mobile Top Header (< 768px) */}
      <header className="mobile-header">
        <Link to="/dashboard" className="sidebar-logo-container">
          <img src="/logo.png" alt="StudyMatch" className="sidebar-logo" />
        </Link>
        <div className="mobile-header-actions">
          <ThemeToggle />
          <div className="header-avatar" title={user?.full_name || user?.email}>
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
            🚪
          </button>
        </div>
      </header>

      {/* Desktop / Tablet Sidebar (>= 768px) */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Link to="/dashboard" className="sidebar-logo-container">
            <img src="/logo.png" alt="StudyMatch" className="sidebar-logo" />
          </Link>
        </div>
        <nav className="sidebar-nav">
          <Link to="/dashboard" className="sidebar-item">
            🏠 <span>Dashboard</span>
          </Link>
          <Link to="/dashboard#materias" className="sidebar-item">
            📚 <span>Materias</span>
          </Link>
          <Link to="/mis-solicitudes" className="sidebar-item">📨 <span>Mis solicitudes</span></Link>
          <Link to="/historial" className="sidebar-item">
            🕘 <span>Mi historial</span>
          </Link>
          <Link to="/profile" className="sidebar-item active">
            👤 <span>Mi perfil</span>
          </Link>
        </nav>
        <div className="sidebar-footer">
          <button
            className="sidebar-logout"
            onClick={() => setShowLogoutConfirm(true)}
          >
            🚪 <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="profile-main">
        {/* Header */}
        <header className="profile-header">
          <div>
            <div className="profile-breadcrumb">
              <Link to="/dashboard">Dashboard</Link>
              <span>/</span>
              <span>Mi Perfil</span>
            </div>
            <h1 className="profile-title">
              Perfil de <span className="profile-name-highlight">{displayName}</span>
            </h1>
            <p className="profile-sub">
              Información de tu cuenta universitaria y gestión de seguridad
            </p>
          </div>
          <div className="profile-header-right">
            <ThemeToggle />
            <div className="header-avatar" title={user?.full_name || user?.email}>
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt="" className="header-avatar-img" />
              ) : (
                studentInitials
              )}
            </div>
          </div>
        </header>

        <div className="profile-content-grid">
          {/* Card 1: User Registered Details */}
          <section className="profile-card profile-info-card">
            <div className="profile-badge-banner">
              <div className="profile-avatar-wrapper">
                <div className="profile-avatar-large">
                  {user?.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt={user.full_name}
                      className="profile-avatar-img"
                    />
                  ) : (
                    <span className="profile-avatar-initials">{studentInitials}</span>
                  )}
                  {avatarLoading && <div className="avatar-loading-overlay">⏳</div>}
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleAvatarFileSelect}
                  accept="image/png, image/jpeg, image/webp"
                  style={{ display: 'none' }}
                />

                <div className="avatar-action-buttons">
                  <button
                    type="button"
                    className="btn-avatar-camera"
                    onClick={() => fileInputRef.current?.click()}
                    title="Subir o cambiar foto de perfil"
                    disabled={avatarLoading}
                  >
                    📷
                  </button>
                  {user?.avatar_url && (
                    <button
                      type="button"
                      className="btn-avatar-trash"
                      onClick={handleRemoveAvatar}
                      title="Eliminar foto y usar iniciales"
                      disabled={avatarLoading}
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>

              <div className="profile-banner-details">
                <h2 className="profile-full-name">{user?.full_name || 'Estudiante'}</h2>
                <p className="profile-email-sub">{user?.email}</p>
                <div className="profile-tags-row">
                  <span className="status-pill status-active">
                    <span className="status-dot"></span> Cuenta Activa
                  </span>
                  <span className="status-pill status-id">
                    ID: #{user?.id ? String(user.id).padStart(4, '0') : '0001'}
                  </span>
                </div>
              </div>
            </div>

            <div className="profile-fields-list">
              <div className="fields-header-row">
                <h3 className="fields-section-title">Datos Registrados</h3>
                {!isEditing && (
                  <button
                    type="button"
                    className="btn-edit-profile-trigger"
                    onClick={handleStartEdit}
                  >
                    ✏️ Editar Datos
                  </button>
                )}
              </div>

              {profileSuccessMsg && (
                <div className="feedback-alert alert-success">
                  <span className="alert-icon">✓</span>
                  <div>
                    <strong>¡Actualizado!</strong>
                    <p>{profileSuccessMsg}</p>
                  </div>
                </div>
              )}

              {profileErrorMsg && (
                <div className="feedback-alert alert-danger">
                  <span className="alert-icon">⚠️</span>
                  <div>
                    <strong>Error:</strong>
                    <p>{profileErrorMsg}</p>
                  </div>
                </div>
              )}

              {isEditing ? (
                <form onSubmit={handleSaveProfile} className="edit-profile-form">
                  <div className="edit-form-grid">
                    <div className="form-group">
                      <label htmlFor="editFirstName">Nombres *</label>
                      <input
                        id="editFirstName"
                        type="text"
                        value={editFirstName}
                        onChange={(e) => setEditFirstName(e.target.value)}
                        placeholder="Tus nombres"
                        required
                        autoFocus
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="editLastName">Apellidos *</label>
                      <input
                        id="editLastName"
                        type="text"
                        value={editLastName}
                        onChange={(e) => setEditLastName(e.target.value)}
                        placeholder="Tus apellidos"
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="editEmail">Correo Institucional / Personal *</label>
                    <input
                      id="editEmail"
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      placeholder="tucorreo@uagrm.edu.bo"
                      required
                    />
                  </div>

                  <div className="edit-form-actions">
                    <button
                      type="button"
                      className="btn-cancel-edit"
                      onClick={handleCancelEdit}
                      disabled={editLoading}
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="btn-save-profile"
                      disabled={editLoading || !editFirstName.trim() || !editLastName.trim() || !editEmail.trim()}
                    >
                      {editLoading ? 'Guardando...' : '✓ Guardar Cambios'}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="info-grid">
                    <div className="info-box">
                      <span className="info-label">Nombres</span>
                      <span className="info-val">{user?.first_name || 'No especificado'}</span>
                    </div>

                    <div className="info-box">
                      <span className="info-label">Apellidos</span>
                      <span className="info-val">{user?.last_name || 'No especificado'}</span>
                    </div>

                    <div className="info-box">
                      <span className="info-label">Nombre Completo</span>
                      <span className="info-val">{user?.full_name || 'No especificado'}</span>
                    </div>

                    <div className="info-box">
                      <span className="info-label">Correo Institucional / Personal</span>
                      <span className="info-val email-highlight">{user?.email || '—'}</span>
                    </div>

                    <div className="info-box">
                      <span className="info-label">Estado de Cuenta</span>
                      <span className="info-val text-success">
                        {user?.is_active ? 'Habilitada para estudio' : 'Inactiva'}
                      </span>
                    </div>

                    <div className="info-box">
                      <span className="info-label">Fecha de Registro</span>
                      <span className="info-val">{formattedDate}</span>
                    </div>
                  </div>

                  <div className="profile-note-box">
                    <span className="note-icon">💡</span>
                    <p>
                      Tus datos corresponden al registro oficial de <strong>StudyMatch</strong> para coordinar grupos de estudio en las 53 materias de la carrera.
                    </p>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Card 2: Change Password Form */}
          <section className="profile-card profile-security-card">
            <div className="security-card-header">
              <div className="security-icon-badge">🔒</div>
              <div>
                <h2 className="security-title">Cambiar Contraseña</h2>
                <p className="security-sub">
                  Ingresa tu clave actual y define una nueva que cumpla con los estándares de seguridad
                </p>
              </div>
            </div>

            {successMsg && (
              <div className="feedback-alert alert-success">
                <span className="alert-icon">✓</span>
                <div>
                  <strong>¡Operación exitosa!</strong>
                  <p>{successMsg}</p>
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="feedback-alert alert-danger">
                <span className="alert-icon">⚠️</span>
                <div>
                  <strong>Atención:</strong>
                  <p>{errorMsg}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="change-password-form">
              {/* Contraseña Actual */}
              <div className="form-group">
                <label htmlFor="currentPassword">Contraseña Actual *</label>
                <div className="input-password-wrapper">
                  <input
                    id="currentPassword"
                    type={showCurrent ? 'text' : 'password'}
                    placeholder="Tu clave actual"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="btn-toggle-eye"
                    onClick={() => setShowCurrent(!showCurrent)}
                    aria-label="Ver u ocultar contraseña actual"
                  >
                    {showCurrent ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              {/* Nueva Contraseña */}
              <div className="form-group">
                <label htmlFor="newPassword">Nueva Contraseña *</label>
                <div className="input-password-wrapper">
                  <input
                    id="newPassword"
                    type={showNew ? 'text' : 'password'}
                    placeholder="Mínimo 8 caracteres, mayúscula, minúscula, número y símbolo"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="btn-toggle-eye"
                    onClick={() => setShowNew(!showNew)}
                    aria-label="Ver u ocultar nueva contraseña"
                  >
                    {showNew ? '🙈' : '👁️'}
                  </button>
                </div>

                {/* Password policy requirements checklist */}
                {newPassword.length > 0 && (
                  <div className="password-checklist">
                    <p className="checklist-title">Requisitos de la nueva contraseña:</p>
                    <div className="checklist-grid">
                      <div className={`check-item ${passwordChecks.length ? 'valid' : 'invalid'}`}>
                        <span>{passwordChecks.length ? '✓' : '○'}</span> Mínimo 8 caracteres
                      </div>
                      <div className={`check-item ${passwordChecks.upper ? 'valid' : 'invalid'}`}>
                        <span>{passwordChecks.upper ? '✓' : '○'}</span> 1 Mayúscula (A-Z)
                      </div>
                      <div className={`check-item ${passwordChecks.lower ? 'valid' : 'invalid'}`}>
                        <span>{passwordChecks.lower ? '✓' : '○'}</span> 1 Minúscula (a-z)
                      </div>
                      <div className={`check-item ${passwordChecks.number ? 'valid' : 'invalid'}`}>
                        <span>{passwordChecks.number ? '✓' : '○'}</span> 1 Número (0-9)
                      </div>
                      <div className={`check-item ${passwordChecks.special ? 'valid' : 'invalid'}`}>
                        <span>{passwordChecks.special ? '✓' : '○'}</span> 1 Carácter especial (!@#$...)
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Confirmar Nueva Contraseña */}
              <div className="form-group">
                <label htmlFor="confirmPassword">Confirmar Nueva Contraseña *</label>
                <div className="input-password-wrapper">
                  <input
                    id="confirmPassword"
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="Repite la nueva contraseña"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="btn-toggle-eye"
                    onClick={() => setShowConfirm(!showConfirm)}
                    aria-label="Ver u ocultar confirmación de contraseña"
                  >
                    {showConfirm ? '🙈' : '👁️'}
                  </button>
                </div>
                {confirmPassword && (
                  <p className={`match-hint ${passwordChecks.match ? 'match-ok' : 'match-error'}`}>
                    {passwordChecks.match ? '✓ Las contraseñas coinciden' : '✕ Las contraseñas no coinciden'}
                  </p>
                )}
              </div>

              <button
                type="submit"
                className="btn-save-password"
                disabled={loading || !currentPassword || !isPasswordValid || !passwordChecks.match}
              >
                {loading ? 'Actualizando contraseña...' : 'Actualizar Contraseña'}
              </button>
            </form>
          </section>
        </div>
      </main>

      {/* Mobile Bottom Navigation (< 768px) */}
      <nav className="mobile-bottom-nav">
        <Link to="/dashboard" className="mobile-nav-item">
          <span className="mobile-nav-icon">🏠</span>
          <span>Inicio</span>
        </Link>
        <Link to="/dashboard#materias" className="mobile-nav-item">
          <span className="mobile-nav-icon">📚</span>
          <span>Materias</span>
        </Link>
        <Link to="/mis-solicitudes" className="mobile-nav-item" aria-label="Mis solicitudes">
          <span className="mobile-nav-icon">📨</span>
          <span>Solicitudes</span>
        </Link>
        <Link to="/historial" className="mobile-nav-item">
          <span className="mobile-nav-icon">🕘</span>
          <span>Historial</span>
        </Link>
        <Link to="/profile" className="mobile-nav-item active">
          <span className="mobile-nav-icon">👤</span>
          <span>Perfil</span>
        </Link>
      </nav>

      {/* Modal confirmación de logout */}
      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>¿Cerrar sesión?</h3>
            <p>¿Estás seguro que deseas salir de StudyMatch?</p>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowLogoutConfirm(false)}>
                Cancelar
              </button>
              <button className="btn-confirm-logout" onClick={handleLogout}>
                Sí, cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
