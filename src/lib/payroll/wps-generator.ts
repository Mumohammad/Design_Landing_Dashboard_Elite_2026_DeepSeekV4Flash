// src/lib/payroll/wps-generator.ts
// v2.0 M4 — Saudi Wage Protection System (WPS) SIF file format.
// Reference: SAMA WPS Technical Specification.
// Generates a pipe-delimited SIF file for upload to the bank/WPS portal.

export interface WPSPaymentRecord {
  driver: {
    iqama_number: string
    full_name_ar: string
  }
  iban: string
  net_payroll: number
  base_amount: number
  housing_allowance: number
  other_allowances: number
  total_deductions: number
  paid_at: string  // ISO date
  working_days_actual: number
}

export interface CompanyProfile {
  mol_reference: string  // Ministry of Labour reference
  iban: string
}

function getSaudiBankCode(iban: string): string {
  // Saudi IBAN: SA + 2 check digits + 2-digit bank code + BBAN
  // Bank code is at positions 4-5 (0-indexed)
  if (iban.length < 6) return "9999"
  const bankCode2Digit = iban.slice(4, 6)
  const bankCodes: Record<string, string> = {
    "10": "1010", // Al-Rajhi Bank
    "20": "1020", // Saudi National Bank (SNB / NCB)
    "30": "1030", // RIYAD Bank
    "40": "1040", // Saudi British Bank (SABB)
    "50": "1050", // Saudi Fransi
    "60": "1060", // Arab National Bank
    "80": "1080", // Al-Jazira
    "90": "1090", // Alinma Bank
  }
  return bankCodes[bankCode2Digit] ?? "9999" // 9999 = unknown
}

function escapePipe(text: string): string {
  return text.replace(/\|/g, "")
}

function formatDate(dateStr: string): string {
  // SIF expects YYYYMMDD
  try {
    const d = new Date(dateStr)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}${m}${day}`
  } catch {
    return "00000000"
  }
}

export function generateWPSSIF(
  payments: WPSPaymentRecord[],
  company: CompanyProfile,
  periodLabel: string // "YYYY-MM"
): string {
  if (payments.length === 0) {
    throw new Error("Cannot generate SIF file: no payment records")
  }

  // Header record
  const totalNet = payments.reduce((s, p) => s + p.net_payroll, 0)
  const header = [
    "H",
    company.mol_reference,
    periodLabel.replace("-", ""),
    payments.length.toString().padStart(6, "0"),
    totalNet.toFixed(2),
    "01", // file version
  ].join("|")

  // Detail records
  const records = payments
    .map((p) => {
      return [
        "D",
        p.driver.iqama_number,
        escapePipe(p.driver.full_name_ar),
        p.iban,
        getSaudiBankCode(p.iban),
        p.net_payroll.toFixed(2),
        p.base_amount.toFixed(2),
        p.housing_allowance.toFixed(2),
        p.other_allowances.toFixed(2),
        p.total_deductions.toFixed(2),
        formatDate(p.paid_at),
        p.working_days_actual.toString(),
        "682", // SAR ISO 4217 numeric
        "01", // Payment method: IBAN transfer
      ].join("|")
    })
    .join("\n")

  // Trailer record
  const trailer = ["T", payments.length.toString()].join("|")

  return [header, records, trailer].join("\n")
}

export function generateSIFFileName(periodLabel: string): string {
  // Standard naming: SIF-YYYYMM-NNNNNN.txt
  const period = periodLabel.replace("-", "")
  const timestamp = Date.now().toString().slice(-6)
  return `SIF-${period}-${timestamp}.txt`
}
