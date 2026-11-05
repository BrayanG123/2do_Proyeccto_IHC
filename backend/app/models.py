from email.policy import default
import json
from datetime import date as dt_date, timedelta
from typing import Optional, List
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Date, Time, ForeignKey
from sqlalchemy.sql import func
from app.database import Base
from sqlalchemy import UniqueConstraint, CheckConstraint


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String(50), nullable=True)
    last_name = Column(String(50), nullable=True)
    full_name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    avatar_url = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())


class Subject(Base):
    __tablename__ = "subjects"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, index=True, nullable=False)
    name = Column(String(150), nullable=False)
    area = Column(String(100), nullable=False)
    emoji = Column(String(10), nullable=True)
    students_count = Column(Integer, default=0)
    sessions_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PasswordResetCode(Base):
    __tablename__ = "password_reset_codes"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(150), nullable=False, index=True)
    code = Column(String(6), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    date = Column(Date, nullable=False)
    time = Column(Time, nullable=True)
    modality = Column(String(50), nullable=False)
    spots = Column(Integer, nullable=False)
    participants_count = Column(Integer, default=0, nullable=False)
    participant_emails = Column(Text, default="[]", nullable=False)
    status = Column(String(30), default="abierta", nullable=False)
    creator_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    creator_name = Column(String(150), nullable=True)
    creator_email = Column(String(150), nullable=True)
    subject = Column(String(150), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def get_participant_emails_list(self) -> list[str]:
        if not self.participant_emails:
            return []
        try:
            data = json.loads(self.participant_emails)
            if isinstance(data, list):
                return [str(e).strip().lower() for e in data if str(e).strip()]
        except Exception:
            return [e.strip().lower() for e in str(self.participant_emails).split(",") if e.strip()]
        return []

    def is_user_registered(self, user_email: str | None) -> bool:
        if not user_email:
            return False
        return user_email.strip().lower() in self.get_participant_emails_list()

    def close_registration(self, user_email: str | None = None, user_id: int | None = None):
        """
        Regla de negocio: Transición de estado para cerrar inscripciones.
        Flujo permitido: 'abierta' -> 'cerrada'.
        Validación de seguridad por correo electrónico del creador.
        Si la sesión ya está cerrada o en otro estado, la transición se rechaza.
        """
        if user_email and self.creator_email and user_email.strip().lower() != self.creator_email.strip().lower():
            raise PermissionError("No autorizado: Solo la persona que creó la sesión con su correo electrónico puede cerrarla.")

        if user_id is not None and self.creator_id is not None and self.creator_id != user_id:
            raise PermissionError("No autorizado: Solo el creador de la sesión puede cerrar las inscripciones.")

        if self.status != "abierta":
            raise ValueError(
                f"Transición inválida: No se pueden cerrar inscripciones de una sesión con estado '{self.status}'. Solo se permite desde 'abierta'."
            )
        self.status = "cerrada"
        return self

    def reopen_registration(self):
        """
        Reabre las inscripciones de una sesión de estudio.
        Transición: 'cerrada' -> 'abierta'.
        """
        if self.status == "abierta":
            raise ValueError("La sesión ya se encuentra con inscripciones abiertas.")
        self.status = "abierta"
        return self

    def can_join(self, user_email: str | None = None, check_capacity: bool = True) -> tuple[bool, str]:
        """
        Regla de negocio: ¿Puede unirse a la sesión?
        Evalúa si un estudiante cumple todas las condiciones para inscribirse:
        1. Sesión abierta.
        2. Fecha futura (la fecha no ha pasado).
        3. El creador no puede unirse a su propia sesión.
        4. No estar ya inscrito (no duplicidad).
        5. Cupos disponibles.
        Retorna (True, 'Permitido') o (False, 'Motivo del rechazo').
        """
        # 1. Sesión cerrada
        if self.status != "abierta":
            return False, "Una sesión cerrada no acepta nuevos participantes."

        # 2. Fecha pasada
        if self.date:
            session_date = self.date if isinstance(self.date, dt_date) else dt_date.fromisoformat(str(self.date))
            if session_date < dt_date.today():
                return False, "No puedes unirte a una sesión cuya fecha ya pasó."

        normalized_email = user_email.strip().lower() if user_email else None

        # 3. El creador no puede unirse a su propia sesión
        if normalized_email and self.creator_email:
            if normalized_email == self.creator_email.strip().lower():
                return False, "El creador no puede unirse a su propia sesión."

        # 4. No duplicidad
        if normalized_email and self.is_user_registered(normalized_email):
            return False, "Ya te encuentras inscrito en esta sesión de estudio."

        # 5. Cupos disponibles
        current_count = self.participants_count or len(self.get_participant_emails_list())
        if check_capacity and self.spots is not None and current_count >= self.spots:
            return False, "No hay cupos disponibles en esta sesión de estudio."

        return True, "Permitido"

    def register_participant(self, user_email: str | None = None):
        """
        Aplica la regla de negocio: ¿Puede unirse a la sesión?
        Si la regla lo rechaza, levanta ValueError con el motivo.
        Si lo permite, registra el participante y persiste el cambio.
        """
        allowed, reason = self.can_join(user_email)
        if not allowed:
            raise ValueError(reason)

        normalized_email = user_email.strip().lower() if user_email else None
        emails = self.get_participant_emails_list()

        if normalized_email:
            emails.append(normalized_email)
            self.participant_emails = json.dumps(emails)
            self.participants_count = len(emails)
        else:
            self.participants_count = (self.participants_count or 0) + 1

        return self

    @property
    def is_open(self) -> bool:
        return self.status == "abierta"


class SessionJoinRequest(Base):
    __tablename__ = "session_join_requests"

    id =         Column( Integer, primary_key=True, index=True)
    session_id = Column( Integer, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id =    Column( Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status =     Column( String(20), nullable=False, default="pendiente")
    created_at = Column( DateTime(timezone=True), nullable=False, server_default=func.now() )
    waitlisted_at = Column(DateTime(timezone=True), nullable=True)
    wait_order = Column(Integer, nullable=True)
    confirmed_email = Column(String(150), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "user_id",
            name="uq_session_join_request_user"
        ),
        CheckConstraint(
            "status IN ('pendiente', 'aceptada', 'rechazada', 'en_espera', 'retirada')",
            name="ck_session_join_request_status"
        ),
    )




class SessionReschedule(Base):
    """Un cambio de fecha u hora, con sus valores anteriores y su motivo."""
    __tablename__ = 'session_reschedules'

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey('sessions.id', ondelete='CASCADE'), nullable=False, index=True)
    organizer_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    old_date = Column(Date, nullable=False)
    old_time = Column(Time, nullable=True)
    new_date = Column(Date, nullable=False)
    new_time = Column(Time, nullable=True)
    reason = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class SessionReconfirmation(Base):
    """Respuesta de un participante a un cambio. Su cupo sigue ocupado mientras decide."""
    __tablename__ = 'session_reconfirmations'

    id = Column(Integer, primary_key=True)
    reschedule_id = Column(Integer, ForeignKey('session_reschedules.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    status = Column(String(12), nullable=False, default='pendiente')
    responded_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint('reschedule_id', 'user_id', name='uq_reconfirmation_participant'),
        CheckConstraint("status IN ('pendiente', 'confirmada', 'retirada')", name='ck_reconfirmation_status'),
    )


# ── HISTORIAL DE PARTICIPACIÓN (Issue #12 / #13) ───────────
HISTORY_EVENT_TYPES = ("unido", "creada", "cerrada", "eliminada")


class SessionHistory(Base):
    """
    Evento persistido del historial: qué ocurrió, cuándo, a quién y con qué sesión.
    Guarda una copia de los datos de la sesión al momento del evento para que
    el historial siga siendo comprensible aunque la sesión se edite o se elimine.
    """
    __tablename__ = "session_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type = Column(String(30), nullable=False)
    session_name = Column(String(150), nullable=False)
    session_subject = Column(String(150), nullable=True)
    session_date = Column(Date, nullable=True)
    session_modality = Column(String(50), nullable=True)
    session_creator_name = Column(String(150), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


def record_session_event(db, user_id: int, event_type: str, session: Session, keep_link: bool = True) -> SessionHistory:
    """
    Registra un evento del historial copiando los datos actuales de la sesión.
    Con keep_link=False el evento no queda vinculado a la sesión (se usa al eliminarla).
    """
    if event_type not in HISTORY_EVENT_TYPES:
        raise ValueError(f"Tipo de evento inválido: '{event_type}'.")

    event = SessionHistory(
        user_id=user_id,
        session_id=session.id if keep_link else None,
        event_type=event_type,
        session_name=session.name,
        session_subject=session.subject,
        session_date=session.date,
        session_modality=session.modality,
        session_creator_name=session.creator_name,
    )
    db.add(event)
    return event


def backfill_session_history(db) -> int:
    """
    Migración idempotente: genera los eventos 'creada' y 'unido' de las sesiones
    que existían antes del historial. La hora real de inscripción no se guardaba,
    así que se usa la fecha de creación de la sesión como referencia.
    Retorna la cantidad de eventos creados.
    """
    existing = {
        (e.user_id, e.session_id, e.event_type)
        for e in db.query(SessionHistory.user_id, SessionHistory.session_id, SessionHistory.event_type)
        .filter(SessionHistory.session_id.isnot(None))
        .all()
    }
    users_by_email = {
        u.email.strip().lower(): u.id
        for u in db.query(User.id, User.email).all()
        if u.email
    }

    created = 0
    for session in db.query(Session).all():
        pending = []
        creator_id = session.creator_id or users_by_email.get((session.creator_email or "").strip().lower())
        if creator_id:
            pending.append((creator_id, "creada"))
        for email in session.get_participant_emails_list():
            participant_id = users_by_email.get(email)
            if participant_id:
                pending.append((participant_id, "unido"))

        for user_id, event_type in pending:
            if (user_id, session.id, event_type) in existing:
                continue
            event = record_session_event(db, user_id, event_type, session)
            if session.created_at:
                event.created_at = session.created_at
            existing.add((user_id, session.id, event_type))
            created += 1

    db.commit()
    return created


def filter_sessions_query(
    db,
    search: Optional[str] = None,
    subject: Optional[str] = None,
    modality: Optional[str] = None,
    date_filter: Optional[str] = None,
    date_from: Optional[dt_date] = None,
    date_to: Optional[dt_date] = None,
    only_available: bool = False,
    reference_date: Optional[dt_date] = None
) -> List[Session]:
    """
    Función de consulta en base de datos que resuelve los filtros combinables (Issue #2):
    - Búsqueda por nombre de la sesión
    - Filtro por materia (coincidencia con subject o contenida en name)
    - Filtro por modalidad (Presencial, Virtual, Híbrida)
    - Filtro por fecha (hoy, próximos 7 días, rango personalizado)
    - Filtro por disponibilidad (regla Issue #1: abierta, fecha hoy o futura, cupos disponibles)
    """
    query = db.query(Session)

    # 1. Búsqueda por nombre (o materia)
    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        query = query.filter(
            (func.lower(Session.name).like(term)) |
            (func.lower(Session.subject).like(term))
        )

    # 2. Filtro por materia
    if subject and subject.strip() and subject.strip().lower() != "todas":
        subj_name = subject.strip()
        query = query.filter(
            (Session.subject.ilike(subj_name)) |
            (Session.name.ilike(f"%{subj_name}%"))
        )

    # 3. Filtro por modalidad
    if modality and modality.strip() and modality.strip().lower() != "todas":
        query = query.filter(Session.modality.ilike(modality.strip()))

    # 4. Filtro por fecha
    today = reference_date or dt_date.today()
    if date_filter == "hoy":
        query = query.filter(Session.date == today)
    elif date_filter == "proximos_7_dias":
        limit_7 = today + timedelta(days=7)
        query = query.filter(Session.date >= today, Session.date <= limit_7)
    elif date_filter == "rango":
        if date_from:
            query = query.filter(Session.date >= date_from)
        if date_to:
            query = query.filter(Session.date <= date_to)

    # 5. Filtro por disponibilidad (Regla Issue #1)
    if only_available:
        query = query.filter(
            Session.status == "abierta",
            Session.date >= today,
            Session.participants_count < Session.spots
        )

    return query.order_by(Session.created_at.desc()).all()


