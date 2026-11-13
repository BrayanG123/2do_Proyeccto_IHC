import { test, expect } from '@playwright/test';

test('Los avisos de cupos disponibles solo aparecen en sesiones abiertas y vigentes', async ({ page }, testInfo) => {
  const date = offset => {
    const day = new Date();
    day.setDate(day.getDate() + offset);
    return [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')].join('-');
  };
  const session = (id, name, changes = {}) => ({
    id, name, date: date(7), time: null, status: 'abierta', modality: 'Virtual',
    spots: 3, participants_count: 2, participant_emails: [], creator_id: 2,
    creator_email: 'organizador@example.com', creator_name: 'Organizador', ...changes,
  });
  const sessions = [
    session(1, 'Sesión próxima'),
    session(2, 'Sesión pasada', { date: date(-1) }),
    session(3, 'Sesión finalizada', { finished_at: new Date().toISOString() }),
    session(4, 'Sesión con dos cupos pasada', { date: date(-1), participants_count: 1 }),
    session(5, 'Sesión cerrada', { status: 'cerrada' }),
    session(6, 'Sesión llena', { participants_count: 3 }),
  ];
  await page.addInitScript(() => {
    localStorage.setItem('token', 'prueba');
    localStorage.setItem('user', JSON.stringify({ id: 1, first_name: 'Prueba', email: 'prueba@example.com' }));
  });
  await page.route('http://localhost:8000/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/sessions/') return route.fulfill({ json: sessions });
    if (path === '/sessions/cancellations/me') return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  await page.goto('http://localhost:5173/dashboard');
  const card = name => page.locator('.session-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(card('Sesión pasada')).toBeVisible();
  await card('Sesión pasada').screenshot({ path: testInfo.outputPath('tarjeta.png'), animations: 'disabled' });
  await expect(card('Sesión próxima').getByText('¡Último cupo disponible!', { exact: false })).toBeVisible();
  for (const name of ['Sesión pasada', 'Sesión finalizada', 'Sesión con dos cupos pasada', 'Sesión cerrada', 'Sesión llena']) {
    await expect(card(name).getByText(/último cupo disponible|cupos libres/i)).toHaveCount(0);
  }
});
