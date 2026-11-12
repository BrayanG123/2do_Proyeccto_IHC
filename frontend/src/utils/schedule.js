export function formatSchedule(date, time) {
  const formattedDate = new Date(`${date}T00:00:00`).toLocaleDateString('es-BO', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  return time ? `${formattedDate} · ${time.slice(0, 5)}` : formattedDate
}

const boliviaDate = new Intl.DateTimeFormat('en', {
  timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function todayInBolivia() {
  const parts = Object.fromEntries(boliviaDate.formatToParts().map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
