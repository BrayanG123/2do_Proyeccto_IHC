import { test, expect } from '@playwright/test';
import { URL_APP, registrar, crearSesion, buscar, leerAnalitica, embudo, comprobarEventos } from './apoyo.js';

const REASON = 'El aula estará cerrada por mantenimiento.';

const cardFor = (page, name) => page.locator('.session-card').filter({
  has: page.getByRole('heading', { name, exact: true }),
});

test('El organizador cancela una sesión y los tres grupos ven el motivo en Mis solicitudes', async ({ browser }, testInfo) => {
  test.setTimeout(150000);
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
  try {
    const [owner, confirmed, pending, waiting] = await Promise.all(contexts.map(context => context.newPage()));
    await owner.setViewportSize({ width: 1280, height: 1040 });
    await registrar(owner);
    const name = 'Repaso de Programación · ' + Date.now().toString(36).slice(-6);
    const created = owner.waitForResponse(response =>
      response.url().endsWith('/sessions/') && response.request().method() === 'POST',
    );
    await crearSesion(owner, name, '1');
    const { id } = await (await created).json();
    const ownerCard = cardFor(owner, name);
    const applicants = [confirmed, pending, waiting];
    const emails = await Promise.all(applicants.map(async page => {
      const email = await registrar(page);
      await buscar(page, name);
      const card = cardFor(page, name);
      await expect(card.getByRole('button', { name: 'Cancelar sesión', exact: true })).toHaveCount(0);
      await card.getByRole('button', { name: 'Solicitar Inscribirme', exact: true }).click();
      await page.getByRole('button', { name: 'Enviar solicitud', exact: true }).click();
      await expect(card.getByText('Estado: Pendiente de aprobación', { exact: true })).toBeVisible();
      return email;
    }));

    await ownerCard.getByRole('button', { name: 'Gestionar solicitudes', exact: true }).click();
    const requests = owner.getByRole('dialog', { name: 'Solicitudes de ' + name });
    const row = index => requests.getByRole('listitem', { name: 'Solicitud de ' + emails[index] });
    await row(0).getByRole('button', { name: 'Aceptar', exact: true }).click();
    await expect(row(0)).toContainText('Estado: Confirmado');
    await expect(row(1)).toContainText('Estado: Pendiente de aprobación');
    await row(2).getByRole('button', { name: 'Aceptar', exact: true }).click();
    await expect(row(2)).toContainText('Estado: En espera');
    await requests.getByRole('button', { name: 'Cerrar solicitudes', exact: true }).click();

    const baseline = await leerAnalitica(owner);
    const cancel = ownerCard.getByRole('button', { name: 'Cancelar sesión', exact: true });
    await cancel.click();
    const dialog = owner.getByRole('dialog', { name: 'Cancelar sesión', exact: true });
    const reason = dialog.getByLabel('Motivo de cancelación', { exact: true });
    const confirmCancellation = dialog.getByRole('button', { name: 'Confirmar cancelación', exact: true });
    await confirmCancellation.click();
    await expect(reason).toBeFocused();
    expect(await reason.evaluate(field => field.validity.valueMissing)).toBe(true);
    await dialog.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(cancel).toBeFocused();

    await cancel.click();
    await reason.fill(REASON);
    await dialog.screenshot({ path: testInfo.outputPath('01-confirmar-cancelacion.png'), animations: 'disabled' });
    await confirmCancellation.click();
    await expect(dialog).toBeHidden();
    await owner.getByRole('button', { name: 'Cerrar notificación', exact: true }).click();
    await expect(ownerCard.getByText('Sesión cancelada', { exact: true })).toBeVisible();
    await expect(ownerCard.getByText(REASON, { exact: true })).toBeVisible();
    await expect(ownerCard.getByRole('button', { name: 'Registrar asistencia', exact: true })).toHaveCount(0);

    await ownerCard.getByRole('button', { name: 'Ver solicitudes', exact: true }).click();
    for (const index of [0, 1, 2]) {
      await expect(row(index)).toContainText('Estado: Cancelada');
      await expect(row(index).getByRole('button')).toHaveCount(0);
    }
    await requests.screenshot({ path: testInfo.outputPath('02-solicitudes-canceladas.png'), animations: 'disabled' });
    await requests.getByRole('button', { name: 'Cerrar solicitudes', exact: true }).click();

    for (const applicant of applicants) {
      await applicant.getByRole('link', { name: /Mis solicitudes/ }).filter({ visible: true }).click();
      await expect(applicant).toHaveURL(URL_APP + '/mis-solicitudes');
      await applicant.reload();
      const card = cardFor(applicant, name);
      await expect(card.getByText('Estado: Cancelada', { exact: true })).toBeVisible();
      await expect(card.getByText(REASON, { exact: true })).toBeVisible();
      await expect(card.getByText('Esta sesión ya no admite solicitudes ni asistencia.', { exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: /Solicitar Inscribirme|Consultar mi asistencia|Confirmar asistencia/ })).toHaveCount(0);
    }

    const cancelledCard = cardFor(confirmed, name);
    await expect(cancelledCard.getByText(REASON, { exact: true })).toBeVisible();
    await confirmed.setViewportSize({ width: 390, height: 844 });
    await confirmed.getByRole('button', { name: 'Alternar tema claro/oscuro', exact: true }).filter({ visible: true }).click();
    await cancelledCard.screenshot({ path: testInfo.outputPath('03-motivo-en-mis-solicitudes.png'), animations: 'disabled' });
    await confirmed.goto(URL_APP + '/dashboard');
    await buscar(confirmed, name);
    await expect(cancelledCard.getByRole('button', { name: 'Solicitar Inscribirme', exact: true })).toHaveCount(0);
    const token = await confirmed.evaluate(() => localStorage.getItem('token'));
    const retry = await confirmed.request.post('http://localhost:8000/sessions/' + id + '/requests', {
      headers: { Authorization: 'Bearer ' + token },
    });
    expect(retry.status()).toBe(409);
    expect((await retry.json()).detail).toBe('La sesión está cancelada.');

    await comprobarEventos(owner, baseline, { cancelar_sesion: [2, 1] });
    const analytics = await leerAnalitica(owner);
    const before = embudo(baseline, 'cancelar_sesion').steps;
    expect(embudo(analytics, 'cancelar_sesion').steps.map((step, index) => step.count - before[index].count))
      .toEqual([2, 1]);
    const validationCount = state => embudo(state, 'cancelar_sesion').blockers
      .find(item => item.reason === 'validacion_fallida')?.count ?? 0;
    expect(validationCount(analytics)).toBeGreaterThan(validationCount(baseline));
    expect(JSON.stringify(analytics)).not.toContain(REASON);
    await owner.goto(URL_APP + '/analitica');
    await expect(owner.getByRole('article', { name: 'Cancelar sesión', exact: true })).toBeVisible();
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
  }
});
