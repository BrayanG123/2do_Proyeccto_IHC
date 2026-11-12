from dataclasses import dataclass


@dataclass(frozen=True)
class Funnel:
    label: str
    steps: tuple[tuple[str, str], ...]
    public: bool = False


FUNNELS = {
    'registro': Funnel('Crear cuenta', (
        ('registro_iniciado', 'Registro iniciado'), ('cuenta_creada', 'Cuenta creada'),
    ), public=True),
    'acceso': Funnel('Iniciar sesión', (
        ('acceso_iniciado', 'Intento iniciado'), ('acceso_concedido', 'Acceso concedido'),
    ), public=True),
    'recuperar_acceso': Funnel('Recuperar acceso', (
        ('recuperacion_iniciada', 'Recuperación iniciada'), ('codigo_enviado', 'Código solicitado'),
        ('codigo_verificado', 'Código verificado'), ('acceso_recuperado', 'Acceso recuperado'),
    ), public=True),
    'buscar_sesiones': Funnel('Buscar y filtrar sesiones', (
        ('busqueda_iniciada', 'Búsqueda o filtro aplicado'), ('busqueda_con_resultados', 'Con resultados'),
    )),
    'filtrar_historial': Funnel('Filtrar historial', (
        ('historial_filtro_aplicado', 'Filtro aplicado'), ('historial_con_resultados', 'Con resultados'),
    )),
    'crear_sesion': Funnel('Crear sesión de estudio', (
        ('creacion_iniciada', 'Formulario abierto'), ('sesion_creada', 'Sesión guardada'),
    )),
    'solicitar_unirse': Funnel('Solicitar participación', (
        ('solicitud_iniciada', 'Solicitud iniciada'), ('solicitud_enviada', 'Solicitud enviada'),
    )),
    'gestionar_solicitudes': Funnel('Gestionar solicitudes y lista de espera', (
        ('gestion_iniciada', 'Gestión iniciada'), ('decision_guardada', 'Decisión guardada'),
    )),
    'editar_sesion': Funnel('Editar sesión', (
        ('edicion_iniciada', 'Edición iniciada'), ('sesion_editada', 'Edición guardada'),
    )),
    'cerrar_inscripciones': Funnel('Cerrar inscripciones', (
        ('cierre_iniciado', 'Cierre iniciado'), ('inscripciones_cerradas', 'Inscripciones cerradas'),
    )),
    'retirarse': Funnel('Retirarse de una sesión', (
        ('retiro_iniciado', 'Retiro iniciado'), ('participacion_retirada', 'Participación retirada'),
    )),
    'reprogramar': Funnel('Reprogramar sesión', (
        ('reprogramacion_iniciada', 'Formulario abierto'), ('reprogramacion_guardada', 'Reprogramación guardada'),
    )),
    'reconfirmar': Funnel('Reconfirmar participación', (
        ('reconfirmacion_iniciada', 'Reconfirmación iniciada'), ('participacion_reconfirmada', 'Participación reconfirmada'),
    )),
    'finalizar_sesion': Funnel('Finalizar sesión para tomar asistencia', (
        ('finalizacion_iniciada', 'Asistencia abierta'), ('sesion_finalizada', 'Sesión finalizada'),
    )),
    'registrar_asistencia': Funnel('Marcar asistencia', (
        ('marca_iniciada', 'Registro iniciado'), ('asistencia_registrada', 'Marca confirmada'),
    )),
    'enviar_justificacion': Funnel('Justificar ausencia', (
        ('justificacion_iniciada', 'Justificación iniciada'), ('justificacion_enviada', 'Justificación enviada'),
    )),
    'resolver_justificacion': Funnel('Resolver justificación', (
        ('resolucion_iniciada', 'Resolución iniciada'), ('justificacion_resuelta', 'Resolución guardada'),
    )),
    'editar_perfil': Funnel('Editar perfil', (
        ('perfil_edicion_iniciada', 'Edición iniciada'), ('perfil_actualizado', 'Perfil actualizado'),
    )),
    'eliminar_sesion': Funnel('Eliminar sesión', (
        ('eliminacion_iniciada', 'Confirmación abierta'), ('sesion_eliminada', 'Sesión eliminada'),
    )),
    'cancelar_sesion': Funnel('Cancelar sesión', (
        ('cancelacion_iniciada', 'Cancelación iniciada'), ('sesion_cancelada', 'Sesión cancelada'),
    )),
}

BLOCKING_REASONS = {
    400: 'validacion_fallida',
    401: 'acceso_denegado',
    403: 'permiso_denegado',
    404: 'recurso_no_disponible',
    409: 'estado_incompatible',
    422: 'validacion_fallida',
    429: 'limite_de_intentos',
    503: 'servicio_no_disponible',
}

SEARCH_EVENTS = {
    'buscar_sesiones': ('busqueda_con_resultados', 'busqueda_sin_resultados'),
    'filtrar_historial': ('historial_con_resultados', 'historial_sin_resultados'),
}

EVENT_NAMES = (
    *(event for funnel in FUNNELS.values() for event, _ in funnel.steps),
    *(f'{flow}_bloqueo' for flow in FUNNELS),
    *(empty_event for _, empty_event in SEARCH_EVENTS.values()),
)

EVENT_CHECK = 'event IN (' + ', '.join(f"'{event}'" for event in EVENT_NAMES) + ')'
REASON_CHECK = 'reason IN (' + ', '.join(f"'{reason}'" for reason in sorted(set(BLOCKING_REASONS.values()))) + ')'
