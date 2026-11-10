import { describe, expect, it } from "vitest"
import { classifySupabaseStartup } from "../../../scripts/report-supabase-start-failure.mjs"

describe("Supabase startup diagnostic privacy", () => {
  it("extracts only migration filenames, SQL states and fixed categories", () => {
    expect(classifySupabaseStartup("Applying migration 001_init.sql\nApplying migration 20261020160955_approvals_private_paging.sql\nERROR: private data (SQLSTATE 42601)\nSQLSTATE 42601"))
      .toEqual({check:"supabase-start-failure",lastMigration:"20261020160955_approvals_private_paging.sql",sqlStates:["42601"],indicators:["sql-error"]})
  })
  it("does not forward credentials, statements or provider diagnostics", () => {
    const result=JSON.stringify(classifySupabaseStartup("password=sensitive-fixture-value\nAPI_KEY=sensitive-fixture-key\nERROR: INSERT INTO users(email) VALUES('private@example.test') (SQLSTATE 23505)"))
    expect(result).not.toMatch(/sensitive|INSERT|users|private@|password|API_KEY/)
    expect(result).toContain("23505")
  })
  it("classifies transport and local resource failures without echoing endpoints", () => {
    expect(classifySupabaseStartup("failed to pull https://private.example.test: TLS handshake timeout; no space left on device").indicators)
      .toEqual(["network-timeout","image-pull","disk-full"])
  })
  it("reports an unknown failure without guessing its cause", () => {
    expect(classifySupabaseStartup("unexpected diagnostic"))
      .toEqual({check:"supabase-start-failure",lastMigration:null,sqlStates:[],indicators:[]})
  })
})
