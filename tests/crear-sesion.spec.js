import { test, expect } from '@playwright/test';



test('test', async ({ page }) => {

    const nombreSesion = `Sesion de programacion ${Date.now()}`;



  await page.goto('http://localhost:5173/');
  await page.getByRole('link', { name: 'Iniciar Sesión' }).click();
  await page.getByRole('textbox', { name: 'Correo electrónico' }).click();
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('ana.demo@example.com');
  await page.getByRole('textbox', { name: 'Contraseña' }).click();
  await page.getByRole('textbox', { name: 'Contraseña' }).fill('StudyMatch123!');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('button', { name: '+ Crear Sesión' }).click();

  await page.getByRole('textbox', { name: 'Nombre de la Sesión' }).fill(nombreSesion);


  await page.getByLabel('Materia asociada').selectOption('Programación II');
  await page.getByRole('textbox', { name: 'Fecha' }).fill('2026-10-31');
  await page.getByRole('spinbutton', { name: 'Cupos disponibles' }).click();
  await page.getByRole('spinbutton', { name: 'Cupos disponibles' }).fill('10');
  await page.getByRole('button', { name: '💾 Guardar' }).click();






  await page.getByRole('textbox', { name: 'Buscar sesiones por nombre...' }).click();
  await page.getByRole('textbox', { name: 'Buscar sesiones por nombre...' }).fill(nombreSesion);
  await expect(
    page.getByRole('heading', { name: nombreSesion, exact: true })
  ).toBeVisible();
});
