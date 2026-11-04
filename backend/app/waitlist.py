"""Cola de solicitudes previamente aprobadas. El llamador bloquea la sesión."""
from datetime import date
from app.models import SessionJoinRequest, User, record_session_event


def waiting_requests(db, session_id):
    return db.query(SessionJoinRequest).filter(
        SessionJoinRequest.session_id == session_id,
        SessionJoinRequest.status == 'en_espera',
    ).order_by(SessionJoinRequest.wait_order.asc(), SessionJoinRequest.id.asc()).all()


def promote_waiting(db, session):
    """Confirma por FIFO, sin superar el cupo y sin promover sesiones cerradas o pasadas."""
    if session.status != 'abierta' or session.date < date.today():
        return
    for request in waiting_requests(db, session.id):
        if session.participants_count >= session.spots:
            break
        user = db.get(User, request.user_id)
        session.register_participant(user.email)
        request.status = 'aceptada'
        request.confirmed_email = user.email.strip().lower()
        record_session_event(db, user.id, 'unido', session)
    db.flush()


def request_view(db, request):
    user = db.get(User, request.user_id)
    position = None
    if request.status == 'en_espera':
        queue = waiting_requests(db, request.session_id)
        position = next(i + 1 for i, item in enumerate(queue) if item.id == request.id)
    return {
        'id': request.id, 'session_id': request.session_id,
        'user_id': request.user_id, 'status': request.status,
        'created_at': request.created_at,
        'user_name': user.full_name, 'user_email': user.email,
        'queue_position': position,
    }
