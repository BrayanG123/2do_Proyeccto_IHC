import base64
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, PasswordResetCode
from app.schemas import (
    UserCreate,
    UserLogin,
    Token,
    PasswordResetRequest,
    PasswordChange,
    VerifyResetCode,
    ResetPasswordWithCode,
    UserResponse,
    ChangePasswordRequest,
    UserProfileUpdate,
)
from app.security import hash_password, verify_password, create_access_token, decode_token
from app.utils.email_service import generate_reset_code, send_reset_code_email
from app.analytics_tracking import TrackedRoute

router = APIRouter(prefix="/auth", tags=["auth"], route_class=TrackedRoute)
security = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    token: Optional[str] = Query(None, description="Token opcional en query string"),
    db: Session = Depends(get_db),
) -> User:
    """Extrae y valida el usuario actual desde el Header Bearer o Query param."""
    raw_token = None
    if credentials and credentials.credentials:
        raw_token = credentials.credentials
    elif token:
        raw_token = token

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado: falta token de acceso",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_token(raw_token)
    if not payload or not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado",
        )
    return user


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """Registro de nueva cuenta."""
    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El correo ya está registrado"
        )
    full_name = f"{user_data.first_name.strip()} {user_data.last_name.strip()}".strip()
    new_user = User(
        first_name=user_data.first_name.strip(),
        last_name=user_data.last_name.strip(),
        full_name=full_name,
        email=user_data.email,
        hashed_password=hash_password(user_data.password)
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    token = create_access_token({"sub": str(new_user.id), "email": new_user.email})
    return {"access_token": token, "token_type": "bearer", "user": new_user}


@router.post("/login", response_model=Token)
def login(credentials: UserLogin, db: Session = Depends(get_db)):
    """Inicio de sesión."""
    user = db.query(User).filter(User.email == credentials.email).first()
    if not user or not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Correo o contraseña incorrectos"
        )
    token = create_access_token({"sub": str(user.id), "email": user.email})
    return {"access_token": token, "token_type": "bearer", "user": user}


@router.post("/send-reset-code")
def send_reset_code(
    request: PasswordResetRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Paso 1 – Genera y envía un código de 6 dígitos al correo del usuario.
    Para no bloquear la respuesta, el correo se envía en background.
    """
    user = db.query(User).filter(User.email == request.email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No existe una cuenta registrada con ese correo electrónico",
        )

    # Invalidar códigos previos no usados de ese email
    db.query(PasswordResetCode).filter(
        PasswordResetCode.email == request.email,
        PasswordResetCode.used == False,
    ).update({"used": True})

    code = generate_reset_code()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    reset_entry = PasswordResetCode(
        email=request.email,
        code=code,
        expires_at=expires_at,
    )
    db.add(reset_entry)
    db.commit()

    # Enviar en background para no bloquear la respuesta HTTP
    user_name = user.first_name or user.full_name.split()[0]
    background_tasks.add_task(send_reset_code_email, request.email, code, user_name)

    return {
        "message": "Código de verificación enviado al correo electrónico",
        "email": request.email,
    }


def reset_code_expired(expires_at: datetime) -> bool:
    if expires_at.tzinfo is None:
        # SQLite devuelve sin zona la fecha que se guardó en UTC.
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) > expires_at


@router.post("/verify-reset-code")
def verify_reset_code(data: VerifyResetCode, db: Session = Depends(get_db)):
    """
    Paso 2 – Verifica que el código de 6 dígitos sea válido y no haya expirado.
    """
    entry = (
        db.query(PasswordResetCode)
        .filter(
            PasswordResetCode.email == data.email,
            PasswordResetCode.code == data.code,
            PasswordResetCode.used == False,
        )
        .order_by(PasswordResetCode.created_at.desc())
        .first()
    )

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código incorrecto o ya utilizado",
        )

    if reset_code_expired(entry.expires_at):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El código ha expirado. Solicita uno nuevo.",
        )

    return {"message": "Código verificado correctamente", "valid": True}


@router.post("/login-with-code", response_model=Token)
def login_with_code(data: VerifyResetCode, db: Session = Depends(get_db)):
    """
    Inicio de sesión directo usando el código de verificación ya validado.
    Permite omitir el cambio de contraseña e iniciar sesión de inmediato.
    Marca el código como usado para que no pueda reutilizarse.
    """
    entry = (
        db.query(PasswordResetCode)
        .filter(
            PasswordResetCode.email == data.email,
            PasswordResetCode.code == data.code,
            PasswordResetCode.used == False,
        )
        .order_by(PasswordResetCode.created_at.desc())
        .first()
    )

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código incorrecto o ya utilizado",
        )

    if reset_code_expired(entry.expires_at):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El código ha expirado. Solicita uno nuevo.",
        )

    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")

    entry.used = True
    db.commit()

    token = create_access_token({"sub": str(user.id), "email": user.email})
    return {"access_token": token, "token_type": "bearer", "user": user}



@router.post("/reset-password-with-code")
def reset_password_with_code(data: ResetPasswordWithCode, db: Session = Depends(get_db)):
    """
    Paso 3 – Verifica el código nuevamente y cambia la contraseña.
    Marca el código como usado al completar el proceso.
    """
    entry = (
        db.query(PasswordResetCode)
        .filter(
            PasswordResetCode.email == data.email,
            PasswordResetCode.code == data.code,
            PasswordResetCode.used == False,
        )
        .order_by(PasswordResetCode.created_at.desc())
        .first()
    )

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código incorrecto o ya utilizado",
        )

    if reset_code_expired(entry.expires_at):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El código ha expirado. Solicita uno nuevo.",
        )

    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")

    user.hashed_password = hash_password(data.new_password)
    entry.used = True
    db.commit()

    return {"message": "¡Contraseña restablecida correctamente! Ya puedes iniciar sesión."}


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Devuelve el usuario autenticado a partir del token."""
    return current_user


@router.post("/change-password")
def change_password(
    data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Permite al estudiante autenticado cambiar su contraseña verificando la actual."""
    if not verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contraseña actual ingresada es incorrecta",
        )
    if data.current_password == data.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nueva contraseña debe ser diferente a la contraseña actual",
        )
    current_user.hashed_password = hash_password(data.new_password)
    db.commit()
    return {"message": "¡Contraseña actualizada exitosamente!"}


@router.put("/profile", response_model=UserResponse)
def update_profile(
    profile_data: UserProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Actualiza la información del estudiante (Nombres, Apellidos y Correo).
    El trigger de PostgreSQL 'trg_update_user_profile' actualiza automáticamente full_name y updated_at.
    """
    new_email = profile_data.email.strip().lower()
    if new_email != current_user.email.lower():
        existing = db.query(User).filter(User.email == new_email).first()
        if existing and existing.id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El correo electrónico ingresado ya pertenece a otra cuenta",
            )
        current_user.email = new_email

    current_user.first_name = profile_data.first_name.strip()
    current_user.last_name = profile_data.last_name.strip()

    # El trigger trg_update_user_profile BEFORE UPDATE en PostgreSQL sincroniza full_name y updated_at
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/avatar", response_model=UserResponse)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Sube y actualiza la foto de perfil del estudiante."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo debe ser una imagen válida (PNG, JPG, JPEG, WEBP)",
        )
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La imagen no puede exceder 5 MB",
        )
    encoded = base64.b64encode(contents).decode("utf-8")
    current_user.avatar_url = f"data:{file.content_type};base64,{encoded}"
    db.commit()
    db.refresh(current_user)
    return current_user


@router.delete("/avatar", response_model=UserResponse)
def remove_avatar(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Elimina la foto de perfil para volver a las iniciales del estudiante."""
    current_user.avatar_url = None
    db.commit()
    db.refresh(current_user)
    return current_user



