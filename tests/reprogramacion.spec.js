import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { registrar, crearSesion, buscar } from './apoyo.js';

test('Reprogramar, reservar dos cupos, reconfirmar y promover al primero en espera', async ({ browser }) => {
  test.setTimeout(120000);
  const contexts = [];
  const evidence = resolve('evidencias/tarea-7/reprogramacion');
  await mkdir(evidence, { recursive: true });
  try {
    // Cada persona utiliza una cuenta y un navegador independientes.
    for (let i = 0; i < 4; i++) contexts.push(await browser.newContext());
    const [organizador, estudiante1, estudiante2, suplente] = await Promise.all(contexts.map(context => context.newPage()));
    await registrar(organizador);
    const nombre = await crearSesion(organizador, `Repaso de Programación ${Date.now()}`, '2');
    const correo1 = await registrar(estudiante1);
    const correo2 = await registrar(estudiante2);
    const correoSuplente = await registrar(suplente);

    const solicitar = async (page) => {
      await buscar(page, nombre);
      await page.getByRole('button', { name: 'Solicitar Inscribirme', exact: true }).click();
      await page.getByRole('button', { name: 'Enviar solicitud', exact: true }).click();
      await expect(page.getByText('Estado: Pendiente de aprobación', { exact: true })).toBeVisible();
    };
    const aprobar = async (correo, estado) => {
      await organizador.getByRole('button', { name: 'Gestionar solicitudes', exact: true }).click();
      const fila = organizador.getByRole('listitem', { name: `Solicitud de ${correo}`, exact: true });
      await fila.getByRole('button', { name: 'Aceptar', exact: true }).click();
      await expect(fila.getByText(estado, { exact: true })).toBeVisible();
      await organizador.getByRole('button', { name: 'Cerrar solicitudes', exact: true }).click();
    };
    const recargar = async (page) => {
      await page.reload();
      await buscar(page, nombre);
    };

    await solicitar(estudiante1);
    await aprobar(correo1, 'Estado: Confirmado');
    await estudiante2.reload();
    await solicitar(estudiante2);
    await aprobar(correo2, 'Estado: Confirmado');
    await suplente.reload();
    await solicitar(suplente);
    await aprobar(correoSuplente, 'Estado: En espera · posición 1');

    await organizador.getByRole('button', { name: 'Reprogramar sesión', exact: true }).click();
    const dialogo = organizador.getByRole('dialog', { name: 'Reprogramar sesión', exact: true });
    const nuevaFecha = new Date();
    nuevaFecha.setDate(nuevaFecha.getDate() + 8);
    const fecha = `${nuevaFecha.getFullYear()}-${String(nuevaFecha.getMonth() + 1).padStart(2, '0')}-${String(nuevaFecha.getDate()).padStart(2, '0')}`;
    await dialogo.getByLabel('Nueva fecha', { exact: true }).fill(fecha);
    await dialogo.getByLabel('Nueva hora', { exact: true }).fill('19:00');
    await dialogo.getByLabel('Motivo del cambio', { exact: true }).fill('El aula estará disponible a partir de las 19:00.');
    await dialogo.getByRole('button', { name: 'Guardar reprogramación', exact: true }).click();
    await expect(dialogo).toBeHidden();
    const aviso = organizador.getByRole('region', { name: 'Cambio de fecha', exact: true });
    await expect(aviso.getByText(/^Nuevo ·.*19:00$/)).toBeVisible();
    await expect(aviso.getByText('El aula estará disponible a partir de las 19:00.', { exact: true })).toBeVisible();
    await expect(organizador.getByText('2 respuestas pendientes', { exact: true })).toBeVisible();
    await expect(organizador.getByText('2 / 2', { exact: true })).toBeVisible();

    // Se comprueba el bloqueo también después de volver a abrir la pantalla.
    await organizador.getByRole('button', { name: 'Reprogramar sesión', exact: true }).click();
    await expect(dialogo.getByRole('button', { name: 'Guardar reprogramación', exact: true })).toBeDisabled();
    await dialogo.screenshot({ path: resolve(evidence, '01-organizador-pendientes.png'), animations: 'disabled' });
    await dialogo.getByRole('button', { name: 'Cerrar reprogramación', exact: true }).click();

    for (const estudiante of [estudiante1, estudiante2]) {
      await recargar(estudiante);
      await expect(estudiante.getByText('Pendiente de reconfirmación. Tu cupo está reservado.', { exact: true })).toBeVisible();
      await expect(estudiante.getByText('2 / 2', { exact: true })).toBeVisible();
    }
    await estudiante1.locator('.session-card').screenshot({ path: resolve(evidence, '02-cupo-reservado.png'), animations: 'disabled' });
    await recargar(suplente);
    await expect(suplente.getByText('Estado: En espera · posición 1', { exact: true })).toBeVisible();

    await estudiante1.getByRole('button', { name: 'Confirmar asistencia', exact: true }).click();
    await expect(estudiante1.getByText('Estado: Confirmado', { exact: true })).toBeVisible();
    await recargar(organizador);
    await expect(organizador.getByText('1 respuesta pendiente', { exact: true })).toBeVisible();
    await expect(organizador.getByText('2 / 2', { exact: true })).toBeVisible();

    await estudiante2.getByRole('button', { name: 'Retirarme', exact: true }).click();
    await expect(estudiante2.getByText('Estado: Saliste de la sesión', { exact: true })).toBeVisible();
    await recargar(suplente);
    await expect(suplente.getByText('Estado: Confirmado', { exact: true })).toBeVisible();
    await expect(suplente.getByText('2 / 2', { exact: true })).toBeVisible();
    await expect(suplente.getByRole('button', { name: 'Confirmar asistencia', exact: true })).toHaveCount(0);
    await suplente.locator('.session-card').screenshot({ path: resolve(evidence, '03-primero-en-espera-confirmado.png'), animations: 'disabled' });

    await recargar(organizador);
    await expect(organizador.getByText('0 respuestas pendientes', { exact: true })).toBeVisible();
    await organizador.getByRole('button', { name: 'Reprogramar sesión', exact: true }).click();
    await expect(dialogo.getByRole('button', { name: 'Guardar reprogramación', exact: true })).toBeEnabled();
    const historial = dialogo.getByRole('region', { name: 'Historial de reprogramaciones', exact: true });
    await expect(historial.getByText('Prueba Automatica · confirmada', { exact: true })).toBeVisible();
    await expect(historial.getByText('Prueba Automatica · retirada', { exact: true })).toBeVisible();
    await historial.screenshot({ path: resolve(evidence, '04-respuestas-resueltas.png'), animations: 'disabled' });
    await dialogo.getByRole('button', { name: 'Cerrar reprogramación', exact: true }).click();
    await organizador.getByRole('button', { name: 'Alternar tema claro/oscuro', exact: true }).click();
    await organizador.setViewportSize({ width: 390, height: 844 });
    await organizador.getByRole('button', { name: 'Reprogramar sesión', exact: true }).click();
    await expect(dialogo.getByLabel('Nueva hora', { exact: true })).toHaveValue('19:00:00');
    await dialogo.screenshot({ path: resolve(evidence, '05-reprogramar-movil-oscuro.png'), animations: 'disabled' });
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
  }
});
