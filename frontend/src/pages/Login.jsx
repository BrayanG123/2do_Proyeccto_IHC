import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from '../components/ThemeToggle'
import { attemptConfig, recordInvalid, useFormAttempt } from '../api/analytics'
import '../styles/Auth.css'

export default function Login() {
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()
  const [accountDeleted] = useState(() => sessionStorage.getItem('accountDeleted') === 'true')
  const startAccess = useFormAttempt('acceso')

  useEffect(() => {
    if (accountDeleted) sessionStorage.removeItem('accountDeleted')
  }, [accountDeleted])

  const handleChange = (e) => {
    startAccess()
    setForm({ ...form, [e.target.name]: e.target.value })
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(form.email, form.password, attemptConfig(startAccess()))
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.detail || 'Error al iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-left">
        <Link to="/" className="auth-logo-badge">
          <img src="/logo.png" alt="StudyMatch" className="auth-logo" />
        </Link>
        <h2 className="auth-tagline">Bienvenido de vuelta</h2>
        <p>Conéctate con tus compañeros de estudio, materias y grupos de repaso.</p>
        <div className="auth-decorations">
          <div className="deco-circle deco-1"></div>
          <div className="deco-circle deco-2"></div>
        </div>
      </div>

      <div className="auth-right">
        <div className="auth-top-bar">
          <ThemeToggle />
          <Link to="/" className="btn-outline" style={{ padding: '6px 14px', fontSize: '0.82rem' }}>
            ← Inicio
          </Link>
        </div>

        <div className="auth-card">
          <div className="auth-mobile-logo">
            <Link to="/" className="auth-logo-badge">
              <img src="/logo.png" alt="StudyMatch" className="auth-logo" />
            </Link>
          </div>

          <h1 className="auth-title">Iniciar sesión</h1>
          {accountDeleted && <p className="auth-success" role="status">Tu cuenta fue eliminada.</p>}
          <p className="auth-subtitle">
            ¿No tienes cuenta? <Link to="/register" className="auth-link">Regístrate aquí</Link>
          </p>

          <form onSubmit={handleSubmit} onInvalid={() => recordInvalid(startAccess())} className="auth-form">
            <div className="form-group">
              <label htmlFor="email">Correo electrónico</label>
              <input
                id="email"
                type="email"
                name="email"
                placeholder="correo@ejemplo.com"
                value={form.email}
                onChange={handleChange}
                required
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Contraseña</label>
              <input
                id="password"
                type="password"
                name="password"
                placeholder="••••••••"
                value={form.password}
                onChange={handleChange}
                required
                autoComplete="current-password"
              />
            </div>

            <div className="forgot-link">
              <Link to="/forgot-password" className="auth-link">¿Olvidaste tu contraseña?</Link>
            </div>

            {error && <div className="auth-error">{error}</div>}

            <button type="submit" className="btn-auth" disabled={loading}>
              {loading ? <span className="btn-spinner"></span> : 'Iniciar sesión'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
