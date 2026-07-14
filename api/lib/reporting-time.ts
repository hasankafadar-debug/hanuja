export const REPORTING_TIME_ZONE = "Europe/Istanbul";

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

type DateParts = {
  year: number;
  month: number;
  day: number;
};

export type ReportingDateRange = {
  fromKey: string;
  toKey: string;
  from: Date;
  to: Date;
};

function parseDateKey(value: string): DateParts | null {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const asUtc = Date.UTC(
    values["year"]!,
    values["month"]! - 1,
    values["day"]!,
    values["hour"]!,
    values["minute"]!,
    values["second"]!,
  );
  const instantWithoutMilliseconds = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - instantWithoutMilliseconds;
}

function zonedDateTimeToUtc(
  dateKey: string,
  time: { hour: number; minute: number; second: number; millisecond: number },
) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) throw new RangeError(`Invalid reporting date: ${dateKey}`);

  const utcGuess = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    time.hour,
    time.minute,
    time.second,
    time.millisecond,
  );
  const firstOffset = getTimeZoneOffsetMs(
    new Date(utcGuess),
    REPORTING_TIME_ZONE,
  );
  let result = utcGuess - firstOffset;
  const resolvedOffset = getTimeZoneOffsetMs(
    new Date(result),
    REPORTING_TIME_ZONE,
  );

  if (resolvedOffset !== firstOffset) {
    result = utcGuess - resolvedOffset;
  }

  return new Date(result);
}

export function isReportingDateKey(value: string | undefined): value is string {
  return Boolean(value && parseDateKey(value));
}

export function getReportingDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}

export function addReportingDateDays(dateKey: string, days: number) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) throw new RangeError(`Invalid reporting date: ${dateKey}`);

  const shifted = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day) + days * DAY_MS,
  );
  return shifted.toISOString().slice(0, 10);
}

export function reportingDayStart(dateKey: string) {
  return zonedDateTimeToUtc(dateKey, {
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
}

export function reportingDayEnd(dateKey: string) {
  return zonedDateTimeToUtc(dateKey, {
    hour: 23,
    minute: 59,
    second: 59,
    millisecond: 999,
  });
}

export function resolveReportingDateRange(
  params: {
    from?: string | undefined;
    to?: string | undefined;
    now?: Date;
    days?: number;
  } = {},
): ReportingDateRange {
  const now = params.now ?? new Date();
  const days = Math.max(1, Math.trunc(params.days ?? 30));
  const defaultToKey = getReportingDateKey(now);
  const defaultFromKey = addReportingDateDays(defaultToKey, -(days - 1));
  let fromKey = isReportingDateKey(params.from) ? params.from : defaultFromKey;
  let toKey = isReportingDateKey(params.to) ? params.to : defaultToKey;

  if (fromKey > toKey) {
    [fromKey, toKey] = [toKey, fromKey];
  }

  return {
    fromKey,
    toKey,
    from: reportingDayStart(fromKey),
    to: reportingDayEnd(toKey),
  };
}

export function formatReportingDate(
  date: Date,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  },
) {
  return new Intl.DateTimeFormat("tr-TR", {
    ...options,
    timeZone: REPORTING_TIME_ZONE,
  }).format(date);
}

export function toReportingDateOnly(date: Date) {
  return new Date(`${getReportingDateKey(date)}T00:00:00.000Z`);
}
