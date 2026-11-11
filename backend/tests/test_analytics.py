from fastapi import FastAPI, Header
from fastapi.testclient import TestClient
import pytest
from sqlalchemy.exc import SQLAlchemyError
from app.database import get_db
from app.models import AnalyticsEvent, SessionJoinRequest, User
from app.routers import analytics, sessions
from app.routers.auth import get_current_user
from tests.test_waitlist import api


@pytest.fixture
def client(api):
    app = FastAPI()
    app.include_router(analytics.router)
    app.include_router(sessions.router)
    app.dependency_overrides[get_db] = lambda: api.db

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
        client.post(f'/sessions/{api.sid}/requests')
    api.db.rollback()
    assert api.db.query(SessionJoinRequest).count() == 0
    assert api.db.query(AnalyticsEvent).count() == 0
