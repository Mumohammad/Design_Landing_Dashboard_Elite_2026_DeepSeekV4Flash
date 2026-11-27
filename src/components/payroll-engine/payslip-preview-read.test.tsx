import { beforeEach, describe, expect, it, vi } from "vitest"

const reads = vi.hoisted(() => ({ payslips: vi.fn(), company: vi.fn() }))
vi.mock("@/lib/payroll-engine/server/read-actions", () => ({ getDriverPayslips: reads.payslips, getPayslipCompany: reads.company }))

import { readDriverPayslipPreview } from "./driver-payslips-tab"

const company = { nameAr: "شركة الاختبار", nameEn: "Synthetic company" }

beforeEach(() => {
  vi.resetAllMocks()
  reads.payslips.mockResolvedValue({ success: true, data: [] })
  reads.company.mockResolvedValue({ success: true, data: company })
})

describe("printable driver payslip reads", () => {
  it("waits for confirmed tenant identity even when the rows have already loaded", async () => {
    let resolveCompany!: (value: unknown) => void
    reads.company.mockReturnValue(new Promise(resolve => { resolveCompany = resolve }))
    let settled = false
    const pending = readDriverPayslipPreview("synthetic-driver").then(result => { settled = true; return result })
    await Promise.resolve()
    expect(settled).toBe(false)
    resolveCompany({ success: true, data: company })
    expect(await pending).toEqual({ success: true, rows: [], company })
    expect(reads.payslips).toHaveBeenCalledWith("synthetic-driver")
  })

  it("fails closed if company details fail, rather than rendering empty tenant branding", async () => {
    reads.company.mockResolvedValue({ success: false, error: "Company read failed" })
    const result = await readDriverPayslipPreview("synthetic-driver")
    expect(result).toEqual({ success: false, error: "Company read failed", source: "company" })
    expect(result).not.toHaveProperty("rows")
    expect(result).not.toHaveProperty("company")
  })

  it("does not treat a company without a printable name as ready", async () => {
    reads.company.mockResolvedValue({ success: true, data: { nameAr: " ", nameEn: "" } })
    expect(await readDriverPayslipPreview("synthetic-driver")).toEqual({ success: false, error: "", source: "company" })
  })

  it("fails closed if the payslip read fails, even with confirmed company details", async () => {
    reads.payslips.mockResolvedValue({ success: false, error: "PAY_READ_FORBIDDEN" })
    expect(await readDriverPayslipPreview("synthetic-driver")).toEqual({ success: false, error: "PAY_READ_FORBIDDEN", source: "payslips" })
  })

  it.each(["payslips", "company"] as const)("settles %s network rejection as a retryable failure without exposing transport details", async source => {
    reads[source].mockRejectedValue(new Error("private transport detail"))
    const result = await readDriverPayslipPreview("synthetic-driver")
    expect(result).toEqual({ success: false, error: "", source: "network" })
    expect(JSON.stringify(result)).not.toContain("private transport detail")
  })
})
