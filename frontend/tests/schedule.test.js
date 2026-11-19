import { afterEach, expect, test, vi } from 'vitest'
import { formatSchedule, todayInBolivia } from '../src/utils/schedule'

afterEach(() => vi.useRealTimers())

test('muestra la fecha en español y omite los segundos de la hora', () => {
  expect(formatSchedule('2026-11-18', '15:08:30')).toBe('18 de noviembre de 2026 · 15:08')
  expect(formatSchedule('2026-11-18', null)).toBe('18 de noviembre de 2026')
})

test('el día cambia a medianoche en Bolivia', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-18T03:59:59Z'))
  expect(todayInBolivia()).toBe('2026-11-17')
  vi.setSystemTime(new Date('2026-11-18T04:00:00Z'))
  expect(todayInBolivia()).toBe('2026-11-18')
})
