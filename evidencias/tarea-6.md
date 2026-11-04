# Tarea 6 — Pruebas E2E de StudyMatch

## Mediciones antes y después de la lista de espera

Fecha: 3 de noviembre de 2026. Primera medición (crear y buscar): 14:40 (America/La_Paz).

Medición anterior a la funcionalidad, en Chromium y con un trabajador: **26 pruebas pasaron y 1 falló, de 27 ejecutadas, en 2,2 minutos**. La matriz registra resultados observados en la terminal. Después de implementarla: **28 pruebas pasaron, 0 fallaron, en 1,8 minutos**. Las columnas conservan ambos resultados.

Preparación: PostgreSQL local en el puerto 5433, backend en `http://localhost:8000`, datos cargados previamente por el estudiante con `seed.py` y frontend Vite en `http://localhost:5173`.

| Caso | Recorrido y comprobación | Antes de la lista de espera | Después de la lista de espera | Archivo de prueba |
| --- | --- | --- | --- | --- |
| Crear y buscar una sesión | Iniciar sesión como Ana, crear una sesión con nombre único, buscar ese nombre y comprobar que su título exacto está visible. | **Pasa: 1 prueba, 0 fallos, 3,5 segundos.** | Pasa en la ejecución conjunta. | [crear-sesion.spec.js](../tests/crear-sesion.spec.js) |
| Inicio de sesión con contraseña incorrecta | Escribir el correo de Ana y una contraseña incorrecta, enviar y comprobar el mensaje de error y que la página siga en el login. | **Pasa: 1 prueba, 0 fallos, 5,7 segundos.** | Pasa en la ejecución conjunta. | [login-incorrecto.spec.js](../tests/login-incorrecto.spec.js) |

Los dos casos anteriores también pasaron en la última ejecución conjunta. Sus tiempos individuales en la tabla corresponden a las ejecuciones iniciales. Los siguientes 25 casos completan los 27 ejecutados:

| Caso | Comprobación | Antes | Después |
| --- | --- | --- | --- |
| Registro e ingreso | Crear una cuenta, recargar, salir e ingresar nuevamente. | Pasa | Pasa |
| Registro inválido | Rechazar confirmaciones de contraseña diferentes. | Pasa | Pasa |
| Dashboard protegido | Sin autenticar, `/dashboard` lleva al login. | Pasa | Pasa |
| Perfil protegido | Sin autenticar, `/profile` lleva al login. | Pasa | Pasa |
| Historial protegido | Sin autenticar, `/historial` lleva al login. | Pasa | Pasa |
| Cerrar sesión | Cancelar conserva el acceso y confirmar impide regresar al dashboard sin autenticar. | Pasa | Pasa |
| Recuperación con correo inexistente | Mostrar que no existe una cuenta para ese correo. | Pasa | Pasa |
| Editar perfil | Guardar otro nombre y conservarlo al recargar. | Pasa | Pasa |
| Cancelar edición del perfil | Conservar el nombre original después de recargar. | Pasa | Pasa |
| Cambiar contraseña | Cambiar la clave e ingresar con la nueva. | Pasa | Pasa |
| Contraseña actual incorrecta | Rechazar el cambio con el mensaje correspondiente. | Pasa | Pasa |
| Foto de perfil | Subir una imagen, conservarla al recargar, quitarla y comprobar que ya no aparece la opción de eliminarla. | Pasa | Pasa |
| Archivo de foto inválido | Rechazar un archivo de texto. | Pasa | Pasa |
| Creación incompleta | Impedir guardar sin nombre y mantener el formulario abierto. | Pasa | Pasa |
| Búsqueda sin resultados | Mostrar el estado vacío y permitir restablecer los filtros. | Pasa | Pasa |
| Filtro por modalidad | Ocultar una sesión presencial con Virtual y mostrarla con Presencial. | Pasa | Pasa |
| Editar sesión | Guardar otro nombre y encontrarlo después de recargar. | Pasa | Pasa |
| Cancelar edición de sesión | Conservar el nombre original después de recargar. | Pasa | Pasa |
| Eliminar sesión | Cancelar la conserva; confirmar la elimina, incluso después de recargar. | Pasa | Pasa |
| Cerrar inscripciones | Conservar el estado cerrado y bloquear la solicitud de otro usuario. | Pasa | Pasa |
| Solicitar inscripción | Cancelar el diálogo; confirmar muestra la solicitud enviada. | Pasa | Pasa |
| Solicitud duplicada / reenvío | Antes: informar que ya existe. Después: mostrar el estado pendiente e impedir otro envío desde la interfaz, incluso al recargar. | **Falla: no aparece el aviso** | Pasa: prevención del reenvío; la API también rechaza duplicados. |
| Historial vacío | Explicar la ausencia de actividad y ofrecer buscar sesiones. | Pasa | Pasa |
| Historial con actividad | Consultar detalle, filtrar y conservar la creación al recargar. | Pasa | Pasa |
| Tema claro y oscuro | Alternar y conservar la elección al recargar, según el estado del control. No es una comparación visual de capturas. | Pasa | Pasa |

### Archivos nuevos

- [registro-acceso.spec.js](../tests/registro-acceso.spec.js): siete casos de registro, acceso, salida y recuperación con correo inexistente.
- [perfil.spec.js](../tests/perfil.spec.js): seis casos de datos del perfil, contraseña y foto.
- [sesiones.spec.js](../tests/sesiones.spec.js): nueve casos de sesiones, filtros y solicitudes.
- [historial-tema.spec.js](../tests/historial-tema.spec.js): tres casos de historial y tema.
- [apoyo.js](../tests/apoyo.js): acciones compartidas para registrar, ingresar, salir, crear y buscar desde la interfaz. No es una prueba adicional; evita repetir esos pasos en todos los archivos.

Para ejecutar toda la suite de StudyMatch:

```powershell
pnpm exec playwright test --project=chromium --workers=1 --reporter=line --trace=off
```

Se utilizó el comando equivalente con Node: `node node_modules/@playwright/test/cli.js test --project=chromium --workers=1 --reporter=line --trace=off`. La configuración excluye `example.spec.js`, porque visita la web de Playwright y no prueba StudyMatch.

Comando para repetir la prueba de creación desde la raíz del proyecto (PowerShell):

```powershell
pnpm exec playwright test tests/crear-sesion.spec.js --project=chromium --workers=1 --reporter=line --trace=off
```

Para ejecutar el caso de contraseña incorrecta:

```powershell
pnpm exec playwright test tests/login-incorrecto.spec.js --project=chromium --workers=1 --reporter=line --trace=off
```

`--reporter=line` muestra el resultado en la terminal. `--trace=off` desactiva la grabación de trazas. Los archivos temporales de `test-results` están ignorados por Git; no se guardan reportes JSON o TXT en la carpeta de evidencias.

### Observaciones de la ejecución

- El primer intento de la prueba de creación con `--trace=on` terminó con un error de infraestructura: Windows bloqueó la eliminación de un archivo ZIP de la traza (`EBUSY`). La repetición con la traza desactivada terminó correctamente, sin modificar la prueba ni la aplicación. A petición del estudiante se quitaron los archivos de reportes adicionales y se conservó aquí el resultado observado.
- La prueba conserva una fecha fija, `2026-10-31`, anterior al día de esta ejecución. La aplicación permitió crear y encontrar la sesión. Por ello, este resultado no demuestra que la sesión sea futura o que permita inscribirse; conviene usar una fecha futura al preparar los siguientes casos.
- La ejecución utiliza la base existente y agrega una sesión. No fue una ejecución desde una base vacía.
- La comparación visual automatizada y la auditoría de accesibilidad siguen pendientes; la revisión visual manual no las sustituye.

### Hallazgos de los casos nuevos

- **Solicitud duplicada (hallazgo anterior, ya corregido):** `solicitarUnirse` capturaba `catch (error)` pero intentaba leer `err?.response...`, una variable no definida. Ahora utiliza `error`. El caso E2E se actualizó deliberadamente: la nueva interfaz muestra el estado de la solicitud y deshabilita el reenvío. Por eso no se presenta como una repetición idéntica del antiguo caso. El rechazo de duplicados (HTTP 409) se verifica en las pruebas de API.
- En la primera ejecución de los casos nuevos se corrigieron errores de las pruebas: el selector del botón de salida (en el perfil incluye un emoji), la comprobación del acceso privado al salir y la espera de la respuesta del buscador. La matriz muestra los resultados de la ejecución posterior a esas correcciones.
- Las pruebas nuevas crean cuentas `e2e-...@example.com` y sesiones con prefijo `[E2E]`. Los cambios de perfil y contraseña afectan solamente a esas cuentas nuevas. Los datos sintéticos quedan en la base, salvo las sesiones eliminadas por su propio caso. No se reinició la base para esta medición.
- Las sesiones de las pruebas nuevas tienen fecha de siete días después de su ejecución. La nota sobre la fecha fija anterior corresponde únicamente al archivo original `crear-sesion.spec.js`.
- El formulario de edición de sesiones tiene etiquetas sin asociar a los campos. La prueba de cambio de nombre utiliza el placeholder; esto no acredita accesibilidad de ese formulario.
- **Pendientes de cobertura:** recuperación completa con recepción y uso del código (requiere un buzón de prueba), otros filtros como materia y rango de fechas, pruebas automatizadas visuales y de accesibilidad. Los casos funcionales no acreditan todavía el cumplimiento íntegro de esos requisitos adicionales.


## Nuevo recorrido comprobado

| Caso | Antes | Después | Archivo |
| --- | --- | --- | --- |
| Lista de espera por aprobación | Funcionalidad no implementada; sin ejecución E2E de este recorrido antes. | Pasa: primer participante confirmado, dos en espera, salida y promoción del primero; posición del segundo actualizada, datos persistidos e historial de quien entra. | [lista-espera.spec.js](../tests/lista-espera.spec.js) |

La suite ahora contiene 28 casos: los 26 recorridos anteriores que pasaban, el caso de reenvío actualizado a la nueva interfaz y el recorrido nuevo. La matriz anterior no se reemplazó por resultados ficticios de la lista de espera.

Reglas acordadas: las solicitudes empiezan pendientes. Aceptar confirma si hay cupo y pone en espera si no lo hay. La cola sigue el orden de aprobación, mediante un contador por sesión que no depende de empates del reloj. Salir libera el cupo y confirma automáticamente al primero en espera. Las sesiones cerradas o pasadas no promueven personas. Una solicitud rechazada o retirada no puede enviarse nuevamente en este alcance.

El backend agrega `waitlisted_at`, `wait_order` y `confirmed_email` y amplía los estados admitidos de solicitudes al iniciar. La migración conserva los datos existentes. La ruta antigua `/sessions/{id}/join` ahora crea una solicitud pendiente; no permite entrar sin aprobación y su respuesta es una solicitud, no una sesión.

Las pruebas de historial se ajustaron al nuevo comportamiento: pedir ingreso todavía no genera participación; ser aceptado sí. Las pruebas de API cubren FIFO por aprobación, permisos del organizador, sesiones cerradas, rechazo de solicitudes, ausencia de promoción de solicitudes pendientes y duplicados.

Validación adicional: **45 pruebas del backend aprobadas** (`cd backend`, luego `.\venv\Scripts\python.exe -m pytest -q`) y **compilación del frontend correcta** (`cd frontend`, luego `npm run build`). Las pruebas de API utilizan SQLite aislado; el recorrido E2E utiliza el PostgreSQL local. No se realizó una prueba de carga de solicitudes concurrentes.

Se revisó manualmente la ventana de solicitudes en escritorio y móvil mediante capturas temporales dentro de `test-results` (ignorado por Git). No se añadieron reportes JSON o TXT a evidencias.

Para ejecutar solamente el nuevo recorrido:

```powershell
pnpm exec playwright test tests/lista-espera.spec.js --project=chromium --workers=1 --reporter=line --trace=off
```

Los estados de otras personas se consultan al recargar o buscar; no hay actualización automática en tiempo real.

Repetición del recorrido nuevo con navegador visible (`--headed`): **1 prueba aprobada en 26,1 segundos**, comprobando nuevamente aprobación, orden de espera, salida, promoción y persistencia.
