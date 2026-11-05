# StudyMatch 📚🤝

**Compañeros | Sesiones de Estudio**

Plataforma para conectar estudiantes, organizar sesiones de estudio y encontrar compañeros por materia.

---

## 🐳 Iniciar con Docker (recomendado)

```bash
docker-compose up --build
```

Eso es todo. Docker levanta automáticamente:
- 🐘 PostgreSQL en puerto `5433`
- ⚡ FastAPI en http://localhost:8000
- ⚛️  React en http://localhost:5173

Para detener:
```bash
docker-compose down
```

Para detener y eliminar los datos de la base de datos:
```bash
docker-compose down -v
```

---

## Datos de demostración

Con los servicios en ejecución, carga las materias y los datos de prueba con:

```bash
docker compose exec backend python seed.py
```

Sin Docker, desde la carpeta `backend` y con el entorno virtual activado:

```bash
python seed.py
```

El script agrega cinco usuarios, seis sesiones, siete solicitudes y once eventos
de historial. Las sesiones se identifican con el prefijo `[DEMO]` e incluyen
sesiones abiertas, una cerrada, una pasada, una con cupos llenos y una sin
solicitudes. Las solicitudes incluyen los estados pendiente, aceptada y rechazada;
solo las aceptadas se incluyen como participantes y generan un evento `unido`.

Todas las cuentas nuevas usan la contraseña **`StudyMatch123!`**:

| Correo | Datos que permite probar |
| --- | --- |
| `ana.demo@example.com` | Organiza tres sesiones y tiene una solicitud pendiente en Estructuras Discretas. |
| `bruno.demo@example.com` | Organiza dos sesiones y está aceptado en el taller con cupos llenos. |
| `carla.demo@example.com` | Tiene una solicitud pendiente en Cálculo I y una aceptada en Álgebra Lineal. |
| `diego.demo@example.com` | Está aceptado en Cálculo I y tiene historial de participación. |
| `elena.demo@example.com` | Organiza una sesión sin solicitudes; tiene una solicitud rechazada y una participación pasada. |

Por ejemplo, entra como Carla para ver su solicitud pendiente y como Ana para
consultarla desde **Gestionar solicitudes** en la sesión de Cálculo I.

Puedes repetir el comando: conserva las contraseñas de cuentas existentes y las
decisiones, participantes y cambios de las sesiones ya cargadas. Las fechas se
calculan respecto al día de la primera carga de cada sesión y no se desplazan al
repetirla. El arranque normal del backend sigue cargando únicamente las materias;
los datos de demostración se agregan al ejecutar `seed.py`.

---

## 🚀 Cómo iniciar el proyecto (sin Docker)

### Pre-requisitos
- Node.js 18+
- Python 3.11+
- PostgreSQL 15+

---

### 1. Configurar la base de datos

Crear la base de datos en PostgreSQL:
```sql
CREATE DATABASE studymatch;
```

---

### 2. Backend (FastAPI)

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Copiar y editar el archivo de variables de entorno:
```bash
copy .env.example .env
```
Editar `.env` con tus credenciales de PostgreSQL.

Iniciar el servidor:
```bash
uvicorn app.main:app --reload
```
> API disponible en: http://localhost:8000
> Documentación: http://localhost:8000/docs

---

### 3. Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```
> App disponible en: http://localhost:5173

---

## 🛠️ Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + Vite |
| Routing | React Router v6 |
| HTTP Client | Axios |
| Backend | FastAPI (Python) |
| Base de datos | PostgreSQL |
| ORM | SQLAlchemy |
| Autenticación | JWT (python-jose) |
| Seguridad | bcrypt (passlib) |

---

---

## 🧪 Pruebas Unitarias (Task 02 – Regla de Cambio de Estado)

El proyecto incluye una suite de pruebas unitarias que valida la máquina de estados y las reglas de negocio para el ciclo de vida de las **Sesiones de Estudio** (`Inscripción abierta -> cerrada`, Acción: *"Cerrar inscripciones"*).

### Casos de prueba evaluados:
1. **`test_01_estado_inicial_es_correcto`**: El estado inicial de la sesión es `'abierta'`.
2. **`test_02_accion_realiza_transicion_esperada`**: La acción `close_registration()` realiza la transición exitosa de `'abierta'` a `'cerrada'`.
3. **`test_03_transicion_invalida_se_rechaza`**: Intentar cerrar una sesión que ya se encuentra cerrada se rechaza lanzando un `ValueError`.
4. **`test_04_demas_datos_del_elemento_se_conservan`**: Tras el cambio de estado, todos los atributos (`name`, `date`, `modality`, `spots`, etc.) se conservan intactos.
5. **`test_05_sesion_cerrada_no_acepta_nuevos_participantes`**: Restricción según su estado: una sesión con estado `'cerrada'` no acepta nuevos participantes (lanza `ValueError`).
6. **`test_06_sesion_abierta_acepta_nuevos_participantes`**: Una sesión abierta sí acepta nuevos participantes e incrementa los cupos ocupados.

### Comandos de ejecución:

#### Opción 1: Ejecutar con Pytest (Recomendado)
```bash
cd backend
python -m pytest -v
```

#### Opción 2: Ejecutar con Unittest nativo de Python (sin dependencias adicionales)
```bash
cd backend
python -m unittest discover -s tests -v
```

#### Opción 3: Ejecutar dentro del contenedor Docker
```bash
docker exec -it studymatch_backend python -m pytest -v
```

---

## Lista de espera y aprobación de solicitudes (Tarea 6)

El organizador tiene el botón **Gestionar solicitudes** en cada sesión propia.
Puede aceptar o rechazar las solicitudes pendientes. Una aceptación confirma al
estudiante si hay cupo; si la sesión está llena, lo agrega al final de la lista
de espera. Las sesiones llenas siguen permitiendo solicitar ingreso.

Cada estudiante ve su estado: pendiente, confirmado, en espera con su posición,
rechazado o retirado. **Salir de la sesión** libera el cupo de una persona
confirmada y promueve al primero previamente aprobado en espera. Una sesión
cerrada o pasada no promueve estudiantes. El organizador no ocupa un cupo.
Los cambios de otras personas se ven al recargar o volver a buscar.

Para probarlo manualmente, crea una sesión futura con un cupo. En otra sesión
de navegador, solicita ingreso con Bruno y acéptalo como organizador. Repite
con Carla: quedará en espera. Cuando Bruno salga, Carla pasará a confirmada;
recarga con Carla para comprobarlo. Usa perfiles de navegador distintos o
cierra sesión al cambiar de cuenta.

Al iniciar el backend se agregan las columnas de la cola y se actualiza la
restricción de estados, conservando las solicitudes existentes. El orden de la
cola se establece al aprobar, mediante un contador por sesión. Aprobar y salir
bloquean la fila de la sesión durante la transacción para proteger el cupo.
Las solicitudes rechazadas o retiradas no se pueden reenviar en este alcance.
La ruta antigua `/sessions/{id}/join` ahora también crea una solicitud pendiente:
su respuesta cambió de sesión a solicitud para exigir la aprobación.

Con frontend, backend y datos de prueba preparados, desde la raíz:

```powershell
pnpm exec playwright test --project=chromium --workers=1 --reporter=line --trace=off
```

Solo el recorrido de espera:

```powershell
pnpm exec playwright test tests/lista-espera.spec.js --project=chromium --workers=1 --reporter=line --trace=off
```

Cada prueba nueva crea sus propias cuentas y sesiones de prueba. Los resultados
antes y después y el alcance pendiente están en [evidencias/tarea-6.md](evidencias/tarea-6.md).
Los ejemplos de instalación de `example.spec.js` se excluyen de la suite.

## Reprogramación con reconfirmación (Tarea 7)

1. Como organizador, busca tu sesión y pulsa **Reprogramar sesión**.
2. Cambia la fecha o la hora, indica el motivo y guarda la reprogramación.
3. Cada participante confirmado verá el cambio al recargar o volver a buscar.
   Puede pulsar **Confirmar asistencia** o **Retirarme**. Su cupo se reserva mientras decide.
4. Si alguien se retira, la primera persona aprobada en espera pasa a confirmada,
   siempre que la sesión esté abierta y vigente.
5. El organizador puede consultar las respuestas en **Ver reprogramaciones**.
   Cuando todas estén resueltas, podrá reprogramar otra vez.

La hora es opcional para admitir las sesiones anteriores. La reprogramación exige
inscripciones abiertas y un motivo. El backend aplica las reglas y bloquea cambios
de fecha u hora desde la edición general cuando requieren reconfirmación.

Para ejecutar el recorrido completo desde la raíz, con la aplicación en ejecución

```powershell
pnpm exec playwright test tests/reprogramacion.spec.js --project=chromium --workers=1 --reporter=line --trace=off
```

La explicación del código, los resultados y las capturas están en
[evidencias/tarea-7.md](evidencias/tarea-7.md).

## 🕘 Historial de Participación (Tarea 4 – Issue #12)

Responde la pregunta de StudyMatch: **¿En qué sesiones participó la persona?**

> Como estudiante, quiero ver un historial de las sesiones de estudio en las que participé, para recordar mi trayectoria de estudio y saber qué pasó con cada sesión sin revisarlas una por una.

### Cómo funciona
- **Datos:** cada acción (unirse, crear, cerrar o eliminar una sesión) guarda un evento en la tabla `session_history` de PostgreSQL, con una copia de los datos de la sesión para que el evento se conserve aunque la sesión se elimine.
- **Consulta:** `GET /history/me` devuelve solo el historial del usuario autenticado (por su token JWT), del más reciente al más antiguo. Filtro opcional `?tipo=todos|unido|creada`.
- **Interfaz:** página **Mi historial** (`/historial`), accesible desde el sidebar y la barra inferior móvil, con filtros `Todas · Me uní · Organicé`, detalle expandible y estado vacío con acción **"Buscar sesiones"**.

### Cómo comprobarlo
1. Inicia sesión, solicita entrar a una sesión abierta desde el Dashboard y pide al organizador que la acepte con cupo disponible.
2. Entra a **Mi historial**: aparece *"Te uniste a ..."* con la fecha y el estado actual.
3. Recarga la página: el evento sigue ahí (persistido en la base de datos).
4. Con un usuario sin actividad se muestra el estado vacío.

### Pruebas
```bash
docker exec studymatch_backend python -m unittest tests.test_session_history -v
```

Decisiones de diseño (Fitts, Hick y carga cognitiva) con antes, después y código: [`docs/decisiones-interaccion.md`](docs/decisiones-interaccion.md).

---

## 📁 Estructura del proyecto

```
Segundo Proyecto/
├── frontend/          # React + Vite
│   └── src/
│       ├── api/       # Configuración Axios
│       ├── components/# PrivateRoute, ThemeToggle, LogoutIcon
│       ├── context/   # AuthContext (estado global)
│       ├── pages/     # Home, Login, Register, ForgotPassword, Dashboard, Profile
│       └── styles/    # CSS por página (Dashboard.css, Auth.css, etc.)
├── backend/           # FastAPI
│   ├── tests/         # Pruebas unitarias
│   │   ├── __init__.py
│   │   └── test_session_state.py # 4 pruebas unitarias de cambio de estado
│   └── app/
│       ├── routers/   # auth.py, subjects.py, sessions.py
│       ├── main.py    # Entrada de la API
│       ├── models.py  # Modelos SQLAlchemy (User, Subject, Session)
│       ├── schemas.py # Pydantic schemas (SessionCreate, SessionResponse, etc.)
│       ├── security.py# JWT + bcrypt
│       ├── database.py# Conexión PostgreSQL
│       └── triggers.py# Triggers y migraciones DDL PostgreSQL
└── docs/
    ├── project-card.md
    ├── task-01-access.md
    └── task-02-state-tests.md
```

