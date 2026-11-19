from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import AnalyticsEvent, Session, SessionJoinRequest
from tests.test_waitlist import api


def test_unknown_session_and_request_are_distinct(api):
    for endpoint in ('/requests', '/attendance', '/requests/1'):
        method = 'PATCH' if endpoint == '/requests/1' else 'GET'
        data = {'json': {'decision': 'aceptar'}} if method == 'PATCH' else {}
        response = api.call(method, '/99999' + endpoint, **data)
        assert response.status_code == 404
        assert response.json()['detail'] == 'Sesión no encontrada.'
    response = api.decide(99999)
    assert response.status_code == 404
    assert response.json()['detail'] == 'Solicitud no encontrada.'


def test_edit_can_remove_hour_and_pending_request_cannot_be_accepted_after_close(api):
    path = f'/{api.sid}'
    assert api.call('PUT', path, json={'time': '15:00:00'}).json()['time'] == '15:00:00'
    assert api.call('PUT', path, json={'time': None}).json()['time'] is None
    request = api.request(2)
    assert api.call('PATCH', path + '/status', json={'status': 'cerrada'}).status_code == 200
    response = api.decide(request)
    assert response.status_code == 400
    assert 'cerrada' in response.json()['detail']
    assert api.db.get(SessionJoinRequest, request).status == 'pendiente'


def test_approving_waiting_request_again_preserves_place(api):
    assert api.decide(api.request(2)).json()['status'] == 'aceptada'
    waiting = api.request(3)
    first = api.decide(waiting).json()
    assert first['status'] == 'en_espera'
    assert api.decide(waiting).status_code == 409
    assert api.call('GET', '/requests/me', 3).json()[0]['queue_position'] == first['queue_position']


def test_reprogramming_rejects_unidentified_legacy_participant(api):
    session = api.db.get(Session, api.sid)
    session.participant_emails = '["sin-cuenta@example.com"]'
    session.participants_count = 1
    api.db.commit()
    previous = session.date
    response = api.call('POST', f'/{api.sid}/reschedule', json={
        'date': str(date.today() + timedelta(days=12)), 'reason': 'Cambio de aula',
    })
    assert response.status_code == 409
    assert 'cuenta identificable' in response.json()['detail']
    assert api.db.get(Session, api.sid).date == previous


@pytest.mark.parametrize('constraint', ['uq_session_join_request_user', 'otra_restriccion'])
def test_request_rolls_back_and_distinguishes_database_conflicts(api, monkeypatch, constraint):
    def fail_commit():
        raise IntegrityError('INSERT', {}, SimpleNamespace(diag=SimpleNamespace(constraint_name=constraint)))

    with monkeypatch.context() as patch:
        patch.setattr(api.db, 'commit', fail_commit)
        if constraint == 'uq_session_join_request_user':
            response = api.call('POST', f'/{api.sid}/requests', 2)
            assert response.status_code == 409
            assert 'Ya tienes una solicitud' in response.json()['detail']
        else:
            with pytest.raises(IntegrityError):
                api.call('POST', f'/{api.sid}/requests', 2)
    assert api.db.query(SessionJoinRequest).count() == 0
    assert api.db.query(AnalyticsEvent).count() == 0


def test_cancelled_model_cannot_reopen_or_accept():
    session = Session(status='cancelada')
    with pytest.raises(ValueError, match='cancelada'):
        session.reopen_registration()
    assert session.can_join('demo@example.com') == (False, 'La sesión está cancelada.')
