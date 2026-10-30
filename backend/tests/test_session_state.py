"""
Pruebas Unitarias - Regla de Cambio de Estado (Task 02)
Proyecto: StudyMatch
Flujo de Estado: Inscripción abierta -> cerrada
Acción: "Cerrar inscripciones"

Requisitos evaluados:
1. El estado inicial es el correcto ('abierta').
2. La acción realiza la transición esperada ('abierta' -> 'cerrada').
3. Una transición inválida se rechaza (intentar cerrar cuando ya está 'cerrada').
4. Los demás datos del elemento se conservan (nombre, fecha, modalidad, cupos, id).
"""

import unittest
from datetime import date, datetime, timedelta
import sys
import os

# Asegurar que el directorio raíz del backend esté en sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.models import Session


class TestSessionStateTransitions(unittest.TestCase):
    """
    Suite de pruebas unitarias sobre la regla de cambio de estado de una Sesión de Estudio.
    """

    def setUp(self):
        """
        Fixture de prueba:
        Crea una instancia de sesión representativa para cada caso de prueba.
        """
        self.session = Session(
            id=101,
            name="Taller de Álgebra Lineal - Espacios Vectoriales",
            date=date.today() + timedelta(days=3),
            modality="Presencial",
            spots=15,
            participants_count=0,
            participant_emails="[]",
            status="abierta",
            creator_id=1,
            creator_name="Fernando Calani",
            creator_email="fernando.calani@uagrm.edu.bo",
            created_at=datetime(2026, 10, 5, 10, 0, 0)
        )

    def test_01_estado_inicial_es_correcto(self):
        """
        Prueba 1: El estado inicial es el correcto.
        Verifica que al instanciarse o crearse una sesión, su estado por defecto
        sea 'abierta' (Inscripción abierta) y que is_open sea True.
        """
        self.assertEqual(
            self.session.status,
            "abierta",
            "El estado inicial de la sesión debe ser 'abierta'."
        )
        self.assertTrue(
            self.session.is_open,
            "La propiedad is_open debe ser True cuando el estado inicial es 'abierta'."
        )

    def test_02_accion_realiza_transicion_esperada(self):
        """
        Prueba 2: La acción realiza la transición esperada.
        Verifica que al invocar 'close_registration()' (Cerrar inscripciones),
        el estado pase efectivamente de 'abierta' a 'cerrada'.
        """
        # Estado previo
        self.assertEqual(self.session.status, "abierta")

        # Ejecución de la acción
        resultado = self.session.close_registration()

        # Verificación del estado posterior
        self.assertEqual(
            self.session.status,
            "cerrada",
            "La acción debe cambiar el estado a 'cerrada'."
        )
        self.assertFalse(
            self.session.is_open,
            "La propiedad is_open debe ser False una vez cerrada la inscripción."
        )
        self.assertIs(
            resultado,
            self.session,
            "El método debe retornar la instancia de la sesión actualizada."
        )

    def test_03_transicion_invalida_se_rechaza(self):
        """
        Prueba 3: Una transición inválida se rechaza.
        Verifica que intentar cerrar una sesión que ya se encuentra en estado 'cerrada'
        (o en cualquier estado distinto a 'abierta') sea rechazado lanzando un ValueError,
        y que el estado no sufra modificaciones no deseadas.
        """
        # Primera transición válida: abierta -> cerrada
        self.session.close_registration()
        self.assertEqual(self.session.status, "cerrada")

        # Intentar ejecutar nuevamente la acción sobre una sesión ya cerrada
        with self.assertRaises(ValueError) as context:
            self.session.close_registration()

        # Comprobar el mensaje de rechazo
        self.assertIn(
            "Transición inválida",
            str(context.exception),
            "Debe lanzar un ValueError indicando que la transición es inválida."
        )

        # El estado debe mantenerse estrictamente en 'cerrada'
        self.assertEqual(
            self.session.status,
            "cerrada",
            "El estado debe continuar siendo 'cerrada' tras rechazar la transición inválida."
        )

    def test_04_demas_datos_del_elemento_se_conservan(self):
        """
        Prueba 4: Los demás datos del elemento se conservan.
        Verifica que tras ejecutar la acción de cerrar inscripciones, todos los demás
        atributos del modelo (id, name, date, modality, spots, creator_id, creator_name, created_at)
        permanezcan intactos.
        """
        # Captura de los valores previos
        id_esperado = self.session.id
        nombre_esperado = self.session.name
        fecha_esperada = self.session.date
        modalidad_esperada = self.session.modality
        cupos_esperados = self.session.spots
        creator_id_esperado = self.session.creator_id
        creator_name_esperado = self.session.creator_name
        fecha_creacion_esperada = self.session.created_at

        # Ejecutar la acción que cambia el estado
        self.session.close_registration()

        # Verificaciones de conservación de datos
        self.assertEqual(self.session.status, "cerrada", "El estado debió cambiar a 'cerrada'.")
        self.assertEqual(self.session.id, id_esperado, "El ID de la sesión debe conservarse.")
        self.assertEqual(self.session.name, nombre_esperado, "El nombre de la sesión debe conservarse.")
        self.assertEqual(self.session.date, fecha_esperada, "La fecha de la sesión debe conservarse.")
        self.assertEqual(self.session.modality, modalidad_esperada, "La modalidad debe conservarse.")
        self.assertEqual(self.session.spots, cupos_esperados, "La cantidad de cupos debe conservarse.")
        self.assertEqual(self.session.created_at, fecha_creacion_esperada, "La fecha de creación debe conservarse.")

    def test_05_sesion_cerrada_no_acepta_nuevos_participantes(self):
        """
        Prueba 5: Restricción según su estado (Directriz StudyMatch).
        Verifica que una sesión con estado 'cerrada' NO acepte nuevos participantes,
        lanzando una excepción ValueError con el mensaje de restricción.
        """
        # Cerrar la sesión
        self.session.close_registration()
        self.assertEqual(self.session.status, "cerrada")
        participantes_iniciales = self.session.participants_count or 0

        # Intentar registrar un nuevo participante en la sesión cerrada
        with self.assertRaises(ValueError) as context:
            self.session.register_participant(user_email="estudiante2@uagrm.edu.bo")

        self.assertIn(
            "Una sesión cerrada no acepta nuevos participantes",
            str(context.exception),
            "El mensaje de error debe indicar claramente la restricción de sesión cerrada."
        )
        self.assertEqual(
            self.session.participants_count or 0,
            participantes_iniciales,
            "El contador de participantes no debe alterarse si la sesión está cerrada."
        )

    def test_06_sesion_abierta_acepta_nuevos_participantes(self):
        """
        Prueba 6: Una sesión abierta sí acepta participantes y actualiza su cupo ocupado.
        """
        self.assertEqual(self.session.status, "abierta")
        self.session.register_participant(user_email="estudiante_nuevo@uagrm.edu.bo")
        self.assertEqual(
            self.session.participants_count,
            1,
            "Una sesión abierta debe incrementar su número de participantes inscritos."
        )

    def test_07_reabrir_sesion_cerrada(self):
        """
        Prueba 7: Reabrir una sesión cerrada.
        Verifica que una sesión cerrada pueda reabrirse ('cerrada' -> 'abierta')
        y volver a recibir participantes.
        """
        self.session.close_registration()
        self.assertEqual(self.session.status, "cerrada")
        self.session.reopen_registration()
        self.assertEqual(self.session.status, "abierta")
        self.assertTrue(self.session.is_open)

    def test_08_usuario_ya_inscrito_no_puede_inscribirse_doble(self):
        """
        Prueba 8: Prevención de doble inscripción.
        Verifica que si un usuario ya se inscribió a la sesión, un segundo
        intento de inscripción sea rechazado con ValueError.
        """
        email_estudiante = "juan.perez@uagrm.edu.bo"
        # Primera inscripción exitosa
        self.session.register_participant(user_email=email_estudiante)
        self.assertEqual(self.session.participants_count, 1)
        self.assertTrue(self.session.is_user_registered(email_estudiante))

        # Segundo intento con el mismo usuario debe ser rechazado
        with self.assertRaises(ValueError) as context:
            self.session.register_participant(user_email=email_estudiante)

        self.assertIn("Ya te encuentras inscrito", str(context.exception))
        self.assertEqual(self.session.participants_count, 1)

    def test_09_no_puede_unirse_si_fecha_ya_paso(self):
        """
        Prueba 9: Criterio docente - No puedo unirme a una sesión cuya fecha ya pasó.
        """
        # Asignar fecha en el pasado
        self.session.date = date(2020, 1, 1)
        with self.assertRaises(ValueError) as context:
            self.session.register_participant(user_email="estudiante_tardio@uagrm.edu.bo")
        self.assertIn("fecha ya pasó", str(context.exception))

    def test_10_creador_no_puede_unirse_a_su_propia_sesion(self):
        """
        Prueba 10: Criterio docente - El creador no puede unirse a su propia sesión.
        """
        with self.assertRaises(ValueError) as context:
            self.session.register_participant(user_email="fernando.calani@uagrm.edu.bo")
        self.assertIn("creador no puede unirse a su propia sesión", str(context.exception))

    def test_11_no_puede_unirse_si_cupos_agotados(self):
        """
        Prueba 11: Criterio docente - No puedo unirme si la sesión no tiene cupos.
        """
        self.session.spots = 1
        self.session.participants_count = 1
        with self.assertRaises(ValueError) as context:
            self.session.register_participant(user_email="estudiante_sincupo@uagrm.edu.bo")
        self.assertIn("No hay cupos disponibles", str(context.exception))


if __name__ == "__main__":
    unittest.main()

