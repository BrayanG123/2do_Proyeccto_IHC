# Accesibilidad de StudyMatch

**Fecha** 18 de noviembre de 2026  
**Herramienta** Lighthouse 13.6.0 en Chrome/157.0.8103.79

## Alcance y resultado

Se ejecutó la categoría Accessibility de Lighthouse en modo Snapshot sobre dos compilaciones locales de producción, con los mismos datos ficticios de PostgreSQL. Se capturaron las vistas después de cargar sus datos y terminar sus animaciones, con y sin sesión según la pantalla. Se midieron 14 estados por tema en escritorio (1440 × 960) y 4 por tema en móvil (390 × 844).

En la primera pasada, 32 de los 36 estados tuvieron hallazgos y los puntajes estuvieron entre 85 y 100. Después de las correcciones, los 36 estados obtuvieron **100/100**, sin hallazgos automáticos ni errores de ejecución. Cada celda muestra el puntaje antes y después. [Mediciones y elementos detectados](accesibilidad/lighthouse.json) · [Informe original de Lighthouse con 16 ejemplos de escritorio](accesibilidad/lighthouse.html)

| Pantalla o estado | Dispositivo | Claro | Oscuro |
| --- | --- | --- | --- |
| Inicio | Escritorio | 90 → 100 | 95 → 100 |
| Iniciar sesión | Escritorio | 93 → 100 | 98 → 100 |
| Registro | Escritorio | 93 → 100 | 98 → 100 |
| Recuperar acceso | Escritorio | 93 → 100 | 98 → 100 |
| Panel de sesiones | Escritorio | 91 → 100 | 91 → 100 |
| Crear sesión | Escritorio | 91 → 100 | 91 → 100 |
| Editar sesión | Escritorio | 85 → 100 | 85 → 100 |
| Gestionar solicitudes | Escritorio | 92 → 100 | 92 → 100 |
| Historial | Escritorio | 97 → 100 | 97 → 100 |
| Analítica | Escritorio | 100 → 100 | 100 → 100 |
| Perfil y Mis datos | Escritorio | 95 → 100 | 95 → 100 |
| Eliminar cuenta | Escritorio | 100 → 100 | 100 → 100 |
| Mis solicitudes | Escritorio | 96 → 100 | 96 → 100 |
| Solicitar participación | Escritorio | 92 → 100 | 92 → 100 |
| Inicio | Móvil | 90 → 100 | 95 → 100 |
| Panel de sesiones | Móvil | 91 → 100 | 91 → 100 |
| Mis solicitudes | Móvil | 96 → 100 | 96 → 100 |
| Solicitar participación | Móvil | 92 → 100 | 92 → 100 |

## Hallazgos y correcciones

| Auditoría de Lighthouse | Qué encontró | Qué se corrigió |
| --- | --- | --- |
| `color-contrast` | El texto de enlaces, etiquetas, filtros y estados se confundía con sus fondos. Por ejemplo, el filtro activo en tema oscuro tenía texto blanco sobre celeste. | Se usaron colores de texto con mayor contraste en cada tema. Las tarjetas de sesiones cerradas y pasadas mantienen sus etiquetas y bordes de estado con el texto a color completo. [Tokens y colores de texto](../frontend/src/styles/tokens.css) |
| `label` y `select-name` | Los selectores del panel y varios controles de edición carecían de una etiqueta asociada que pudiera leer una tecnología de asistencia. | Se nombraron los filtros de materia y fecha, se asociaron las etiquetas de edición por identificador y se vinculó la ayuda del estado de inscripción. [Panel y edición](../frontend/src/pages/Dashboard.jsx) |
| `landmark-one-main` y `heading-order` | Las páginas públicas carecían de una región principal. En Inicio los encabezados pasaban de nivel 1 a nivel 3. | Se añadió la región principal a Inicio y a los formularios públicos de acceso. Los títulos de las tarjetas de Inicio ahora son de nivel 2. [Inicio](../frontend/src/pages/Home.jsx) |

## Comprobaciones complementarias

Se calculó la relación con los colores CSS de texto y fondo observados en Chromium, componiendo los fondos semitransparentes. El umbral aplicable al texto normal es **4,5:1** según WCAG 2.2, criterio 1.4.3, nivel AA. El menor valor de las diez muestras finales seleccionadas fue **4,90:1**. [Criterio de contraste de W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

| Muestra | Tema | Antes | Después |
| --- | --- | --- | --- |
| Inicio · distintivo | Claro | 3,51:1 | 5,08:1 |
| Acceso · enlace de registro | Claro | 4,10:1 | 5,93:1 |
| Panel · modalidad virtual | Claro | 3,65:1 | 5,29:1 |
| Panel · inscripción abierta | Claro | 3,37:1 | 4,90:1 |
| Panel · modalidad virtual | Oscuro | 3,07:1 | 5,86:1 |
| Panel · filtro de modalidad activo | Oscuro | 2,14:1 | 8,93:1 |

Crear, Editar y Solicitar participación ahora usan diálogos nativos con nombre accesible. Se comprobó en ambos temas que se pueden abrir con **Enter**, recorrer con **Tab**, cerrar con **Escape** y recuperar el foco en el botón de apertura. La prueba del diálogo de solicitud mantiene las comprobaciones de contraste de Tarea 7, cuyos mínimos registrados fueron 4,76:1 en claro y 5,48:1 en oscuro. [Diálogo de sesión](../frontend/src/components/SessionDialog.jsx) · [Prueba de teclado y contraste](../tests/confirmacion.spec.js) · [Tarea 7](tarea-7.md)

El puntaje de Lighthouse resume los controles automáticos sobre los estados muestreados. Queda pendiente una evaluación con lector de pantalla. [Accesibilidad en Chrome DevTools](https://developer.chrome.com/docs/devtools/accessibility/reference)
