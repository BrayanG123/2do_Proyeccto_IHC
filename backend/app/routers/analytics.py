from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession
from app.database import get_db
from app.models import AnalyticsEvent, Session, User
from app.routers.auth import get_current_user
from app.schemas import AnalyticsStart, AnalyticsEventResponse, AnalyticsSummaryResponse


router = APIRouter(prefix='/analytics', tags=['Analítica'])


@router.post('/start', response_model=AnalyticsEventResponse, status_code=201)
def register_start(data: AnalyticsStart, db: DBSession = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    session = db.get(Session, data.session_id)
    if session is None:
        raise HTTPException(404, 'Sesión no encontrada.')
    modality = session.modality
    if modality not in ('Presencial', 'Virtual'):
        modality = 'Otra'
    event = AnalyticsEvent(event='solicitud_iniciada', modality=modality)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.get('/summary', response_model=AnalyticsSummaryResponse)
def get_summary(db: DBSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    totals = db.query(AnalyticsEvent.event, func.count(AnalyticsEvent.id)).group_by(AnalyticsEvent.event).all()
    counts = dict(totals)
    started = counts.get('solicitud_iniciada', 0)
    sent = counts.get('solicitud_enviada', 0)
    percentage = 0.0
    if started > 0:
        percentage = round(sent * 100 / started, 2)
    recent_events = db.query(AnalyticsEvent).order_by(AnalyticsEvent.id.desc()).limit(10).all()
    return {
        'iniciadas': started, 'enviadas': sent,
        'porcentaje_finalizacion': percentage, 'ultimos_eventos': recent_events,
    }
