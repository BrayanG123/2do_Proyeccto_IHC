from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app import analytics_tracking
from app.models import AnalyticsEvent, Session
from tests.test_analytics import client
from tests.test_waitlist import api


def test_unparseable_attempt_id_is_not_used_for_correlation():
    request = SimpleNamespace(headers={analytics_tracking.ATTEMPT_HEADER: '?' * 36})
    assert analytics_tracking.get_attempt_id(request) is None


@pytest.mark.parametrize('result, event', [
    ('con_resultados', 'busqueda_con_resultados'),
    ('sin_resultados', 'busqueda_sin_resultados'),
])
def test_search_observation_distinguishes_empty_results(client, api, result, event):
    attempt = str(uuid4())
    response = client.post('/analytics/observations', json={
        'flow': 'buscar_sesiones', 'attempt_id': attempt, 'result': result,
    })
    assert response.status_code == 204
    recorded = api.db.query(AnalyticsEvent).filter_by(attempt_id=attempt).one()
    assert recorded.event == event


def test_public_flow_rejects_an_observation_that_does_not_belong_to_it(client, api):
    attempt = str(uuid4())
    response = client.post('/analytics/public-observations', json={
        'flow': 'registro', 'attempt_id': attempt, 'result': 'sin_resultados',
    })
    assert response.status_code == 422
    assert api.db.query(AnalyticsEvent).filter_by(attempt_id=attempt).count() == 0


def test_private_observation_records_a_validation_block_with_attempt_id(client, api):
    attempt = str(uuid4())
    response = client.post('/analytics/observations', json={
        'flow': 'crear_sesion', 'attempt_id': attempt, 'result': 'validacion_fallida',
    })
    assert response.status_code == 204
    stored = api.db.query(AnalyticsEvent).filter_by(attempt_id=attempt).one()
    assert stored.event == 'crear_sesion_bloqueo'
    assert stored.reason == 'validacion_fallida'


def test_reused_attempt_still_counts_each_successful_join(client, api):
    headers = {analytics_tracking.ATTEMPT_HEADER: str(uuid4())}
    path = f'/sessions/{api.sid}/requests'
    assert client.post(path, headers={**headers, 'x-user': '2'}).status_code == 201
    assert client.post(path, headers={**headers, 'x-user': '3'}).status_code == 201
    successes = api.db.query(AnalyticsEvent).filter_by(event='solicitud_enviada').all()
    assert len(successes) == 2
    assert {item.attempt_id for item in successes} == {headers[analytics_tracking.ATTEMPT_HEADER], None}


def test_duplicate_observation_returns_same_event_and_constraint_failure_propagates(api, monkeypatch):
    attempt = str(uuid4())
    original = analytics_tracking.save_event(api.db, 'registro_iniciado', attempt_id=attempt)
    duplicate = analytics_tracking.save_event(api.db, 'registro_iniciado', attempt_id=attempt)
    assert original.id == duplicate.id

    def fail_commit():
        raise IntegrityError('INSERT', {}, Exception('restricción diferente'))

    monkeypatch.setattr(api.db, 'commit', fail_commit)
    with pytest.raises(IntegrityError):
        analytics_tracking.save_event(api.db, 'registro_iniciado', attempt_id=str(uuid4()))


def test_route_telemetry_failure_is_logged_without_exposing_attempt(monkeypatch, caplog):
    def fail():
        raise SQLAlchemyError('detalle interno')

    monkeypatch.setattr(analytics_tracking, 'SessionLocal', fail)
    analytics_tracking.record_route_event('registro_iniciado', attempt_id='identificador-privado')
    assert 'No se pudo guardar el evento de analítica registro_iniciado' in caplog.text
    assert 'identificador-privado' not in caplog.text


def test_join_does_not_hide_an_integrity_error_without_an_existing_attempt(api, monkeypatch):
    def failed_savepoint():
        raise IntegrityError('INSERT', {}, Exception('restricción diferente'))

    monkeypatch.setattr(api.db, 'begin_nested', failed_savepoint)
    with pytest.raises(IntegrityError):
        analytics_tracking.add_join_success(api.db, api.db.get(Session, api.sid), str(uuid4()))
