import json
from typing import Any, Literal
from datetime import datetime
import re
from pydantic import BaseModel, EmailStr, field_validator


def validate_password_rules(v: str) -> str:
    if len(v) < 8:
        raise ValueError("La contraseña debe tener al menos 8 caracteres")
    if not re.search(r"[A-Z]", v):
        raise ValueError("La contraseña debe contener al menos una letra mayúscula")
    if not re.search(r"[a-z]", v):
        raise ValueError("La contraseña debe contener al menos una letra minúscula")
    if not re.search(r"\d", v):
        raise ValueError("La contraseña debe contener al menos un número")
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>_\-+=\[\]\\/~`]", v):
        raise ValueError("La contraseña debe contener al menos un carácter especial (!@#$%^&*...)")
    return v


class UserCreate(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        return validate_password_rules(v)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    first_name: str | None = None
    last_name: str | None = None
    full_name: str
    email: str
    is_active: bool
    avatar_url: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True





class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordChange(BaseModel):
    email: EmailStr
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        return validate_password_rules(v)


class VerifyResetCode(BaseModel):
    email: EmailStr
    code: str


class ResetPasswordWithCode(BaseModel):
    email: EmailStr
    code: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        return validate_password_rules(v)



class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        return validate_password_rules(v)


class UserProfileUpdate(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr

    @field_validator("first_name", "last_name")
    @classmethod
    def validate_names(cls, v: str) -> str:
        v_stripped = v.strip()
        if len(v_stripped) < 2:
            raise ValueError("El campo debe tener al menos 2 caracteres")
        return v_stripped




class SubjectBase(BaseModel):
    code: str
    name: str
    area: str
    emoji: str | None = None
    students_count: int = 0
    sessions_count: int = 0


class SubjectCreate(BaseModel):
    name: str
    code: str | None = None
    area: str = "General"
    emoji: str | None = "📚"


class SubjectResponse(SubjectBase):
    id: int

    class Config:
        from_attributes = True


# ── SESIONES ──────────────────────────────────────────────
import datetime as dt

class SessionCreate(BaseModel):
    name: str
    subject: str | None = None
    date: dt.date
    modality: str
    spots: int
    status: str = "abierta"

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("El nombre debe tener al menos 3 caracteres")
        return v

    @field_validator("spots")
    @classmethod
    def validate_spots(cls, v: int) -> int:
        if v < 1:
            raise ValueError("Los cupos deben ser al menos 1")
        return v


class SessionStatusUpdate(BaseModel):
    status: str


class SessionUpdate(BaseModel):
    name: str | None = None
    subject: str | None = None
    date: dt.date | None = None
    modality: str | None = None
    spots: int | None = None
    status: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if len(v) < 3:
                raise ValueError("El nombre debe tener al menos 3 caracteres")
        return v

    @field_validator("spots")
    @classmethod
    def validate_spots(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("Los cupos deben ser al menos 1")
        return v

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is not None and v not in ["abierta", "cerrada"]:
            raise ValueError("El estado debe ser 'abierta' o 'cerrada'")
        return v


class SessionResponse(BaseModel):
    id: int
    name: str
    subject: str | None = None
    date: dt.date
    modality: str
    spots: int
    participants_count: int = 0
    participant_emails: list[str] = []
    status: str = "abierta"
    creator_id: int | None = None
    creator_name: str | None = None
    creator_email: str | None = None
    created_at: datetime | None = None

    @field_validator("participant_emails", mode="before")
    @classmethod
    def parse_participant_emails(cls, v: Any) -> list[str]:
        if isinstance(v, list):
            return [str(item).strip().lower() for item in v if str(item).strip()]
        if isinstance(v, str):
            try:
                data = json.loads(v)
                if isinstance(data, list):
                    return [str(item).strip().lower() for item in data if str(item).strip()]
            except Exception:
                return [item.strip().lower() for item in v.split(",") if item.strip()]
        return []

    class Config:
        from_attributes = True


# ── HISTORIAL (Issue #14) ─────────────────────────────────
class HistoryEventResponse(BaseModel):
    id: int
    event_type: str
    created_at: datetime | None = None
    session_id: int | None = None
    session_name: str
    session_subject: str | None = None
    session_date: dt.date | None = None
    session_modality: str | None = None
    session_creator_name: str | None = None
    current_status: str
    participants_count: int | None = None
    spots: int | None = None




class SessionJoinRequestResponse(BaseModel):
    id: int
    session_id: int
    user_id: int
    status: str
    created_at: datetime
    user_name: str | None = None
    user_email: str | None = None
    queue_position: int | None = None

    model_config = {"from_attributes": True}


class RequestDecision(BaseModel):
    decision: Literal['aceptar', 'rechazar']
