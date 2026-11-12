import { test, expect } from '@playwright/test';
import { URL_APP, registrar, crearSesion, buscar, leerAnalitica, embudo, comprobarEventos } from './apoyo.js';

test('Dos inicios y un envío real se reflejan en el panel y persisten al recargar', async ({ browser }, testInfo) => {
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
    const baseline = await leerAnalitica(student);

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
    await comprobarEventos(student, baseline, { solicitar_unirse: [2, 1] });
    const waitForPanel = () => student.waitForResponse(response => response.url().endsWith('/analytics/funnels') && response.ok());
    const loaded = waitForPanel();
    await student.goto(`${URL_APP}/analitica`);
    const [started, sent] = embudo(await (await loaded).json(), 'solicitar_unirse').steps;
    const formatter = new Intl.NumberFormat('es-BO');
    await expect(student.getByTestId('solicitud_iniciada')).toHaveText(formatter.format(started.count));
    await expect(student.getByTestId('solicitud_enviada')).toHaveText(formatter.format(sent.count));
    await expect(student.getByTestId('drop-solicitud_enviada')).toHaveText(
      `Caída de ${formatter.format(sent.drop_rate)} % · ${formatter.format(sent.lost)} sin avanzar`,
    );
    await expect(student.getByRole('table')).toBeVisible();
    const reloaded = waitForPanel();
    await student.reload();
    const [persisted] = embudo(await (await reloaded).json(), 'solicitar_unirse').steps;
    expect(persisted.count).toBeGreaterThanOrEqual(started.count);
    await expect(student.getByTestId('solicitud_iniciada')).toHaveText(formatter.format(persisted.count));
    await student.screenshot({ path: testInfo.outputPath('panel-escritorio.png'), animations: 'disabled' });
    await student.setViewportSize({ width: 390, height: 844 });
    await student.getByRole('button', { name: 'Alternar tema claro/oscuro', exact: true }).click();
    await student.getByRole('article', { name: 'Solicitar participación' }).screenshot({
      path: testInfo.outputPath('panel-movil-oscuro.png'), animations: 'disabled',
    });
  } finally {
    await Promise.allSettled([ownerContext.close(), studentContext.close()]);
  }
});

test('La analítica exige iniciar sesión y sus errores permiten reintentar', async ({ page }) => {
  const unauthenticated = await page.request.get('http://localhost:8000/analytics/funnels');
  expect(unauthenticated.status()).toBe(401);
  await page.goto(`${URL_APP}/analitica`);
  await expect(page).toHaveURL(`${URL_APP}/login`);
  await registrar(page);
  await page.route('**/analytics/funnels', route => route.fulfill({ status: 503, json: { detail: 'Fallo simulado' } }));
  await page.goto(`${URL_APP}/analitica`);
  await expect(page.getByRole('alert')).toHaveText('No se pudo cargar la analítica. Intenta actualizar el panel.');
  await page.unroute('**/analytics/funnels');
  await page.getByRole('button', { name: 'Actualizar panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Embudos por flujo' })).toBeVisible();
});
