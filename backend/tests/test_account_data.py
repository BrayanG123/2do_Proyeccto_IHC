import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.models import PasswordResetCode, Session, SessionJoinRequest, User
from app.security import hash_password
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
