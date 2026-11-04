import { test, expect } from '@playwright/test';

test('Una contraseña incorrecta muestra un error y no permite ingresar', async ({ page }) => {
  await page.goto('http://localhost:5173/login');
  await page.getByLabel('Correo electrónico').fill('ana.demo@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill('ClaveIncorrecta123!');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();

  await expect(page.getByText('Correo o contraseña incorrectos', { exact: true })).toBeVisible();
  await expect(page).toHaveURL('http://localhost:5173/login');
});
