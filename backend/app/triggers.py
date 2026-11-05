from sqlalchemy import text
from app.database import engine

CREATE_TRIGGERS_SQL = """
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Garantizar que la tabla sessions cuente con la columna 'status' para transiciones de estado
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'abierta';
UPDATE sessions SET status = 'abierta' WHERE status IS NULL;

-- Garantizar que la tabla sessions cuente con los campos del creador
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS creator_id INTEGER;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS creator_name VARCHAR(150);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS creator_email VARCHAR(150);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS participants_count INTEGER DEFAULT 0;
UPDATE sessions SET participants_count = 0 WHERE participants_count IS NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS participant_emails TEXT DEFAULT '[]';
UPDATE sessions SET participant_emails = '[]' WHERE participant_emails IS NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS subject VARCHAR(150);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS time TIME;

-- Lista de espera: conservar las solicitudes existentes y ampliar sus estados.
ALTER TABLE session_join_requests ADD COLUMN IF NOT EXISTS waitlisted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE session_join_requests ADD COLUMN IF NOT EXISTS wait_order INTEGER;
ALTER TABLE session_join_requests ADD COLUMN IF NOT EXISTS confirmed_email VARCHAR(150);
ALTER TABLE session_join_requests DROP CONSTRAINT IF EXISTS ck_session_join_request_status;
ALTER TABLE session_join_requests ADD CONSTRAINT ck_session_join_request_status
CHECK (status IN ('pendiente', 'aceptada', 'rechazada', 'en_espera', 'retirada'));

CREATE OR REPLACE FUNCTION update_user_profile_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- Concatenar automáticamente full_name cuando se actualizan first_name o last_name
    NEW.full_name := TRIM(CONCAT(COALESCE(NEW.first_name, ''), ' ', COALESCE(NEW.last_name, '')));
    -- Actualizar timestamp
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_user_profile ON users;

CREATE TRIGGER trg_update_user_profile
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_user_profile_trigger();
"""


def setup_triggers():
    """Ejecuta y garantiza la existencia del trigger en PostgreSQL."""
    try:
        with engine.connect() as conn:
            conn.execute(text(CREATE_TRIGGERS_SQL))
            conn.commit()
            print("Trigger trg_update_user_profile configurado exitosamente en PostgreSQL")
    except Exception as e:
        print(f"Error al configurar triggers: {e}")

    # Migrar participaciones existentes al historial (Issue #13)
    try:
        from app.database import SessionLocal
        from app.models import backfill_session_history
        with SessionLocal() as db:
            created = backfill_session_history(db)
            if created:
                print(f"Historial: {created} eventos migrados desde sesiones existentes")
    except Exception as e:
        print(f"Advertencia al migrar historial: {e}")
