import test from "node:test"
import assert from "node:assert/strict"
import { STAGING_REF, verifyNativePreviewEnvironment } from "./preview-safety.mjs"
const jwt = (ref, role) => "fixture." + Buffer.from(JSON.stringify({ref, role})).toString("base64url") + ".fixture"
const config = () => ({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: "https://" + STAGING_REF + ".supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(STAGING_REF,"anon"), SUPABASE_SERVICE_ROLE_KEY: jwt(STAGING_REF,"service_role"), NEXT_PUBLIC_APP_URL: "https://elite-dashboard-fixture-elitesaasc-5643.vercel.app" })
test("native preview accepts approved staging and the isolated app origin", () => verifyNativePreviewEnvironment(config()))
test("production and local builds retain their own configuration", () => { verifyNativePreviewEnvironment({VERCEL_ENV:"production"}); verifyNativePreviewEnvironment({}) })
for (const field of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_APP_URL"]) test("preview fails closed without " + field, () => assert.throws(() => verifyNativePreviewEnvironment({...config(), [field]:""})))
test("custom staging environments are guarded even without VERCEL_ENV", () => assert.throws(() => verifyNativePreviewEnvironment({VERCEL_TARGET_ENV:"staging"})))
test("production URL and foreign or wrong-role legacy credentials are rejected without exposing values", () => {
  for (const patch of [{ NEXT_PUBLIC_SUPABASE_URL:"https://wwfnsbilmyxeawgzicmv.supabase.co" }, { NEXT_PUBLIC_SUPABASE_ANON_KEY:jwt("foreign","anon") }, {SUPABASE_SERVICE_ROLE_KEY:jwt(STAGING_REF,"anon")}]) assert.throws(() => verifyNativePreviewEnvironment({...config(),...patch}), error => !error.message.includes(Object.values(patch)[0]))
})
for (const name of ["DEPLOYMENT_ROLE","PUBLIC_DASHBOARD_URL","PUBLIC_LANDING_URL","NEXT_PUBLIC_DASHBOARD_URL","NEXT_PUBLIC_LANDING_URL"]) test("preview rejects inherited cross-host config " + name, () => assert.throws(() => verifyNativePreviewEnvironment({...config(),[name]:"inherited"})))
test("preview rejects foreign email destinations and external ZATCA submission", () => {
  for(const patch of [{NEXT_PUBLIC_APP_URL:"https://elite-dashboard-blush.vercel.app"},{NEXT_PUBLIC_SITE_URL:"https://production.example.test"},{ZATCA_MODE:"production"},{ZATCA_API_BASE_URL:"https://external.example.test"},{ZATCA_PRODUCTION_ENABLED:"true"}]) assert.throws(() => verifyNativePreviewEnvironment({...config(),...patch}))
})
test("opaque keys require actual API verification separately but are accepted structurally", () => verifyNativePreviewEnvironment({...config(),NEXT_PUBLIC_SUPABASE_ANON_KEY:"sb_publishable_fixture",SUPABASE_SERVICE_ROLE_KEY:"sb_secret_fixture"}))
