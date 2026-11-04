import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export const URL_APP = 'http://localhost:5173';
export const CLAVE = 'StudyMatch123!';
export const nombreUnico = (texto) => `[E2E] ${texto} ${randomUUID()}`;

// Acciones compartidas: siempre se utilizan los formularios de la aplicación.
export async function registrar(page) {
  const correo = `e2e-${randomUUID()}@example.com`;
  await page.goto(`${URL_APP}/register`);
  await page.getByLabel('Nombres', { exact: true }).fill('Prueba');
  await page.getByLabel('Apellidos', { exact: true }).fill('Automatica');
  await page.getByLabel('Correo Electrónico', { exact: true }).fill(correo);
  await page.getByLabel('Contraseña', { exact: true }).fill(CLAVE);
  await page.getByLabel('Confirmar Contraseña', { exact: true }).fill(CLAVE);
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await expect(page).toHaveURL(`${URL_APP}/dashboard`);
  return correo;
}

export async function ingresar(page, correo, clave = CLAVE) {
  await page.goto(`${URL_APP}/login`);
  await page.getByLabel('Correo electrónico').fill(correo);
  await page.getByLabel('Contraseña', { exact: true }).fill(clave);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(`${URL_APP}/dashboard`);
}

export async function salir(page) {
  await page.getByRole('button', { name: /^(?:🚪\s*)?Cerrar sesión$/ }).click();
  await page.getByRole('button', { name: 'Sí, cerrar sesión', exact: true }).click();
  await expect(page).toHaveURL(/^http:\/\/localhost:5173\/(?:login)?$/);
  await page.goto(`${URL_APP}/dashboard`);
  await expect(page).toHaveURL(`${URL_APP}/login`);
}

export async function buscar(page, nombre) {
  // La búsqueda espera 300 ms antes de consultar: esperamos su respuesta, sin pausas fijas.
  const respuesta = page.waitForResponse(res => {
    const url = new URL(res.url());
    return url.pathname === '/sessions/' && url.searchParams.get('search') === nombre && res.request().method() === 'GET' && res.ok();
  });
  await page.getByPlaceholder('Buscar sesiones por nombre...').fill(nombre);
  await (await respuesta).finished();
  await expect(page.getByRole('heading', { name: nombre, exact: true })).toBeVisible();
}

export async function crearSesion(page, nombre = nombreUnico('Sesion'), cupos = '3') {
  // Fecha futura en hora local, para que el recorrido no venza con el calendario.
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + 7);
  const fechaISO = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
  await page.getByRole('button', { name: '+ Crear Sesión', exact: true }).click();
  await page.getByLabel('Nombre de la Sesión', { exact: true }).fill(nombre);
  await page.getByLabel('Materia asociada', { exact: true }).selectOption('Programación II');
  await page.getByLabel('Fecha', { exact: true }).fill(fechaISO);
  await page.getByLabel('Cupos disponibles', { exact: true }).fill(cupos);
  await page.getByRole('button', { name: '💾 Guardar', exact: true }).click();
  await buscar(page, nombre);
  await expect(page.getByRole('button', { name: /Editar/, exact: false })).toHaveCount(1);
  return nombre;
}
