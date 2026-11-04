"""
Pruebas Unitarias - Historial de participación (Issue #12 / #16)
Proyecto: StudyMatch
Pregunta que responde el historial: ¿En qué sesiones participó la persona?

Criterios evaluados:
1. Una acción genera el evento (unirse -> 'unido', crear -> 'creada').
2. La consulta solo devuelve eventos del usuario correcto.
3. Orden comprensible: el más reciente primero.
4. Un usuario sin eventos obtiene una lista vacía (estado vacío).
5. El evento se conserva después de eliminar la sesión.
6. El filtro por tipo devuelve solo los eventos de ese tipo.
7. El estado actual de la sesión se calcula correctamente.
8. La migración de datos existentes no duplica eventos.

Ejecución:
    docker exec studymatch_backend python -m unittest tests.test_session_history -v
"""

import unittest
from datetime import date, datetime, timedelta
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import Session, SessionHistory, User, record_session_event, backfill_session_history
from app.history import get_user_history, current_session_status
from app.schemas import SessionCreate, RequestDecision
from app.routers import sessions as sessions_router


class TestSessionHistory(unittest.TestCase):
    """
    Suite de pruebas del historial sobre una base SQLite en memoria (aislada y determinista).
    """

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", echo=False)

        # SQLite necesita activar las llaves foráneas para respetar ON DELETE SET NULL
        @event.listens_for(self.engine, "connect")
        def _enable_fk(dbapi_connection, _):
            dbapi_connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(bind=self.engine)
        self.db = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)()

        self.creator = User(id=1, full_name="Ana Creadora", email="ana@test.com", hashed_password="x")
        self.student = User(id=2, full_name="Beto Estudiante", email="beto@test.com", hashed_password="x")
        self.newcomer = User(id=3, full_name="Caro Nueva", email="caro@test.com", hashed_password="x")
        self.db.add_all([self.creator, self.student, self.newcomer])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def _create_session(self, name="Repaso de Cálculo", days_ahead=3):
        data = SessionCreate(
            name=name,
            subject="Cálculo I",
            date=date.today() + timedelta(days=days_ahead),
            modality="Virtual",
            spots=5,
        )
        return sessions_router.create_session(data, self.db, self.creator)

    # ── 1. Una acción genera el evento ───────────────────────
    def _confirm_student(self, session):
        request = sessions_router.join_session(session.id, self.db, self.student)
        # Una solicitud pendiente todavía no es una participación.
        self.assertEqual(get_user_history(self.db, self.student.id), [])
        sessions_router.decide_request(session.id, request.id, RequestDecision(decision='aceptar'), self.db, self.creator)

    def test_01_unirse_genera_evento_unido(self):
        session = self._create_session()
        self._confirm_student(session)

        history = get_user_history(self.db, self.student.id)
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0].event_type, "unido")
        self.assertEqual(history[0].session_id, session.id)
        self.assertEqual(history[0].session_name, "Repaso de Cálculo")
        self.assertIsNotNone(history[0].created_at)

    def test_02_crear_genera_evento_creada(self):
        session = self._create_session()

        history = get_user_history(self.db, self.creator.id)
        self.assertEqual([e.event_type for e in history], ["creada"])
        self.assertEqual(history[0].session_id, session.id)

    def test_03_unirse_rechazado_no_genera_evento(self):
        session = self._create_session(days_ahead=-1)  # fecha pasada: la regla rechaza unirse
        with self.assertRaises(Exception):
            sessions_router.join_session(session.id, self.db, self.student)
        self.db.rollback()

        self.assertEqual(get_user_history(self.db, self.student.id), [])

    # ── 2. Usuario correcto ──────────────────────────────────
    def test_04_consulta_solo_devuelve_eventos_del_usuario(self):
        session = self._create_session()
        self._confirm_student(session)

        student_history = get_user_history(self.db, self.student.id)
        creator_history = get_user_history(self.db, self.creator.id)

        self.assertTrue(all(e.user_id == self.student.id for e in student_history))
        self.assertTrue(all(e.user_id == self.creator.id for e in creator_history))
        self.assertNotIn("unido", [e.event_type for e in creator_history])

    # ── 3. Orden ─────────────────────────────────────────────
    def test_05_orden_mas_reciente_primero(self):
        s1 = self._create_session("Sesión antigua")
        s2 = self._create_session("Sesión reciente")
        old = record_session_event(self.db, self.student.id, "unido", s1)
        new = record_session_event(self.db, self.student.id, "unido", s2)
        old.created_at = datetime(2026, 10, 1, 9, 0)
        new.created_at = datetime(2026, 10, 18, 9, 0)
        self.db.commit()

        names = [e.session_name for e in get_user_history(self.db, self.student.id)]
        self.assertEqual(names, ["Sesión reciente", "Sesión antigua"])

    # ── 4. Estado vacío ──────────────────────────────────────
    def test_06_usuario_sin_eventos_obtiene_lista_vacia(self):
        self._create_session()
        self.assertEqual(get_user_history(self.db, self.newcomer.id), [])

    # ── 5. Conservación ──────────────────────────────────────
    def test_07_evento_se_conserva_al_eliminar_la_sesion(self):
        session = self._create_session("Sesión que será eliminada")
        self._confirm_student(session)
        sessions_router.delete_session(session.id, self.db, self.creator)
        self.db.expire_all()

        self.assertIsNone(self.db.get(Session, session.id))

        student_history = get_user_history(self.db, self.student.id)
        self.assertEqual(len(student_history), 1)
        self.assertEqual(student_history[0].session_name, "Sesión que será eliminada")
        self.assertIsNone(student_history[0].session_id)

        creator_types = [e.event_type for e in get_user_history(self.db, self.creator.id)]
        self.assertEqual(sorted(creator_types), ["creada", "eliminada"])

    # ── 6. Filtro por tipo ───────────────────────────────────
    def test_08_filtro_por_tipo(self):
        session = self._create_session()
        sessions_router.close_session_registration(session.id, self.db, self.creator)
        other = self._create_session("Otra sesión")
        record_session_event(self.db, self.creator.id, "unido", other)
        self.db.commit()

        organized = [e.event_type for e in get_user_history(self.db, self.creator.id, "creada")]
        joined = [e.event_type for e in get_user_history(self.db, self.creator.id, "unido")]

        self.assertEqual(sorted(organized), ["cerrada", "creada", "creada"])
        self.assertEqual(joined, ["unido"])
        self.assertEqual(len(get_user_history(self.db, self.creator.id, "todos")), 4)

        with self.assertRaises(ValueError):
            get_user_history(self.db, self.creator.id, "inexistente")

    # ── 7. Estado actual ─────────────────────────────────────
    def test_09_estado_actual_de_la_sesion(self):
        ref = date(2026, 10, 15)
        open_session = Session(name="A", date=ref + timedelta(days=2), modality="Virtual", spots=3, status="abierta")
        past_session = Session(name="B", date=ref - timedelta(days=2), modality="Virtual", spots=3, status="abierta")
        closed_session = Session(name="C", date=ref + timedelta(days=2), modality="Virtual", spots=3, status="cerrada")

        self.assertEqual(current_session_status(open_session, ref), "abierta")
        self.assertEqual(current_session_status(past_session, ref), "finalizada")
        self.assertEqual(current_session_status(closed_session, ref), "cerrada")
        self.assertEqual(current_session_status(None, ref), "eliminada")

    # ── 8. Migración ─────────────────────────────────────────
    def test_10_migracion_no_duplica_eventos(self):
        legacy = Session(
            name="Sesión previa al historial",
            date=date(2026, 10, 10),
            modality="Presencial",
            spots=10,
            creator_id=self.creator.id,
            creator_email="ana@test.com",
            participant_emails='["beto@test.com"]',
            participants_count=1,
        )
        self.db.add(legacy)
        self.db.commit()

        self.assertEqual(backfill_session_history(self.db), 2)
        self.assertEqual(backfill_session_history(self.db), 0)

        self.assertEqual([e.event_type for e in get_user_history(self.db, self.student.id)], ["unido"])
        self.assertEqual(self.db.query(SessionHistory).count(), 2)


if __name__ == "__main__":
    unittest.main()
