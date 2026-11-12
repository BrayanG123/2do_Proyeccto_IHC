import logging
from uuid import UUID

from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException

from app.analytics_events import BLOCKING_REASONS
from app.database import SessionLocal
from app.models import AnalyticsEvent


logger = logging.getLogger(__name__)
ATTEMPT_HEADER = 'X-Analytics-Attempt'

# Los pasos de servidor proceden de la ruta que realmente atendió la acción.
ROUTE_EVENTS = {
    ('POST', '/auth/register'): ('registro', 'cuenta_creada'),
    ('POST', '/auth/login'): ('acceso', 'acceso_concedido'),
    ('POST', '/auth/send-reset-code'): ('recuperar_acceso', 'codigo_enviado'),
    ('POST', '/auth/verify-reset-code'): ('recuperar_acceso', 'codigo_verificado'),
    ('POST', '/auth/reset-password-with-code'): ('recuperar_acceso', 'acceso_recuperado'),
    ('POST', '/auth/login-with-code'): ('recuperar_acceso', 'acceso_recuperado'),
    ('PUT', '/auth/profile'): ('editar_perfil', 'perfil_actualizado'),
    ('GET', '/sessions/'): ('buscar_sesiones', None),
    ('POST', '/sessions/'): ('crear_sesion', 'sesion_creada'),
    ('PUT', '/sessions/{session_id}'): ('editar_sesion', 'sesion_editada'),
    ('DELETE', '/sessions/{session_id}'): ('eliminar_sesion', 'sesion_eliminada'),
    ('PATCH', '/sessions/{session_id}/close'): ('cerrar_inscripciones', 'inscripciones_cerradas'),
    # La solicitud conserva su evento de éxito en la transacción que la guarda.
    ('POST', '/sessions/{session_id}/requests'): ('solicitar_unirse', None),
    ('GET', '/sessions/{session_id}/requests'): ('gestionar_solicitudes', None),
    ('PATCH', '/sessions/{session_id}/requests/{request_id}'): ('gestionar_solicitudes', 'decision_guardada'),
    ('POST', '/sessions/{session_id}/leave'): ('retirarse', 'participacion_retirada'),
    ('POST', '/sessions/{session_id}/reschedule'): ('reprogramar', 'reprogramacion_guardada'),
    ('POST', '/sessions/{session_id}/reschedules/{reschedule_id}/confirm'): ('reconfirmar', 'participacion_reconfirmada'),
    ('GET', '/sessions/{session_id}/attendance'): ('finalizar_sesion', None),
    ('POST', '/sessions/{session_id}/finish'): ('finalizar_sesion', 'sesion_finalizada'),
    ('PATCH', '/sessions/{session_id}/attendance/{user_id}'): ('registrar_asistencia', 'asistencia_registrada'),
    ('POST', '/sessions/{session_id}/attendance/justification'): ('enviar_justificacion', 'justificacion_enviada'),
    ('PATCH', '/sessions/{session_id}/attendance/{user_id}/justification'): ('resolver_justificacion', 'justificacion_resuelta'),
    ('POST', '/sessions/{session_id}/cancel'): ('cancelar_sesion', 'sesion_cancelada'),
}


def get_attempt_id(request):
    raw_id = request.headers.get(ATTEMPT_HEADER) if request is not None else None
    if raw_id and len(raw_id) == 36:
        try:
            attempt_id = UUID(raw_id)
        except ValueError:
            return None
        if attempt_id.version == 4:
            return str(attempt_id)
    return None


def session_modality(session):
    return session.modality if session.modality in ('Presencial', 'Virtual') else 'Otra'


def add_join_success(db, session, attempt_id):
    # Conservar el total histórico aun si dos solicitudes usan el mismo identificador.
    name = 'solicitud_enviada'
    modality = session_modality(session)
    if attempt_id:
        try:
            with db.begin_nested():
                db.add(AnalyticsEvent(event=name, modality=modality, attempt_id=attempt_id))
            return
        except IntegrityError:
            if not db.query(AnalyticsEvent.id).filter_by(event=name, attempt_id=attempt_id).first():
                raise
    db.add(AnalyticsEvent(event=name, modality=modality))


def save_event(db, name, *, attempt_id=None, reason=None, modality=None):
    event = AnalyticsEvent(event=name, attempt_id=attempt_id, reason=reason, modality=modality)
    db.add(event)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # Reenviar un paso con el mismo identificador es idempotente.
        existing = db.query(AnalyticsEvent).filter_by(event=name, attempt_id=attempt_id).first() if attempt_id else None
        if existing is None:
            raise
        return existing
    return event


def record_route_event(event, *, attempt_id=None, reason=None):
    try:
        with SessionLocal() as db:
            save_event(db, event, attempt_id=attempt_id, reason=reason)
    except SQLAlchemyError:
        logger.warning('No se pudo guardar el evento de analítica %s', event)


class TrackedRoute(APIRoute):
    def get_route_handler(self):
        handle_request = super().get_route_handler()

        async def track_request(request):
            tracked = ROUTE_EVENTS.get((request.method, self.path))
            attempt_id = get_attempt_id(request)
            if tracked is None or attempt_id is None:
                return await handle_request(request)

            flow, success_event = tracked
            try:
                response = await handle_request(request)
            except (HTTPException, RequestValidationError) as error:
                status_code = error.status_code if isinstance(error, HTTPException) else 422
                reason = BLOCKING_REASONS.get(status_code)
                if reason:
                    await run_in_threadpool(record_route_event, f'{flow}_bloqueo', reason=reason)
                raise
            if success_event and 200 <= response.status_code < 300:
                await run_in_threadpool(record_route_event, success_event, attempt_id=attempt_id)
            return response

        return track_request
