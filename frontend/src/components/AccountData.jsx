import { useRef, useState } from 'react'
import api from '../api/axios'
import { attemptConfig, recordInvalid, startFlow } from '../api/analytics'

const dataSections = {
  sesiones_organizadas: 'Sesiones que organizaste',
  solicitudes: 'Solicitudes de participación',
  asistencia: 'Asistencia y justificaciones',
  reprogramaciones_organizadas: 'Reprogramaciones que organizaste',
  reconfirmaciones: 'Reconfirmaciones',
  historial: 'Historial de actividad',
}

export default function AccountData({ onAccountDeleted }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dataError, setDataError] = useState('')
  const [password, setPassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const dialog = useRef(null)
  const deletionAttempt = useRef(null)

  const viewData = async () => {
    if (data) {
      setData(null)
      return
    }
    setDataError('')
    setBusy(true)
    try {
      const response = await api.get('/auth/me/data')
      setData(response.data)
    } catch {
      setDataError('No se pudieron cargar tus datos. Inténtalo de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  const downloadData = async () => {
    setDataError('')
    setBusy(true)
    const attempt = startFlow('descargar_datos')
    try {
      const response = await api.get('/auth/me/data/download', {
        ...attemptConfig(attempt), responseType: 'blob',
      })
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = 'mis-datos-studymatch.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setDataError('No se pudieron descargar tus datos. Inténtalo de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  const openConfirmation = () => {
    setPassword('')
    setDeleteError('')
    deletionAttempt.current = startFlow('eliminar_cuenta')
    dialog.current.showModal()
  }

  const confirmDeletion = async event => {
    event.preventDefault()
    setDeleting(true)
    setDeleteError('')
    const attempt = deletionAttempt.current
    try {
      // Registra la apertura mientras la cuenta todavía puede autenticarse.
      await attempt?.ready
      await api.delete('/auth/me', { ...attemptConfig(attempt), data: { password } })
      dialog.current.close()
      onAccountDeleted()
    } catch (error) {
      const detail = error.response?.data?.detail
      setDeleteError(typeof detail === 'string' ? detail : 'No se pudo eliminar la cuenta. Inténtalo de nuevo.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="profile-card account-data" aria-labelledby="account-data-title">
      <h2 id="account-data-title">Mis datos</h2>
      <p>Consulta tu perfil y tu actividad en StudyMatch o descarga una copia en formato JSON.</p>
      <div className="account-data-actions">
        <button type="button" className="btn-cancel" onClick={viewData} disabled={busy} aria-expanded={Boolean(data)} aria-controls="account-data-preview">
          {data ? 'Ocultar mis datos' : 'Ver mis datos'}
        </button>
        <button type="button" className="btn-cancel" onClick={downloadData} disabled={busy}>Descargar JSON</button>
      </div>
      {dataError && <p role="alert">{dataError}</p>}
      <div id="account-data-preview" hidden={!data}>
        {data && (
          <>
            <dl className="account-data-profile">
              <dt>Nombre</dt><dd>{data.perfil.full_name}</dd>
              <dt>Correo electrónico</dt><dd>{data.perfil.email}</dd>
              <dt>Fecha de registro</dt><dd>{data.perfil.created_at?.slice(0, 10) || 'Sin fecha'}</dd>
            </dl>
            {Object.entries(dataSections).map(([key, label]) => (
              <details className="account-data-detail" key={key}>
                <summary>{label} ({data[key].length})</summary>
                {data[key].length ? <pre>{JSON.stringify(data[key], null, 2)}</pre> : <p>Sin registros.</p>}
              </details>
            ))}
          </>
        )}
      </div>
      <div className="account-data-delete">
        <h3>Eliminar cuenta</h3>
        <p>Puedes descargar una copia de tus datos antes de eliminar la cuenta.</p>
        <button type="button" className="btn-cancel" onClick={openConfirmation}>Eliminar mi cuenta</button>
      </div>
      <dialog ref={dialog} className="modal account-delete-dialog" aria-labelledby="account-delete-title"
        aria-describedby="account-delete-description" onCancel={event => { if (deleting) event.preventDefault() }}>
        <h2 id="account-delete-title">Eliminar cuenta</h2>
        <p id="account-delete-description">Perderás el acceso a tu cuenta y se eliminarán tu perfil y tus solicitudes. Las sesiones que organizas y que siguen sin finalizar se cancelarán, y las personas afectadas verán el motivo. Saldrás de las listas de espera y el resto conservará su orden. Esta acción es permanente.</p>
        <form onSubmit={confirmDeletion} onInvalid={() => recordInvalid(deletionAttempt.current)}>
          <div className="form-group">
            <label htmlFor="delete-account-password">Contraseña actual</label>
            <input id="delete-account-password" type="password" autoComplete="current-password" required
              value={password} disabled={deleting} onChange={event => { setPassword(event.target.value); setDeleteError('') }} />
          </div>
          {deleteError && <p className="account-data-error" role="alert">{deleteError}</p>}
          <div className="account-confirm-actions">
            <button type="button" className="btn-cancel" onClick={() => dialog.current.close()} disabled={deleting}>Volver</button>
            <button type="submit" className="btn-cancel" disabled={deleting}>
              {deleting ? 'Eliminando…' : 'Eliminar cuenta'}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  )
}
