/* eslint-disable -- vendored upstream source kept byte-for-byte below the header */
// Vendored verbatim from duaa7226-collab/Payroll-Sys-2026 @ 1feaee25 (src/lib/excel-parser.ts).
// Do not edit the calculation logic here — parity is enforced by golden.test.ts.
// Excel workbook parser — accepts monthly upload (RLVL, FTR Cost, WR, Car Rental)
// Uses xlsx library. Joins by rider_id. Returns normalized driver list.
import * as XLSX from 'xlsx'
import type { RawDriverData } from './salary-engine'

export interface ParsedWorkbook {
  drivers: RawDriverData[]
  wrRow: Record<string, any> | null
  sheetNames: string[]
  warnings: string[]
  // Company/contract-level banking info (used when RLVL doesn't have per-driver banking)
  banking: {
    beneficiaryName: string
    iban: string
    bankName: string
    source: 'rlvl' | 'wr' | 'none'
  }
  // Per-driver banking info (when RLVL has banking columns)
  driverBanking: Record<string, { beneficiaryName: string; iban: string; bankName: string }>
}

// Column name normalization — strip arabic side, lowercase, snake_case
function norm(s: string): string {
  if (!s) return ''
  return String(s)
    .split(' - ')[0] // take English side if bilingual
    .replace(/Sum of /i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

function findCol(headers: string[], ...candidates: string[]): string | null {
  const normalized = headers.map(h => ({ raw: h, norm: norm(h) }))
  // Pass 1: exact match (prevents 'working_days' from matching 'fully_working_days')
  for (const cand of candidates) {
    const c = cand.toLowerCase().replace(/\s+/g, '_')
    const found = normalized.find(h => h.norm === c)
    if (found) return found.raw
  }
  // Pass 2: starts-with match (e.g., 'rider_id' matches 'rider_id - معرف')
  for (const cand of candidates) {
    const c = cand.toLowerCase().replace(/\s+/g, '_')
    const found = normalized.find(h => h.norm.startsWith(c))
    if (found) return found.raw
  }
  // Pass 2.5: For bilingual headers like "محفظة المندوب - Rider Balance",
  // the English side is AFTER the dash. Split on ' - ' and take the LAST part.
  for (const cand of candidates) {
    const c = cand.toLowerCase().replace(/\s+/g, '_')
    const found = normalized.find(h => {
      const parts = h.raw.split(' - ')
      const englishSide = parts[parts.length - 1].trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      return englishSide === c || englishSide.startsWith(c)
    })
    if (found) return found.raw
  }
  // Pass 3: fuzzy includes — try underscore and space variants
  for (const cand of candidates) {
    const cUnderscore = cand.toLowerCase().replace(/\s+/g, '_')
    const cSpace = cand.toLowerCase().replace(/_+/g, ' ')
    const found = normalized.find(h => {
      const raw = h.raw.toLowerCase()
      return raw.includes(cUnderscore) || raw.includes(cSpace)
    })
    if (found) return found.raw
  }
  return null
}

function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return isNaN(v) ? 0 : v
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? 0 : n
}

export function parseWorkbook(buffer: ArrayBuffer | Buffer | Uint8Array): ParsedWorkbook {
  // Accepts Buffer (Node) or ArrayBuffer (edge/browser) — xlsx reads both as a
  // byte array, so no copy is needed.
  const wb = XLSX.read(buffer as any, { type: 'array' })
  const warnings: string[] = []
  const sheetNames = wb.SheetNames

  // Find RLVL sheet
  const rlvlSheetName = wb.SheetNames.find(n => n.toLowerCase().includes('rlvl'))
  if (!rlvlSheetName) {
    throw new Error('RLVL sheet not found. Required sheet missing.')
  }
  // Find FTR Cost sheet — OPTIONAL (warn but don't fail if missing)
  // Match: contains 'ftr' OR contains 'cost' OR starts with 'ftr cost'
  const ftrSheetName = wb.SheetNames.find(n => {
    const lower = n.toLowerCase()
    return lower.includes('ftr') || lower.includes('cost')
  })
  if (!ftrSheetName) {
    warnings.push('FTR Cost sheet not found — driver info (working days, hours, vehicle type) will use defaults from RLVL. To get full driver metrics, add an "FTR Cost" sheet to the workbook.')
  }
  // Find WR sheet (optional but recommended)
  const wrSheetName = wb.SheetNames.find(n => n.toLowerCase() === 'wr' || n.toLowerCase().includes('wr'))

  // ====== Parse RLVL ======
  const rlvlRows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[rlvlSheetName], { defval: null })
  if (rlvlRows.length === 0) throw new Error('RLVL sheet is empty')
  const rlvlHeaders = Object.keys(rlvlRows[0])

  const riderIdCol = findCol(rlvlHeaders, 'rider_id', 'riderid')
  const nameCol = findCol(rlvlHeaders, 'name')
  const contractCol = findCol(rlvlHeaders, 'contract_name', 'contract name')
  const completedOrdersCol = findCol(rlvlHeaders, 'completed_orders')
  const cityPaymentCol = findCol(rlvlHeaders, 'city_payment')
  const basicPaymentCol = findCol(rlvlHeaders, 'basic_payment')
  const acceptanceCol = findCol(rlvlHeaders, 'acceptance_rate_penalties')
  const contactCol = findCol(rlvlHeaders, 'contact_rate_penalties')
  const stackingCol = findCol(rlvlHeaders, 'stacking_deduction')
  const declinedCol = findCol(rlvlHeaders, 'declined_penalties_day_logic', 'declined_penalties')
  const lateCol = findCol(rlvlHeaders, 'late_penalty')
  const noshowCol = findCol(rlvlHeaders, 'no_show_penalty')
  const noshowSpecialCol = findCol(rlvlHeaders, 'no_show_penalty_special_cities')
  const dailyAcceptanceCol = findCol(rlvlHeaders, 'daily_acceptance_rate_penalty')
  const distanceCol = findCol(rlvlHeaders, 'distance_payment')
  const missedDaysCol = findCol(rlvlHeaders, 'missed_days_penalty')
  const segmentCol = findCol(rlvlHeaders, 'segment_payment')
  const riderBalanceCol = findCol(rlvlHeaders, 'rider_balance', 'rider balance', 'riderbalance')
  // RLVL may also contain per-driver banking columns (preferred source per user requirement)
  const rlvlBeneficiaryCol = findCol(rlvlHeaders, 'beneficiary_name', 'beneficiary', 'beneficiary name')
  const rlvlIbanCol = findCol(rlvlHeaders, 'iban')
  const rlvlBankCol = findCol(rlvlHeaders, 'bank_name', 'bank', 'bank name')

  if (!riderIdCol) throw new Error('Cannot find rider_id column in RLVL sheet')

  // ====== Parse FTR Cost (optional — gracefully handle missing sheet) ======
  const ftrRows = ftrSheetName
    ? XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[ftrSheetName], { defval: null })
    : []
  const ftrHeaders = ftrRows.length > 0 ? Object.keys(ftrRows[0]) : []
  const ftrRiderIdCol = findCol(ftrHeaders, 'rider_id', 'riderid')
  const ftrNameCol = findCol(ftrHeaders, 'name')
  const ftrContractCol = findCol(ftrHeaders, 'contract_name', 'contract name')
  const vehicleCol = findCol(ftrHeaders, 'rider_vehicle_type', 'vehicle_type')
  const totalMonthlyHoursCol = findCol(ftrHeaders, 'total_monthly_working_hours')
  const workingHoursCol = findCol(ftrHeaders, 'working_hours')
  const fullyWorkingDaysCol = findCol(ftrHeaders, 'fully_working_days')
  const workingDaysCol = findCol(ftrHeaders, 'working_days')
  const inactiveReasonCol = findCol(ftrHeaders, 'inactive_reason')

  // Build FTR lookup by rider ID
  const ftrByRider = new Map<string, Record<string, any>>()
  for (const row of ftrRows) {
    if (!ftrRiderIdCol) continue
    const rid = String(row[ftrRiderIdCol] ?? '').trim()
    if (rid) ftrByRider.set(rid, row)
  }

  // ====== Parse WR (finance reconciliation) ======
  let wrRow: Record<string, any> | null = null
  if (wrSheetName) {
    const wrRows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wrSheetName], { defval: null })
    if (wrRows.length > 0) {
      wrRow = wrRows[0] // single aggregate row per contract
    }
  }

  // Extract WR aggregate deductions + banking info
  let wrCarDeduction = 0
  let wrTgaDeduction = 0
  let wrBeneficiaryName = ''
  let wrIban = ''
  let wrBankName = ''
  if (wrRow) {
    const wrHeaders = Object.keys(wrRow)
    const carCol = findCol(wrHeaders, 'car_deduction', 'car deduction')
    const tgaCol = findCol(wrHeaders, 'tga', 'tga 2026')
    const beneficiaryCol = findCol(wrHeaders, 'beneficiary_name', 'beneficiary')
    const ibanCol = findCol(wrHeaders, 'iban')
    const bankCol = findCol(wrHeaders, 'bank_name', 'bank')
    if (carCol) wrCarDeduction = num(wrRow[carCol])
    if (tgaCol) wrTgaDeduction = num(wrRow[tgaCol])
    if (beneficiaryCol) wrBeneficiaryName = String(wrRow[beneficiaryCol] ?? '').trim()
    if (ibanCol) wrIban = String(wrRow[ibanCol] ?? '').trim()
    if (bankCol) wrBankName = String(wrRow[bankCol] ?? '').trim()
  }

  // ====== Join RLVL + FTR by rider ID ======
  const drivers: RawDriverData[] = []
  const seenRiders = new Set<string>()
  // Per-driver banking info extracted from RLVL (preferred source)
  const driverBanking: Record<string, { beneficiaryName: string; iban: string; bankName: string }> = {}
  // Aggregate RLVL banking (first non-empty row — used as fallback when WR has nothing)
  let rlvlAggregateBanking = { beneficiaryName: '', iban: '', bankName: '' }

  for (const row of rlvlRows) {
    const riderId = String(row[riderIdCol!] ?? '').trim()
    if (!riderId) {
      warnings.push(`Skipped RLVL row without rider_id: ${JSON.stringify(row).slice(0, 100)}`)
      continue
    }
    if (seenRiders.has(riderId)) {
      warnings.push(`Duplicate rider_id in RLVL: ${riderId}`)
      continue
    }
    seenRiders.add(riderId)

    const name = nameCol ? String(row[nameCol] ?? '') : ''
    const contractName = contractCol ? String(row[contractCol] ?? 'nokhaba_tatweer_ftr') : 'nokhaba_tatweer_ftr'

    // Extract per-driver banking from RLVL (if columns exist)
    const rlvlBeneficiary = rlvlBeneficiaryCol ? String(row[rlvlBeneficiaryCol] ?? '').trim() : ''
    const rlvlIban = rlvlIbanCol ? String(row[rlvlIbanCol] ?? '').trim() : ''
    const rlvlBank = rlvlBankCol ? String(row[rlvlBankCol] ?? '').trim() : ''
    if (rlvlBeneficiary || rlvlIban || rlvlBank) {
      driverBanking[riderId] = {
        beneficiaryName: rlvlBeneficiary,
        iban: rlvlIban,
        bankName: rlvlBank,
      }
      // Capture first non-empty as aggregate (used when WR doesn't have banking)
      if (!rlvlAggregateBanking.beneficiaryName && rlvlBeneficiary) rlvlAggregateBanking.beneficiaryName = rlvlBeneficiary
      if (!rlvlAggregateBanking.iban && rlvlIban) rlvlAggregateBanking.iban = rlvlIban
      if (!rlvlAggregateBanking.bankName && rlvlBank) rlvlAggregateBanking.bankName = rlvlBank
    }

    const ftrRow = ftrByRider.get(riderId)
    let vehicleType = 'car'
    let actualWorkingDays = 30  // Default to full month when FTR Cost sheet is missing
    let fullyWorkingDays = 30
    let workingHours = 0
    let totalMonthlyWorkingHours = 0
    let inactiveReason = 'Active'
    if (ftrRow) {
      if (vehicleCol) vehicleType = String(ftrRow[vehicleCol] ?? 'car')
      if (workingDaysCol) actualWorkingDays = num(ftrRow[workingDaysCol])
      if (fullyWorkingDaysCol) fullyWorkingDays = num(ftrRow[fullyWorkingDaysCol])
      if (workingHoursCol) workingHours = num(ftrRow[workingHoursCol])
      if (totalMonthlyHoursCol) totalMonthlyWorkingHours = num(ftrRow[totalMonthlyHoursCol])
      if (inactiveReasonCol) inactiveReason = String(ftrRow[inactiveReasonCol] ?? 'Active')
    } else if (ftrSheetName) {
      // FTR sheet exists but rider not in it — warn
      warnings.push(`Rider ${riderId} (${name}) found in RLVL but missing in FTR Cost sheet`)
    }
    // If no FTR sheet at all, use defaults silently (warning already added at top)

    // Penalties map (raw, may be negative)
    const penalties: Record<string, number> = {
      acceptance_rate_penalties: acceptanceCol ? num(row[acceptanceCol]) : 0,
      contact_rate_penalties: contactCol ? num(row[contactCol]) : 0,
      stacking_deduction: stackingCol ? num(row[stackingCol]) : 0,
      declined_penalties_day_logic: declinedCol ? num(row[declinedCol]) : 0,
      late_penalty: lateCol ? num(row[lateCol]) : 0,
      no_show_penalty: noshowCol ? num(row[noshowCol]) : 0,
      no_show_penalty_special_cities: noshowSpecialCol ? num(row[noshowSpecialCol]) : 0,
      daily_acceptance_rate_penalty: dailyAcceptanceCol ? num(row[dailyAcceptanceCol]) : 0,
      distance_payment: distanceCol ? num(row[distanceCol]) : 0,
      missed_days_penalty: missedDaysCol ? num(row[missedDaysCol]) : 0,
      segment_payment: segmentCol ? num(row[segmentCol]) : 0,
    }

    const riderBalance = riderBalanceCol ? num(row[riderBalanceCol]) : 0

    drivers.push({
      riderId,
      name,
      contractName,
      vehicleType,
      inactiveReason,
      completedOrders: completedOrdersCol ? num(row[completedOrdersCol]) : 0,
      uploadedBasicPayment: basicPaymentCol ? num(row[basicPaymentCol]) : 0,
      uploadedCityPayment: cityPaymentCol ? num(row[cityPaymentCol]) : 0,
      actualWorkingDays,
      fullyWorkingDays,
      workingHours,
      totalMonthlyWorkingHours,
      penalties,
      carDeduction: wrCarDeduction,
      tgaDeduction: wrTgaDeduction,
      riderBalance,
      segmentPayment: segmentCol ? num(row[segmentCol]) : 0,
      trafficViolationsTotal: 0, // filled separately by traffic violation lookup
      // Filled by the import route from the rules engine (custom + manual items)
      customBonuses: [],
      customDeductions: [],
      manualBonuses: [],
      manualDeductions: [],
    })
  }

  // ====== Decide aggregate banking source ======
  // Priority: RLVL (per-driver / first-row aggregate) > WR (company-level) > none
  const rlvlHasBanking = !!(rlvlAggregateBanking.beneficiaryName || rlvlAggregateBanking.iban || rlvlAggregateBanking.bankName)
  const wrHasBanking = !!(wrBeneficiaryName || wrIban || wrBankName)
  const bankingSource: 'rlvl' | 'wr' | 'none' = rlvlHasBanking ? 'rlvl' : (wrHasBanking ? 'wr' : 'none')
  const finalBanking = {
    beneficiaryName: rlvlHasBanking ? rlvlAggregateBanking.beneficiaryName : wrBeneficiaryName,
    iban: rlvlHasBanking ? rlvlAggregateBanking.iban : wrIban,
    bankName: rlvlHasBanking ? rlvlAggregateBanking.bankName : wrBankName,
    source: bankingSource,
  }

  return {
    drivers,
    wrRow,
    sheetNames,
    warnings,
    banking: finalBanking,
    driverBanking,
  }
}
