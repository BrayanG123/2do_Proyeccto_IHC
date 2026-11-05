from datetime import date as dt_date, timedelta, datetime, timezone
import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app.models import Session, User, Subject, filter_sessions_query, record_session_event, SessionJoinRequest
from app.schemas import SessionCreate, SessionResponse, SessionStatusUpdate, SessionUpdate, SessionJoinRequestResponse, RequestDecision
from app.routers.auth import get_current_user
from app.waitlist import promote_waiting, request_view
from app.models import SessionReschedule, SessionReconfirmation
from app.schemas import SessionRescheduleCreate, SessionRescheduleResponse
from app.rescheduling import check_schedule_edit, reschedule_session, confirm_reschedule, mark_withdrawn, reschedule_view






router = APIRouter(prefix="/sessions", tags=["Sesiones"])


@router.post("/", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(
    data: SessionCreate,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Crea una nueva sesión de estudio vinculada al usuario autenticado (creador).
    Estado inicial por defecto: 'abierta'.
    """
    creator_display = (
        current_user.full_name
        or f"{current_user.first_name or ''} {current_user.last_name or ''}".strip()
        or current_user.email
    )
    subject_val = data.subject.strip() if data.subject and data.subject.strip() else None

    # Si se especificó una materia, actualizar contador en subjects si existe
    if subject_val:
        subj = db.query(Subject).filter(Subject.name.ilike(subject_val)).first()
        if subj:
            subj.sessions_count = (subj.sessions_count or 0) + 1

    new_session = Session(
        name=data.name,
        subject=subject_val,
        date=data.date,
        time=data.time,
        modality=data.modality,
        spots=data.spots,
        status="abierta",
        creator_id=current_user.id,
        creator_name=creator_display,
        creator_email=current_user.email.strip().lower()
    )
    db.add(new_session)
    db.flush()  # obtener el id antes de registrar el evento
    record_session_event(db, current_user.id, "creada", new_session)
    db.commit()
    db.refresh(new_session)
    return new_session


@router.get("/", response_model=List[SessionResponse])
def get_sessions(
    search: Optional[str] = Query(None, description="Buscar por nombre de sesión"),
    subject: Optional[str] = Query(None, description="Filtrar por materia"),
    modality: Optional[str] = Query(None, description="Filtrar por modalidad (Presencial, Virtual, Híbrida)"),
    date_filter: Optional[str] = Query(None, description="Filtro de fecha: 'hoy', 'proximos_7_dias', 'rango'"),
    date_from: Optional[dt_date] = Query(None, description="Fecha inicio para rango"),
    date_to: Optional[dt_date] = Query(None, description="Fecha fin para rango"),
    only_available: bool = Query(False, description="Solo sesiones abiertas, con cupos y fecha futura"),
    db: DBSession = Depends(get_db)
):
    """
    Devuelve las sesiones guardadas en la BD aplicando los filtros combinables por base de datos.
    """
    return filter_sessions_query(
        db=db,
        search=search,
        subject=subject,
        modality=modality,
        date_filter=date_filter,
        date_from=date_from,
        date_to=date_to,
        only_available=only_available
    )


@router.patch("/{session_id}/close", response_model=SessionResponse)
def close_session_registration(
    session_id: int,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Acción: 'Cerrar inscripciones'.
    Regla de seguridad: Solo el usuario que creó la sesión (validado por correo) puede cerrarla.
    Aplica la regla de transición de estado: 'abierta' -> 'cerrada'.
    Rechaza transiciones inválidas con error HTTP 400 y accesos no autorizados con HTTP 403.
    """
    session = db.query(Session).filter(Session.id == session_id).with_for_update().first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sesión no encontrada"
        )

    # Validar que el usuario actual sea el creador por correo electrónico
    is_creator = False
    if session.creator_email and current_user.email:
        is_creator = session.creator_email.strip().lower() == current_user.email.strip().lower()
    elif session.creator_id and current_user.id:
        is_creator = int(session.creator_id) == int(current_user.id)

    if not is_creator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No autorizado: Solo la persona que creó la sesión puede cerrar sus inscripciones."
        )

    try:
        session.close_registration()
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    record_session_event(db, current_user.id, "cerrada", session)
    db.commit()
    db.refresh(session)
    return session


@router.patch("/{session_id}/status", response_model=SessionResponse)
def update_session_status(
    session_id: int,
    body: SessionStatusUpdate,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Actualiza el estado de la sesión validando que el usuario sea el creador por correo.
    """
    session = db.query(Session).filter(Session.id == session_id).with_for_update().first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sesión no encontrada"
        )

    # Validar creador por correo electrónico
    is_creator = False
    if session.creator_email and current_user.email:
        is_creator = session.creator_email.strip().lower() == current_user.email.strip().lower()
    elif session.creator_id and current_user.id:
        is_creator = int(session.creator_id) == int(current_user.id)

    if not is_creator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No autorizado: Solo la persona que creó la sesión puede modificar su estado."
        )

    if body.status == "cerrada":
        try:
            session.close_registration()
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        record_session_event(db, current_user.id, "cerrada", session)
    elif body.status == "abierta":
        if session.status == "abierta":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transición inválida: La sesión ya se encuentra con inscripciones abiertas."
            )
        session.status = "abierta"
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Estado '{body.status}' no válido. Estados permitidos: 'abierta', 'cerrada'."
        )

    db.commit()
    db.refresh(session)
    return session


@router.put("/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: int,
    data: SessionUpdate,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    1. Editar: Los datos del elemento (nombre, fecha, modalidad, cupos).
    Solo el creador puede editar los datos de su sesión.
    """
    session = db.query(Session).filter(Session.id == session_id).with_for_update().first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sesión no encontrada"
        )

    is_creator = False
    if session.creator_email and current_user.email:
        is_creator = session.creator_email.strip().lower() == current_user.email.strip().lower()
    elif session.creator_id and current_user.id:
        is_creator = int(session.creator_id) == int(current_user.id)

    if not is_creator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No autorizado: Solo el creador puede editar los datos de su sesión."
        )

    check_schedule_edit(db, session, data)
    if data.name is not None:
        session.name = data.name
    if data.date is not None:
        session.date = data.date
    if 'time' in data.model_fields_set:
        session.time = data.time
    if data.modality is not None:
        session.modality = data.modality
    if data.spots is not None:
        if data.spots < session.participants_count:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Los cupos ({data.spots}) no pueden ser menores a los participantes ya inscritos ({session.participants_count})."
            )
        session.spots = data.spots
    if data.subject is not None:
        session.subject = data.subject.strip() if data.subject else None

    if data.status is not None:
        if data.status not in ["abierta", "cerrada"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Estado inválido. Solo se permite 'abierta' o 'cerrada'."
            )
        if data.status == "cerrada" and session.status != "cerrada":
            record_session_event(db, current_user.id, "cerrada", session)
        session.status = data.status

    db.commit()
    db.refresh(session)
    return session


@router.delete("/{session_id}", status_code=status.HTTP_200_OK)
def delete_session(
    session_id: int,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    2. Eliminar: Elimina la sesión solicitando confirmación previa en la UI.
    Solo el creador puede eliminar su sesión.
    """
    session = db.query(Session).filter(Session.id == session_id).with_for_update().first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sesión no encontrada"
        )

    is_creator = False
    if session.creator_email and current_user.email:
        is_creator = session.creator_email.strip().lower() == current_user.email.strip().lower()
    elif session.creator_id and current_user.id:
        is_creator = int(session.creator_id) == int(current_user.id)

    if not is_creator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No autorizado: Solo el creador puede eliminar su sesión."
        )

    # El evento conserva una copia de la sesión; no queda vinculado porque la fila se elimina
    record_session_event(db, current_user.id, "eliminada", session, keep_link=False)
    db.delete(session)
    db.commit()
    return {"message": "Sesión eliminada exitosamente", "id": session_id}


@router.post("/{session_id}/join", response_model=SessionJoinRequestResponse)
def join_session(
    session_id: int,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    3. Aplicar una restricción según su estado:
    Directriz de STUDYMATCH: Una sesión cerrada no acepta nuevos participantes.
    """
    # Compatibilidad de ruta: tampoco permite saltarse la aprobación del organizador.
    return solicitar_unirse(session_id, db, current_user)



@router.post(
    "/{session_id}/requests",
    response_model=SessionJoinRequestResponse,
    status_code=status.HTTP_201_CREATED
)
def solicitar_unirse(
    session_id: int,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    
    session = (
        db.query(Session)
        .filter(Session.id == session_id)
        .with_for_update()
        .first()
    )

    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Sesión no encontrada."
        )


    if session.creator_id is None:
        raise HTTPException(
            status_code=400,
            detail="Esta sesión no tiene un organizador disponible."
        )


    if session.creator_id == current_user.id:
        raise HTTPException(
            status_code=400,
            detail="No puedes solicitar unirte a tu propia sesión."
        )


    existente = (
        db.query(SessionJoinRequest)
        .filter(
            SessionJoinRequest.session_id == session_id,
            SessionJoinRequest.user_id == current_user.id
        )
        .first()
    )

    if existente is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                "Ya tienes una solicitud para esta sesión "
                f"con estado '{existente.status}'."
            )
        )


    permitido, motivo = session.can_join(current_user.email, check_capacity=False)

    if not permitido:
        raise HTTPException(
            status_code=400,
            detail=motivo
        )


    solicitud = SessionJoinRequest(
        session_id=session.id,
        user_id=current_user.id,
        status="pendiente"
    )


    db.add(solicitud)


    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()

        constraint_name = getattr(
            getattr(exc.orig, "diag", None),
            "constraint_name",
            None
        )

        if constraint_name == "uq_session_join_request_user":
            raise HTTPException(
                status_code=409,
                detail="Ya tienes una solicitud para esta sesión."
            ) from exc


        raise

    db.refresh(solicitud)
    return solicitud


def locked_session(db, session_id):
    session = db.query(Session).filter(Session.id == session_id).with_for_update().first()
    if session is None:
        raise HTTPException(404, 'Sesión no encontrada.')
    return session


def require_organizer(session, user):
    if session.creator_id != user.id:
        raise HTTPException(403, 'Solo el organizador puede gestionar las solicitudes.')


@router.get('/requests/me', response_model=List[SessionJoinRequestResponse])
def my_requests(db: DBSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    requests = db.query(SessionJoinRequest).filter(SessionJoinRequest.user_id == current_user.id).all()
    return [request_view(db, item) for item in requests]


@router.get('/{session_id}/requests', response_model=List[SessionJoinRequestResponse])
def list_requests(session_id: int, db: DBSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = db.get(Session, session_id)
    if session is None:
        raise HTTPException(404, 'Sesión no encontrada.')
    require_organizer(session, current_user)
    requests = db.query(SessionJoinRequest).filter(SessionJoinRequest.session_id == session_id).order_by(SessionJoinRequest.id).all()
    return [request_view(db, item) for item in requests]


@router.patch('/{session_id}/requests/{request_id}', response_model=SessionJoinRequestResponse)
def decide_request(session_id: int, request_id: int, body: RequestDecision,
                   db: DBSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = locked_session(db, session_id)
    require_organizer(session, current_user)
    request = db.query(SessionJoinRequest).filter(
        SessionJoinRequest.id == request_id, SessionJoinRequest.session_id == session_id,
    ).first()
    if request is None:
        raise HTTPException(404, 'Solicitud no encontrada.')
    if request.status not in ('pendiente', 'en_espera'):
        raise HTTPException(409, 'Esta solicitud ya tiene una decisión definitiva.')
    if body.decision == 'rechazar':
        request.status = 'rechazada'
    else:
        if request.status != 'pendiente':
            raise HTTPException(409, 'La solicitud ya está en la lista de espera.')
        applicant = db.get(User, request.user_id)
        allowed, reason = session.can_join(applicant.email, check_capacity=False)
        if not allowed:
            raise HTTPException(400, reason)
        request.status = 'en_espera'
        request.waitlisted_at = datetime.now(timezone.utc)
        # El bloqueo de la sesión serializa este contador incluso si dos relojes coinciden.
        request.wait_order = (db.query(func.max(SessionJoinRequest.wait_order)).filter(
            SessionJoinRequest.session_id == session_id,
        ).scalar() or 0) + 1
        db.flush()
        promote_waiting(db, session)
    db.commit()
    return request_view(db, request)


@router.post('/{session_id}/leave', response_model=SessionResponse)
def leave_session(session_id: int, db: DBSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = locked_session(db, session_id)
    request = db.query(SessionJoinRequest).filter(
        SessionJoinRequest.session_id == session_id, SessionJoinRequest.user_id == current_user.id,
    ).first()
    email = (request.confirmed_email if request and request.confirmed_email else current_user.email).strip().lower()
    if not session.is_user_registered(email):
        raise HTTPException(409, 'No estás confirmado en esta sesión.')
    emails = session.get_participant_emails_list()
    emails.remove(email)
    session.participant_emails = json.dumps(emails)
    session.participants_count = max(0, session.participants_count - 1)
    if request:
        request.status = 'retirada'
    mark_withdrawn(db, session_id, current_user.id)
    promote_waiting(db, session)
    db.commit()
    db.refresh(session)
    return session


@router.get('/reschedules/me', response_model=List[SessionRescheduleResponse])
def my_reschedules(db: DBSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    organized = db.query(Session.id).filter(Session.creator_id == current_user.id).all()
    requested = db.query(SessionJoinRequest.session_id).filter(SessionJoinRequest.user_id == current_user.id).all()
    involved = db.query(SessionReschedule.session_id).join(
        SessionReconfirmation, SessionReconfirmation.reschedule_id == SessionReschedule.id,
    ).filter(SessionReconfirmation.user_id == current_user.id).all()
    session_ids = {row[0] for row in organized + requested + involved}
    changes = db.query(SessionReschedule).filter(SessionReschedule.session_id.in_(session_ids)).order_by(
        SessionReschedule.id.desc(),
    ).all()
    return [reschedule_view(db, change, current_user) for change in changes]


@router.post('/{session_id}/reschedule', response_model=SessionRescheduleResponse, status_code=201)
def create_reschedule(session_id: int, body: SessionRescheduleCreate,
                      db: DBSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = locked_session(db, session_id)
    require_organizer(session, current_user)
    change = reschedule_session(db, session, current_user, body)
    db.commit()
    return reschedule_view(db, change, current_user)


@router.post('/{session_id}/reschedules/{reschedule_id}/confirm', response_model=SessionRescheduleResponse)
def reconfirm_session(session_id: int, reschedule_id: int,
                      db: DBSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    locked_session(db, session_id)
    confirm_reschedule(db, session_id, reschedule_id, current_user.id)
    db.commit()
    return reschedule_view(db, db.get(SessionReschedule, reschedule_id), current_user)
