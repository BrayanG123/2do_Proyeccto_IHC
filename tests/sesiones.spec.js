import { test, expect } from '@playwright/test';
import { URL_APP, registrar, crearSesion, buscar, nombreUnico, salir } from './apoyo.js';

test.beforeEach(async ({ page }) => { await registrar(page); });

test('Crear sesión: los campos vacíos impiden guardar', async ({ page }) => {
  await page.getByRole('button', { name: '+ Crear Sesión', exact: true }).click();
  await page.getByRole('button', { name: '💾 Guardar', exact: true }).click();
  await expect(page.getByLabel('Nombre de la Sesión', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Nombre de la Sesión', { exact: true })).toBeFocused();
  expect(await page.getByLabel('Nombre de la Sesión', { exact: true }).evaluate(campo => campo.validity.valueMissing)).toBe(true);
});

test('Buscar: mostrar estado vacío y restablecer filtros', async ({ page }) => {
  const nombre = await crearSesion(page);
  await page.getByPlaceholder('Buscar sesiones por nombre...').fill(nombreUnico('No existe'));
  await expect(page.getByRole('heading', { name: 'No se encontraron sesiones coincidentes', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Restablecer todos los filtros/ }).click();
  await expect(page.getByPlaceholder('Buscar sesiones por nombre...')).toHaveValue('');
  await expect(page.getByRole('heading', { name: nombre, exact: true })).toBeVisible();
});

test('Filtros: una sesión presencial se oculta en Virtual y vuelve en Presencial', async ({ page }) => {
  const nombre = await crearSesion(page);
  await page.getByRole('button', { name: '💻 Virtual', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No se encontraron sesiones coincidentes', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '🏫 Presencial', exact: true }).click();
  await expect(page.getByRole('heading', { name: nombre, exact: true })).toBeVisible();
});

test('Editar sesión: guardar el nombre nuevo y conservarlo al recargar', async ({ page }) => {
  await crearSesion(page);
  await page.getByRole('button', { name: /Editar/ }).click();
  const nuevoNombre = nombreUnico('Editada');
  // El formulario de edición no asocia sus etiquetas; se identifica por su texto de ayuda.
  await page.getByPlaceholder('Ej: Repaso examen final...').fill(nuevoNombre);
  await page.getByRole('button', { name: '💾 Guardar Cambios', exact: true }).click();
  await expect(page.getByRole('heading', { name: '✏️ Editar Sesión de Estudio', exact: true })).toHaveCount(0);
  await buscar(page, nuevoNombre);
  await page.reload();
  await buscar(page, nuevoNombre);
});

test('Editar sesión: cancelar conserva el nombre original', async ({ page }) => {
  const nombre = await crearSesion(page);
  await page.getByRole('button', { name: /Editar/ }).click();
  await page.getByPlaceholder('Ej: Repaso examen final...').fill('No guardar');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.reload();
  await buscar(page, nombre);
});

test('Eliminar sesión: cancelar conserva la sesión y confirmar la elimina', async ({ page }) => {
  const nombre = await crearSesion(page);
  await page.getByRole('button', { name: '🗑️ Eliminar', exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('heading', { name: nombre, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '🗑️ Eliminar', exact: true }).click();
  await page.getByRole('button', { name: 'Sí, Eliminar', exact: true }).click();
  await expect(page.getByRole('heading', { name: nombre, exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByPlaceholder('Buscar sesiones por nombre...').fill(nombre);
  await expect(page.getByRole('heading', { name: 'No se encontraron sesiones coincidentes', exact: true })).toBeVisible();
});

test('Cerrar inscripciones: persiste el estado y otro usuario no puede solicitar unirse', async ({ page }) => {
  const nombre = await crearSesion(page);
  await page.getByRole('button', { name: /Cerrar inscripciones/ }).click();
  await expect(page.getByText('🔒 Cerrada', { exact: true })).toBeVisible();
  await page.reload();
  await buscar(page, nombre);
  await expect(page.getByText('🔒 Cerrada', { exact: true })).toBeVisible();
  await salir(page);
  await registrar(page);
  await buscar(page, nombre);
  await expect(page.getByRole('button', { name: '⛔ Inscripción cerrada', exact: true })).toBeDisabled();
});

test('Solicitar unirse: cancelar no envía y confirmar muestra la solicitud enviada', async ({ page }) => {
  const nombre = await crearSesion(page);
  await salir(page);
  await registrar(page);
  await buscar(page, nombre);
  await page.getByRole('button', { name: 'Solicitar Inscribirme', exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirmar inscripción a sesión', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Solicitar Inscribirme', exact: true }).click();
  await page.getByRole('button', { name: '✅ Enviar Solicitud', exact: true }).click();
  await expect(page.getByText(`Solicitud enviada para "${nombre}". Espera la respuesta del organizador.`, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Confirmar inscripción a sesión', exact: true })).toHaveCount(0);
});

test('Solicitar unirse: una solicitud pendiente impide volver a enviar y persiste', async ({ page }) => {
  const nombre = await crearSesion(page);
  await salir(page);
  await registrar(page);
  await buscar(page, nombre);
  await page.getByRole('button', { name: 'Solicitar Inscribirme', exact: true }).click();
  await page.getByRole('button', { name: '✅ Enviar Solicitud', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirmar inscripción a sesión', exact: true })).toHaveCount(0);
  await expect(page.getByText('Estado: Pendiente de aprobación', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Solicitud registrada', exact: true })).toBeDisabled();
  await page.reload();
  await buscar(page, nombre);
  await expect(page.getByText('Estado: Pendiente de aprobación', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Solicitar Inscribirme', exact: true })).toHaveCount(0);
});
