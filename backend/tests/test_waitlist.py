"""Reglas de aprobación y cola mediante la API real con una base SQLite aislada."""
from datetime import date, timedelta
import pytest
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db
from app.models import User, SessionHistory
from app.routers.auth import get_current_user
from app.routers.sessions import router


@pytest.fixture
def api():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    for i in range(1, 6):
        db.add(User(id=i, full_name=f'Estudiante {i}', email=f'u{i}@example.com', hashed_password='no-se-usa'))
    db.commit()
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    def actor(x_user: int = Header()):
        return db.get(User, x_user)
    app.dependency_overrides[get_current_user] = actor
    with TestClient(app) as client:
        class API:
            def call(self, method, path, user=1, **kwargs):
                return client.request(method, '/sessions' + path, headers={'x-user': str(user)}, **kwargs)
            def request(self, user):
                result = self.call('POST', f'/{self.sid}/requests', user)
                assert result.status_code == 201, result.text
                return result.json()['id']
            def decide(self, request_id, decision='aceptar', user=1):
                return self.call('PATCH', f'/{self.sid}/requests/{request_id}', user, json={'decision': decision})
        api = API()
        result = api.call('POST', '/', json={'name': 'Prueba lista de espera', 'date': str(date.today() + timedelta(days=7)), 'modality': 'Virtual', 'spots': 1})
        assert result.status_code == 201
        api.sid = result.json()['id']
        api.db = db
        yield api
    db.close()
    engine.dispose()


def test_fifo_segun_entrada_a_espera_y_sin_sobrepasar_cupo(api):
    bruno = api.request(2)
    assert api.decide(bruno).json()['status'] == 'aceptada'
    diego = api.request(4)
    carla = api.request(3)
    assert api.decide(carla).json()['queue_position'] == 1
    assert api.decide(diego).json()['queue_position'] == 2
    assert api.call('POST', f'/{api.sid}/leave', 2).status_code == 200
    own = api.call('GET', '/requests/me', 3).json()
    assert own[0]['status'] == 'aceptada'
    assert api.call('GET', '/requests/me', 4).json()[0]['queue_position'] == 1
    sessions = api.call('GET', '/').json()
    assert sessions[0]['participants_count'] == 1
    assert sessions[0]['participant_emails'] == ['u3@example.com']
    assert api.db.query(SessionHistory).filter_by(user_id=3, event_type='unido').count() == 1
    assert api.call('POST', f'/{api.sid}/leave', 2).status_code == 409


def test_cerrada_no_promueve_ni_recibe_solicitudes(api):
    assert api.decide(api.request(2)).json()['status'] == 'aceptada'
    assert api.decide(api.request(3)).json()['status'] == 'en_espera'
    assert api.call('PATCH', f'/{api.sid}/close').status_code == 200
    assert api.call('POST', f'/{api.sid}/requests', 4).status_code == 400
    result = api.call('POST', f'/{api.sid}/leave', 2)
    assert result.json()['participants_count'] == 0
    assert api.call('GET', '/requests/me', 3).json()[0]['status'] == 'en_espera'


def test_solo_organizador_puede_ver_y_decidir(api):
    request_id = api.request(2)
    assert api.call('GET', f'/{api.sid}/requests', 3).status_code == 403
    assert api.decide(request_id, user=2).status_code == 403
    assert api.decide(request_id).json()['status'] == 'aceptada'
    assert api.decide(request_id).status_code == 409


def test_rechazar_y_no_promover_solicitudes_pendientes(api):
    assert api.decide(api.request(2)).json()['status'] == 'aceptada'
    espera = api.request(3)
    assert api.decide(espera).json()['status'] == 'en_espera'
    assert api.decide(espera, 'rechazar').json()['status'] == 'rechazada'
    api.request(4)
    result = api.call('POST', f'/{api.sid}/leave', 2)
    assert result.json()['participants_count'] == 0
    assert api.call('GET', '/requests/me', 4).json()[0]['status'] == 'pendiente'


def test_solicitud_duplicada_y_join_no_saltan_aprobacion(api):
    result = api.call('POST', f'/{api.sid}/join', 2)
    assert result.status_code == 200  # La ruta antigua es un alias de solicitud.
    assert result.json()['status'] == 'pendiente'
    assert api.call('POST', f'/{api.sid}/requests', 2).status_code == 409
    assert api.call('GET', '/').json()[0]['participants_count'] == 0
