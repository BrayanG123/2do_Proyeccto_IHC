from datetime import timedelta, timezone

from sqlalchemy import func

from app.models import SessionJoinRequest, User
from app.rescheduling import pending_reconfirmations


BOLIVIA_TIME = timezone(timedelta(hours=-4))


def apply_cancellation(db, session, reason, cancelled_at):
    """Cancela la sesión bloqueada y sus participaciones en la transacción del llamador."""
    requests = db.query(SessionJoinRequest).filter_by(session_id=session.id).all()
    for request in requests:
        if request.status in ('aceptada', 'pendiente', 'en_espera'):
            request.status = 'cancelada'

    # Las participaciones antiguas también necesitan un aviso en Mis solicitudes.
    legacy_participants = db.query(User.id, User.email).filter(
        func.lower(User.email).in_(session.get_participant_emails_list()),
        User.id.not_in([request.user_id for request in requests]),
        User.id != session.creator_id,
    )
    for user_id, email in legacy_participants:
        db.add(SessionJoinRequest(
            session_id=session.id, user_id=user_id, status='cancelada', confirmed_email=email,
        ))

    for response in pending_reconfirmations(db, session.id):
        response.status = 'cancelada'
        response.responded_at = cancelled_at

    session.status = 'cancelada'
    session.cancelled_at = cancelled_at
    session.cancellation_reason = reason
    session.participant_emails = '[]'
    session.participants_count = 0
