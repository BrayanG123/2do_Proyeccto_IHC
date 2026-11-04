import { test, expect } from '@playwright/test';
import { URL_APP, CLAVE, registrar, ingresar, salir } from './apoyo.js';

test.beforeEach(async ({ page }) => {
  await registrar(page);
  await page.goto(`${URL_APP}/profile`);
});

test('Perfil: guardar nombres y conservarlos al recargar', async ({ page }) => {
  await page.getByRole('button', { name: /Editar Datos/ }).click();
  await page.getByLabel('Nombres *', { exact: true }).fill('NombreEditado');
  await page.getByRole('button', { name: /Guardar Cambios/ }).click();
  await expect(page.getByText('¡Datos de perfil actualizados exitosamente!', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'NombreEditado Automatica', exact: true })).toBeVisible();
});

test('Perfil: cancelar los cambios conserva el nombre original', async ({ page }) => {
  await page.getByRole('button', { name: /Editar Datos/ }).click();
  await page.getByLabel('Nombres *', { exact: true }).fill('NoGuardar');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Prueba Automatica', exact: true })).toBeVisible();
});

test('Contraseña: cambiarla e ingresar con la nueva clave', async ({ page }) => {
  await page.getByRole('button', { name: /Editar Datos/ }).click();
  const correo = await page.getByLabel('Correo Institucional / Personal *', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByLabel('Contraseña Actual *', { exact: true }).fill(CLAVE);
  await page.getByLabel('Nueva Contraseña *', { exact: true }).fill('NuevaClave456!');
  await page.getByLabel('Confirmar Nueva Contraseña *', { exact: true }).fill('NuevaClave456!');
  await page.getByRole('button', { name: 'Actualizar Contraseña', exact: true }).click();
  await expect(page.getByText('¡Contraseña actualizada exitosamente!', { exact: true })).toBeVisible();
  await salir(page);
  await ingresar(page, correo, 'NuevaClave456!');
});

test('Contraseña: rechazar una clave actual incorrecta', async ({ page }) => {
  await page.getByLabel('Contraseña Actual *', { exact: true }).fill('Incorrecta123!');
  await page.getByLabel('Nueva Contraseña *', { exact: true }).fill('NuevaClave456!');
  await page.getByLabel('Confirmar Nueva Contraseña *', { exact: true }).fill('NuevaClave456!');
  await page.getByRole('button', { name: 'Actualizar Contraseña', exact: true }).click();
  await expect(page.getByText('La contraseña actual ingresada es incorrecta', { exact: true })).toBeVisible();
});

test('Foto de perfil: subir una imagen y quitarla', async ({ page }) => {
  const selectorArchivo = page.waitForEvent('filechooser');
  await page.getByTitle('Subir o cambiar foto de perfil', { exact: true }).click();
  const archivo = await selectorArchivo;
  await archivo.setFiles({
    name: 'avatar-prueba.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGxkAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(page.getByText('¡Foto de perfil actualizada exitosamente!', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTitle('Eliminar foto y usar iniciales', { exact: true })).toBeVisible();
  await page.getByTitle('Eliminar foto y usar iniciales', { exact: true }).click();
  await expect(page.getByText('Foto de perfil eliminada. Ahora se muestran tus iniciales.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTitle('Eliminar foto y usar iniciales', { exact: true })).toHaveCount(0);
});

test('Foto de perfil: rechazar un archivo de texto', async ({ page }) => {
  const selectorArchivo = page.waitForEvent('filechooser');
  await page.getByTitle('Subir o cambiar foto de perfil', { exact: true }).click();
  const archivo = await selectorArchivo;
  await archivo.setFiles({ name: 'no-es-imagen.txt', mimeType: 'text/plain', buffer: Buffer.from('prueba') });
  await expect(page.getByText('Debes seleccionar un archivo de imagen válido (PNG, JPG, WEBP)', { exact: true })).toBeVisible();
});
