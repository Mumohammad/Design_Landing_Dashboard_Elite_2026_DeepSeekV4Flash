import { describe, expect, it } from "vitest"
import {
  ALLOWED_EVENT_TRANSITIONS,
  eventKpiBucket,
  isEventTransitionAllowed,
  odometerSparkline,
  todayIsoDate,
  vehicleReleaseTarget,
} from "./module-utils"

describe("maintenance event terminal-state guard", () => {
  it("allows open → in_progress/completed/cancelled", () => {
    expect(ALLOWED_EVENT_TRANSITIONS.open).toEqual(["in_progress", "completed", "cancelled"])
    expect(isEventTransitionAllowed("open", "in_progress")).toBe(true)
    expect(isEventTransitionAllowed("open", "completed")).toBe(true)
    expect(isEventTransitionAllowed("open", "cancelled")).toBe(true)
  })

  it("allows in_progress → completed/cancelled only", () => {
    expect(isEventTransitionAllowed("in_progress", "completed")).toBe(true)
    expect(isEventTransitionAllowed("in_progress", "cancelled")).toBe(true)
    expect(isEventTransitionAllowed("in_progress", "open")).toBe(false)
  })

  it("treats completed and cancelled as terminal", () => {
    expect(ALLOWED_EVENT_TRANSITIONS.completed).toEqual([])
    expect(ALLOWED_EVENT_TRANSITIONS.cancelled).toEqual([])
    expect(isEventTransitionAllowed("completed", "open")).toBe(false)
    expect(isEventTransitionAllowed("cancelled", "in_progress")).toBe(false)
    expect(isEventTransitionAllowed("completed", "completed")).toBe(false)
  })
})

describe("vehicleReleaseTarget (assignments composition)", () => {
  it("returns assigned when a live assignment exists", () => {
    expect(vehicleReleaseTarget(true)).toBe("assigned")
  })

  it("returns available when there is no current assignment", () => {
    expect(vehicleReleaseTarget(false)).toBe("available")
    expect(vehicleReleaseTarget(null)).toBe("available")
    expect(vehicleReleaseTarget(undefined)).toBe("available")
  })
})

describe("eventKpiBucket", () => {
  const now = new Date("2026-10-15T12:00:00Z")

  it("buckets by status first", () => {
    expect(eventKpiBucket("open", null, now)).toBe("open")
    expect(eventKpiBucket("in_progress", null, now)).toBe("in_progress")
  })

  it("counts completed only in the same calendar month", () => {
    expect(eventKpiBucket("completed", "2026-10-03T10:00:00Z", now)).toBe("completed_this_month")
    expect(eventKpiBucket("completed", "2026-09-30T23:59:59Z", now)).toBe("other")
    expect(eventKpiBucket("completed", "2025-10-15T00:00:00Z", now)).toBe("other")
    expect(eventKpiBucket("completed", null, now)).toBe("other")
  })

  it("buckets cancelled events as other", () => {
    expect(eventKpiBucket("cancelled", "2026-10-03T10:00:00Z", now)).toBe("other")
  })

  it("ignores malformed reported_at", () => {
    expect(eventKpiBucket("completed", "not-a-date", now)).toBe("other")
  })
})

describe("todayIsoDate", () => {
  it("renders yyyy-mm-dd", () => {
    expect(todayIsoDate(new Date("2026-10-04T09:30:00Z"))).toBe("2026-10-04")
  })
})

describe("odometerSparkline", () => {
  it("sorts ascending by recorded_at and projects readings", () => {
    expect(
      odometerSparkline([
        { reading: 300, recorded_at: "2026-03-01T00:00:00Z" },
        { reading: 100, recorded_at: "2026-01-01T00:00:00Z" },
        { reading: 200, recorded_at: "2026-02-01T00:00:00Z" },
      ])
    ).toEqual([100, 200, 300])
  })

  it("drops non-finite readings instead of zero-filling", () => {
    expect(
      odometerSparkline([
        { reading: 100, recorded_at: "2026-01-01T00:00:00Z" },
        { reading: NaN as unknown as number, recorded_at: "2026-02-01T00:00:00Z" },
        { reading: 200, recorded_at: "2026-03-01T00:00:00Z" },
      ])
    ).toEqual([100, 200])
  })

  it("returns empty for empty input", () => {
    expect(odometerSparkline([])).toEqual([])
  })
})
