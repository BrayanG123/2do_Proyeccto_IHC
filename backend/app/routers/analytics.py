from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, UUID4
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session as DBSession
from app.analytics_events import FUNNELS, SEARCH_EVENTS
from app.analytics_tracking import get_attempt_id, save_event, session_modality
from app.database import get_db
from app.models import AnalyticsEvent, Session, User
from app.routers.auth import get_current_user
from app.schemas import AnalyticsStart, AnalyticsEventResponse, AnalyticsSummaryResponse


router = APIRouter(prefix='/analytics', tags=['Analítica'])


@router.post('/start', response_model=AnalyticsEventResponse, status_code=201)
def register_start(data: AnalyticsStart, request: Request, db: DBSession = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    session = db.get(Session, data.session_id)
    if session is None:
        raise HTTPException(404, 'Sesión no encontrada.')
    return save_event(db, 'solicitud_iniciada', attempt_id=get_attempt_id(request), modality=session_modality(session))


@router.get('/summary', response_model=AnalyticsSummaryResponse)
def get_summary(db: DBSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    events = db.query(AnalyticsEvent).filter(AnalyticsEvent.event.in_(('solicitud_iniciada', 'solicitud_enviada')))
    totals = events.with_entities(AnalyticsEvent.event, func.count(AnalyticsEvent.id)).group_by(AnalyticsEvent.event).all()
    counts = dict(totals)
    started = counts.get('solicitud_iniciada', 0)
    sent = counts.get('solicitud_enviada', 0)
    percentage = 0.0
    if started > 0:
        percentage = round(sent * 100 / started, 2)
    recent_events = events.order_by(AnalyticsEvent.id.desc()).limit(10).all()
    return {
        'iniciadas': started, 'enviadas': sent,
        'porcentaje_finalizacion': percentage, 'ultimos_eventos': recent_events,
    }


class Observation(BaseModel):
    model_config = {'extra': 'forbid'}

    flow: str = Field(max_length=30)
    attempt_id: UUID4
    result: Literal['inicio', 'validacion_fallida', 'con_resultados', 'sin_resultados']


def observe(data: Observation, db: DBSession, *, public: bool):
    funnel = FUNNELS.get(data.flow)
    if funnel is None or funnel.public != public:
        raise HTTPException(422, 'Flujo de analítica inválido.')

    reason = None
    if data.result == 'inicio' and data.flow != 'solicitar_unirse':
        name = funnel.steps[0][0]
    elif data.result == 'validacion_fallida':
        name = f'{data.flow}_bloqueo'
        reason = data.result
    elif data.flow in SEARCH_EVENTS and data.result in ('con_resultados', 'sin_resultados'):
        found, empty = SEARCH_EVENTS[data.flow]
        name = empty if data.result == 'sin_resultados' else found
    else:
        raise HTTPException(422, 'Resultado de analítica inválido.')

    save_event(db, name, attempt_id=str(data.attempt_id), reason=reason)


@router.post('/observations', status_code=204)
def register_observation(data: Observation, db: DBSession = Depends(get_db),
                         current_user: User = Depends(get_current_user)):
    observe(data, db, public=False)


@router.post('/public-observations', status_code=204)
def register_public_observation(data: Observation, db: DBSession = Depends(get_db)):
    observe(data, db, public=True)


def funnel_stats(db, funnel, empty_event=None):
    events = [name for name, _ in funnel.steps]
    outcomes = [*events, empty_event] if empty_event else events
    reached = [
        func.max(case((AnalyticsEvent.event == name, 1), else_=0)).label(name)
        for name in outcomes
    ]
    attempts = select(*reached).where(
        AnalyticsEvent.event.in_(outcomes), AnalyticsEvent.attempt_id.is_not(None),
    ).group_by(AnalyticsEvent.attempt_id).subquery()

    # Un paso cuenta únicamente si el mismo intento tiene todos los pasos anteriores.
    metrics = [
        func.count().filter(and_(*(attempts.c[event] == 1 for event in events[:index + 1])))
        for index in range(len(events))
    ]
    if empty_event:
        metrics.append(func.count().filter(
            attempts.c[events[0]] == 1, attempts.c[empty_event] == 1, attempts.c[events[-1]] == 0,
        ))
    counts = db.execute(select(*metrics)).one()

    steps = []
    for index, ((name, label), count) in enumerate(zip(funnel.steps, counts)):
        previous = counts[index - 1] if index else 0
        steps.append({
            'event': name,
            'label': label,
            'count': count,
            'lost': previous - count if index else None,
            'drop_rate': round((previous - count) * 100 / previous, 2) if previous else None,
        })
    return steps, counts[-1] if empty_event else None


@router.get('/funnels')
def get_funnels(db: DBSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    blockers = db.query(AnalyticsEvent.event, AnalyticsEvent.reason, func.count()).filter(
        AnalyticsEvent.reason.is_not(None),
    ).group_by(AnalyticsEvent.event, AnalyticsEvent.reason).order_by(AnalyticsEvent.reason).all()
    recent = db.query(AnalyticsEvent).order_by(AnalyticsEvent.id.desc()).limit(12).all()
    funnels = []
    for flow, funnel in FUNNELS.items():
        empty_event = SEARCH_EVENTS[flow][1] if flow in SEARCH_EVENTS else None
        steps, empty_results = funnel_stats(db, funnel, empty_event)
        funnels.append({
            'id': flow,
            'label': funnel.label,
            'steps': steps,
            'empty_results': empty_results,
            'blockers': [
                {'reason': reason, 'count': count}
                for event, reason, count in blockers if event == f'{flow}_bloqueo'
            ],
        })
    return {
        'funnels': funnels,
        'recent_events': [
            {'id': item.id, 'event': item.event, 'modality': item.modality,
             'reason': item.reason, 'created_at': item.created_at}
            for item in recent
        ],
    }
