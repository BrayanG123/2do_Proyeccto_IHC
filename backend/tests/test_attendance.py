"""Asistencia mediante la API de sesiones y una base aislada."""
from datetime import date, timedelta
import json
from app.models import Session, SessionAttendance, AttendanceHistory
from app.history import current_session_status
from tests.test_waitlist import api


def prepare(api):
    assert api.call('PUT', f'/{api.sid}', json={'date': str(date.today()), 'spots': 2}).status_code == 200
    assert api.decide(api.request(2)).json()['status'] == 'aceptada'
    assert api.decide(api.request(3)).json()['status'] == 'aceptada'
    assert api.decide(api.request(4)).json()['status'] == 'en_espera'
    assert api.call('POST', f'/{api.sid}/finish').status_code == 200


def mark(api, user, status):
    return api.call('PATCH', f'/{api.sid}/attendance/{user}', json={'status': status})


def justify(api, user=3, text='Tuve una consulta médica'):
    return api.call('POST', f'/{api.sid}/attendance/justification', user, json={'text': text})


def decide(api, user=1, decision='aceptar', reason='La explicación corresponde a la ausencia'):
    return api.call('PATCH', f'/{api.sid}/attendance/3/justification', user,
                    json={'decision': decision, 'reason': reason})


def test_complete_attendance_and_justification_history(api):
    prepare(api)
    assert mark(api, 2, 'presente').status_code == 200
    assert mark(api, 3, 'ausente').status_code == 200
    assert justify(api).status_code == 201
    assert justify(api).status_code == 409
    assert decide(api).json()['justification_status'] == 'aceptada'
    assert decide(api).status_code == 409
    own = api.call('GET', f'/{api.sid}/attendance', 3).json()
    assert len(own) == 1
    assert own[0]['status'] == 'ausente'
    assert own[0]['decision_reason'] == 'La explicación corresponde a la ausencia'
    assert [change['action'] for change in own[0]['history']] == ['asistencia', 'justificacion', 'decision']
    assert own[0]['history'][0]['previous_status'] == 'sin_registrar'
    assert own[0]['history'][1]['note'] == 'Tuve una consulta médica'
    assert own[0]['history'][2]['new_status'] == 'aceptada'
    assert len(api.call('GET', f'/{api.sid}/attendance').json()) == 2
    assert api.call('GET', f'/{api.sid}/attendance', 2).json()[0]['status'] == 'presente'
    assert api.db.query(SessionAttendance).count() == 2
    assert api.db.query(AttendanceHistory).count() == 4
    assert current_session_status(api.db.get(Session, api.sid)) == 'finalizada'


def test_permissions_and_private_results(api):
    prepare(api)
    assert api.call('GET', f'/{api.sid}/attendance', 4).status_code == 403
    assert api.call('GET', f'/{api.sid}/attendance', 5).status_code == 403
    assert api.call('PATCH', f'/{api.sid}/attendance/3', 2, json={'status': 'presente'}).status_code == 403
    assert api.call('PATCH', f'/{api.sid}/attendance/3', 5, json={'status': 'presente'}).status_code == 403
    assert mark(api, 4, 'ausente').status_code == 404
    assert mark(api, 1, 'presente').status_code == 404
    assert justify(api, user=5).status_code == 404
    assert mark(api, 3, 'ausente').status_code == 200
    assert justify(api).status_code == 201
    assert decide(api, user=3).status_code == 403
    assert decide(api, user=5).status_code == 403
    assert api.call('GET', f'/{api.sid}/attendance', 3).json()[0]['justification_status'] == 'pendiente'


def test_finished_roster_cannot_be_removed_or_rescheduled(api):
    prepare(api)
    assert api.call('POST', f'/{api.sid}/finish').status_code == 409
    assert api.call('POST', f'/{api.sid}/leave', 2).status_code == 409
    assert api.call('PUT', f'/{api.sid}', json={'date': str(date.today() + timedelta(days=3))}).status_code == 409
    assert api.call('PUT', f'/{api.sid}', json={'status': 'abierta'}).status_code == 409
    assert api.call('PATCH', f'/{api.sid}/status', json={'status': 'abierta'}).status_code == 409
    assert api.call('DELETE', f'/{api.sid}').status_code == 409
    assert api.call('POST', f'/{api.sid}/requests', 5).status_code == 400
    assert api.call('POST', f'/{api.sid}/reschedule', json={
        'date': str(date.today() + timedelta(days=2)), 'reason': 'Cambio posterior al cierre',
    }).status_code == 409
    assert api.call('GET', '/requests/me', 4).json()[0]['status'] == 'en_espera'
    assert api.db.query(SessionAttendance).count() == 2


def test_finish_requires_owner_and_date_and_resolved_reconfirmations(api):
    assert api.call('POST', f'/{api.sid}/finish', 2).status_code == 403
    assert api.call('POST', f'/{api.sid}/finish').status_code == 400
    assert api.call('PUT', f'/{api.sid}', json={'date': str(date.today())}).status_code == 200
    assert api.decide(api.request(2)).status_code == 200
    change = api.call('POST', f'/{api.sid}/reschedule', json={
        'date': str(date.today()), 'time': '10:00', 'reason': 'Cambio de horario del aula',
    }).json()
    assert api.call('POST', f'/{api.sid}/finish').status_code == 409
    assert api.call('POST', f'/{api.sid}/reschedules/{change["id"]}/confirm', 2).status_code == 200
    assert api.call('POST', f'/{api.sid}/finish').status_code == 200


def test_corrections_history_and_no_duplicate_changes(api):
    prepare(api)
    assert mark(api, 3, 'presente').status_code == 200
    assert mark(api, 3, 'presente').status_code == 200
    assert justify(api).status_code == 409
    assert mark(api, 3, 'ausente').status_code == 200
    assert justify(api).status_code == 201
    assert mark(api, 3, 'presente').status_code == 409
    assert decide(api, decision='rechazar').json()['justification_status'] == 'rechazada'
    own = api.call('GET', f'/{api.sid}/attendance', 3).json()[0]
    assert [change['new_status'] for change in own['history']] == ['presente', 'ausente', 'pendiente', 'rechazada']
    assert mark(api, 3, 'presente').status_code == 409


def test_validation_and_no_justification_before_absence(api):
    prepare(api)
    assert justify(api).status_code == 409
    assert mark(api, 3, 'incorrecto').status_code == 422
    assert mark(api, 3, 'ausente').status_code == 200
    assert justify(api, text='   ').status_code == 422
    assert justify(api, text='x' * 2001).status_code == 422
    assert justify(api).status_code == 201
    assert decide(api, reason='   ').status_code == 422
    assert decide(api, decision='otro').status_code == 422
    assert api.db.query(AttendanceHistory).count() == 2


def test_legacy_confirmed_roster_and_changed_profile_email(api):
    from app.models import User
    session = api.db.get(Session, api.sid)
    session.date = date.today() - timedelta(days=1)
    session.participant_emails = json.dumps(['u2@example.com'])
    session.participants_count = 1
    api.db.commit()
    assert api.call('GET', '/attendance/me', 2).json() == []
    assert api.call('POST', f'/{api.sid}/finish').status_code == 200
    api.db.get(User, 2).email = 'nuevo@example.com'
    api.db.commit()
    assert api.call('GET', '/attendance/me', 2).json() == [api.sid]
    assert api.call('GET', '/attendance/me', 5).json() == []
    assert mark(api, 2, 'ausente').status_code == 200
    assert justify(api, user=2).status_code == 201
    assert api.call('GET', f'/{api.sid}/attendance', 2).json()[0]['user_email'] == 'nuevo@example.com'
