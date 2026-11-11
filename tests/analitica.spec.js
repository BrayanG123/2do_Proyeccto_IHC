import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { URL_APP, registrar, crearSesion, buscar } from './apoyo.js';

test('Dos inicios y un envío real se reflejan en el panel y persisten al recargar', async ({ browser }) => {
  test.setTimeout(120000);
  const ownerContext = await browser.newContext();
  const studentContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const owner = await ownerContext.newPage();
    const student = await studentContext.newPage();
    await registrar(owner);
    const name = await crearSesion(owner, `Repaso para analítica ${Date.now()}`);
    await registrar(student);
    await buscar(student, name);
    const token = await student.evaluate(() => localStorage.getItem('token'));
    const baselineResponse = await student.request.get('http://localhost:8000/analytics/summary', { headers: { Authorization: `Bearer ${token}` } });
    expect(baselineResponse.ok()).toBeTruthy();
    const baseline = await baselineResponse.json();

    // Cada apertura se registra una vez. La primera se abandona.
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = student.waitForResponse(response => response.url().endsWith('/analytics/start') && response.request().method() === 'POST');
      await student.getByRole('button', { name: 'Solicitar Inscribirme', exact: true }).click();
      const response = await started;
      expect(response.status()).toBe(201);
      const event = await response.json();
      expect(event.event).toBe('solicitud_iniciada');
      expect(Object.keys(event).sort()).toEqual(['created_at', 'event', 'id', 'modality']);
      if (attempt === 0) await student.getByRole('button', { name: 'Cancelar', exact: true }).click();
    }
    await student.getByRole('button', { name: 'Enviar solicitud', exact: true }).click();
    await expect(student.getByText('Estado: Pendiente de aprobación', { exact: true })).toBeVisible();
    await student.goto(`${URL_APP}/analitica`);
    await expect(student.getByTestId('started-count')).toHaveText(String(baseline.iniciadas + 2));
    await expect(student.getByTestId('sent-count')).toHaveText(String(baseline.enviadas + 1));
    const percentage = Math.round((baseline.enviadas + 1) * 10000 / (baseline.iniciadas + 2)) / 100;
    await expect(student.getByTestId('completion-rate')).toHaveText(`${percentage} %`);
    await expect(student.getByRole('cell', { name: 'solicitud_enviada', exact: true }).first()).toBeVisible();
    await student.reload();
    await expect(student.getByTestId('started-count')).toHaveText(String(baseline.iniciadas + 2));
    await mkdir(resolve('evidencias/clase-21'), { recursive: true });
    await student.screenshot({ path: resolve('evidencias/clase-21/panel-escritorio.png'), fullPage: true, animations: 'disabled' });
    await student.setViewportSize({ width: 390, height: 844 });
    await student.getByRole('button', { name: 'Alternar tema claro/oscuro', exact: true }).click();
    await student.screenshot({ path: resolve('evidencias/clase-21/panel-movil-oscuro.png'), fullPage: true, animations: 'disabled' });
  } finally {
    await Promise.allSettled([ownerContext.close(), studentContext.close()]);
  }
});

test('La analítica exige iniciar sesión y sus errores permiten reintentar', async ({ page }) => {
  const unauthenticated = await page.request.get('http://localhost:8000/analytics/summary');
  expect(unauthenticated.status()).toBe(401);
  await page.goto(`${URL_APP}/analitica`);
  await expect(page).toHaveURL(`${URL_APP}/login`);
  await registrar(page);
  await page.route('**/analytics/summary', route => route.fulfill({ status: 503, json: { detail: 'Fallo simulado' } }));
  await page.goto(`${URL_APP}/analitica`);
  await expect(page.getByRole('alert')).toHaveText('No se pudo cargar la analítica. Intenta actualizar el panel.');
  await page.unroute('**/analytics/summary');
  await page.getByRole('button', { name: 'Actualizar panel', exact: true }).click();
  await expect(page.getByTestId('started-count')).toBeVisible();
});
