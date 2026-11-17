import json
from datetime import datetime, timezone

from sqlalchemy import func, or_, select

from app.models import (
    AttendanceHistory, PasswordResetCode, Session, SessionAttendance,
    SessionHistory, SessionJoinRequest, SessionReconfirmation, SessionReschedule,
)
from app.session_cancellation import apply_cancellation
from app.waitlist import promote_waiting


ACCOUNT_CANCEL_REASON = 'La persona que organizaba esta sesión eliminó su cuenta.'
DELETED_ORGANIZER = 'Cuenta eliminada'
SESSION_FIELDS = (
    'id', 'name', 'subject', 'date', 'time', 'modality', 'spots', 'status',
    'created_at', 'finished_at', 'cancelled_at', 'cancellation_reason',
)
RESCHEDULE_FIELDS = ('session_id', 'old_date', 'old_time', 'new_date', 'new_time', 'reason', 'created_at')


def fields(record, names):
    return {name: getattr(record, name) for name in names}


def organized_by(user):
    return or_(
        Session.creator_id == user.id,
        (Session.creator_id.is_(None)) & (func.lower(Session.creator_email) == user.email.lower()),
    )


def export_account(db, user):
    attendance = []
    for record in db.query(SessionAttendance).filter_by(user_id=user.id).order_by(SessionAttendance.id):
        changes = db.query(AttendanceHistory).filter_by(attendance_id=record.id).order_by(AttendanceHistory.id)
        attendance.append({
            **fields(record, ('session_id', 'status', 'justification', 'justification_status', 'decision_reason')),
            'historial': [
                fields(change, ('action', 'previous_status', 'new_status', 'note', 'created_at'))
                for change in changes
            ],
        })
    requests = db.query(SessionJoinRequest, Session).join(Session, Session.id == SessionJoinRequest.session_id).filter(
        SessionJoinRequest.user_id == user.id,
    ).order_by(SessionJoinRequest.id)
    reconfirmations = db.query(SessionReconfirmation, SessionReschedule).join(
        SessionReschedule, SessionReconfirmation.reschedule_id == SessionReschedule.id,
    ).filter(SessionReconfirmation.user_id == user.id).order_by(SessionReconfirmation.id)
    return {
        'perfil': fields(user, ('first_name', 'last_name', 'full_name', 'email', 'avatar_url', 'created_at', 'updated_at')),
        'sesiones_organizadas': [
            fields(session, SESSION_FIELDS) for session in db.query(Session).filter(organized_by(user)).order_by(Session.id)
        ],
        'solicitudes': [
            {
                **fields(request, ('session_id', 'status', 'created_at', 'waitlisted_at')),
                'sesion': session.name,
                'motivo_cancelacion': session.cancellation_reason if request.status == 'cancelada' else None,
            }
            for request, session in requests
        ],
        'asistencia': attendance,
        'reprogramaciones_organizadas': [
            fields(change, RESCHEDULE_FIELDS)
            for change in db.query(SessionReschedule).filter_by(organizer_id=user.id).order_by(SessionReschedule.id)
        ],
        'reconfirmaciones': [
            {**fields(change, RESCHEDULE_FIELDS), **fields(response, ('status', 'responded_at'))}
            for response, change in reconfirmations
        ],
        'historial': [
            fields(item, ('event_type', 'session_name', 'session_subject', 'session_date', 'session_modality', 'created_at'))
            for item in db.query(SessionHistory).filter_by(user_id=user.id).order_by(SessionHistory.id)
        ],
    }


def delete_account(db, user):
    email = user.email.strip().lower()
    owner_filter = organized_by(user)
    requested = select(SessionJoinRequest.session_id).where(SessionJoinRequest.user_id == user.id)
    sessions = db.query(Session).filter(or_(
        owner_filter, Session.id.in_(requested), func.lower(Session.participant_emails).contains(email, autoescape=True),
    )).order_by(Session.id).with_for_update().all()
    owned = [
        session for session in sessions
        if session.creator_id == user.id or (session.creator_id is None and (session.creator_email or '').lower() == email)
    ]
    owned_ids = {session.id for session in owned}
    requests = db.query(SessionJoinRequest).filter_by(user_id=user.id).all()
    requests_by_session = {request.session_id: request for request in requests}
    cancelled_at = datetime.now(timezone.utc)

    for session in owned:
        if session.status != 'cancelada' and session.finished_at is None:
            apply_cancellation(db, session, ACCOUNT_CANCEL_REASON, cancelled_at)
        session.creator_id = None
        session.creator_email = None
        session.creator_name = DELETED_ORGANIZER

    # Quita las solicitudes propias antes de que se pueda promover a alguien de la cola.
    for request in requests:
        db.delete(request)
    db.flush()

    for session in sessions:
        if session.id in owned_ids:
            continue
        request = requests_by_session.get(session.id)
        aliases = {email}
        if request and request.confirmed_email:
            aliases.add(request.confirmed_email.strip().lower())
        participants = session.get_participant_emails_list()
        remaining = [address for address in participants if address not in aliases]
        if len(remaining) != len(participants):
            session.participant_emails = json.dumps(remaining)
            session.participants_count = max(0, session.participants_count - (len(participants) - len(remaining)))
            promote_waiting(db, session)

    owned_attendance = select(SessionAttendance.id).where(SessionAttendance.user_id == user.id)
    db.query(AttendanceHistory).filter(AttendanceHistory.attendance_id.in_(owned_attendance)).delete(synchronize_session=False)
    db.query(AttendanceHistory).filter_by(actor_id=user.id).update({'actor_id': None}, synchronize_session=False)
    db.query(SessionAttendance).filter_by(user_id=user.id).delete(synchronize_session=False)
    db.query(SessionReconfirmation).filter_by(user_id=user.id).delete(synchronize_session=False)
    db.query(SessionReschedule).filter_by(organizer_id=user.id).update({'organizer_id': None}, synchronize_session=False)
    db.query(SessionHistory).filter_by(user_id=user.id).delete(synchronize_session=False)
    if owned_ids:
        db.query(SessionHistory).filter(SessionHistory.session_id.in_(owned_ids)).update(
            {'session_creator_name': DELETED_ORGANIZER}, synchronize_session=False,
        )
    db.query(PasswordResetCode).filter(func.lower(PasswordResetCode.email) == email).delete(synchronize_session=False)
    db.delete(user)
