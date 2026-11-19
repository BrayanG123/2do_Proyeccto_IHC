// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import api from '../src/api/axios'
import Analytics from '../src/pages/Analytics'
import { ThemeProvider } from '../src/context/ThemeContext'

vi.mock('../src/api/axios', () => ({ default: { get: vi.fn() } }))

beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)

function showPanel() {
  render(<MemoryRouter><ThemeProvider><Analytics /></ThemeProvider></MemoryRouter>)
}

function funnel(id, label, total, finished) {
  const lost = total - finished
  return {
    id, label, empty_results: null, blockers: [],
    steps: [
      { event: `${id}_inicio`, label: 'Inicio', count: total, lost: 0, drop_rate: null },
      { event: `${id}_fin`, label: 'Finalización', count: finished, lost, drop_rate: total ? lost / total * 100 : 0 },
    ],
  }
}

test('desempata por intentos perdidos y muestra bloqueos, búsquedas vacías y eventos', async () => {
  const search = funnel('busqueda', 'Buscar sesión', 8, 4)
  search.empty_results = 3
  search.blockers = [{ reason: 'validacion_fallida', count: 2 }]
  api.get.mockResolvedValueOnce({ data: {
    funnels: [funnel('acceso', 'Acceso', 4, 2), search, funnel('registro', 'Registro', 2, 2)],
    recent_events: [
      { id: 1, event: 'bloqueo_busqueda', reason: 'permiso_denegado', created_at: '2026-11-19T01:12:30Z' },
      { id: 2, event: 'crear_sesion', modality: 'Virtual', created_at: '2026-11-19T01:13:30Z' },
      { id: 3, event: 'listar', created_at: '2026-11-19T01:14:30Z' },
    ],
  } })
  showPanel()
  expect(screen.getByRole('button', { name: 'Cargando…' }).disabled).toBe(true)
  const largest = await screen.findByRole('region', { name: 'Mayor caída observada' })
  expect(largest.textContent).toContain('Buscar sesión')
  expect(largest.textContent).toContain('4 de 8 intentos')
  const result = screen.getByRole('article', { name: 'Buscar sesión' })
  expect(within(result).getByText('Validación fallida')).toBeTruthy()
  expect(result.textContent).toMatch(/Sin resultados · 3/)
  const events = screen.getByRole('table', { name: 'Hora de Bolivia' })
  expect(within(events).getByText('Permiso denegado')).toBeTruthy()
  expect(within(events).getByText('Virtual')).toBeTruthy()
  expect(within(events).getByText('—')).toBeTruthy()
})

test('una carga fallida se puede repetir y el panel distingue un embudo sin intentos', async () => {
  api.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
    data: { funnels: [funnel('acceso', 'Acceso', 0, 0)], recent_events: [] },
  })
  showPanel()
  expect((await screen.findByRole('alert')).textContent).toMatch(/No se pudo cargar la analítica/)
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar panel' }))
  expect(await screen.findByText('Sin intentos registrados.')).toBeTruthy()
  expect(screen.getByText('Aún no hay eventos registrados.')).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'Mayor caída observada' })).toBeNull()
  expect(api.get.mock.calls).toEqual([['/analytics/funnels'], ['/analytics/funnels']])
})
