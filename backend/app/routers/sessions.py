from datetime import date as dt_date, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app.models import Session, User, Subject, filter_sessions_query, record_session_event, SessionJoinRequest
from app.schemas import SessionCreate, SessionResponse, SessionStatusUpdate, SessionUpdate, SessionJoinRequestResponse
from app.routers.auth import get_current_user






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
    session = db.query(Session).filter(Session.id == session_id).first()
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
    session = db.query(Session).filter(Session.id == session_id).first()
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
    session = db.query(Session).filter(Session.id == session_id).first()
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

    if data.name is not None:
        session.name = data.name
    if data.date is not None:
        session.date = data.date
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
    session = db.query(Session).filter(Session.id == session_id).first()
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


@router.post("/{session_id}/join", response_model=SessionResponse)
def join_session(
    session_id: int,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    3. Aplicar una restricción según su estado:
    Directriz de STUDYMATCH: Una sesión cerrada no acepta nuevos participantes.
    """
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sesión no encontrada"
        )

    try:
        session.register_participant(user_email=current_user.email)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    record_session_event(db, current_user.id, "unido", session)
    db.commit()
    db.refresh(session)
    return session



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


    permitido, motivo = session.can_join(current_user.email)

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