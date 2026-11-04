import { test, expect } from '@playwright/test';
import { URL_APP, registrar, crearSesion } from './apoyo.js';

test('Historial vacío: orientar al usuario hacia las sesiones', async ({ page }) => {
  await registrar(page);
  await page.goto(`${URL_APP}/historial`);
  await expect(page.getByRole('heading', { name: 'Aún no tienes actividad en StudyMatch', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Buscar sesiones/ }).click();
  await expect(page).toHaveURL(`${URL_APP}/dashboard#sesiones`);
});

test('Historial: mostrar la creación, consultar detalle, filtrar y recargar', async ({ page }) => {
  await registrar(page);
  const nombre = await crearSesion(page);
  await page.goto(`${URL_APP}/historial`);
  await expect(page.getByText(nombre, { exact: true })).toBeVisible();
  await page.getByRole('button').filter({ has: page.getByText(nombre, { exact: true }) }).click();
  await expect(page.getByText('Fecha de la sesión', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Organicé/ }).click();
  await expect(page.getByText(nombre, { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Me uní/ }).click();
  await expect(page.getByRole('heading', { name: 'Todavía no te uniste a ninguna sesión', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(nombre, { exact: true })).toBeVisible();
});

test('Tema: alternar oscuro y claro y conservar la elección al recargar', async ({ page }) => {
  await page.goto(`${URL_APP}/login`);
  const boton = page.getByRole('button', { name: 'Alternar tema claro/oscuro', exact: true });
  await expect(boton).toHaveAttribute('title', 'Cambiar a modo oscuro');
  await boton.click();
  await expect(boton).toHaveAttribute('title', 'Cambiar a modo claro');
  await page.reload();
  await expect(boton).toHaveAttribute('title', 'Cambiar a modo claro');
  await boton.click();
  await expect(boton).toHaveAttribute('title', 'Cambiar a modo oscuro');
});
