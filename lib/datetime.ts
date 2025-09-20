const RELATIVE_DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

export function formatRelativeTimestamp(isoString: string, locale: string): string {
  if (!isoString) {
    return "";
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  const now = Date.now();
  let diffInSeconds = (date.getTime() - now) / 1000;
  let unit: Intl.RelativeTimeFormatUnit = "second";

  for (const division of RELATIVE_DIVISIONS) {
    if (Math.abs(diffInSeconds) < division.amount) {
      unit = division.unit;
      break;
    }
    diffInSeconds /= division.amount;
  }

  const formatter = new Intl.RelativeTimeFormat(locale || "en", { numeric: "auto" });
  const formatted = formatter.format(Math.round(diffInSeconds), unit);
  if (locale?.startsWith("zh")) {
    return formatted.replace(/秒钟/g, "秒");
  }
  return formatted;
}

export function formatFullTimestamp(isoString: string, locale: string): string {
  if (!isoString) {
    return "";
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  try {
    return date.toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "medium",
    });
  } catch {
    return date.toISOString();
  }
}
