type LocalDateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsAt(date: Date, timeZone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function localMidnightToUtc(year: number, month: number, day: number, timeZone: string): Date {
  const localAsUtc = Date.UTC(year, month - 1, day);
  let candidate = localAsUtc;
  // A second pass handles offset changes close to midnight without a timezone dependency.
  for (let pass = 0; pass < 2; pass += 1) {
    const actual = partsAt(new Date(candidate), timeZone);
    const representedAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    candidate += localAsUtc - representedAsUtc;
  }
  return new Date(candidate);
}

export function zonedDayBounds(now: Date, timeZone: string): { startUtc: Date; endUtc: Date } {
  const current = partsAt(now, timeZone);
  const nextDate = new Date(Date.UTC(current.year, current.month - 1, current.day + 1));
  return {
    startUtc: localMidnightToUtc(current.year, current.month, current.day, timeZone),
    endUtc: localMidnightToUtc(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate(), timeZone),
  };
}
