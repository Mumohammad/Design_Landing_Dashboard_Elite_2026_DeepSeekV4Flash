// src/lib/payroll/wps-generator.ts
// v2.0 M4 — Saudi Wage Protection System (WPS) SIF file format.
// Reference: SAMA WPS Technical Specification.
// Generates a pipe-delimited SIF file for upload to the bank/WPS portal.

import { decimalRound, sumMoneyValues } from "@/lib/accounting/decimal"
import { businessDateKey } from "@/lib/formatting/business-date"

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

function requiredField(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim() || /[|\r\n]/.test(value)) {
    throw new Error(`Invalid WPS ${label}.`)
  }
  return value
}

function formatPeriod(periodLabel: string): string {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(periodLabel)) throw new Error("Invalid payroll period.")
  return periodLabel.replace("-", "")
}

function formatDate(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(value)
  if (!match) throw new Error("Invalid WPS payment date.")
  const [, day, time, offset] = match
  const midnight = new Date(`${day}T00:00:00Z`)
  // Date parsing rolls dates such as February 30 forward into March.
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== day) {
    throw new Error("Invalid WPS payment date.")
  }
  if (!time) return day.replace(/-/g, "")
  const instant = new Date(`${day}T${time}${offset ?? "+03:00"}`)
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid WPS payment date.")
  return businessDateKey(instant).replace(/-/g, "")
}

function finiteValue(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`Invalid WPS ${label}.`)
  return value
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
  const netAmounts = payments.map(p => decimalRound(p.net_payroll).toFixed(2))
  const header = [
    "H",
    requiredField(company.mol_reference, "MOL reference"),
    formatPeriod(periodLabel),
    payments.length.toString().padStart(6, "0"),
    sumMoneyValues(netAmounts).toFixed(2),
    "01", // file version
  ].join("|")

  // Detail records
  const records = payments
    .map((p, index) => {
      return [
        "D",
        requiredField(p.driver.iqama_number, "iqama number"),
        requiredField(p.driver.full_name_ar.replace(/[|\r\n]/g, ""), "beneficiary name"),
        requiredField(p.iban, "IBAN"),
        getSaudiBankCode(p.iban),
        netAmounts[index],
        finiteValue(p.base_amount, "base amount").toFixed(2),
        finiteValue(p.housing_allowance, "housing allowance").toFixed(2),
        finiteValue(p.other_allowances, "other allowances").toFixed(2),
        finiteValue(p.total_deductions, "deductions").toFixed(2),
        formatDate(p.paid_at),
        finiteValue(p.working_days_actual, "working days").toString(),
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
  const period = formatPeriod(periodLabel)
  const timestamp = Date.now().toString().slice(-6)
  return `SIF-${period}-${timestamp}.txt`
}
