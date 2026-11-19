from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError

from app.account_data import ACCOUNT_CANCEL_REASON, DELETED_ORGANIZER
from app.models import PasswordResetCode, Session, SessionJoinRequest, User
from app.routers.auth import AccountDeletion, delete_my_account
from app.security import hash_password
from tests.test_attendance import mark, prepare
from tests.test_analytics import client
from tests.test_waitlist import api


def test_account_removal_rolls_back_session_and_request_changes(client, api, monkeypatch):
    user = api.db.get(User, 1)
    user.hashed_password = hash_password('ClaveDePrueba123!')
    api.db.commit()
    participant_id = api.request(2)
    assert api.decide(participant_id).json()['status'] == 'aceptada'

    def fail_commit():
        api.db.flush()
        raise SQLAlchemyError('Fallo después de aplicar los cambios')

    with monkeypatch.context() as patch, pytest.raises(SQLAlchemyError):
        patch.setattr(api.db, 'commit', fail_commit)
        client.request('DELETE', '/auth/me', headers={'x-user': '1'}, json={'password': 'ClaveDePrueba123!'})

    api.db.rollback()
    assert api.db.get(User, 1) is not None
    session = api.db.get(Session, api.sid)
    assert session.status == 'abierta'
    assert session.creator_id == 1
    assert session.get_participant_emails_list() == ['u2@example.com']
    assert api.db.get(SessionJoinRequest, participant_id).status == 'aceptada'


def test_export_excludes_access_secrets(client, api):
    from datetime import datetime, timezone

    api.db.add(PasswordResetCode(email='u2@example.com', code='654321', expires_at=datetime.now(timezone.utc)))
    api.db.commit()
    response = client.get('/auth/me/data/download')
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    assert response.json()['perfil']['email'] == 'u2@example.com'
    assert '654321' not in response.text
    assert 'hashed_password' not in response.text
    assert 'u1@example.com' not in response.text


def test_preview_includes_the_users_attendance_history_only(client, api):
    prepare(api)
    assert mark(api, 2, 'presente').status_code == 200
    assert mark(api, 3, 'ausente').status_code == 200

    preview = client.get('/auth/me/data')
    assert preview.status_code == 200
    assert preview.headers['cache-control'] == 'no-store'
    body = preview.json()
    assert body['perfil']['email'] == 'u2@example.com'
    record, = body['asistencia']
    assert record['session_id'] == api.sid
    assert record['status'] == 'presente'
    assert record['historial'][0]['action'] == 'asistencia'
    assert record['historial'][0]['new_status'] == 'presente'
    assert 'u3@example.com' not in preview.text


def test_member_deletion_removes_old_email_and_promotes_waiting_request(client, api):
    member = api.db.get(User, 2)
    member.hashed_password = hash_password('ClaveDePrueba123!')
    api.db.commit()
    assert api.decide(api.request(2)).json()['status'] == 'aceptada'
    waiting = api.request(3)
    assert api.decide(waiting).json()['status'] == 'en_espera'
    member.email = 'nuevo@example.com'
    api.db.commit()

    wrong_password = client.request('DELETE', '/auth/me', json={'password': 'incorrecta'})
    assert wrong_password.status_code == 403
    assert api.db.get(User, 2) is not None
    assert api.db.get(SessionJoinRequest, waiting).status == 'en_espera'

    deleted = client.request('DELETE', '/auth/me', json={'password': 'ClaveDePrueba123!'})
    assert deleted.status_code == 204
    assert api.db.get(User, 2) is None
    session = api.db.get(Session, api.sid)
    assert session.get_participant_emails_list() == ['u3@example.com']
    assert session.participants_count == 1
    assert api.db.get(SessionJoinRequest, waiting).status == 'aceptada'


def test_organizer_deletion_preserves_session_and_notifies_participant(client, api):
    organizer = api.db.get(User, 1)
    organizer.hashed_password = hash_password('ClaveDePrueba123!')
    api.db.commit()
    assert api.decide(api.request(2)).json()['status'] == 'aceptada'

    deleted = client.request(
        'DELETE', '/auth/me', headers={'x-user': '1'}, json={'password': 'ClaveDePrueba123!'},
    )
    assert deleted.status_code == 204
    session = api.db.get(Session, api.sid)
    assert session.creator_id is None
    assert session.creator_name == DELETED_ORGANIZER
    assert session.cancellation_reason == ACCOUNT_CANCEL_REASON
    participant_data = client.get('/auth/me/data').json()
    request, = participant_data['solicitudes']
    assert request['status'] == 'cancelada'
    assert request['motivo_cancelacion'] == ACCOUNT_CANCEL_REASON


def test_account_deleted_during_authentication_is_reported_as_missing(api):
    with pytest.raises(HTTPException) as failure:
        delete_my_account(AccountDeletion(password='clave-ficticia'), SimpleNamespace(id=99999), api.db)
    assert failure.value.status_code == 404
    assert api.db.query(User).count() == 5
