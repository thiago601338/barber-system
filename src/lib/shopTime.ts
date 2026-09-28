/** Calendar dates and appointment times belong to the shop's timezone, not the viewer's device. */
export function shopDateKey(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function shopToday(timezone: string): string { return shopDateKey(new Date(), timezone) }

export function shiftCalendarDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

export function shopClock(value: unknown, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(String(value)))
}

export function shopDateTime(value: unknown, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(String(value)))
}

/** First instant of a shop calendar day, including days with a DST change. */
export function shopDayStartUtc(day: string, timezone: string): string {
  const [year, month, date] = day.split('-').map(Number)
  const nominal = Date.UTC(year, month - 1, date)
  let before = nominal - 36 * 60 * 60 * 1000
  let after = nominal + 36 * 60 * 60 * 1000
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2)
    if (shopDateKey(new Date(middle), timezone) < day) before = middle
    else after = middle
  }
  return new Date(after).toISOString()
}

export function shopMonthStart(timezone: string, offset = 0): string {
  const date = new Date(`${shopToday(timezone)}T12:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + offset, 1)
  return date.toISOString().slice(0, 10)
}

export function shopMonthEnd(timezone: string, offset = 0): string {
  const date = new Date(`${shopToday(timezone)}T12:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + offset + 1, 0)
  return date.toISOString().slice(0, 10)
}

export function shopWeekStart(timezone: string, offset = 0): string {
  const date = new Date(`${shopToday(timezone)}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + offset * 7)
  return date.toISOString().slice(0, 10)
}
