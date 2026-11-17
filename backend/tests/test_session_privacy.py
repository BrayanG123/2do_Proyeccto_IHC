from app.security import create_access_token
from tests.test_analytics import client
from tests.test_waitlist import api


def test_sessions_do_not_share_email_addresses_and_keep_viewer_flags(client, api):
    assert api.decide(api.request(2)).json()['status'] == 'aceptada'
    for user_id, role in ((None, (False, False)), (1, (True, False)), (2, (False, True)), (3, (False, False))):
        headers = {}
        if user_id:
            headers['Authorization'] = f"Bearer {create_access_token({'sub': str(user_id)})}"
        response = client.get('/sessions/', headers=headers)
        assert response.status_code == 200
        listing, = response.json()
        assert 'participant_emails' not in listing
        assert 'creator_email' not in listing
        assert '@example.com' not in response.text
        assert (listing['is_creator'], listing['is_enrolled']) == role
