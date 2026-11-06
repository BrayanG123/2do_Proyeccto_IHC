import { test, expect } from '@playwright/test';
import { URL_APP, registrar, crearSesion, buscar } from './apoyo.js';

test('Mis solicitudes muestra una sesión confirmada y llena aunque antes hubiera otros filtros', async ({ browser }) => {
  test.setTimeout(90000);
  const organizerContext = await browser.newContext();
  const studentContext = await browser.newContext();
  try {
    const organizer = await organizerContext.newPage();
    const student = await studentContext.newPage();
    await registrar(organizer);
    const requestedName = await crearSesion(organizer, `Repaso solicitado ${Date.now()}`, '1');
    const otherName = await crearSesion(organizer, `Otra sesión ${Date.now()}`, '2');
    const email = await registrar(student);
    await buscar(student, requestedName);
    await student.getByRole('button', { name: 'Solicitar Inscribirme', exact: true }).click();
    await student.getByRole('button', { name: 'Enviar solicitud', exact: true }).click();
    await expect(student.getByText('Estado: Pendiente de aprobación', { exact: true })).toBeVisible();
    await student.getByRole('link', { name: /Mis solicitudes/ }).filter({ visible: true }).click();
    await expect(student.getByRole('heading', { name: 'Mis solicitudes', exact: true, level: 1 })).toBeVisible();
    await expect(student.locator('.session-card')).toHaveCount(1);
    await expect(student.getByText('Estado: Pendiente de aprobación', { exact: true })).toBeVisible();

    await buscar(organizer, requestedName);
    await organizer.getByRole('button', { name: 'Gestionar solicitudes', exact: true }).click();
    const request = organizer.getByRole('listitem', { name: `Solicitud de ${email}`, exact: true });
    await request.getByRole('button', { name: 'Aceptar', exact: true }).click();
    await expect(request.getByText('Estado: Confirmado', { exact: true })).toBeVisible();

    await student.goto(`${URL_APP}/dashboard`);
    await buscar(student, otherName);
    await student.getByRole('checkbox', { name: /Solo disponibles/ }).check();
    await student.getByRole('link', { name: /Mis solicitudes/ }).filter({ visible: true }).click();
    await expect(student.locator('.session-card')).toHaveCount(1);
    await expect(student.getByRole('heading', { name: requestedName, exact: true })).toBeVisible();
    await expect(student.getByText('Estado: Confirmado', { exact: true })).toBeVisible();
    await expect(student.getByText('1 / 1', { exact: true })).toBeVisible();
    await expect(student.getByRole('heading', { name: otherName, exact: true })).toHaveCount(0);
    await student.reload();
    await expect(student.getByText('Estado: Confirmado', { exact: true })).toBeVisible();

    // La acción existente continúa disponible dentro de esta sección.
    await student.getByRole('button', { name: 'Salir de la sesión', exact: true }).click();
    await expect(student.getByText('Estado: Saliste de la sesión', { exact: true })).toBeVisible();
    await student.setViewportSize({ width: 390, height: 844 });
    await student.getByRole('link', { name: /Historial/ }).filter({ visible: true }).click();
    await student.getByRole('link', { name: 'Mis solicitudes', exact: true }).filter({ visible: true }).click();
    await expect(student.getByText('Estado: Saliste de la sesión', { exact: true })).toBeVisible();
  } finally {
    await Promise.allSettled([organizerContext.close(), studentContext.close()]);
  }
});

test('Mis solicitudes protege el acceso y ofrece buscar sesiones cuando la cuenta está vacía', async ({ page }) => {
  await page.goto(`${URL_APP}/mis-solicitudes`);
  await expect(page).toHaveURL(`${URL_APP}/login`);
  await registrar(page);
  await page.getByRole('link', { name: /Mis solicitudes/ }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { name: 'Aún no has enviado solicitudes', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Buscar sesiones', exact: true }).click();
  await expect(page).toHaveURL(`${URL_APP}/dashboard#sesiones`);
  await expect(page.getByPlaceholder('Buscar sesiones por nombre...')).toBeVisible();
});
