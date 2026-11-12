from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app import waitlist
from app.history import current_session_status, get_user_history
from app.models import Session, SessionAttendance, SessionJoinRequest
from app.routers import sessions
from tests.test_waitlist import api


REASON = 'El aula estará cerrada por mantenimiento.'


def test_cancel_transitions_active_requests_and_limits_reason_to_affected_people(api):
    confirmed = api.request(2)
    waiting = api.request(3)
    pending = api.request(4)
    assert api.decide(confirmed).json()['status'] == 'aceptada'
    assert api.decide(waiting).json()['status'] == 'en_espera'

    response = api.call('POST', f'/{api.sid}/cancel', json={'reason': f'  {REASON}  '})
    assert response.status_code == 200
    cancelled = response.json()
    assert cancelled['status'] == 'cancelada'
    assert cancelled['cancelled_at'] is not None
    assert cancelled['participants_count'] == 0
    assert cancelled['participant_emails'] == []
    assert 'cancellation_reason' not in cancelled

    requests = api.call('GET', f'/{api.sid}/requests').json()
    assert {item['id']: item['status'] for item in requests} == dict.fromkeys(
        (confirmed, waiting, pending), 'cancelada',
    )
    assert all(item['queue_position'] is None for item in requests)
    for user_id in (1, 2, 3, 4):
        assert api.call('GET', '/cancellations/me', user_id).json() == {str(api.sid): REASON}
    assert api.call('GET', '/cancellations/me', 5).json() == {}
    assert 'cancellation_reason' not in api.call('GET', '/', 5).json()[0]
    assert api.call('GET', '/', params={'only_available': True}).json() == []

    history = get_user_history(api.db, 1, 'creada')
    assert history[0].event_type == 'cancelada'
    assert current_session_status(api.db.get(Session, api.sid)) == 'cancelada'


def test_cancel_checks_organizer_validates_reason_and_keeps_first_cancellation(api):
    path = f'/{api.sid}/cancel'
    assert api.call('POST', path, 2, json={'reason': REASON}).status_code == 403
    for invalid in ({}, {'reason': '   '}, {'reason': 'x' * 1001}):
        assert api.call('POST', path, json=invalid).status_code == 422
    assert api.db.get(Session, api.sid).status == 'abierta'

    assert api.call('PATCH', f'/{api.sid}/close').status_code == 200
    assert api.call('POST', path, json={'reason': REASON}).status_code == 200
    assert api.call('POST', path, json={'reason': 'Otro motivo'}).status_code == 409
    assert api.call('GET', '/cancellations/me').json() == {str(api.sid): REASON}
    assert [event.event_type for event in get_user_history(api.db, 1)].count('cancelada') == 1


@pytest.mark.parametrize('day,expected', [(10, 409), (11, 409), (12, 200)])
def test_cancellation_deadline_uses_calendar_day_in_bolivia(api, monkeypatch, day, expected):
    class EarlyUtcMorning(datetime):
        @classmethod
        def now(cls, tz):
            return datetime(2026, 11, 12, 2, tzinfo=timezone.utc).astimezone(tz)

    monkeypatch.setattr(sessions, 'datetime', EarlyUtcMorning)
    session = api.db.get(Session, api.sid)
    session.date = date(2026, 11, day)
    api.db.commit()
    response = api.call('POST', f'/{api.sid}/cancel', json={'reason': REASON})
    assert response.status_code == expected


def test_cancelled_session_blocks_participation_attendance_and_state_changes(api):
    pending = api.request(2)
    path = f'/{api.sid}'
    assert api.call('POST', path + '/cancel', json={'reason': REASON}).status_code == 200
    actions = [
        ('POST', '/requests', 2, None),
        ('POST', '/requests', 5, None),
        ('POST', '/join', 5, None),
        ('POST', '/leave', 2, None),
        ('PATCH', f'/requests/{pending}', 1, {'decision': 'aceptar'}),
        ('PATCH', '/close', 1, None),
        ('PATCH', '/status', 1, {'status': 'abierta'}),
        ('PUT', '', 1, {'name': 'Otro nombre'}),
        ('DELETE', '', 1, None),
        ('POST', '/reschedule', 1, {'date': str(date.today() + timedelta(days=8)), 'reason': REASON}),
        ('POST', '/finish', 1, None),
        ('GET', '/attendance', 1, None),
        ('PATCH', '/attendance/2', 1, {'status': 'presente'}),
        ('POST', '/attendance/justification', 2, {'text': REASON}),
        ('PATCH', '/attendance/2/justification', 1, {'decision': 'aceptar', 'reason': REASON}),
    ]
    for method, suffix, actor, body in actions:
        response = api.call(method, path + suffix, actor, json=body)
        assert response.status_code == 409, (method, suffix, response.text)
        assert response.json()['detail'] == 'La sesión está cancelada.'
    assert api.db.query(SessionAttendance).count() == 0


def test_cancellation_preserves_past_decisions_and_handles_legacy_reconfirmation(api):
    session = api.db.get(Session, api.sid)
    session.register_participant('u2@example.com')
    rejected = api.request(3)
    assert api.decide(rejected, 'rechazar').status_code == 200
    withdrawn = api.request(4)
    session.spots = 2
    api.db.commit()
    assert api.decide(withdrawn).json()['status'] == 'aceptada'
    assert api.call('POST', f'/{api.sid}/leave', 4).status_code == 200

    change = api.call('POST', f'/{api.sid}/reschedule', json={
        'date': str(date.today() + timedelta(days=10)), 'reason': 'Cambio de aula.',
    }).json()
    assert change['pending_count'] == 1
    assert api.call('POST', f'/{api.sid}/cancel', json={'reason': REASON}).status_code == 200
    assert api.call('GET', '/requests/me', 2).json()[0]['status'] == 'cancelada'
    assert api.call('GET', '/cancellations/me', 2).json() == {str(api.sid): REASON}
    assert api.call('GET', '/requests/me', 3).json()[0]['status'] == 'rechazada'
    assert api.call('GET', '/requests/me', 4).json()[0]['status'] == 'retirada'
    assert api.call('GET', '/cancellations/me', 3).json() == {}
    assert api.call('GET', '/cancellations/me', 4).json() == {}
    notice = api.call('GET', '/reschedules/me', 2).json()[0]
    assert notice['own_status'] == 'cancelada'
    assert notice['pending_count'] == 0
    assert api.call('POST', f'/{api.sid}/reschedules/{change["id"]}/confirm', 2).status_code == 409


def test_cancel_rejects_finished_session(api):
    session = api.db.get(Session, api.sid)
    session.finished_at = datetime.now(timezone.utc)
    api.db.commit()
    assert api.call('POST', f'/{api.sid}/cancel', json={'reason': REASON}).status_code == 409
    assert session.cancelled_at is None


def test_reading_waitlist_tolerates_cancellation_between_queries(api, monkeypatch):
    assert api.decide(api.request(2)).json()['status'] == 'aceptada'
    assert api.decide(api.request(3)).json()['status'] == 'en_espera'
    monkeypatch.setattr(waitlist, 'waiting_requests', lambda db, session_id: [])

    response = api.call('GET', '/requests/me', 3)
    assert response.status_code == 200
    assert response.json()[0]['queue_position'] is None


def test_cancellation_rolls_back_all_changes_if_commit_fails(api, monkeypatch):
    pending = api.request(2)

    def fail_commit():
        api.db.flush()
        raise SQLAlchemyError('Fallo simulado después de las escrituras')

    with monkeypatch.context() as patch:
        patch.setattr(api.db, 'commit', fail_commit)
        with pytest.raises(SQLAlchemyError):
            api.call('POST', f'/{api.sid}/cancel', json={'reason': REASON})

    api.db.rollback()
    session = api.db.get(Session, api.sid)
    assert session.status == 'abierta'
    assert session.cancellation_reason is None
    assert api.db.get(SessionJoinRequest, pending).status == 'pendiente'
    assert not any(event.event_type == 'cancelada' for event in get_user_history(api.db, 1))
