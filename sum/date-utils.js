const DAY_MS = 86_400_000;

export function koreaInputDate(offsetDays = 0, referenceDate = new Date()) {
  const referenceTime = referenceDate instanceof Date ? referenceDate.getTime() : new Date(referenceDate).getTime();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(referenceTime + offsetDays * DAY_MS));
}
