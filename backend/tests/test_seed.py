"""Pruebas del seeder en una base SQLite temporal, sin usar PostgreSQL."""
import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

import seed
from app.database import Base
from app.models import Session, SessionHistory, SessionJoinRequest, Subject, User
from app.security import hash_password, verify_password


class TestDemoSeed(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")

        @event.listens_for(self.engine, "connect")
        def enable_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, autoflush=False)()
        seed.seed_subjects_in_db(self.db)
        self.password_patch = patch(
            "seed.hash_password", return_value="demo-password-hash"
        )
        self.hash_mock = self.password_patch.start()
        self.addCleanup(self.password_patch.stop)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def run_seed(self, reference_date=date(2026, 10, 29)):
        result = seed.seed_demo_data(self.db, reference_date)
        self.db.commit()
        return result

    def counts(self):
        return tuple(
            self.db.query(model).count()
            for model in (User, Session, SessionJoinRequest, SessionHistory)
        )

    def test_creates_demo_scenarios(self):
        self.assertEqual(
            self.run_seed(),
            {"users": 5, "sessions": 6, "requests": 7, "history": 11},
        )
        self.assertEqual(self.counts(), (5, 6, 7, 11))

    def test_demo_password_authenticates_all_new_accounts(self):
        with patch("seed.hash_password", wraps=hash_password):
            self.run_seed()
        for user in self.db.query(User).all():
            self.assertTrue(verify_password(seed.DEMO_PASSWORD, user.hashed_password))

    def test_repeated_run_preserves_rows_dates_passwords_and_subject_counts(self):
        self.run_seed()
        passwords = {u.id: u.hashed_password for u in self.db.query(User).all()}
        dates = {s.id: s.date for s in self.db.query(Session).all()}
        counters = {s.id: s.sessions_count for s in self.db.query(Subject).all()}

        self.assertEqual(
            self.run_seed(date(2026, 12, 1)),
            {"users": 0, "sessions": 0, "requests": 0, "history": 0},
        )
        self.assertEqual(self.counts(), (5, 6, 7, 11))
        self.assertEqual(self.hash_mock.call_count, 5)
        self.assertEqual(passwords, {u.id: u.hashed_password for u in self.db.query(User).all()})
        self.assertEqual(dates, {s.id: s.date for s in self.db.query(Session).all()})
        self.assertEqual(counters, {s.id: s.sessions_count for s in self.db.query(Subject).all()})

    def test_participants_and_history_match_accepted_requests(self):
        self.run_seed()
        for request in self.db.query(SessionJoinRequest).all():
            session = self.db.get(Session, request.session_id)
            user = self.db.get(User, request.user_id)
            accepted = request.status == "aceptada"
            self.assertNotEqual(user.id, session.creator_id)
            self.assertEqual(session.is_user_registered(user.email), accepted)
            history_count = self.db.query(SessionHistory).filter_by(
                user_id=user.id, session_id=session.id, event_type="unido"
            ).count()
            self.assertEqual(history_count, 1 if accepted else 0)

        for session in self.db.query(Session).all():
            self.assertEqual(
                session.participants_count, len(session.get_participant_emails_list())
            )
            self.assertLessEqual(session.participants_count, session.spots)

    def test_contains_past_closed_full_and_empty_sessions(self):
        self.run_seed()
        sessions = self.db.query(Session).all()
        self.assertEqual(sum(s.date < date(2026, 10, 29) for s in sessions), 1)
        self.assertEqual(sum(s.status == "cerrada" for s in sessions), 1)
        self.assertEqual(sum(s.participants_count == s.spots for s in sessions), 1)
        self.assertEqual(
            sum(
                self.db.query(SessionJoinRequest).filter_by(session_id=s.id).count() == 0
                for s in sessions
            ),
            1,
        )

    def test_preserves_existing_accounts(self):
        existing = User(
            email="ana.demo@example.com",
            full_name="Persona Existente",
            hashed_password="existing-password-hash",
        )
        unrelated = User(
            email="otra@example.com", full_name="Otra Persona", hashed_password="original"
        )
        self.db.add_all([existing, unrelated])
        self.db.commit()

        self.assertEqual(self.run_seed()["users"], 4)
        self.assertEqual(existing.full_name, "Persona Existente")
        self.assertEqual(existing.hashed_password, "existing-password-hash")
        self.assertEqual(unrelated.hashed_password, "original")

    def test_preserves_decisions_and_renamed_or_edited_sessions(self):
        self.run_seed()
        request = self.db.query(SessionJoinRequest).filter_by(status="pendiente").first()
        session = self.db.get(Session, request.session_id)
        request.status = "rechazada"
        session.name = "Nombre cambiado desde la aplicación"
        session.date = date(2027, 2, 1)
        session.spots = 9
        session.status = "cerrada"
        self.db.commit()

        self.assertEqual(self.run_seed()["sessions"], 0)
        self.assertEqual(self.counts(), (5, 6, 7, 11))
        self.assertEqual(request.status, "rechazada")
        self.assertEqual(session.name, "Nombre cambiado desde la aplicación")
        self.assertEqual(session.date, date(2027, 2, 1))
        self.assertEqual(session.spots, 9)
        self.assertEqual(session.status, "cerrada")

    def test_demo_transaction_can_roll_back_on_failure(self):
        self.db.query(Subject).filter_by(code="ELC106").delete()
        self.db.commit()

        from sqlalchemy.orm.exc import NoResultFound

        with self.assertRaises(NoResultFound):
            seed.seed_demo_data(self.db)
        self.db.rollback()
        self.assertEqual(self.counts(), (0, 0, 0, 0))


if __name__ == "__main__":
    unittest.main()
