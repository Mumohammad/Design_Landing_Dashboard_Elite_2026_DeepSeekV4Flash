// VAT net-position math — pure module.
//
// The DB view `vat_reconciliation` (migration 051) is authoritative for the
// per-period net position; this module locks the SAME formula in TypeScript
// for the dashboard strip (which computes from live ledgers client-side) and
// is unit-tested against the three canonical scenarios.

/** Canonical net position: output + adj-out − recoverable input − adj-in. */
export function computeVatNetPosition(
  outputVat: number,
  adjustmentsOutput: number,
  recoverableInputVat: number,
  adjustmentsInput: number
): number {
  return outputVat + adjustmentsOutput - recoverableInputVat - adjustmentsInput
}

export type VatNetNature = "payable" | "receivable" | "zero"

/** Derive the return nature from the signed net (payable > 0, receivable < 0). */
export function netNature(net: number): VatNetNature {
  return net > 0 ? "payable" : net < 0 ? "receivable" : "zero"
}
