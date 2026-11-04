import { test, expect } from '@playwright/test';
import { URL_APP, CLAVE, registrar, ingresar, salir, nombreUnico } from './apoyo.js';

test('Registro: crear una cuenta, recargar e ingresar nuevamente', async ({ page }) => {
  const correo = await registrar(page);
  await page.reload();
  await expect(page).toHaveURL(`${URL_APP}/dashboard`);
  await expect(page.getByRole('button', { name: '+ Crear Sesión', exact: true })).toBeVisible();
  await salir(page);
  await ingresar(page, correo);
});

test('Registro: rechazar confirmaciones de contraseña diferentes', async ({ page }) => {
  await page.goto(`${URL_APP}/register`);
  await page.getByLabel('Nombres', { exact: true }).fill('Prueba');
  await page.getByLabel('Apellidos', { exact: true }).fill('Automatica');
  await page.getByLabel('Correo Electrónico', { exact: true }).fill('prueba@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill(CLAVE);
  await page.getByLabel('Confirmar Contraseña', { exact: true }).fill('OtraClave123!');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await expect(page.getByText('Las contraseñas no coinciden', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(`${URL_APP}/register`);
});

for (const ruta of ['dashboard', 'profile', 'historial']) {
  test(`Acceso: /${ruta} redirige al login sin autenticar`, async ({ page }) => {
    await page.goto(`${URL_APP}/${ruta}`);
    await expect(page).toHaveURL(`${URL_APP}/login`);
    await expect(page.getByRole('heading', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  });
}

test('Cerrar sesión: cancelar conserva el acceso y confirmar lo termina', async ({ page }) => {
  await registrar(page);
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page).toHaveURL(`${URL_APP}/dashboard`);
  await salir(page);
  await page.goto(`${URL_APP}/dashboard`);
  await expect(page).toHaveURL(`${URL_APP}/login`);
});

test('Recuperación: un correo inexistente muestra un error', async ({ page }) => {
  await page.goto(`${URL_APP}/forgot-password`);
  await page.getByLabel('Correo Electrónico').fill(`${nombreUnico('sin-cuenta').replace(/[^a-z0-9-]/gi, '')}@example.com`);
  await page.getByRole('button', { name: 'Enviar código de verificación', exact: true }).click();
  await expect(page.getByText('No existe una cuenta registrada con ese correo electrónico', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recuperar contraseña', exact: true })).toBeVisible();
});
