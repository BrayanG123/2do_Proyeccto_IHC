import { test, expect } from '@playwright/test';
import { URL_APP, registrar, crearSesion, buscar } from './apoyo.js';

test('Lista de espera: aprobar, esperar sin cupo, salir y promover al primero', async ({ browser }) => {
  test.setTimeout(90000);
  const contexts = [];
  try {
    // Cuatro navegadores aislados: organizador y tres estudiantes.
    for (let i = 0; i < 4; i++) contexts.push(await browser.newContext());
    const [ana, bruno, carla, diego] = await Promise.all(contexts.map(context => context.newPage()));
    await registrar(ana);
    const nombre = await crearSesion(ana, undefined, '1');
    const brunoEmail = await registrar(bruno);
    const carlaEmail = await registrar(carla);
    const diegoEmail = await registrar(diego);

    const solicitar = async (page) => {
      await buscar(page, nombre);
      await page.getByRole('button', { name: 'Solicitar Inscribirme', exact: true }).click();
      await page.getByRole('button', { name: 'Enviar solicitud', exact: true }).click();
      await expect(page.getByText('Estado: Pendiente de aprobación', { exact: true })).toBeVisible();
    };
    const aprobar = async (correo, estado) => {
      await ana.getByRole('button', { name: 'Gestionar solicitudes', exact: true }).click();
      const fila = ana.getByRole('listitem', { name: `Solicitud de ${correo}`, exact: true });
      await fila.getByRole('button', { name: 'Aceptar', exact: true }).click();
      await expect(fila.getByText(estado, { exact: true })).toBeVisible();
      await ana.getByRole('button', { name: 'Cerrar solicitudes', exact: true }).click();
    };
    await solicitar(bruno);
    await aprobar(brunoEmail, 'Estado: Confirmado');
    await bruno.reload();
    await buscar(bruno, nombre);
    await expect(bruno.getByText('Estado: Confirmado', { exact: true })).toBeVisible();

    // Una sesión llena sigue permitiendo solicitar la aprobación.
    await carla.reload();
    await solicitar(carla);
    await aprobar(carlaEmail, 'Estado: En espera · posición 1');
    await diego.reload();
    await solicitar(diego);
    await aprobar(diegoEmail, 'Estado: En espera · posición 2');
    await carla.reload();
    await buscar(carla, nombre);
    await expect(carla.getByText('Estado: En espera · posición 1', { exact: true })).toBeVisible();

    await bruno.getByRole('button', { name: 'Salir de la sesión', exact: true }).click();
    await expect(bruno.getByText('Estado: Saliste de la sesión', { exact: true })).toBeVisible();
    await carla.reload();
    await buscar(carla, nombre);
    await expect(carla.getByText('Estado: Confirmado', { exact: true })).toBeVisible();
    await expect(carla.getByText('1 / 1', { exact: true })).toBeVisible();
    await diego.reload();
    await buscar(diego, nombre);
    await expect(diego.getByText('Estado: En espera · posición 1', { exact: true })).toBeVisible();

    // La promoción también queda en el historial del estudiante confirmado.
    await carla.goto(`${URL_APP}/historial`);
    await expect(carla.getByText(nombre, { exact: true })).toBeVisible();
    await carla.getByRole('tab', { name: /Me uní/ }).click();
    await expect(carla.getByText(nombre, { exact: true })).toBeVisible();
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
