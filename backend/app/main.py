from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, SessionLocal
from app import models
from app.routers import auth, subjects, sessions, history, analytics
from app.routers.subjects import seed_subjects_in_db
from app.triggers import setup_triggers

# Crear tablas automáticamente al iniciar
models.Base.metadata.create_all(bind=engine)

# Configurar triggers de PostgreSQL (auto-actualización de full_name y updated_at)
setup_triggers()

# Auto-poblar las 53 materias de la carrera en PostgreSQL
try:
    with SessionLocal() as db:
        seed_subjects_in_db(db)
except Exception as e:
    print(f"Advertencia al poblar materias: {e}")


app = FastAPI(
    title="StudyMatch API",
    description="API para la plataforma StudyMatch - Compañeros y sesiones de estudio",
    version="1.0.0"
)

# CORS para que React pueda conectarse
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registrar routers
app.include_router(auth.router)
app.include_router(subjects.router)
app.include_router(sessions.router)
app.include_router(history.router)
app.include_router(analytics.router)



@app.get("/")
def root():
    return {"message": "StudyMatch API funcionando", "version": "1.0.0"}
