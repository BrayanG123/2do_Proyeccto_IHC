import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from '../components/ThemeToggle'
import { attemptConfig, recordInvalid, useFormAttempt } from '../api/analytics'
import '../styles/Auth.css'

export default function Register() {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    confirm: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { register } = useAuth()
  const navigate = useNavigate()
  const startRegistration = useFormAttempt('registro')

  const rules = {
    length: form.password.length >= 8,
    upper: /[A-Z]/.test(form.password),
    lower: /[a-z]/.test(form.password),
    number: /\d/.test(form.password),
    special: /[!@#$%^&*(),.?":{}|<>_\-+=[\]\\/~`]/.test(form.password),
  }

  const isPasswordValid = Object.values(rules).every(Boolean)

  const handleChange = (e) => {
    startRegistration()
    setForm({ ...form, [e.target.name]: e.target.value })
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const attempt = startRegistration()

    if (!form.first_name.trim() || !form.last_name.trim()) {
      recordInvalid(attempt)
      setError('Por favor ingresa tus nombres y apellidos')
      return
    }

    if (!isPasswordValid) {
      recordInvalid(attempt)
      setError('La contraseña debe cumplir con todos los requisitos de seguridad')
      return
    }

    if (form.password !== form.confirm) {
      recordInvalid(attempt)
      setError('Las contraseñas no coinciden')
      return
    }

    setLoading(true)
    try {
      await register(form.first_name, form.last_name, form.email, form.password, attemptConfig(attempt))
      navigate('/dashboard')
    } catch (err) {
      const detail = err.response?.data?.detail
      if (Array.isArray(detail)) {
        setError(detail.map(d => d.msg).join(', '))
      } else {
        setError(detail || 'Error al registrarse')
      }
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
        <h2 className="auth-tagline">Únete a StudyMatch</h2>
        <p>Crea tu cuenta universitaria y encuentra a los mejores compañeros para tus sesiones de estudio.</p>
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

          <h1 className="auth-title">Crear cuenta</h1>
          <p className="auth-subtitle">
            ¿Ya tienes cuenta? <Link to="/login" className="auth-link">Inicia sesión</Link>
          </p>

          <form onSubmit={handleSubmit} onInvalid={() => recordInvalid(startRegistration())} className="auth-form">
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="first_name">Nombres</label>
                <input
                  id="first_name"
                  type="text"
                  name="first_name"
                  placeholder="Fernando"
                  value={form.first_name}
                  onChange={handleChange}
                  required
                  autoComplete="given-name"
                />
              </div>

              <div className="form-group">
                <label htmlFor="last_name">Apellidos</label>
                <input
                  id="last_name"
                  type="text"
                  name="last_name"
                  placeholder="Calani García"
                  value={form.last_name}
                  onChange={handleChange}
                  required
                  autoComplete="family-name"
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="reg-email">Correo Electrónico</label>
              <input
                id="reg-email"
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
              <label htmlFor="reg-password">Contraseña</label>
              <input
                id="reg-password"
                type="password"
                name="password"
                placeholder="••••••••"
                value={form.password}
                onChange={handleChange}
                required
                autoComplete="new-password"
              />
            </div>

            {/* Checklist de requisitos de contraseña */}
            <div className="password-requirements">
              <div className={`req-item ${rules.length ? 'valid' : ''}`}>
                <span className="req-icon">{rules.length ? '✓' : '○'}</span>
                <span>Al menos 8 caracteres</span>
              </div>
              <div className={`req-item ${rules.upper ? 'valid' : ''}`}>
                <span className="req-icon">{rules.upper ? '✓' : '○'}</span>
                <span>Al menos 1 letra mayúscula (A-Z)</span>
              </div>
              <div className={`req-item ${rules.lower ? 'valid' : ''}`}>
                <span className="req-icon">{rules.lower ? '✓' : '○'}</span>
                <span>Al menos 1 letra minúscula (a-z)</span>
              </div>
              <div className={`req-item ${rules.number ? 'valid' : ''}`}>
                <span className="req-icon">{rules.number ? '✓' : '○'}</span>
                <span>Al menos 1 número (0-9)</span>
              </div>
              <div className={`req-item ${rules.special ? 'valid' : ''}`}>
                <span className="req-icon">{rules.special ? '✓' : '○'}</span>
                <span>Al menos 1 carácter especial (@, $, !, %, *, #, etc.)</span>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="confirm">Confirmar Contraseña</label>
              <input
                id="confirm"
                type="password"
                name="confirm"
                placeholder="Repite tu contraseña"
                value={form.confirm}
                onChange={handleChange}
                required
                autoComplete="new-password"
              />
            </div>

            {error && <div className="auth-error">{error}</div>}

            <button type="submit" className="btn-auth" disabled={loading}>
              {loading ? <span className="btn-spinner"></span> : 'Crear cuenta'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
