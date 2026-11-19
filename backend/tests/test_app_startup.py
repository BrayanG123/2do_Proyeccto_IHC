import importlib
import runpy
import sys
from unittest.mock import Mock

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from starlette.staticfiles import StaticFiles

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


def test_production_serves_react_routes_and_preserves_api_errors(api, monkeypatch, tmp_path):
    use_isolated_database(monkeypatch, api)
    monkeypatch.setattr(triggers, 'setup_triggers', Mock())

    index = '<main>StudyMatch</main>'
    (tmp_path / 'index.html').write_text(index, encoding='utf-8')
    (tmp_path / 'app.js').write_text('console.log("StudyMatch")', encoding='utf-8')
    static_init = StaticFiles.__init__

    def use_build_fixture(self, *, directory, html):
        assert directory.name == 'static'
        static_init(self, directory=tmp_path, html=html)

    monkeypatch.setattr(StaticFiles, '__init__', use_build_fixture)
    module = importlib.import_module('app.web')
    try:
        with TestClient(module.app) as client:
            home = client.get('/')
            assert home.status_code == 200
            assert home.text == index
            route = client.get('/mis-solicitudes')
            assert route.status_code == 200
            assert route.text == index

            asset = client.get('/app.js')
            assert asset.status_code == 200
            assert asset.text == 'console.log("StudyMatch")'
            assert client.get('/missing.js').status_code == 404
            assert client.post('/mis-solicitudes').status_code == 405

            health = client.get('/api/')
            assert health.status_code == 200
            assert health.json()['message'] == 'StudyMatch API funcionando'
            missing_api = client.get('/api/desconocida')
            assert missing_api.status_code == 404
            assert missing_api.json()['detail'] == 'Not Found'
    finally:
        sys.modules.pop('app.web', None)
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
