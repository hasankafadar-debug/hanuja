import { describe, expect, it } from "vitest";
import {
  addReportingDateDays,
  formatReportingDate,
  getReportingDateKey,
  reportingDayEnd,
  reportingDayStart,
  resolveReportingDateRange,
  toReportingDateOnly,
} from "../../../api/lib/reporting-time";

describe("reporting time", () => {
  it("uses the current Istanbul calendar day after local midnight", () => {
    const range = resolveReportingDateRange({
      now: new Date("2026-07-05T21:30:00.000Z"),
    });

    expect(range.fromKey).toBe("2026-06-07");
    expect(range.toKey).toBe("2026-07-06");
  });

  it("converts an Istanbul calendar day to exact UTC boundaries", () => {
    expect(reportingDayStart("2026-07-06").toISOString()).toBe(
      "2026-07-05T21:00:00.000Z",
    );
    expect(reportingDayEnd("2026-07-06").toISOString()).toBe(
      "2026-07-06T20:59:59.999Z",
    );
  });

  it("formats instants on either side of Istanbul midnight deterministically", () => {
    expect(getReportingDateKey(new Date("2026-07-05T20:59:59.999Z"))).toBe(
      "2026-07-05",
    );
    expect(getReportingDateKey(new Date("2026-07-05T21:00:00.000Z"))).toBe(
      "2026-07-06",
    );
    expect(formatReportingDate(new Date("2026-07-05T21:00:00.000Z"))).toBe(
      "06.07.2026",
    );
  });

  it("assigns orders around midnight to the correct Istanbul day and range", () => {
    const range = resolveReportingDateRange({
      from: "2026-07-06",
      to: "2026-07-06",
    });
    const orders = [
      new Date("2026-07-05T20:59:59.999Z"),
      new Date("2026-07-05T21:00:00.000Z"),
      new Date("2026-07-06T20:59:59.999Z"),
      new Date("2026-07-06T21:00:00.000Z"),
    ];

    expect(
      orders
        .filter((createdAt) => createdAt >= range.from && createdAt <= range.to)
        .map(getReportingDateKey),
    ).toEqual(["2026-07-06", "2026-07-06"]);
  });

  it("falls back for invalid inputs and normalizes reversed ranges", () => {
    const invalid = resolveReportingDateRange({
      from: "2026-02-30",
      to: "not-a-date",
      now: new Date("2026-07-05T21:30:00.000Z"),
    });
    const reversed = resolveReportingDateRange({
      from: "2026-07-10",
      to: "2026-07-06",
    });

    expect(invalid.fromKey).toBe("2026-06-07");
    expect(invalid.toKey).toBe("2026-07-06");
    expect(reversed.fromKey).toBe("2026-07-06");
    expect(reversed.toKey).toBe("2026-07-10");
  });

  it("uses calendar arithmetic and stores Istanbul date-only keys at UTC midnight", () => {
    expect(addReportingDateDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(
      toReportingDateOnly(new Date("2026-07-05T21:30:00.000Z")).toISOString(),
    ).toBe("2026-07-06T00:00:00.000Z");
  });
});
