import { describe, expect, it } from "vitest"

import {
  ACTION_META,
  AUDIT_PAGE_SIZE_DEFAULT,
  AUDIT_PAGE_SIZE_MAX,
  MODULE_META,
  auditToCsv,
  collectSensitiveStrings,
  dateRangeBounds,
  entityDrillHref,
  maskAuditMetadata,
  prettyMetadata,
} from "./audit-utils"

describe("maskAuditMetadata", () => {
  const payload = {
    driver_code: "DRV-ABC123",
    changed: ["status"],
    primary_mobile: "0551234567",
    iqama_number: "2234567890",
    nested: {
      iban: "SA0380000000608010167519",
      full_name_ar: "سائق تجريبي",
      deeper: { email: "driver@example.com", note: "ok" },
    },
    list: [{ passport_number: "P1234567" }, { note: "fine" }],
  }

  it("masks sensitive keys when consent is absent", () => {
    const masked = maskAuditMetadata(payload, false)
    expect(masked).not.toBeNull()
    const m = masked as Record<string, unknown>
    expect(m.driver_code).toBe("DRV-ABC123")
    expect(m.primary_mobile).toBe("••••••")
    expect(m.iqama_number).toBe("••••••")
    expect((m.nested as Record<string, unknown>).iban).toBe("••••••")
    expect((m.nested as Record<string, unknown>).full_name_ar).toBe("سائق تجريبي")
    const deeper = ((m.nested as Record<string, unknown>).deeper ?? {}) as Record<string, unknown>
    expect(deeper.email).toBe("••••••")
    expect(deeper.note).toBe("ok")
    const list = m.list as Record<string, unknown>[]
    expect(list[0].passport_number).toBe("••••••")
    expect(list[1].note).toBe("fine")
  })

  it("passes values through untouched when consent is granted", () => {
    const masked = maskAuditMetadata(payload, true)
    const m = masked as Record<string, unknown>
    expect(m.primary_mobile).toBe("0551234567")
    expect((m.nested as Record<string, unknown>).iban).toBe("SA0380000000608010167519")
  })

  it("does not mutate the input payload", () => {
    const input = { phone: "0551234567", note: "x" }
    const before = JSON.stringify(input)
    maskAuditMetadata(input, false)
    expect(JSON.stringify(input)).toBe(before)
  })

  it("handles null/empty payloads", () => {
    expect(maskAuditMetadata(null, false)).toBeNull()
    expect(maskAuditMetadata(undefined, true)).toBeNull()
    expect(maskAuditMetadata({}, true)).toEqual({})
  })
})

describe("collectSensitiveStrings", () => {
  it("collects strings under sensitive keys when consent is absent", () => {
    const out = collectSensitiveStrings(
      { driver_code: "DRV-1", primary_mobile: "0551234567", nested: { email: "a@b.c" } },
      false
    )
    expect(out).toEqual(["DRV-1"])
  })

  it("collects everything when consent is granted", () => {
    const out = collectSensitiveStrings({ phone: "0551234567", code: "C1" }, true)
    expect(out.sort()).toEqual(["0551234567", "C1"])
  })

  it("returns empty for null payloads", () => {
    expect(collectSensitiveStrings(null, true)).toEqual([])
  })
})

describe("prettyMetadata", () => {
  it("masks before serialization and pretty-prints", () => {
    const s = prettyMetadata({ primary_mobile: "0551234567", status: "active" }, false)
    expect(s).toContain("••••••")
    expect(s).not.toContain("0551234567")
    expect(s).toContain('"status": "active"')
  })

  it("returns null for empty payloads", () => {
    expect(prettyMetadata({}, true)).toBeNull()
    expect(prettyMetadata(null, true)).toBeNull()
  })
})

describe("auditToCsv", () => {
  it("prepends a UTF-8 BOM and escapes RFC-4180 specials", () => {
    const csv = auditToCsv(["a", "b"], [["x,y", 'he said "hi"'], ["line1\nline2", 5]])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const body = csv.slice(1)
    expect(body.startsWith('a,b\n"x,y","he said ""hi"""\n')).toBe(true)
    // Embedded newline stays inside the quoted field.
    expect(body.endsWith('"line1\nline2",5')).toBe(true)
  })
})

describe("facets and caps", () => {
  it("covers the modules and actions observed in writeAuditLog call sites", () => {
    expect(Object.keys(MODULE_META)).toContain("drivers")
    expect(Object.keys(MODULE_META)).toContain("users")
    expect(Object.keys(MODULE_META)).toContain("accounting")
    expect(Object.keys(ACTION_META)).toContain("status_changed")
    expect(Object.keys(ACTION_META)).toContain("employee_code_assigned")
  })

  it("keeps the hard pagination caps", () => {
    expect(AUDIT_PAGE_SIZE_MAX).toBe(100)
    expect(AUDIT_PAGE_SIZE_DEFAULT).toBe(50)
  })
})

describe("entityDrillHref", () => {
  it("builds a filtered drill-down link preserving both dimensions", () => {
    const href = entityDrillHref("driver", "d1")
    expect(href.startsWith("/audit-log?")).toBe(true)
    expect(href).toContain("entityType=driver")
    expect(href).toContain("entityId=d1")
  })
})

describe("dateRangeBounds", () => {
  it("expands yyyy-mm-dd into inclusive local bounds", () => {
    expect(dateRangeBounds("2026-09-01", "2026-09-24")).toEqual({
      fromIso: "2026-09-01T00:00:00",
      toIso: "2026-09-24T23:59:59.999",
    })
  })

  it("passes null through for absent or malformed inputs", () => {
    expect(dateRangeBounds("", "2026-09-24")).toEqual({ fromIso: null, toIso: "2026-09-24T23:59:59.999" })
    expect(dateRangeBounds("not-a-date", "")).toEqual({ fromIso: null, toIso: null })
  })
})
