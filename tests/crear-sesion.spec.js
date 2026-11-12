import { test } from '@playwright/test';
import { registrar, crearSesion, buscar, leerAnalitica, comprobarEventos } from './apoyo.js';

test('Crear una sesión guarda el registro y completa su embudo', async ({ page }) => {
  await registrar(page);
  const baseline = await leerAnalitica(page);
  const nombre = await crearSesion(page);
  await page.reload();
  await buscar(page, nombre);
  await comprobarEventos(page, baseline, { crear_sesion: [1, 1] });
});
