"""Carga materias y datos de demostración de StudyMatch.

Ejecutar desde backend: python seed.py
Con Docker: docker compose exec backend python seed.py
Los datos existentes no se reinician al volver a ejecutar el script.
"""
from datetime import date, timedelta
import json

from app.database import Base, SessionLocal, engine
from app.models import (
    Session,
    SessionHistory,
    SessionJoinRequest,
    Subject,
    User,
    record_session_event,
)
from app.routers.subjects import seed_subjects_in_db
from app.security import hash_password


DEMO_PASSWORD = "StudyMatch123!"

DEMO_USERS = [
    ("Ana", "Torres", "ana.demo@example.com"),
    ("Bruno", "Rojas", "bruno.demo@example.com"),
    ("Carla", "Mendez", "carla.demo@example.com"),
    ("Diego", "Vargas", "diego.demo@example.com"),
    ("Elena", "Flores", "elena.demo@example.com"),
]

DEMO_SESSIONS = [
    {
        "name": "[DEMO] Repaso de Calculo I",
        "creator": "ana.demo@example.com",
        "subject": "MAT101",
        "days": 3,
        "modality": "Virtual",
        "spots": 5,
        "status": "abierta",
        "requests": [
            ("carla.demo@example.com", "pendiente"),
            ("diego.demo@example.com", "aceptada"),
        ],
    },
    {
        "name": "[DEMO] Estructuras Discretas",
        "creator": "bruno.demo@example.com",
        "subject": "INF119",
        "days": 5,
        "modality": "Presencial",
        "spots": 4,
        "status": "abierta",
        "requests": [
            ("ana.demo@example.com", "pendiente"),
            ("elena.demo@example.com", "rechazada"),
        ],
    },
    {
        "name": "[DEMO] Taller de Programacion I",
        "creator": "ana.demo@example.com",
        "subject": "INF120",
        "days": 7,
        "modality": "Híbrida",
        "spots": 1,
        "status": "abierta",
        "requests": [("bruno.demo@example.com", "aceptada")],
    },
    {
        "name": "[DEMO] Algebra Lineal - inscripciones cerradas",
        "creator": "bruno.demo@example.com",
        "subject": "MAT103",
        "days": 4,
        "modality": "Presencial",
        "spots": 4,
        "status": "cerrada",
        "requests": [("carla.demo@example.com", "aceptada")],
    },
    {
        "name": "[DEMO] Repaso anterior de Fisica I",
        "creator": "ana.demo@example.com",
        "subject": "FIS100",
        "days": -7,
        "modality": "Virtual",
        "spots": 6,
        "status": "abierta",
        "requests": [("elena.demo@example.com", "aceptada")],
    },
    {
        "name": "[DEMO] Interaccion Hombre-Computador",
        "creator": "elena.demo@example.com",
        "subject": "ELC106",
        "days": 10,
        "modality": "Virtual",
        "spots": 6,
        "status": "abierta",
        "requests": [],
    },
]


def seed_demo_data(db, reference_date=None):
    """Agrega datos faltantes; el llamador confirma la transacción."""
    today = reference_date or date.today()
    result = {"users": 0, "sessions": 0, "requests": 0, "history": 0}
    users = {}

    for first_name, last_name, email in DEMO_USERS:
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            user = User(
                first_name=first_name,
                last_name=last_name,
                full_name=f"{first_name} {last_name}",
                email=email,
                hashed_password=hash_password(DEMO_PASSWORD),
                is_active=True,
            )
            db.add(user)
            db.flush()
            result["users"] += 1
        users[email] = user

    for template in DEMO_SESSIONS:
        creator = users[template["creator"]]
        # El historial conserva el nombre original aunque se edite la sesión.
        existing = (
            db.query(Session)
            .join(SessionHistory, SessionHistory.session_id == Session.id)
            .filter(
                Session.creator_id == creator.id,
                SessionHistory.user_id == creator.id,
                SessionHistory.event_type == "creada",
                SessionHistory.session_name == template["name"],
            )
            .first()
        )
        if existing is None:
            existing = (
                db.query(Session)
                .filter(
                    Session.creator_id == creator.id,
                    Session.name == template["name"],
                )
                .first()
            )

        # Conservar fechas, participantes y decisiones de sesiones existentes.
        if existing is not None:
            continue

        subject = (
            db.query(Subject)
            .filter(Subject.code == template["subject"])
            .one()
        )
        accepted = [
            users[email]
            for email, state in template["requests"]
            if state == "aceptada"
        ]

        # Son datos de ejemplo: también representamos inscripciones
        # realizadas antes de que una sesión cerrara o su fecha pasara.
        session = Session(
            name=template["name"],
            subject=subject.name,
            date=today + timedelta(days=template["days"]),
            modality=template["modality"],
            spots=template["spots"],
            status=template["status"],
            creator_id=creator.id,
            creator_name=creator.full_name,
            creator_email=creator.email,
            participant_emails=json.dumps([user.email for user in accepted]),
            participants_count=len(accepted),
        )
        db.add(session)
        db.flush()
        result["sessions"] += 1
        subject.sessions_count = (subject.sessions_count or 0) + 1

        record_session_event(db, creator.id, "creada", session)
        result["history"] += 1

        for email, state in template["requests"]:
            user = users[email]
            db.add(
                SessionJoinRequest(
                    session_id=session.id,
                    user_id=user.id,
                    status=state,
                )
            )
            result["requests"] += 1

            if state == "aceptada":
                record_session_event(db, user.id, "unido", session)
                result["history"] += 1

        if session.status == "cerrada":
            record_session_event(db, creator.id, "cerrada", session)
            result["history"] += 1

    db.flush()
    return result


def main():
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        subjects = seed_subjects_in_db(db)
        demo = seed_demo_data(db)
        db.commit()

    print(f"Materias sincronizadas: {subjects['total']}")
    print(f"Usuarios demo creados: {demo['users']}")
    print(f"Sesiones demo creadas: {demo['sessions']}")
    print(f"Solicitudes demo creadas: {demo['requests']}")
    print(f"Eventos de historial creados: {demo['history']}")
    print("\nCuentas de demostracion:")
    for _, _, email in DEMO_USERS:
        print(f"  {email}")
    print(f"Contrasena de las cuentas nuevas: {DEMO_PASSWORD}")
    print("Las cuentas existentes conservan su contrasena.")
    print("Las sesiones existentes conservan sus fechas y sus cambios.")


if __name__ == "__main__":
    main()
