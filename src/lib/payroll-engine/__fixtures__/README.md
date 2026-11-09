# Payroll engine parity fixtures

- `*.xlsx` — anonymized copies of real platform workbooks (rider IDs, names,
  VAT numbers, beneficiary/bank data replaced). `edge.xlsx` adds duplicate,
  blank and FTR-missing riders, string amounts, RLVL banking columns and
  non-zero WR car/TGA deductions. `rlvl-only.xlsx` has no FTR/WR sheets.
- `scenarios.json` — rule overrides, bonuses, deductions (incl. installments),
  manual adjustments, traffic violations and expenses per scenario.
- `golden.json` — output of the **untouched upstream code**
  (duaa7226-collab/Payroll-Sys-2026 @ 1feaee25, xlsx 0.18.5).

Regenerate (only when intentionally re-syncing with upstream):

```bash
git clone https://github.com/duaa7226-collab/Payroll-Sys-2026 /tmp/upstream && git -C /tmp/upstream checkout <commit>
mkdir -p /tmp/golden/orig && cd /tmp/golden
cp /tmp/upstream/src/lib/{rules,salary-engine,excel-parser,income-expenses-engine,custom-bonus-helpers,custom-deduction-helpers,manual-adjustment-helpers,traffic-helpers,payroll-persist,utils}.ts orig/
cp <repo>/scripts/payroll-golden/db.ts.txt orig/db.ts
cp <repo>/scripts/payroll-golden/orig-run.ts.txt orig-run.ts   # edit FX path
npm i xlsx@0.18.5 clsx tailwind-merge tsx && npx tsx orig-run.ts
```

A real production run of the upstream app (Sep 2026 workbook, 17 riders,
net SAR 24,223.7156) was also matched rider-by-rider before vendoring.
