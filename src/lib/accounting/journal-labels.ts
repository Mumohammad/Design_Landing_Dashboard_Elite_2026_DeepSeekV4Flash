const labels: Record<string, { ar: string; en: string }> = {
 manual: { ar: "قيد يدوي", en: "Manual journal" }, payroll: { ar: "رواتب", en: "Payroll" },
 cod_settlement: { ar: "تسوية التحصيل", en: "Collection settlement" }, invoice: { ar: "فاتورة", en: "Invoice" },
 expense: { ar: "مصروف", en: "Expense" }, bank: { ar: "معاملة بنكية", en: "Bank transaction" },
 vat: { ar: "ضريبة القيمة المضافة", en: "VAT" }, reversal: { ar: "قيد عكسي", en: "Reversal" },
 opening: { ar: "رصيد افتتاحي", en: "Opening balance" },
}
export function journalLabel(kind: string, locale: "ar" | "en"): string { return labels[kind]?.[locale] ?? kind }
