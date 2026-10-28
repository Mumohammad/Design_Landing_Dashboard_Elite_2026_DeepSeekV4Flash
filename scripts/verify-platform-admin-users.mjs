import { randomBytes, randomUUID } from "node:crypto"
import { expect as baseExpect } from "@playwright/test"
import { assertModuleTestTarget } from "./assert-module-test-target.mjs"

const expect = baseExpect.configure({ timeout: 25_000 })
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? "")
const requireProof = (condition, message) => { if (!condition) throw Error(message) }
const userFields = "id,auth_user_id,tenant_id,email,role,status,version,must_change_password,created_by,deleted_at"

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const positiveVersion = value => (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) || (Number.isSafeInteger(value) && value > 0)
const samePayload = (actual, expected) => plain(actual) && plain(expected) && Object.keys(actual).length === Object.keys(expected).length && Object.keys(expected).every(key => own(actual, key) && (key === "expected_version" ? String(actual[key]) === String(expected[key]) : actual[key] === expected[key]))

/** Pure preflight: a rejected DTO must never reach a browser route or API write. */
export function assertOwnedPlatformMutation(method, payload, scope) {
  requireProof(["POST", "PATCH", "DELETE"].includes(method) && plain(payload), "Owned platform mutation DTO required")
  requireProof(uuid(scope?.actorId) && uuid(scope?.actorUserId) && uuid(scope?.actorTenantId) && uuid(scope?.tenantId) && scope.tenantId !== scope.actorTenantId, "Owned platform mutation scope required")
  requireProof(scope.intent?.method === method, "Declared platform operation required before forwarding")
  if (method === "POST") {
    const fields = ["request_id", "tenant_id", "email", "full_name", "role", "password"]
    requireProof(Object.keys(payload).length === fields.length && fields.every(key => own(payload, key)), "Owned platform creation fields differ")
    requireProof(uuid(payload.request_id) && (!scope.requestId || payload.request_id === scope.requestId), "Owned platform creation request differs")
    requireProof(payload.tenant_id === scope.tenantId && payload.email === scope.email && /^platform-member-[0-9a-f-]{36}@example\.test$/i.test(scope.email ?? ""), "Owned platform creation target differs")
    requireProof(typeof scope.fullName === "string" && /^Platform member [0-9a-f-]{36}$/i.test(scope.fullName) && payload.full_name === scope.fullName && scope.role === "readonly_auditor" && payload.role === scope.role, "Owned platform creation identity or role differs")
    requireProof(typeof scope.password === "string" && scope.password.length >= 10 && payload.password === scope.password, "Owned platform creation password differs")
    return { kind: "platform-member-intent", actorId: scope.actorId, email: scope.email, requestId: payload.request_id, tenantId: scope.tenantId }
  }
  const fields = method === "PATCH" ? ["user_id", "expected_version", "reason", "role", "status", "reset_password"] : ["user_id", "expected_version", "reason"]
  requireProof(Object.keys(payload).every(key => fields.includes(key)) && own(payload, "user_id") && own(payload, "expected_version"), "Owned platform mutation fields differ")
  const ownedIds = [scope.actorUserId, scope.ownerUserId, scope.memberUserId].filter(uuid)
  requireProof(uuid(payload.user_id) && ownedIds.includes(payload.user_id), "Owned platform mutation target differs")
  requireProof(positiveVersion(payload.expected_version) && (!own(payload, "reason") || (typeof payload.reason === "string" && payload.reason.length <= 500)), "Owned platform mutation review differs")
  if (method === "PATCH") {
    requireProof(!own(payload, "role") || payload.role === "supervisor", "Owned platform mutation role differs")
    requireProof(!own(payload, "status") || ["active", "inactive"].includes(payload.status), "Owned platform mutation status differs")
    requireProof(!own(payload, "reset_password") || payload.reset_password === true, "Owned platform mutation reset differs")
    const operations = ["role", "status", "reset_password"].filter(key => own(payload, key))
    requireProof(operations.length === 1 || (operations.length === 2 && own(payload, "role") && own(payload, "reset_password")), "Owned platform mutation operation differs")
  }
  // The primary caller and separate company's last owner are intentional denials,
  // never general-purpose targets for this harness.
  if (payload.user_id === scope.actorUserId) {
    requireProof(method === "PATCH" && payload.status === "inactive" && !own(payload, "role") && !own(payload, "reset_password") && String(payload.expected_version) === String(scope.actorVersion) && payload.reason === "Synthetic protected actor denial", "Protected synthetic actor operation differs")
  } else if (payload.user_id === scope.ownerUserId) {
    requireProof(method === "PATCH" && !own(payload, "reset_password") && String(payload.expected_version) === String(scope.ownerVersion) && payload.reason === "Synthetic last owner protection" && ((payload.role === "supervisor" && !own(payload, "status")) || (payload.status === "inactive" && !own(payload, "role"))), "Synthetic last owner operation differs")
  }
  requireProof(samePayload(payload, scope.intent.payload), "Platform mutation differs from the declared operation")
  return null
}

/** The durable, secret-free intent must complete before any POST is forwarded. */
export async function forwardOwnedPlatformMutation(method, payload, scope, { recordIntent, forward }) {
  const intent = assertOwnedPlatformMutation(method, payload, scope)
  requireProof(typeof forward === "function", "Platform request forwarder required")
  if (intent) {
    requireProof(typeof recordIntent === "function", "Durable platform member intent recorder required")
    await recordIntent(intent)
  }
  return forward(payload)
}

/** Bind one request synchronously and share its durable write before forwarding. */
export function createOwnedPlatformIntentRecorder({ record, bind }) {
  requireProof(typeof record === "function" && typeof bind === "function", "Durable platform intent callbacks required")
  let bound, pending
  return intent => {
    if (bound) {
      requireProof(samePayload(intent, bound), "Owned platform creation intent differs")
      return pending
    }
    bound = { ...intent }
    bind(bound)
    pending = Promise.resolve().then(() => record(bound))
    return pending
  }
}

/**
 * Mutating acceptance for the coordinated runner's authenticated AAL2 owner.
 * Only its release-UUID@example.test identity receives a temporary admin marker.
 * All global mutations target a new synthetic company, never another tenant.
 * Do not run with tracing, video, HAR recording, or request/body logging enabled.
 */
export async function verifyPlatformAdminUsers(page, admin, tenantId, appUrl, actorId, options = {}) {
  // This must precede every fixture read, Auth lookup, and mutation.
  await assertModuleTestTarget(page, admin.supabaseUrl, appUrl)
  requireProof(uuid(tenantId) && uuid(actorId), "Synthetic release owner and tenant IDs required")
  const actorResult = await admin.from("users").select(userFields).eq("tenant_id", tenantId).eq("auth_user_id", actorId).is("deleted_at", null).single()
  const actor = actorResult.data
  requireProof(!actorResult.error && actor?.status === "active" && actor.role === "general_manager" && /^release-[0-9a-f-]{36}@example\.test$/i.test(actor.email), "Synthetic release owner required")
  const tenant = await admin.from("tenants").select("id,created_by,domain,status,deleted_at").eq("id", tenantId).single()
  requireProof(!tenant.error && tenant.data.created_by === actorId && tenant.data.status === "active" && !tenant.data.deleted_at && /^[0-9a-f-]{36}\.test$/i.test(tenant.data.domain ?? ""), "Synthetic release tenant proof required")
  const membership = await admin.from("tenant_memberships").select("id").eq("tenant_id", tenantId).eq("user_id", actor.id).is("deleted_at", null).single()
  requireProof(!membership.error && membership.data?.id, "Synthetic release owner membership required")
  const existingAdmin = await admin.from("platform_admins").select("user_id").eq("user_id", actorId).maybeSingle()
  requireProof(!existingAdmin.error && !existingAdmin.data, "Synthetic caller must have no pre-existing platform admin marker")

  requireProof(typeof options.recordOwnedFixture === "function", "Durable platform fixture recorder required")
  const app = new URL(appUrl)
  const tag = randomUUID()
  const marker = "platform-user-acceptance:" + tag
  const ownerAuthId = randomUUID()
  const ownerEmail = "platform-owner-" + tag + "@example.test"
  const memberEmail = "platform-member-" + tag + "@example.test"
  const companyName = "Platform acceptance " + tag
  let targetTenantId, targetOwnerUserId, targetOwnerVersion, memberId, requestId, authorization, creationPayload, reservationInput, reservedAuthId
  let markerInserted = false, ownerAttempted = false, failed = false
  let password = "Fixture!" + randomBytes(24).toString("base64url") + "aA1"
  let stage = "synthetic caller authentication"
  const viewport = page.viewportSize()
  const originalLocale = await page.locator("html").getAttribute("lang")
  const endpoint = new URL("/api/platform/admin/users", app).href
  const isApi = (request, method) => new URL(request.url()).origin === app.origin && new URL(request.url()).pathname === "/api/platform/admin/users" && request.method() === method
  const apiOperations = []
  let browserIntent, routeInstalled = false, blockedMutationError, rejectBlocked
  const blockedMutation = new Promise((_, reject) => { rejectBlocked = reject })
  // A guard failure may happen outside an active click/response wait.
  blockedMutation.catch(() => {})
  const guardRace = promise => Promise.race([promise, blockedMutation])
  const ownedScope = intent => ({ actorId, actorUserId: actor.id, actorTenantId: tenantId, actorVersion: actor.version, tenantId: targetTenantId, ownerUserId: targetOwnerUserId, ownerVersion: targetOwnerVersion, memberUserId: memberId, email: memberEmail, fullName: "Platform member " + tag, role: "readonly_auditor", password, requestId, intent })
  const persistIntent = createOwnedPlatformIntentRecorder({
    record: intent => options.recordOwnedFixture(intent),
    bind: intent => { requestId = intent.requestId },
  })
  const rememberCreation = payload => {
    requireProof(payload.request_id === requestId, "Durably bound platform request required")
    creationPayload = payload
    reservationInput = { p_request_id: requestId, p_tenant_id: targetTenantId, p_email: memberEmail, p_role: payload.role, p_full_name: payload.full_name }
  }
  const api = (method, data, authenticated = true) => {
    const forward = payload => page.request.fetch(endpoint, { method, headers: authenticated ? { Authorization: authorization } : {}, ...(payload ? { data: payload } : {}) })
    if (method === "GET") return forward(data)
    // APIRequestContext traffic bypasses page.route, so it has its own preflight.
    const intent = method === "POST" ? { method } : apiOperations.find(operation => operation.method === method && samePayload(data, operation.payload))
    return forwardOwnedPlatformMutation(method, data, ownedScope(intent), { recordIntent: persistIntent, forward })
  }
  const platformRoute = url => url.origin === app.origin && url.pathname === "/api/platform/admin/users"
  const routeHandler = async route => {
    const request = route.request()
    if (["GET", "HEAD", "OPTIONS"].includes(request.method())) return route.continue()
    try {
      const url = new URL(request.url())
      requireProof(!url.search && !url.hash, "Exact platform mutation endpoint required")
      const payload = request.postDataJSON()
      await forwardOwnedPlatformMutation(request.method(), payload, ownedScope(browserIntent), {
        recordIntent: persistIntent,
        forward: async validated => {
          if (request.method() === "POST") rememberCreation(validated)
          await route.continue()
        },
      })
    } catch {
      blockedMutationError = Error("Unexpected platform mutation blocked before forwarding")
      rejectBlocked(blockedMutationError)
      await route.abort("blockedbyclient").catch(() => {})
    }
  }
  const read = async id => {
    const result = await admin.from("users").select(userFields).eq("tenant_id", targetTenantId).eq("id", id).single()
    requireProof(!result.error && result.data, "Owned platform user verification read failed")
    return result.data
  }
  const audits = async id => {
    const result = await admin.from("audit_log").select("action,actor_id,entity_type,entity_id,old_values,new_values").eq("tenant_id", targetTenantId).eq("module", "platform_admin").eq("entity_id", id)
    requireProof(!result.error, "Owned platform user audit read failed")
    return result.data
  }
  const synchronized = async (id, roleName, archived = false) => {
    const assignments = await admin.from("user_role_assignments").select("id,role_id,assigned_by,revoked_at,deleted_at").eq("tenant_id", targetTenantId).eq("user_id", id)
    const memberships = await admin.from("tenant_memberships").select("id,deleted_at").eq("tenant_id", targetTenantId).eq("user_id", id)
    requireProof(!assignments.error && !memberships.error, "Owned platform access history read failed")
    const active = assignments.data.filter(row => !row.revoked_at && !row.deleted_at)
    requireProof(active.length === (archived ? 0 : 1) && memberships.data.length === 1 && memberships.data.filter(row => !row.deleted_at).length === (archived ? 0 : 1), "Platform assignment or membership synchronization failed")
    if (!archived) {
      const role = await admin.from("roles").select("id").eq("tenant_id", targetTenantId).eq("name", roleName).is("deleted_at", null).single()
      requireProof(!role.error && active[0].role_id === role.data.id && active[0].assigned_by === actorId, "Platform role assignment differs from persisted role")
    }
    return assignments.data
  }
  const openUsers = async () => {
    await page.goto(new URL("/platform/admin?lang=en", app).href)
    await page.getByTestId("platform-users-tab").click()
    await expect(page.getByTestId("platform-users")).toBeVisible()
  }
  const rowFor = id => page.locator('[data-testid="platform-user-row"][data-user-id="' + id + '"]')
  const review = async (button, reason, method = "PATCH", change = {}) => {
    const before = await read(memberId)
    browserIntent = { method, payload: { user_id: memberId, expected_version: before.version, reason, ...change } }
    try {
      await guardRace(button.click())
      const dialog = page.getByTestId("platform-user-review")
      await expect(dialog).toBeVisible()
      await dialog.locator("#platform-user-reason").fill(reason)
      const pending = page.waitForResponse(response => isApi(response.request(), method))
      const [response] = await guardRace(Promise.all([pending, dialog.getByTestId("platform-user-confirm").click()]))
      requireProof(response.ok(), "Reviewed platform mutation was rejected")
      await expect(dialog).toBeHidden()
      return response.request().postDataJSON()
    } finally { browserIntent = undefined }
  }

  try {
    // Stop any accidental tracing before handling an access token or password.
    await page.context().tracing.stop()
    requireProof(!page.video(), "Platform acceptance requires an unrecorded browser context")
    await page.route(platformRoute, routeHandler)
    routeInstalled = true
    // Obtain this already-verified owner session from an allowed tenant read;
    // the global-admin page correctly redirects a caller before it is granted authority.
    const backendOrigin = new URL(admin.supabaseUrl).origin
    const tokenRequest = page.waitForRequest(request => new URL(request.url()).origin === backendOrigin && new URL(request.url()).pathname === "/rest/v1/journal_entries")
    await page.goto(new URL("/accounting?lang=en", app).href)
    authorization = await (await tokenRequest).headerValue("authorization")
    requireProof(/^Bearer\s+\S+$/i.test(authorization ?? ""), "Authenticated platform browser session required")
    const verifiedActor = await admin.auth.getUser(authorization.replace(/^Bearer\s+/i, ""))
    requireProof(!verifiedActor.error && verifiedActor.data.user?.id === actorId && verifiedActor.data.user.email === actor.email, "Browser session does not match the synthetic release owner")
    requireProof((await api("GET")).status() === 403, "Non-admin browser session gained global user access")
    requireProof((await api("GET", undefined, false)).status() === 401, "Unauthenticated request gained global user access")

    stage = "temporary synthetic platform authority"
    await options.recordOwnedFixture({ kind: "platform-marker", actorId, email: actor.email, note: marker, tag })
    const granted = await admin.from("platform_admins").insert({ user_id: actorId, email: actor.email, note: marker, created_by: actorId }).select("user_id").single()
    requireProof(!granted.error && granted.data?.user_id === actorId, "Synthetic platform admin grant failed")
    markerInserted = true

    stage = "separate synthetic company and last owner"
    ownerAttempted = true
    await options.recordOwnedFixture?.({kind:"platform-owner",authUserId:ownerAuthId,actorId,email:ownerEmail,tag})
    const owner = await admin.auth.admin.createUser({ id: ownerAuthId, email: ownerEmail, password, email_confirm: true, app_metadata: { _invite_provisioned: true, _platform_acceptance: tag, _platform_acceptance_actor: actorId } })
    requireProof(!owner.error && owner.data.user?.id === ownerAuthId, "Synthetic platform target owner creation failed")
    const company = await admin.rpc("provision_company_atomic", { p_auth_user_id: ownerAuthId, p_company: { name: companyName, domain: tag + ".test", slug: "platform-acceptance-" + tag } })
    requireProof(!company.error && uuid(company.data?.id) && company.data.id !== tenantId, "Synthetic platform target company creation failed")
    targetTenantId = company.data.id
    await options.recordOwnedFixture?.({kind:"platform-owner",authUserId:ownerAuthId,actorId,email:ownerEmail,tag,tenantId:targetTenantId})
    const targetOwner = await admin.from("users").select(userFields).eq("tenant_id", targetTenantId).eq("auth_user_id", ownerAuthId).eq("email", ownerEmail).single()
    requireProof(!targetOwner.error && uuid(targetOwner.data.id) && targetOwner.data.role === "general_manager" && targetOwner.data.status === "active", "Synthetic target owner proof failed")
    targetOwnerUserId = targetOwner.data.id
    targetOwnerVersion = targetOwner.data.version
    apiOperations.push(
      { method: "PATCH", payload: { user_id: actor.id, expected_version: String(actor.version), status: "inactive", reason: "Synthetic protected actor denial" } },
      ...[{ role: "supervisor" }, { status: "inactive" }].map(operation => ({ method: "PATCH", payload: { user_id: targetOwnerUserId, expected_version: String(targetOwnerVersion), ...operation, reason: "Synthetic last owner protection" } })),
    )

    stage = "global UI initial-password creation"
    const unavailableOverview=route=>route.fulfill({status:503,contentType:"application/json",body:'{"error":"Synthetic overview unavailable"}'})
    const unavailableCompanies=route=>route.fulfill({status:503,contentType:"application/json",body:'{"error":"Synthetic company choices unavailable"}'})
    await page.route("**/api/platform/admin/stats",unavailableOverview)
    await page.route("**/api/platform/admin/companies",unavailableCompanies)
    await openUsers()
    browserIntent = { method: "POST" }
    await guardRace(page.getByTestId("platform-user-create").click())
    const create = page.getByTestId("platform-user-create-form")
    const choices=create.getByTestId("platform-user-choices")
    await expect(choices).toHaveAttribute("data-state","error")
    await expect(choices.getByRole("alert")).toBeVisible()
    await expect(create.getByTestId("platform-new-submit")).toBeDisabled()
    await page.unroute("**/api/platform/admin/companies",unavailableCompanies)
    await choices.getByRole("button",{name:"Retry",exact:true}).click()
    await expect.poll(()=>choices.getAttribute("data-state")).toMatch(/^(ready|error)$/)
    const state=await choices.getAttribute("data-state")
    if(state!=="ready"){console.error(JSON.stringify({check:"platform user choices",state,endpoint:await choices.getAttribute("data-error-endpoint"),status:await choices.getAttribute("data-http-status")}));throw Error("Owned platform company and role choices unavailable")}
    await expect(create.locator('#platform-new-tenant option[value="'+targetTenantId+'"]')).toHaveCount(1)
    await page.unroute("**/api/platform/admin/stats",unavailableOverview)
    await create.locator("#platform-new-tenant").selectOption(targetTenantId)
    await create.locator("#platform-new-email").fill(memberEmail)
    await create.locator("#platform-new-name").fill("Platform member " + tag)
    await create.locator("#platform-new-role").selectOption("readonly_auditor")
    await create.locator("#platform-new-password").fill(password)
    const creating = page.waitForResponse(response => isApi(response.request(), "POST"))
    const [created] = await guardRace(Promise.all([creating, create.getByTestId("platform-new-submit").click()]))
    browserIntent = undefined
    requireProof(created.ok() && uuid(requestId), "Global UI user creation failed")
    await expect(create).toBeHidden()
    const member = await admin.from("users").select(userFields).eq("tenant_id", targetTenantId).eq("email", memberEmail).single()
    requireProof(!member.error && member.data.created_by === actorId && member.data.role === "readonly_auditor" && member.data.status === "active" && member.data.must_change_password === true, "Initial-password user state differs")
    memberId = member.data.id
    apiOperations.push(
      ...[
        { status: "inactive", reason: "no" },
        { role: "supervisor", reset_password: true, reason: "Reject combined recovery operation" },
        { reset_password: true },
      ].map(operation => ({ method: "PATCH", payload: { user_id: memberId, expected_version: String(member.data.version), ...operation } })),
      { method: "DELETE", payload: { user_id: memberId, expected_version: String(member.data.version), reason: "Reject archive of active synthetic user" } },
    )
    reservedAuthId = member.data.auth_user_id
    await options.recordOwnedFixture?.({kind:"platform-member",authUserId:reservedAuthId,actorId,email:memberEmail,requestId,tenantId:targetTenantId})
    const auth = await admin.auth.admin.getUserById(member.data.auth_user_id)
    requireProof(!auth.error && auth.data.user?.email === memberEmail && !auth.data.user.invited_at && !auth.data.user.recovery_sent_at && auth.data.user.app_metadata?._platform_provision_request === requestId && auth.data.user.app_metadata?._platform_provision_tenant === targetTenantId && auth.data.user.app_metadata?._platform_provision_actor === actorId, "Created Auth identity does not bind to the durable request")
    await synchronized(memberId, "readonly_auditor")
    requireProof((await api("POST", creationPayload)).ok(), "Durable initial-password request replay failed")
    creationPayload.password = undefined
    creationPayload = undefined
    password = ""
    const duplicates = await admin.from("users").select("id").eq("tenant_id", targetTenantId).eq("email", memberEmail)
    requireProof(!duplicates.error && duplicates.data.length === 1 && duplicates.data[0].id === memberId && (await audits(memberId)).filter(row => row.action === "platform_user_created").length === 1, "Durable creation replay duplicated the user or audit")

    stage = "provider-independent mutation validation"
    for (const invalid of [
      { status: "inactive", reason: "no" },
      { role: "supervisor", reset_password: true, reason: "Reject combined recovery operation" },
      { reset_password: true },
    ]) {
      requireProof((await api("PATCH", { user_id: memberId, expected_version: String(member.data.version), ...invalid })).status() === 400, "Invalid platform operation reached mutation or mail handling")
    }
    requireProof((await api("DELETE", { user_id: memberId, expected_version: String(member.data.version), reason: "Reject archive of active synthetic user" })).status() === 409, "Active account was archived without deactivation")
    const afterInvalid = await read(memberId)
    requireProof(afterInvalid.status === "active" && afterInvalid.role === "readonly_auditor" && String(afterInvalid.version) === String(member.data.version) && (await audits(memberId)).length === 1, "Rejected platform requests changed state or audit")

    stage = "protected actor and last-owner denials"
    const protectedResponse = await api("PATCH", { user_id: actor.id, expected_version: String(actor.version), status: "inactive", reason: "Synthetic protected actor denial" })
    requireProof(protectedResponse.status() === 403, "Platform actor protection failed")
    const actorAfter = await admin.from("users").select("role,status,version").eq("tenant_id", tenantId).eq("auth_user_id", actorId).single()
    requireProof(!actorAfter.error && actorAfter.data.role === actor.role && actorAfter.data.status === actor.status && String(actorAfter.data.version) === String(actor.version), "Rejected protected actor change altered the release owner")
    for (const operation of [{ role: "supervisor" }, { status: "inactive" }]) {
      const response = await api("PATCH", { user_id: targetOwner.data.id, expected_version: String(targetOwner.data.version), ...operation, reason: "Synthetic last owner protection" })
      requireProof(response.status() === 409, "Last active target owner protection failed")
    }
    const ownerUnchanged = await read(targetOwner.data.id)
    requireProof(ownerUnchanged.role === "general_manager" && ownerUnchanged.status === "active" && String(ownerUnchanged.version) === String(targetOwner.data.version) && (await audits(targetOwner.data.id)).length === 0, "Rejected last-owner changes altered state or audit")
    await expect(rowFor(actor.id).getByRole("combobox")).toBeDisabled()

    stage = "reviewed role and stale-version conflict"
    const beforeRole = await read(memberId)
    apiOperations.push({ method: "PATCH", payload: { user_id: memberId, expected_version: String(beforeRole.version), status: "inactive", reason: "Synthetic stale global status attempt" } })
    browserIntent = { method: "PATCH", payload: { user_id: memberId, expected_version: beforeRole.version, role: "supervisor", reason: "Synthetic global operational reassignment" } }
    await guardRace(rowFor(memberId).getByRole("combobox").selectOption("supervisor"))
    const roleReview = page.getByTestId("platform-user-review")
    await roleReview.locator("#platform-user-reason").fill("Synthetic global operational reassignment")
    const changingRole = page.waitForResponse(response => isApi(response.request(), "PATCH"))
    const [changedRole] = await guardRace(Promise.all([changingRole, roleReview.getByTestId("platform-user-confirm").click()]))
    browserIntent = undefined
    requireProof(changedRole.ok(), "Global UI role review failed")
    await expect(roleReview).toBeHidden()
    let current = await read(memberId)
    requireProof(current.role === "supervisor" && Number(current.version) > Number(beforeRole.version), "Global role change did not persist")
    const history = await synchronized(memberId, "supervisor")
    requireProof(history.length === 2 && history.filter(row => row.revoked_at).length === 1, "Global role reassignment history missing")
    const auditCount = (await audits(memberId)).length
    const stale = await api("PATCH", { user_id: memberId, expected_version: String(beforeRole.version), status: "inactive", reason: "Synthetic stale global status attempt" })
    requireProof(stale.status() === 409 && (await read(memberId)).status === "active" && (await audits(memberId)).length === auditCount, "Stale platform request changed state or audit")
    await openUsers()
    await expect(rowFor(memberId).getByRole("combobox")).toHaveValue("supervisor")

    stage = "reviewed status transitions and reload persistence"
    for (const next of ["inactive", "active", "inactive"]) {
      await review(rowFor(memberId).getByTestId("platform-user-status"), "Synthetic global status " + next, "PATCH", { status: next })
      current = await read(memberId)
      requireProof(current.status === next && !current.deleted_at, "Global status change did not persist")
      await synchronized(memberId, "supervisor")
      await openUsers()
      await expect(rowFor(memberId).getByTestId("platform-user-status")).toBeVisible()
    }

    stage = "reviewed archive and retained atomic evidence"
    await review(rowFor(memberId).getByTestId("platform-user-archive"), "Retire synthetic global user record", "DELETE")
    current = await read(memberId)
    requireProof(current.deleted_at && current.status === "inactive", "Global archive did not preserve inactive history")
    await synchronized(memberId, "supervisor", true)
    await openUsers()
    await expect(rowFor(memberId)).toHaveCount(0)
    const evidence = await audits(memberId)
    for (const [action, count] of [["platform_user_created", 1], ["platform_user_role", 1], ["platform_user_status", 3], ["platform_user_archive", 1]]) {
      requireProof(evidence.filter(row => row.action === action).length === count, "Global user audit count differs")
    }
    const auditFields = new Set(["role", "status", "version", "archived", "reason_recorded", "must_change_password"])
    requireProof(evidence.length === 6 && evidence.every(row => row.actor_id === actorId && row.entity_type === "users" && row.entity_id === memberId && Object.keys({ ...row.old_values, ...row.new_values }).every(key => auditFields.has(key))), "Global audit actor or privacy proof failed")
    requireProof(evidence.filter(row => row.action !== "platform_user_created").every(row => row.new_values?.reason_recorded === true), "Reviewed global changes lack audit reason proof")
    if (blockedMutationError) throw blockedMutationError
  } catch (error) {
    failed = true
    console.error(JSON.stringify({check:"platform user acceptance",stage,errorType:error.name,operation:/expect\(locator\)\.[A-Za-z]+/.exec(error.message)?.[0],callsite:/verify-platform-admin-users\.mjs:(\d+):(\d+)/.exec(error.stack)?.slice(1)}))
    const failure = Error("Platform user acceptance failed: " + stage)
    failure.verificationStage = stage
    throw failure
  } finally {
    password = ""
    if (creationPayload) creationPayload.password = undefined
    creationPayload = undefined
    let cleanupFailed = false
    // A lost HTTP/finalization response may leave only the reserved Auth row.
    // Recover its ID through the original caller-bound RPC, never private DML.
    if (!reservedAuthId && reservationInput && authorization && markerInserted) {
      try {
        requireProof(typeof admin.supabaseKey === "string" && admin.supabaseKey, "Caller cleanup API key unavailable")
        const recovered = await fetch(new URL("/rest/v1/rpc/reserve_platform_user", admin.supabaseUrl), {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
          headers: { apikey: admin.supabaseKey, Authorization: authorization, "Content-Type": "application/json" },
          body: JSON.stringify(reservationInput),
        })
        const reservation = await recovered.json()
        requireProof(recovered.ok && uuid(reservation?.auth_user_id), "Owned Auth reservation recovery failed")
        reservedAuthId = reservation.auth_user_id
        await options.recordOwnedFixture?.({kind:"platform-member",authUserId:reservedAuthId,actorId,email:memberEmail,requestId,tenantId:targetTenantId})
      } catch { cleanupFailed = true }
    }
    // Delete only the exact marker this invocation successfully inserted.
    if (markerInserted) {
      try {
        const removed = await admin.from("platform_admins").delete().eq("user_id", actorId).eq("email", actor.email).eq("note", marker).eq("created_by", actorId).select("user_id")
        if (removed.error || removed.data?.length !== 1) cleanupFailed = true
      } catch { cleanupFailed = true }
    }
    if (ownerAttempted) {
      try {
        // Recover only this known owner's company if provisioning's response was lost.
        const ownerRow = await admin.from("users").select("id,tenant_id,auth_user_id,email").eq("auth_user_id", ownerAuthId).eq("email", ownerEmail).maybeSingle()
        if (ownerRow.error) throw Error("Owned fixture lookup failed")
        if (ownerRow.data) {
          const ownTenant = await admin.from("tenants").select("id,created_by,domain,name_en").eq("id", ownerRow.data.tenant_id).single()
          requireProof(!ownTenant.error && ownTenant.data.created_by === ownerAuthId && ownTenant.data.domain === tag + ".test" && ownTenant.data.name_en === companyName, "Owned company cleanup proof failed")
          targetTenantId = ownTenant.data.id
          const owned = await admin.from("users").select("id,auth_user_id,email,created_by").eq("tenant_id", targetTenantId).in("email", [ownerEmail, memberEmail])
          requireProof(!owned.error, "Owned user cleanup lookup failed")
          for (const user of owned.data) {
            try {
              requireProof((user.email === ownerEmail && user.auth_user_id === ownerAuthId) || (user.email === memberEmail && user.created_by === actorId && user.auth_user_id === reservedAuthId), "Owned user cleanup proof failed")
              const stamp = new Date().toISOString()
              for (const result of [
                await admin.from("users").update({ status: "inactive" }).eq("tenant_id", targetTenantId).eq("id", user.id).eq("auth_user_id", user.auth_user_id).eq("email", user.email),
                await admin.from("user_role_assignments").update({ revoked_at: stamp }).eq("tenant_id", targetTenantId).eq("user_id", user.id).is("revoked_at", null),
                await admin.from("tenant_memberships").update({ deleted_at: stamp }).eq("tenant_id", targetTenantId).eq("user_id", user.id).is("deleted_at", null),
              ]) requireProof(!result.error, "Owned app access retirement failed")
            } catch { cleanupFailed = true }
          }
        }
      } catch { cleanupFailed = true }
      // Retire exact known Auth identities even if another fixture's cleanup failed.
      for (const id of [ownerAuthId, reservedAuthId].filter(Boolean)) {
        try {
          const identity = await admin.auth.admin.getUserById(id)
          if (identity.data.user) {
            const user = identity.data.user
            requireProof(!identity.error && (id === ownerAuthId ? user.email === ownerEmail && user.app_metadata?._platform_acceptance === tag && user.app_metadata?._platform_acceptance_actor === actorId : user.email === memberEmail && user.app_metadata?._platform_provision_request === requestId && user.app_metadata?._platform_provision_tenant === targetTenantId && user.app_metadata?._platform_provision_actor === actorId), "Owned Auth cleanup proof failed")
            requireProof(!(await admin.auth.admin.deleteUser(id, true)).error, "Owned Auth retirement failed")
          } else requireProof(!identity.error || identity.error.status === 404, "Owned Auth absence could not be verified")
        } catch { cleanupFailed = true }
      }
    }
    authorization = undefined
    browserIntent = undefined
    if (routeInstalled) {
      try { await page.unroute(platformRoute, routeHandler) } catch { cleanupFailed = true }
    }
    if (viewport) await page.setViewportSize(viewport).catch(() => {})
    await page.goto(new URL("/dashboard?lang=" + (originalLocale ?? "en"), app).href).catch(() => {})
    // Company, role, accounting, user, assignment and audit history is retained.
    // The containing runner alone owns retirement of its original release owner.
    if (cleanupFailed) throw Error("Owned platform user fixture cleanup failed" + (failed ? " after acceptance failure" : ""))
  }
  console.log("PASS: platform user UI creation/replay, role/status/archive persistence, synchronized access/audits, stale conflict, protected actor and last-owner denials; owned access retired")
}
