from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import FastAPI, Header
from fastapi.testclient import TestClient
import pytest
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker
from app import analytics_tracking
from app.database import get_db
from app.models import AnalyticsEvent, SessionJoinRequest, User
from app.routers import analytics, auth, sessions
from app.routers.auth import get_current_user
from tests.test_waitlist import api


@pytest.fixture
def client(api, monkeypatch):
    app = FastAPI()
    app.include_router(analytics.router)
    app.include_router(auth.router)
    app.include_router(sessions.router)
    app.dependency_overrides[get_db] = lambda: api.db
    monkeypatch.setattr(analytics_tracking, 'SessionLocal', sessionmaker(bind=api.db.bind))

    def actor(x_user: int = Header(default=2)):
        return api.db.get(User, x_user)

    app.dependency_overrides[get_current_user] = actor
    with TestClient(app) as client:
        yield client


def test_start_once_with_only_expected_properties(client, api):
    response = client.post('/analytics/start', json={'session_id': api.sid})
    assert response.status_code == 201
    assert response.json()['event'] == 'solicitud_iniciada'
    assert response.json()['modality'] == 'Virtual'
    assert set(response.json()) == {'id', 'event', 'modality', 'created_at'}
    assert api.db.query(AnalyticsEvent).count() == 1
    assert client.post('/analytics/start', json={'session_id': api.sid, 'email': 'privado@example.com'}).status_code == 422
    assert client.post('/analytics/start', json={'session_id': 999999}).status_code == 404
    assert api.db.query(AnalyticsEvent).count() == 1


def test_success_only_when_request_is_saved(client, api):
    assert client.post(f'/sessions/{api.sid}/requests').status_code == 201
    assert client.post(f'/sessions/{api.sid}/requests').status_code == 409
    assert client.post(f'/sessions/{api.sid}/requests', headers={'x-user': '1'}).status_code == 400
    events = api.db.query(AnalyticsEvent).all()
    assert len(events) == 1
    assert events[0].event == 'solicitud_enviada'
    assert events[0].modality == 'Virtual'


def test_summary_empty_and_percentage(client, api):
    summary = client.get('/analytics/summary').json()
    assert summary == {'iniciadas': 0, 'enviadas': 0, 'porcentaje_finalizacion': 0.0, 'ultimos_eventos': []}
    for _ in range(2):
        assert client.post('/analytics/start', json={'session_id': api.sid}).status_code == 201
    assert client.post(f'/sessions/{api.sid}/requests').status_code == 201
    summary = client.get('/analytics/summary').json()
    assert summary['iniciadas'] == 2
    assert summary['enviadas'] == 1
    assert summary['porcentaje_finalizacion'] == 50
    assert len(summary['ultimos_eventos']) == 3


def test_failed_commit_keeps_request_and_event_consistent(client, api, monkeypatch):
    def fail_commit():
        api.db.flush()
        raise SQLAlchemyError('Fallo simulado de la transacción')

    monkeypatch.setattr(api.db, 'commit', fail_commit)
    with pytest.raises(SQLAlchemyError):
        client.post(f'/sessions/{api.sid}/requests', headers={'X-Analytics-Attempt': str(uuid4())})
    api.db.rollback()
    assert api.db.query(SessionJoinRequest).count() == 0
    assert api.db.query(AnalyticsEvent).count() == 0


def read_funnel(client, flow):
    response = client.get('/analytics/funnels')
    assert response.status_code == 200
    return next(item for item in response.json()['funnels'] if item['id'] == flow)


def test_reset_code_expiration_respects_database_timezone():
    local_now = datetime.now(timezone(timedelta(hours=-4)))
    assert not auth.reset_code_expired(local_now + timedelta(minutes=5))
    assert auth.reset_code_expired(local_now - timedelta(minutes=5))


def test_funnel_correlates_attempts_and_preserves_legacy_counts(client, api):
    finished = {'X-Analytics-Attempt': str(uuid4())}
    abandoned = {'X-Analytics-Attempt': str(uuid4())}
    data = {'session_id': api.sid}
    assert client.post('/analytics/start', json=data).status_code == 201
    for headers in [finished, finished, abandoned]:
        assert client.post('/analytics/start', json=data, headers=headers).status_code == 201
    assert client.post(f'/sessions/{api.sid}/requests', headers=finished).status_code == 201
    assert client.post(f'/sessions/{api.sid}/requests', headers=abandoned).status_code == 409
    funnel = read_funnel(client, 'solicitar_unirse')
    assert [step['count'] for step in funnel['steps']] == [2, 1]
    assert funnel['steps'][1]['drop_rate'] == 50
    assert funnel['blockers'] == [{'reason': 'estado_incompatible', 'count': 1}]
    assert client.get('/analytics/summary').json()['iniciadas'] == 3
    assert api.db.query(AnalyticsEvent).filter_by(event='solicitud_enviada').count() == 1


def test_observations_only_accept_known_events_and_no_user_fields(client, api):
    data = {'flow': 'buscar_sesiones', 'attempt_id': str(uuid4()), 'result': 'inicio'}
    assert client.post('/analytics/public-observations', json=data).status_code == 422
    assert client.post('/analytics/observations', json={**data, 'search': 'texto privado'}).status_code == 422
    assert client.post('/analytics/observations', json={**data, 'flow': 'evento_inventado'}).status_code == 422
    assert client.post('/analytics/observations', json={**data, 'result': 'sesion_creada'}).status_code == 422
    assert client.post('/analytics/observations', json={**data, 'result': 'sin_resultados'}).status_code == 204
    assert client.post('/analytics/observations', json=data).status_code == 204
    assert client.post('/analytics/observations', json=data).status_code == 204
    funnel = read_funnel(client, 'buscar_sesiones')
    assert [step['count'] for step in funnel['steps']] == [1, 0]
    assert funnel['empty_results'] == 1
    assert api.db.query(AnalyticsEvent).count() == 2
    assert set(client.get('/analytics/funnels').json()['recent_events'][0]) == {
        'id', 'event', 'modality', 'reason', 'created_at',
    }


@pytest.mark.parametrize('complete_path', ['login-with-code', 'reset-password-with-code'])
def test_recovery_funnel_measures_intermediate_steps(client, monkeypatch, complete_path):
    sent_codes = []
    monkeypatch.setattr(auth, 'send_reset_code_email', lambda email, code, name: sent_codes.append(code))
    attempt_id = str(uuid4())
    headers = {'X-Analytics-Attempt': attempt_id}
    start = {'flow': 'recuperar_acceso', 'attempt_id': attempt_id, 'result': 'inicio'}
    email = {'email': 'u1@example.com'}

    assert client.post('/analytics/public-observations', json=start).status_code == 204
    assert client.post('/auth/send-reset-code', json=email, headers=headers).status_code == 200
    assert [step['count'] for step in read_funnel(client, 'recuperar_acceso')['steps']] == [1, 1, 0, 0]
    code = {**email, 'code': sent_codes[0]}
    # La verificación de otro intento no completa el recorrido.
    orphan = {'X-Analytics-Attempt': str(uuid4())}
    assert client.post('/auth/verify-reset-code', json=code, headers=orphan).status_code == 200
    assert [step['count'] for step in read_funnel(client, 'recuperar_acceso')['steps']] == [1, 1, 0, 0]

    assert client.post('/auth/verify-reset-code', json=code, headers=headers).status_code == 200
    if complete_path == 'reset-password-with-code':
        code['new_password'] = 'PruebaSegura123!'
    assert client.post(f'/auth/{complete_path}', json=code, headers=headers).status_code == 200
    assert [step['count'] for step in read_funnel(client, 'recuperar_acceso')['steps']] == [1, 1, 1, 1]
