import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from '../components/ThemeToggle'
import api from '../api/axios'
import { attemptConfig, recordInvalid, startFlow } from '../api/analytics'
import '../styles/Auth.css'
import '../styles/ForgotPassword.css'

export default function ForgotPassword() {
  const navigate = useNavigate()
  const { loginWithCode } = useAuth()

  // step: 1 = email, 2 = código, 3 = nueva contraseña
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(600) // 10 minutos en segundos
  const [canResend, setCanResend] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(60)
  const codeRefs = useRef([])
  const recovery = useRef(null)
  const startRecovery = () => {
    recovery.current ??= startFlow('recuperar_acceso')
    return recovery.current
  }

  // Countdown del código (10 min)
  useEffect(() => {
    if (step !== 2) return
    setCountdown(600)
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [step])

  // Cooldown para reenviar (60 s)
  useEffect(() => {
    if (step !== 2 || !canResend) return
    setResendCooldown(60)
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          setCanResend(false)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [canResend, step])

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // Reglas de contraseña
  const rules = {
    length: newPassword.length >= 8,
    upper: /[A-Z]/.test(newPassword),
    lower: /[a-z]/.test(newPassword),
    number: /\d/.test(newPassword),
    special: /[!@#$%^&*(),.?":{}|<>_\-+=[\]\\/~`]/.test(newPassword),
  }
  const isPasswordValid = Object.values(rules).every(Boolean)

  // ── PASO 1: enviar código ──────────────────────────────────────────────────
  const handleSendCode = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/send-reset-code', { email }, attemptConfig(startRecovery()))
      setMessage('Te enviamos un código de 6 dígitos. Revisa tu bandeja de entrada.')
      setStep(2)
      setCanResend(false)
      setTimeout(() => setCanResend(true), 60000)
      // Foco en el primer campo del código
      setTimeout(() => codeRefs.current[0]?.focus(), 300)
    } catch (err) {
      setError(err.response?.data?.detail || 'No se pudo enviar el código. Verifica tu correo.')
    } finally {
      setLoading(false)
    }
  }

  // ── Inputs del código OTP ──────────────────────────────────────────────────
  const handleCodeChange = (idx, val) => {
    const digit = val.replace(/\D/g, '').slice(-1)
    const next = [...code]
    next[idx] = digit
    setCode(next)
    setError('')
    if (digit && idx < 5) {
      codeRefs.current[idx + 1]?.focus()
    }
  }

  const handleCodeKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !code[idx] && idx > 0) {
      codeRefs.current[idx - 1]?.focus()
    }
  }

  const handleCodePaste = (e) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length === 6) {
      setCode(pasted.split(''))
      codeRefs.current[5]?.focus()
    }
  }

  const fullCode = code.join('')

  // ── PASO 2: verificar código ───────────────────────────────────────────────
  const handleVerifyCode = async (e) => {
    e.preventDefault()
    if (fullCode.length < 6) {
      recordInvalid(recovery.current)
      setError('Ingresa los 6 dígitos del código de verificación')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/verify-reset-code', { email, code: fullCode }, attemptConfig(recovery.current))
      setMessage('¡Código verificado! Ahora puedes establecer tu nueva contraseña.')
      setStep(3)
    } catch (err) {
      setError(err.response?.data?.detail || 'Código incorrecto o expirado')
    } finally {
      setLoading(false)
    }
  }

  // ── Reenviar código ────────────────────────────────────────────────────────
  const handleResend = async () => {
    setLoading(true)
    setError('')
    setCode(['', '', '', '', '', ''])
    try {
      await api.post('/auth/send-reset-code', { email }, attemptConfig(recovery.current))
      setMessage('Nuevo código enviado. Revisa tu correo.')
      setCanResend(false)
      setCountdown(600)
      setTimeout(() => setCanResend(true), 60000)
      setTimeout(() => codeRefs.current[0]?.focus(), 300)
    } catch (err) {
      setError(err.response?.data?.detail || 'Error al reenviar. Inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  // ── PASO 3: cambiar contraseña ─────────────────────────────────────────────
  const handleResetPassword = async (e) => {
    e.preventDefault()
    if (!isPasswordValid) {
      recordInvalid(recovery.current)
      setError('La contraseña debe cumplir con todos los requisitos de seguridad')
      return
    }
    if (newPassword !== confirm) {
      recordInvalid(recovery.current)
      setError('Las contraseñas no coinciden')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/reset-password-with-code', {
        email,
        code: fullCode,
        new_password: newPassword,
      }, attemptConfig(recovery.current))
      setMessage('¡Contraseña restablecida con éxito!')
      setTimeout(() => navigate('/login'), 2000)
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(Array.isArray(detail) ? detail.map((d) => d.msg).join(', ') : detail || 'Error al cambiar la contraseña')
    } finally {
      setLoading(false)
    }
  }

  // ── Omitir: iniciar sesión directamente con el código verificado ──────────
  const handleSkip = async () => {
    setLoading(true)
    setError('')
    try {
      await loginWithCode(email, fullCode, attemptConfig(recovery.current))
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.detail || 'No se pudo iniciar sesión. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  // ── Títulos y subtítulos por paso ──────────────────────────────────────────
  const stepMeta = {
    1: { title: 'Recuperar contraseña', sub: 'Ingresa tu correo y te enviaremos un código de verificación.' },
    2: { title: 'Ingresa el código', sub: `Código de 6 dígitos enviado a ${email}` },
    3: { title: 'Nueva contraseña', sub: 'Elige una contraseña segura para tu cuenta.' },
  }

  return (
    <main className="auth-page">
      <div className="auth-left">
        <Link to="/" className="auth-logo-badge">
          <img src="/logo.png" alt="StudyMatch" className="auth-logo" />
        </Link>
        <h2 className="auth-tagline">Recupera tu acceso</h2>
        <p>Restablece tu contraseña de forma segura para volver a tus grupos de estudio.</p>
        <div className="auth-decorations">
          <div className="deco-circle deco-1"></div>
          <div className="deco-circle deco-2"></div>
        </div>
      </div>

      <div className="auth-right">
        <div className="auth-top-bar">
          <ThemeToggle />
          <Link to="/login" className="btn-outline" style={{ padding: '6px 14px', fontSize: '0.82rem' }}>
            ← Login
          </Link>
        </div>

        <div className="auth-card">
          <div className="auth-mobile-logo">
            <Link to="/" className="auth-logo-badge">
              <img src="/logo.png" alt="StudyMatch" className="auth-logo" />
            </Link>
          </div>

          {/* Step indicator */}
          <div className="fp-steps">
            {[1, 2, 3].map((s) => (
              <div key={s} className={`fp-step ${step >= s ? 'active' : ''} ${step > s ? 'done' : ''}`}>
                <div className="fp-step-dot">{step > s ? '✓' : s}</div>
                <span className="fp-step-label">
                  {s === 1 ? 'Correo' : s === 2 ? 'Código' : 'Contraseña'}
                </span>
              </div>
            ))}
          </div>

          <h1 className="auth-title">{stepMeta[step].title}</h1>
          <p className="auth-subtitle">{stepMeta[step].sub}</p>

          {message && <div className="auth-success">{message}</div>}
          {error && <div className="auth-error">{error}</div>}

          {/* ── PASO 1: Email ──────────────────────────────────────────── */}
          {step === 1 && (
            <form onSubmit={handleSendCode} onInvalid={() => recordInvalid(startRecovery())} className="auth-form">
              <div className="form-group">
                <label htmlFor="fp-email">Correo Electrónico</label>
                <input
                  id="fp-email"
                  type="email"
                  placeholder="correo@ejemplo.com"
                  value={email}
                  onChange={(e) => { startRecovery(); setEmail(e.target.value); setError('') }}
                  required
                  autoComplete="email"
                />
              </div>
              <button type="submit" className="btn-auth" disabled={loading}>
                {loading ? <span className="btn-spinner"></span> : 'Enviar código de verificación'}
              </button>
              <p className="fp-back-link">
                <Link to="/login" className="auth-link">← Volver al login</Link>
              </p>
            </form>
          )}

          {/* ── PASO 2: Código OTP ─────────────────────────────────────── */}
          {step === 2 && (
            <form onSubmit={handleVerifyCode} onInvalid={() => recordInvalid(recovery.current)} className="auth-form">
              {/* Countdown */}
              <div className={`fp-countdown ${countdown === 0 ? 'expired' : ''}`}>
                {countdown > 0
                  ? <>⏱ El código expira en <strong>{formatTime(countdown)}</strong></>
                  : <>⚠ El código ha expirado. Solicita uno nuevo.</>
                }
              </div>

              {/* OTP inputs */}
              <div className="otp-inputs" onPaste={handleCodePaste}>
                {code.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => (codeRefs.current[idx] = el)}
                    id={`otp-${idx}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleCodeChange(idx, e.target.value)}
                    onKeyDown={(e) => handleCodeKeyDown(idx, e)}
                    className={`otp-digit ${digit ? 'filled' : ''}`}
                    autoComplete="off"
                  />
                ))}
              </div>

              <button
                type="submit"
                className="btn-auth"
                disabled={loading || fullCode.length < 6 || countdown === 0}
              >
                {loading ? <span className="btn-spinner"></span> : 'Verificar código'}
              </button>

              <div className="fp-resend-row">
                {canResend ? (
                  <button
                    type="button"
                    className="fp-resend-btn"
                    onClick={handleResend}
                    disabled={loading}
                  >
                    🔄 Reenviar código
                  </button>
                ) : (
                  <span className="fp-resend-info">
                    Puedes reenviar en {resendCooldown}s
                  </span>
                )}
              </div>

              <p className="fp-back-link">
                <button type="button" className="fp-text-btn" onClick={() => { recovery.current = null; setStep(1) }}>
                  ← Cambiar correo
                </button>
              </p>
            </form>
          )}

          {/* ── PASO 3: Nueva contraseña ───────────────────────────────── */}
          {step === 3 && (
            <form onSubmit={handleResetPassword} onInvalid={() => recordInvalid(recovery.current)} className="auth-form">
              <div className="form-group">
                <label htmlFor="new-pass">Nueva Contraseña</label>
                <input
                  id="new-pass"
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setError('') }}
                  required
                  autoComplete="new-password"
                />
              </div>

              {/* Checklist de requisitos */}
              <div className="password-requirements">
                {[
                  { key: 'length', label: 'Al menos 8 caracteres' },
                  { key: 'upper', label: 'Al menos 1 letra mayúscula (A-Z)' },
                  { key: 'lower', label: 'Al menos 1 letra minúscula (a-z)' },
                  { key: 'number', label: 'Al menos 1 número (0-9)' },
                  { key: 'special', label: 'Al menos 1 carácter especial (@, $, !, %, ...)' },
                ].map(({ key, label }) => (
                  <div key={key} className={`req-item ${rules[key] ? 'valid' : ''}`}>
                    <span className="req-icon">{rules[key] ? '✓' : '○'}</span>
                    <span>{label}</span>
                  </div>
                ))}
              </div>

              <div className="form-group">
                <label htmlFor="new-confirm">Confirmar Contraseña</label>
                <input
                  id="new-confirm"
                  type="password"
                  placeholder="Repite la nueva contraseña"
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); setError('') }}
                  required
                  autoComplete="new-password"
                />
              </div>

              <button type="submit" className="btn-auth" disabled={loading}>
                {loading ? <span className="btn-spinner"></span> : 'Cambiar contraseña'}
              </button>

              <button
                type="button"
                className="btn-auth fp-skip-btn"
                onClick={handleSkip}
                style={{ marginTop: '10px' }}
              >
                Iniciar sesión con el código
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}
