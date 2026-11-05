"""Reglas de reprogramación. Las operaciones de escritura reciben la sesión bloqueada."""
from datetime import date, datetime, timezone
from fastapi import HTTPException
from sqlalchemy import func
from app.models import User, SessionJoinRequest, SessionReschedule, SessionReconfirmation


def pending_reconfirmations(db, session_id):
    return db.query(SessionReconfirmation).join(
        SessionReschedule, SessionReconfirmation.reschedule_id == SessionReschedule.id,
    ).filter(
        SessionReschedule.session_id == session_id,
        SessionReconfirmation.status == 'pendiente',
    )


def confirmed_participants(db, session):
    """Reconoce tanto solicitudes aceptadas como participaciones antiguas guardadas por correo."""
    emails = session.get_participant_emails_list()
    participants = {
        user.id: user for user in db.query(User).filter(func.lower(User.email).in_(emails)).all()
    }
    accepted = db.query(SessionJoinRequest, User).join(User, User.id == SessionJoinRequest.user_id).filter(
        SessionJoinRequest.session_id == session.id,
        SessionJoinRequest.status == 'aceptada',
    ).all()
    # confirmed_email conserva la inscripción incluso si luego cambia el correo del perfil.
    for request, user in accepted:
        email = (request.confirmed_email or user.email).strip().lower()
        if email in emails:
            participants[user.id] = user
    if len(participants) != session.participants_count:
        raise HTTPException(409, 'Hay participaciones sin una cuenta identificable. Revisa los participantes antes de reprogramar.')
    return list(participants.values())


def check_schedule_edit(db, session, data):
    """La edición general también debe respetar las reservas de los participantes."""
    new_date = data.date if data.date is not None else session.date
    new_time = data.time if 'time' in data.model_fields_set else session.time
    if new_date == session.date and new_time == session.time:
        return
    if pending_reconfirmations(db, session.id).count():
        raise HTTPException(409, 'Hay reconfirmaciones pendientes. Espera las respuestas antes de reprogramar.')
    if session.participants_count:
        raise HTTPException(400, 'Usa Reprogramar sesión e indica el motivo para avisar a los participantes.')


def reschedule_session(db, session, organizer, data):
    if pending_reconfirmations(db, session.id).count():
        raise HTTPException(409, 'Hay reconfirmaciones pendientes. Espera las respuestas antes de reprogramar.')
    if session.status != 'abierta':
        raise HTTPException(400, 'Abre las inscripciones antes de reprogramar la sesión.')
    if data.date < date.today():
        raise HTTPException(400, 'La nueva fecha no puede estar en el pasado.')
    new_time = data.time if 'time' in data.model_fields_set else session.time
    if data.date == session.date and new_time == session.time:
        raise HTTPException(400, 'Cambia la fecha o la hora para reprogramar.')

    participants = confirmed_participants(db, session)
    change = SessionReschedule(
        session_id=session.id, organizer_id=organizer.id,
        old_date=session.date, old_time=session.time,
        new_date=data.date, new_time=new_time, reason=data.reason,
    )
    db.add(change)
    db.flush()
    for participant in participants:
        db.add(SessionReconfirmation(reschedule_id=change.id, user_id=participant.id, status='pendiente'))

    session.date = data.date
    session.time = new_time
    # La lista de participantes y su contador conservan los cupos reservados.
    db.flush()
    return change


def confirm_reschedule(db, session_id, reschedule_id, user_id):
    response = db.query(SessionReconfirmation).join(
        SessionReschedule, SessionReconfirmation.reschedule_id == SessionReschedule.id,
    ).filter(
        SessionReschedule.id == reschedule_id,
        SessionReschedule.session_id == session_id,
        SessionReconfirmation.user_id == user_id,
    ).first()
    if response is None:
        raise HTTPException(403, 'Esta reconfirmación no te corresponde.')
    if response.status != 'pendiente':
        raise HTTPException(409, 'Ya respondiste a esta reprogramación.')
    response.status = 'confirmada'
    response.responded_at = datetime.now(timezone.utc)
    db.flush()


def mark_withdrawn(db, session_id, user_id):
    """Salir por cualquier entrada resuelve también la reconfirmación que estaba pendiente."""
    for response in pending_reconfirmations(db, session_id).filter(SessionReconfirmation.user_id == user_id).all():
        response.status = 'retirada'
        response.responded_at = datetime.now(timezone.utc)
    db.flush()


def reschedule_view(db, change, current_user):
    rows = db.query(SessionReconfirmation, User).join(User, User.id == SessionReconfirmation.user_id).filter(
        SessionReconfirmation.reschedule_id == change.id,
    ).order_by(SessionReconfirmation.id).all()
    own = next((response for response, user in rows if user.id == current_user.id), None)
    responses = []
    if change.organizer_id == current_user.id:
        responses = [
            {'user_id': user.id, 'user_name': user.full_name, 'status': response.status,
             'responded_at': response.responded_at}
            for response, user in rows
        ]
    return {
        'id': change.id, 'session_id': change.session_id,
        'old_date': change.old_date, 'old_time': change.old_time,
        'new_date': change.new_date, 'new_time': change.new_time,
        'reason': change.reason, 'created_at': change.created_at,
        'pending_count': sum(response.status == 'pendiente' for response, _ in rows),
        'own_status': own.status if own else None, 'responses': responses,
    }
