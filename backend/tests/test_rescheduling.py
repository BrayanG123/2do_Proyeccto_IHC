"""La misma API de sesiones se prueba con una base aislada y cuentas ficticias."""
from datetime import date, timedelta
import json
from app.models import Session, SessionHistory, SessionJoinRequest, SessionReschedule
from tests.test_waitlist import api  # Reutiliza la preparación de la base de datos.


def prepare_participants(api):
    assert api.call('PUT', f'/{api.sid}', json={'spots': 2}).status_code == 200
    assert api.decide(api.request(2)).json()['status'] == 'aceptada'
    assert api.decide(api.request(3)).json()['status'] == 'aceptada'
    assert api.decide(api.request(4)).json()['status'] == 'en_espera'


def reschedule(api, user=1, **changes):
    body = {'date': str(date.today() + timedelta(days=8)), 'time': '16:00', 'reason': 'Cambio de disponibilidad del aula'}
    body.update(changes)
    return api.call('POST', f'/{api.sid}/reschedule', user, json=body)


def test_two_responses_reserved_seats_and_exactly_one_promotion(api):
    prepare_participants(api)
    change = reschedule(api)
    assert change.status_code == 201, change.text
    rid = change.json()['id']
    assert change.json()['pending_count'] == 2
    assert api.call('GET', '/').json()[0]['participants_count'] == 2
    assert api.call('GET', '/requests/me', 4).json()[0]['status'] == 'en_espera'

    assert api.call('POST', f'/{api.sid}/reschedules/{rid}/confirm', 2).status_code == 200
    assert reschedule(api).status_code == 409
    left = api.call('POST', f'/{api.sid}/leave', 3)
    assert left.status_code == 200
    assert left.json()['participants_count'] == 2
    assert set(left.json()['participant_emails']) == {'u2@example.com', 'u4@example.com'}
    assert api.call('POST', f'/{api.sid}/leave', 3).status_code == 409
    assert api.call('POST', f'/{api.sid}/reschedules/{rid}/confirm', 3).status_code == 409
    assert api.call('POST', f'/{api.sid}/reschedules/{rid}/confirm', 2).status_code == 409
    assert api.db.query(SessionHistory).filter_by(user_id=4, event_type='unido').count() == 1
    history = api.call('GET', '/reschedules/me').json()[0]
    assert history['pending_count'] == 0
    assert [item['status'] for item in history['responses']] == ['confirmada', 'retirada']
    second = reschedule(api, date=str(date.today() + timedelta(days=9)))
    assert second.status_code == 201
    assert second.json()['pending_count'] == 2
    assert api.db.query(SessionReschedule).count() == 2


def test_schedule_edit_cannot_bypass_reason_or_pending_responses(api):
    prepare_participants(api)
    new_date = str(date.today() + timedelta(days=10))
    assert api.call('PUT', f'/{api.sid}', json={'date': new_date}).status_code == 400
    assert api.call('PUT', f'/{api.sid}', json={'time': '17:00'}).status_code == 400
    assert reschedule(api).status_code == 201
    assert api.call('PUT', f'/{api.sid}', json={'date': new_date}).status_code == 409
    assert api.call('PUT', f'/{api.sid}', json={'name': 'Nombre corregido'}).status_code == 200


def test_permissions_and_response_privacy(api):
    prepare_participants(api)
    assert reschedule(api, user=2).status_code == 403
    rid = reschedule(api).json()['id']
    assert api.call('POST', f'/{api.sid}/reschedules/{rid}/confirm', 4).status_code == 403
    assert api.call('POST', f'/{api.sid}/reschedules/{rid}/confirm', 1).status_code == 403
    mine = api.call('GET', '/reschedules/me', 2).json()[0]
    assert mine['own_status'] == 'pendiente'
    assert mine['responses'] == []
    assert api.call('GET', '/reschedules/me', 5).json() == []


def test_validate_reason_date_and_actual_change(api):
    assert reschedule(api, reason='   ').status_code == 422
    assert reschedule(api, date='no-es-fecha').status_code == 422
    assert reschedule(api, time='99:00').status_code == 422
    assert reschedule(api, time='16:00+02:00').status_code == 422
    assert reschedule(api, date=str(date.today() - timedelta(days=1))).status_code == 400
    session = api.db.get(Session, api.sid)
    assert reschedule(api, date=str(session.date), time=None).status_code == 400
    assert api.db.query(SessionReschedule).count() == 0


def test_time_only_change_and_complete_history(api):
    original = api.db.get(Session, api.sid)
    old_date = original.date
    change = reschedule(api, date=str(old_date), time='18:30').json()
    assert change['old_date'] == change['new_date'] == str(old_date)
    assert change['old_time'] is None
    assert change['new_time'] == '18:30:00'
    assert change['reason'] == 'Cambio de disponibilidad del aula'
    assert change['pending_count'] == 0
    second = api.call('POST', f'/{api.sid}/reschedule', json={
        'date': str(old_date + timedelta(days=1)), 'reason': 'Cambio de fecha conservando el horario',
    })
    assert second.status_code == 201
    assert second.json()['new_time'] == '18:30:00'
    assert len(api.call('GET', '/reschedules/me').json()) == 2


def test_legacy_participation_without_join_request(api):
    session = api.db.get(Session, api.sid)
    session.participant_emails = json.dumps(['u2@example.com'])
    session.participants_count = 1
    api.db.commit()
    assert api.db.query(SessionJoinRequest).count() == 0
    change = reschedule(api).json()
    assert change['pending_count'] == 1
    assert api.call('GET', '/reschedules/me', 2).json()[0]['own_status'] == 'pendiente'
    assert api.call('POST', f'/{api.sid}/leave', 2).json()['participants_count'] == 0
    assert api.call('GET', '/reschedules/me', 2).json()[0]['own_status'] == 'retirada'


def test_changed_profile_email_keeps_reserved_seat(api):
    assert api.decide(api.request(2)).json()['status'] == 'aceptada'
    from app.models import User
    api.db.get(User, 2).email = 'correo-nuevo@example.com'
    api.db.commit()
    assert reschedule(api).json()['pending_count'] == 1
    assert api.call('POST', f'/{api.sid}/leave', 2).json()['participants_count'] == 0


def test_closed_session_preserves_waitlist_on_withdrawal(api):
    prepare_participants(api)
    assert reschedule(api).status_code == 201
    assert api.call('PATCH', f'/{api.sid}/close').status_code == 200
    assert api.call('POST', f'/{api.sid}/leave', 2).json()['participants_count'] == 1
    assert api.call('GET', '/requests/me', 4).json()[0]['status'] == 'en_espera'
    assert reschedule(api).status_code == 409


def test_closed_session_cannot_be_rescheduled(api):
    assert api.call('PATCH', f'/{api.sid}/close').status_code == 200
    assert reschedule(api).status_code == 400
