import { test, expect } from '@playwright/test';
import { registrar, salir, crearSesion, buscar, nombreUnico } from './apoyo.js';

// Medición de los colores CSS, componiendo fondos transparentes sobre sus padres.
async function contrastes(dialogo) {
  return dialogo.evaluate(dialog => {
    const rgba = color => color.match(/[\d.]+/g).map(Number);
    const fondo = element => {
      if (!element) return [255, 255, 255];
      const color = rgba(getComputedStyle(element).backgroundColor);
      const alpha = color[3] ?? 1;
      if (alpha === 1) return color.slice(0, 3);
      const parent = fondo(element.parentElement);
      return color.slice(0, 3).map((value, i) => value * alpha + parent[i] * (1 - alpha));
    };
    const luminancia = color => {
      const linear = color.slice(0, 3).map(value => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    return [...dialog.querySelectorAll('h3, h4, p, dt, dd, summary, button')]
      .filter(el => el.getClientRects().length && el.innerText.trim())
      .map(el => {
        const text = rgba(getComputedStyle(el).color);
        const background = fondo(el);
        const alpha = text[3] ?? 1;
        const foreground = text.slice(0, 3).map((value, i) => value * alpha + background[i] * (1 - alpha));
        const a = luminancia(foreground);
        const b = luminancia(background);
        return { texto: el.innerText, contraste: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
  });
}

for (const oscuro of [false, true]) {
  test(`Confirmación legible en modo ${oscuro ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await registrar(page);
    const nombre = oscuro ? nombreUnico('Sesion') : `Repaso de programación ${Date.now()}`;
    await crearSesion(page, nombre);
    await salir(page);
    await registrar(page);
    if (oscuro) await page.getByRole('button', { name: 'Alternar tema claro/oscuro', exact: true }).click();
    await buscar(page, nombre);
    await page.getByRole('button', { name: 'Solicitar Inscribirme', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Solicitar participar', exact: true });
    await expect(dialogo.getByRole('heading', { name: oscuro ? 'Sesión de estudio' : nombre, exact: true })).toBeVisible();
    if (oscuro) await expect(dialogo).not.toContainText('[E2E]');
    const organizador = dialogo.getByText('Organiza Prueba Automatica', { exact: true });
    await expect(organizador).not.toBeVisible();
    await dialogo.getByText('Ver más detalles', { exact: true }).click();
    await expect(organizador).toBeVisible();
    const medidas = await contrastes(dialogo);
    for (const medida of medidas) {
      expect(medida.contraste, medida.texto).toBeGreaterThanOrEqual(4.5);
    }
    console.log(`Modo ${oscuro ? 'oscuro' : 'claro'} · contraste mínimo ${Math.min(...medidas.map(item => item.contraste)).toFixed(2)} a 1`);
    await dialogo.getByRole('button', { name: 'Enviar solicitud', exact: true }).click();
    await expect(dialogo).toHaveCount(0);
    await expect(page.getByText('Estado: Pendiente de aprobación', { exact: true })).toBeVisible();
    await page.reload();
    await buscar(page, nombre);
    await expect(page.getByText('Estado: Pendiente de aprobación', { exact: true })).toBeVisible();
  });
}
