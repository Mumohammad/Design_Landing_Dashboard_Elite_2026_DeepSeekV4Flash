import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { verifyMigrationVersions, verifyRepositoryMigrationVersions } from "./verify-migration-versions.mjs"

const expense = { name: "20261109090000_expense_claims.sql", sql: "select 1;\n" }
const binding = { version: "20261109090000", name: "expense_claims", sourceSha256: createHash("sha256").update(expense.sql).digest("hex") }
test("current repository has unique versions and preserves observed applied bindings", () => assert.ok(verifyRepositoryMigrationVersions() > 0))
test("rejects two different migrations with one version", () => assert.throws(() => verifyMigrationVersions([expense, { name: "20261109090000_guard_payroll_engine_mutations.sql", sql: "select 2;" }], [binding]), /Duplicate/))
test("rejects replacing an applied expense version with a payroll guard", () => assert.throws(() => verifyMigrationVersions([{ name: "20261109090000_guard_payroll_engine_mutations.sql", sql: expense.sql }], [binding]), /reassigned/))
test("rejects relocating an applied migration to a fresh version", () => assert.throws(() => verifyMigrationVersions([{ ...expense, name: "20261109105602_expense_claims_canonical.sql" }], [binding]), /removed/))
test("rejects editing SQL at an applied version", () => assert.throws(() => verifyMigrationVersions([{ ...expense, sql: "select 2;\n" }], [binding]), /source changed/))
test("accepts a fresh forward and equivalent Windows checkout line endings", () => assert.equal(verifyMigrationVersions([{ ...expense, sql: "select 1;\r\n" }, { name: "20261109114942_guard_payroll_engine_mutations.sql", sql: "select 2;" }], [binding]), 2))
for (const file of [{ name: "invalid.sql", sql: "select 1;" }, { name: "20261109114942_empty.sql", sql: "" }]) test("rejects invalid/empty source " + file.name, () => assert.throws(() => verifyMigrationVersions([file], []), /Invalid or empty/))
test("rejects malformed or repeated applied bindings", () => {
  assert.throws(() => verifyMigrationVersions([expense], [{ ...binding, sourceSha256: "missing" }]), /Invalid applied/)
  assert.throws(() => verifyMigrationVersions([expense], [binding, binding]), /Invalid applied/)
})
