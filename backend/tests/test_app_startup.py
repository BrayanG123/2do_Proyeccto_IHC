import importlib
import runpy
import sys
from unittest.mock import Mock

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import database, triggers
from app.models import Session, Subject
from tests.test_waitlist import api
import seed


def use_isolated_database(monkeypatch, api):
    monkeypatch.setattr(database, 'engine', api.db.bind)
    monkeypatch.setattr(database, 'SessionLocal', sessionmaker(bind=api.db.bind))


def test_startup_loads_catalog_and_keeps_analytics_private(api, monkeypatch):
    use_isolated_database(monkeypatch, api)
    configure_triggers = Mock()
    monkeypatch.setattr(triggers, 'setup_triggers', configure_triggers)
    module = importlib.import_module('app.main')
    try:
        with TestClient(module.app) as client:
            assert client.get('/').status_code == 200
            response = client.get('/subjects/')
            assert response.status_code == 200
            assert any(item['name'] == 'Programación II' for item in response.json())
            assert client.get('/analytics/funnels').status_code in {401, 403}
        configure_triggers.assert_called_once_with()
    finally:
        sys.modules.pop('app.main', None)


def test_demo_cli_loads_subjects_and_preserves_existing_sessions(api, monkeypatch, capsys):
    use_isolated_database(monkeypatch, api)
    previous = api.db.get(Session, api.sid).name

    runpy.run_path(seed.__file__, run_name='__main__')
    first = capsys.readouterr().out
    assert 'Materias sincronizadas:' in first
    assert 'Sesiones demo creadas:' in first
    assert api.db.query(Subject).count() > 0
    count = api.db.query(Session).count()
    assert count > 1
    assert api.db.get(Session, api.sid).name == previous

    runpy.run_path(seed.__file__, run_name='__main__')
    second = capsys.readouterr().out
    assert 'Sesiones demo creadas: 0' in second
    assert api.db.query(Session).count() == count
