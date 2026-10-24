import { randomBytes, randomUUID } from "node:crypto"
import { expect as baseExpect } from "@playwright/test"
import { assertModuleTestTarget } from "./assert-module-test-target.mjs"

const expect = baseExpect.configure({ timeout: 25_000 })
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? "")
const requireProof = (condition, message) => { if (!condition) throw Error(message) }
const userFields = "id,auth_user_id,tenant_id,email,role,status,version,must_change_password,created_by,deleted_at"

/**
 * Mutating acceptance for the coordinated runner's authenticated AAL2 owner.
 * Only its release-UUID@example.test identity receives a temporary admin marker.
 * All global mutations target a new synthetic company, never another tenant.
 * Do not run with tracing, video, HAR recording, or request/body logging enabled.
 */
export async function verifyPlatformAdminUsers(page, admin, tenantId, appUrl, actorId) {
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

  const app = new URL(appUrl)
  const tag = randomUUID()
  const marker = "platform-user-acceptance:" + tag
  const ownerAuthId = randomUUID()
  const ownerEmail = "platform-owner-" + tag + "@example.test"
  const memberEmail = "platform-member-" + tag + "@example.test"
  const companyName = "Platform acceptance " + tag
  let targetTenantId, memberId, requestId, authorization, creationPayload, reservationInput, reservedAuthId
  let markerInserted = false, ownerAttempted = false, failed = false
  let password = "Fixture!" + randomBytes(24).toString("base64url") + "aA1"
  let stage = "synthetic caller authentication"
  const viewport = page.viewportSize()
  const originalLocale = await page.locator("html").getAttribute("lang")
  const endpoint = new URL("/api/platform/admin/users", app).href
  const isApi = (request, method) => new URL(request.url()).origin === app.origin && new URL(request.url()).pathname === "/api/platform/admin/users" && request.method() === method
  const api = (method, data, authenticated = true) => page.request.fetch(endpoint, { method, headers: authenticated ? { Authorization: authorization } : {}, ...(data ? { data } : {}) })
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
  const review = async (button, reason, method = "PATCH") => {
    await button.click()
    const dialog = page.getByTestId("platform-user-review")
    await expect(dialog).toBeVisible()
    await dialog.locator("#platform-user-reason").fill(reason)
    const pending = page.waitForResponse(response => isApi(response.request(), method))
    await dialog.getByTestId("platform-user-confirm").click()
    const response = await pending
    requireProof(response.ok(), "Reviewed platform mutation was rejected")
    await expect(dialog).toBeHidden()
    return response.request().postDataJSON()
  }

  try {
    // Stop any accidental tracing before handling an access token or password.
    await page.context().tracing.stop()
    requireProof(!page.video(), "Platform acceptance requires an unrecorded browser context")
    const tokenRequest = page.waitForRequest(request => new URL(request.url()).origin === app.origin && new URL(request.url()).pathname === "/api/platform/admin/me")
    await page.goto(new URL("/platform/admin?lang=en", app).href)
    authorization = await (await tokenRequest).headerValue("authorization")
    requireProof(/^Bearer\s+\S+$/i.test(authorization ?? ""), "Authenticated platform browser session required")
    const verifiedActor = await admin.auth.getUser(authorization.replace(/^Bearer\s+/i, ""))
    requireProof(!verifiedActor.error && verifiedActor.data.user?.id === actorId && verifiedActor.data.user.email === actor.email, "Browser session does not match the synthetic release owner")
    requireProof((await api("GET")).status() === 403, "Non-admin browser session gained global user access")
    requireProof((await api("GET", undefined, false)).status() === 401, "Unauthenticated request gained global user access")

    stage = "temporary synthetic platform authority"
    const granted = await admin.from("platform_admins").insert({ user_id: actorId, email: actor.email, note: marker, created_by: actorId }).select("user_id").single()
    requireProof(!granted.error && granted.data?.user_id === actorId, "Synthetic platform admin grant failed")
    markerInserted = true

    stage = "separate synthetic company and last owner"
    ownerAttempted = true
    const owner = await admin.auth.admin.createUser({ id: ownerAuthId, email: ownerEmail, password, email_confirm: true, app_metadata: { _invite_provisioned: true, _platform_acceptance: tag } })
    requireProof(!owner.error && owner.data.user?.id === ownerAuthId, "Synthetic platform target owner creation failed")
    const company = await admin.rpc("provision_company_atomic", { p_auth_user_id: ownerAuthId, p_company: { name: companyName, domain: tag + ".test", slug: "platform-acceptance-" + tag } })
    requireProof(!company.error && uuid(company.data?.id) && company.data.id !== tenantId, "Synthetic platform target company creation failed")
    targetTenantId = company.data.id
    const targetOwner = await admin.from("users").select(userFields).eq("tenant_id", targetTenantId).eq("auth_user_id", ownerAuthId).eq("email", ownerEmail).single()
    requireProof(!targetOwner.error && targetOwner.data.role === "general_manager" && targetOwner.data.status === "active", "Synthetic target owner proof failed")

    stage = "global UI initial-password creation"
    await openUsers()
    await page.getByTestId("platform-user-create").click()
    const create = page.getByTestId("platform-user-create-form")
    await create.locator("#platform-new-tenant").selectOption(targetTenantId)
    await create.locator("#platform-new-email").fill(memberEmail)
    await create.locator("#platform-new-name").fill("Platform member " + tag)
    await create.locator("#platform-new-role").selectOption("readonly_auditor")
    await create.locator("#platform-new-password").fill(password)
    const creatingRequest = page.waitForRequest(request => isApi(request, "POST")).then(request => {
      creationPayload = request.postDataJSON()
      requestId = creationPayload.request_id
      requireProof(uuid(requestId) && creationPayload.tenant_id === targetTenantId && creationPayload.email === memberEmail && creationPayload.role === "readonly_auditor", "Global UI creation request differs from the owned fixture")
      reservationInput = { p_request_id: requestId, p_tenant_id: targetTenantId, p_email: memberEmail, p_role: creationPayload.role, p_full_name: creationPayload.full_name ?? null }
    })
    const creating = page.waitForResponse(response => isApi(response.request(), "POST"))
    const [, created] = await Promise.all([creatingRequest, creating, create.getByTestId("platform-new-submit").click()])
    requireProof(created.ok() && uuid(requestId), "Global UI user creation failed")
    await expect(create).toBeHidden()
    const member = await admin.from("users").select(userFields).eq("tenant_id", targetTenantId).eq("email", memberEmail).single()
    requireProof(!member.error && member.data.created_by === actorId && member.data.role === "readonly_auditor" && member.data.status === "active" && member.data.must_change_password === true, "Initial-password user state differs")
    memberId = member.data.id
    reservedAuthId = member.data.auth_user_id
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
    await rowFor(memberId).getByRole("combobox").selectOption("supervisor")
    const roleReview = page.getByTestId("platform-user-review")
    await roleReview.locator("#platform-user-reason").fill("Synthetic global operational reassignment")
    const changingRole = page.waitForResponse(response => isApi(response.request(), "PATCH"))
    await roleReview.getByTestId("platform-user-confirm").click()
    requireProof((await changingRole).ok(), "Global UI role review failed")
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
      await review(rowFor(memberId).getByTestId("platform-user-status"), "Synthetic global status " + next)
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
  } catch {
    failed = true
    throw Error("Platform user acceptance failed: " + stage)
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
            requireProof(!identity.error && (id === ownerAuthId ? user.email === ownerEmail && user.app_metadata?._platform_acceptance === tag : user.email === memberEmail && user.app_metadata?._platform_provision_request === requestId && user.app_metadata?._platform_provision_tenant === targetTenantId && user.app_metadata?._platform_provision_actor === actorId), "Owned Auth cleanup proof failed")
            requireProof(!(await admin.auth.admin.deleteUser(id, true)).error, "Owned Auth retirement failed")
          } else requireProof(!identity.error || identity.error.status === 404, "Owned Auth absence could not be verified")
        } catch { cleanupFailed = true }
      }
    }
    authorization = undefined
    if (viewport) await page.setViewportSize(viewport).catch(() => {})
    await page.goto(new URL("/dashboard?lang=" + (originalLocale ?? "en"), app).href).catch(() => {})
    // Company, role, accounting, user, assignment and audit history is retained.
    // The containing runner alone owns retirement of its original release owner.
    if (cleanupFailed) throw Error("Owned platform user fixture cleanup failed" + (failed ? " after acceptance failure" : ""))
  }
  console.log("PASS: platform user UI creation/replay, role/status/archive persistence, synchronized access/audits, stale conflict, protected actor and last-owner denials; owned access retired")
}
