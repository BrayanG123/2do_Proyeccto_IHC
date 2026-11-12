"""
Consulta del historial de participación (Issue #14).
Responde la pregunta de StudyMatch: ¿En qué sesiones participó la persona?
"""
from datetime import date as dt_date
from typing import List, Optional
from app.models import Session, SessionHistory

HISTORY_FILTERS = {
    "todos": None,
    "unido": ("unido",),
    # Sesiones que la persona organizó: su creación y lo que hizo con ellas después
    "creada": ("creada", "cerrada", "eliminada", "cancelada"),
}


def get_user_history(db, user_id: int, tipo: str = "todos") -> List[SessionHistory]:
    """
    Consulta principal del historial:
    - Solo eventos del usuario indicado.
    - Orden comprensible: el más reciente primero.
    - Filtro opcional por tipo: 'todos', 'unido' o 'creada'.
    """
    if tipo not in HISTORY_FILTERS:
        raise ValueError(f"Filtro inválido: '{tipo}'. Opciones: {', '.join(HISTORY_FILTERS)}.")

    query = db.query(SessionHistory).filter(SessionHistory.user_id == user_id)
    event_types = HISTORY_FILTERS[tipo]
    if event_types:
        query = query.filter(SessionHistory.event_type.in_(event_types))

    return query.order_by(SessionHistory.created_at.desc(), SessionHistory.id.desc()).all()


def current_session_status(session: Optional[Session], reference_date: Optional[dt_date] = None) -> str:
    """
    Resultado actual de la sesión involucrada en un evento:
    Puede estar eliminada, cancelada, cerrada, finalizada o abierta.
    """
    if session is None:
        return "eliminada"
    if session.status == "cancelada":
        return "cancelada"
    if session.finished_at is not None:
        return "finalizada"
    if session.status == "cerrada":
        return "cerrada"
    today = reference_date or dt_date.today()
    if session.date and session.date < today:
        return "finalizada"
    return "abierta"
