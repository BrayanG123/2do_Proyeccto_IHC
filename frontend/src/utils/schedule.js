export function formatSchedule(date, time) {
  const formattedDate = new Date(`${date}T00:00:00`).toLocaleDateString('es-BO', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  return time ? `${formattedDate} · ${time.slice(0, 5)}` : formattedDate
}
