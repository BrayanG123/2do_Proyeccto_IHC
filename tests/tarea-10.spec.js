import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { CLAVE, URL_APP, comprobarEventos, embudo, leerAnalitica, nombreUnico, registrar } from './apoyo.js';

const API = 'http://localhost:8000';

test('Consultar y descargar datos propios, bloquear una clave incorrecta y eliminar la cuenta', async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const contexts = await Promise.all(Array.from({ length: 5 }, () => browser.newContext()));
  try {
    const register = async context => {
      const page = await context.newPage();
      const email = await registrar(page);
      const token = await page.evaluate(() => localStorage.getItem('token'));
      return { page, email, headers: { Authorization: 'Bearer ' + token } };
    };
    const [owner, host, first, last, confirmed] = await Promise.all(contexts.map(register));
    const request = async (actor, method, path, data, expected) => {
      const response = await actor.page.request.fetch(API + path, { method, data, headers: actor.headers });
      expect(response.status(), path).toBe(expected);
      return expected === 204 ? null : response.json();
    };
    const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const create = (actor, name) => request(actor, 'POST', '/sessions/', {
      name: nombreUnico(name), date: future, spots: 1, modality: 'Virtual',
    }, 201);
    const own = await create(owner, 'Microeconomía');
    const other = await create(host, 'Estadística');
    const join = (actor, session) => request(actor, 'POST', `/sessions/${session.id}/requests`, undefined, 201);
    const accept = (actor, session, application) => request(
      actor, 'PATCH', `/sessions/${session.id}/requests/${application.id}`, { decision: 'aceptar' }, 200,
    );
    await accept(owner, own, await join(host, own));
    await accept(owner, own, await join(last, own));
    await join(first, own);
    await accept(host, other, await join(confirmed, other));
    for (const person of [first, owner, last]) {
      await accept(host, other, await join(person, other));
    }
    const requests = (actor, session) => request(actor, 'GET', `/sessions/${session.id}/requests`, undefined, 200);
    const queue = rows => rows.filter(row => row.status === 'en_espera')
      .sort((a, b) => a.queue_position - b.queue_position).map(row => [row.user_email, row.queue_position]);
    expect(queue(await requests(host, other))).toEqual([[first.email, 1], [owner.email, 2], [last.email, 3]]);

    const baseline = await leerAnalitica(host.page);
    await owner.page.goto(URL_APP + '/profile');
    const dataPanel = owner.page.getByRole('region', { name: 'Mis datos' });
    await dataPanel.getByRole('button', { name: 'Ver mis datos' }).click();
    await expect(dataPanel.getByText(owner.email, { exact: true })).toBeVisible();
    await expect(dataPanel.getByText('Sesiones que organizaste (1)')).toBeVisible();
    await dataPanel.screenshot({ path: testInfo.outputPath('mis-datos.png'), animations: 'disabled' });
    const downloadEvent = owner.page.waitForEvent('download');
    await dataPanel.getByRole('button', { name: 'Descargar JSON' }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('mis-datos-studymatch.json');
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    expect(exported.perfil.email).toBe(owner.email);
    expect(exported.sesiones_organizadas.map(session => session.id)).toEqual([own.id]);
    expect(exported.solicitudes).toEqual([expect.objectContaining({ session_id: other.id, status: 'en_espera' })]);
    expect(JSON.stringify(exported)).not.toMatch(/hashed_password|confirmed_email|participant_emails/);
    for (const person of [host, first, last, confirmed]) {
      expect(JSON.stringify(exported)).not.toContain(person.email);
    }
    await dataPanel.getByRole('button', { name: 'Eliminar mi cuenta' }).click();
    const dialog = owner.page.getByRole('dialog', { name: 'Eliminar cuenta' });
    const confirm = dialog.getByRole('button', { name: 'Eliminar cuenta' });
    const back = await dialog.getByRole('button', { name: 'Volver' }).boundingBox();
    const submit = await confirm.boundingBox();
    expect(Math.abs(back.width - submit.width)).toBeLessThan(1);
    expect(Math.abs(back.height - submit.height)).toBeLessThan(1);
    const password = dialog.getByLabel('Contraseña actual', { exact: true });
    await password.fill('Clave incorrecta');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toContainText('La contraseña es incorrecta');
    await dialog.screenshot({ path: testInfo.outputPath('confirmacion-y-bloqueo.png'), animations: 'disabled' });
    expect((await requests(owner, own)).map(row => row.status).sort()).toEqual(['aceptada', 'en_espera', 'pendiente']);

    await password.fill(CLAVE);
    await confirm.click();
    await expect(owner.page.getByRole('status')).toHaveText('Tu cuenta fue eliminada.');
    await expect(owner.page).toHaveURL(URL_APP + '/login');
    await request(owner, 'GET', '/auth/me/data', undefined, 404);
    await owner.page.getByLabel('Correo electrónico').fill(owner.email);
    await owner.page.getByLabel('Contraseña', { exact: true }).fill(CLAVE);
    await owner.page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await expect(owner.page.getByText('Correo o contraseña incorrectos')).toBeVisible();
    expect(queue(await requests(host, other))).toEqual([[first.email, 1], [last.email, 2]]);

    const reason = 'La persona que organizaba esta sesión eliminó su cuenta.';
    for (const person of [host, first, last]) {
      await person.page.goto(URL_APP + '/mis-solicitudes');
      const card = person.page.locator('.session-card').filter({ hasText: own.name });
      await expect(card.getByText('Estado: Cancelada', { exact: true })).toBeVisible();
      await expect(card.getByText(reason, { exact: true })).toBeVisible();
      if (person === host) {
        await card.screenshot({ path: testInfo.outputPath('sesion-cancelada.png'), animations: 'disabled' });
      }
    }
    await comprobarEventos(host.page, baseline, { descargar_datos: [1, 1], eliminar_cuenta: [1, 1] });
    const analytics = await leerAnalitica(host.page);
    const countBlocked = report => embudo(report, 'eliminar_cuenta').blockers.find(row => row.reason === 'permiso_denegado')?.count ?? 0;
    expect(countBlocked(analytics)).toBeGreaterThan(countBlocked(baseline));
    expect(JSON.stringify(analytics)).not.toContain(owner.email);
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
  }
});
