import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { URL_APP, registrar, crearSesion, buscar } from './apoyo.js';

// Datos reproducibles mediante los formularios reales y cuentas propias de cada prueba.
async function prepareSession(organizer, students) {
  await registrar(organizer);
  const created = organizer.waitForResponse(response => response.url().endsWith('/sessions/') && response.request().method() === 'POST');
  const name = await crearSesion(organizer, `Repaso con asistencia ${Date.now()}`, '2', 0);
  const session = await (await created).json();
  const members = [];
  for (const student of students) {
    const email = await registrar(student);
    await buscar(student, name);
    await student.getByRole('button', { name: 'Solicitar Inscribirme', exact: true }).click();
    await student.getByRole('button', { name: 'Enviar solicitud', exact: true }).click();
    await expect(student.getByText('Estado: Pendiente de aprobación', { exact: true })).toBeVisible();
    await organizer.getByRole('button', { name: 'Gestionar solicitudes', exact: true }).click();
    const row = organizer.getByRole('listitem', { name: `Solicitud de ${email}`, exact: true });
    await row.getByRole('button', { name: 'Aceptar', exact: true }).click();
    await expect(row.getByText('Estado: Confirmado', { exact: true })).toBeVisible();
    await organizer.getByRole('button', { name: 'Cerrar solicitudes', exact: true }).click();
    const id = await student.evaluate(() => JSON.parse(localStorage.getItem('user')).id);
    members.push({ email, id });
  }
  await organizer.getByRole('button', { name: 'Registrar asistencia', exact: true }).click();
  await organizer.getByRole('button', { name: 'Finalizar sesión y registrar asistencia', exact: true }).click();
  await expect(organizer.getByText('Asistencia · Sin registrar', { exact: true })).toHaveCount(students.length);
  return { session, name, members };
}

test('Asistencia completa con presentes, ausencia, justificación aceptada e historial persistente', async ({ browser }) => {
  test.setTimeout(120000);
  const contexts = await Promise.all([1, 2, 3].map(() => browser.newContext({ viewport: { width: 1280, height: 900 } })));
  const evidence = resolve('evidencias/tarea-8');
  await mkdir(evidence, { recursive: true });
  try {
    const [organizer, present, absent] = await Promise.all(contexts.map(context => context.newPage()));
    const { name, members } = await prepareSession(organizer, [present, absent]);
    const attendance = organizer.getByRole('dialog', { name: 'Asistencia y justificaciones', exact: true });
    const presentRow = attendance.getByRole('listitem', { name: `Asistencia de ${members[0].email}`, exact: true });
    const absentRow = attendance.getByRole('listitem', { name: `Asistencia de ${members[1].email}`, exact: true });
    await presentRow.getByRole('button', { name: 'Marcar presente', exact: true }).click();
    await expect(presentRow.getByText('Asistencia · Presente', { exact: true })).toBeVisible();
    await absentRow.getByRole('button', { name: 'Marcar ausente', exact: true }).click();
    await expect(absentRow.getByText('Asistencia · Ausente', { exact: true })).toBeVisible();
    await attendance.screenshot({ path: resolve(evidence, '01-presentes-y-ausentes.png'), animations: 'disabled' });

    for (const student of [present, absent]) {
      await student.getByRole('link', { name: /Mis solicitudes/ }).filter({ visible: true }).click();
      await student.getByRole('button', { name: 'Consultar mi asistencia', exact: true }).click();
      await expect(student.getByRole('listitem', { name: /^Asistencia de/ })).toHaveCount(1);
    }
    await expect(present.getByText('Asistencia · Presente', { exact: true })).toBeVisible();
    await expect(present.getByRole('button', { name: 'Enviar justificación', exact: true })).toHaveCount(0);
    await absent.getByLabel('Justifica tu ausencia', { exact: true }).fill('Tuve una consulta médica durante el encuentro.');
    await absent.getByRole('button', { name: 'Enviar justificación', exact: true }).click();
    await expect(absent.getByText('Justificación · Pendiente de revisión', { exact: true })).toBeVisible();
    await absent.getByRole('dialog').screenshot({ path: resolve(evidence, '02-justificacion-pendiente.png'), animations: 'disabled' });

    await attendance.getByRole('button', { name: 'Cerrar asistencia', exact: true }).click();
    await organizer.reload();
    await buscar(organizer, name);
    await organizer.getByRole('button', { name: 'Registrar asistencia', exact: true }).click();
    await absentRow.getByLabel('Motivo de la resolución', { exact: true }).fill('Se acepta la justificación por la consulta médica.');
    await absentRow.getByRole('button', { name: 'Aceptar justificación', exact: true }).click();
    await expect(absentRow.getByText('Justificación · Aceptada', { exact: true })).toBeVisible();
    await expect(absentRow.getByRole('button', { name: 'Marcar presente', exact: true })).toBeDisabled();
    await absentRow.getByText('Historial de cambios', { exact: true }).click();
    await expect(absentRow.locator('.attendance-history > li')).toHaveCount(3);
    await absentRow.locator('details').screenshot({ path: resolve(evidence, '03-historial-de-cambios.png'), animations: 'disabled' });

    await absent.reload();
    await absent.getByRole('button', { name: 'Consultar mi asistencia', exact: true }).click();
    await expect(absent.getByText('Justificación · Aceptada', { exact: true })).toBeVisible();
    await expect(absent.getByText('Motivo de la resolución · Se acepta la justificación por la consulta médica.', { exact: true })).toBeVisible();
    await absent.getByRole('button', { name: 'Cerrar asistencia', exact: true }).click();
    await absent.setViewportSize({ width: 390, height: 844 });
    await absent.getByRole('button', { name: 'Alternar tema claro/oscuro', exact: true }).filter({ visible: true }).click();
    await absent.getByRole('button', { name: 'Consultar mi asistencia', exact: true }).click();
    await absent.getByRole('dialog').screenshot({ path: resolve(evidence, '04-resultado-movil-oscuro.png'), animations: 'disabled' });
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
  }
});

test('Un usuario ajeno y un participante no pueden modificar la asistencia del organizador', async ({ browser }) => {
  test.setTimeout(90000);
  const contexts = await Promise.all([1, 2, 3].map(() => browser.newContext()));
  try {
    const [organizer, member, outsider] = await Promise.all(contexts.map(context => context.newPage()));
    const { session, name, members } = await prepareSession(organizer, [member]);
    const row = organizer.getByRole('listitem', { name: `Asistencia de ${members[0].email}`, exact: true });
    await row.getByRole('button', { name: 'Marcar presente', exact: true }).click();
    await expect(row.getByText('Asistencia · Presente', { exact: true })).toBeVisible();
    await registrar(outsider);
    await buscar(outsider, name);
    await expect(outsider.getByRole('button', { name: 'Registrar asistencia', exact: true })).toHaveCount(0);
    await expect(outsider.getByRole('button', { name: 'Consultar mi asistencia', exact: true })).toHaveCount(0);
    for (const actor of [outsider, member]) {
      const token = await actor.evaluate(() => localStorage.getItem('token'));
      const response = await actor.request.patch(`http://localhost:8000/sessions/${session.id}/attendance/${members[0].id}`, {
        headers: { Authorization: `Bearer ${token}` }, data: { status: 'ausente' },
      });
      expect(response.status()).toBe(403);
      expect((await response.json()).detail).toBe('Solo el organizador puede realizar esta acción.');
    }
    await mkdir(resolve('evidencias/tarea-8'), { recursive: true });
    await outsider.locator('.session-card').screenshot({ path: resolve('evidencias/tarea-8/05-usuario-ajeno.png'), animations: 'disabled' });
    await organizer.getByRole('button', { name: 'Cerrar asistencia', exact: true }).click();
    await organizer.reload();
    await buscar(organizer, name);
    await organizer.getByRole('button', { name: 'Registrar asistencia', exact: true }).click();
    await expect(row.getByText('Asistencia · Presente', { exact: true })).toBeVisible();
    await row.getByText('Historial de cambios', { exact: true }).click();
    await expect(row.locator('.attendance-history > li')).toHaveCount(1);
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
  }
});
