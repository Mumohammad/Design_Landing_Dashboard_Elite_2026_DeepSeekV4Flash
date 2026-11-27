import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomInt, randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { pathToFileURL } from "node:url"

export async function verifyTelegramReceiptConcurrency(sql) {
  const owner = randomUUID()
  const username = `telegram-${owner}`
  const chat = randomInt(1_000_000_000)
  const bot = randomInt(1_000_000_000)
  const link = randomUUID()
  const tenant = await sql(`
    INSERT INTO auth.users(id,email,raw_app_meta_data)
      VALUES('${owner}','${username}@example.test','{"_invite_provisioned":true}');
    SELECT public.provision_company_atomic('${owner}',
      jsonb_build_object('name','Telegram concurrency fixture','slug','${username}','domain','${username}.example.test'))->>'id';
  `)
  assert.match(tenant, /^[a-f0-9-]{36}$/)
  await sql(`
    UPDATE public.users SET must_change_password=false WHERE auth_user_id='${owner}';
    INSERT INTO public.expense_claim_settings(tenant_id,telegram_enabled) VALUES('${tenant}',true)
      ON CONFLICT(tenant_id) DO UPDATE SET telegram_enabled=true;
    INSERT INTO public.expense_telegram_links(id,tenant_id,user_id,telegram_user_id,telegram_chat_id,linked_at)
      VALUES('${link}','${tenant}','${owner}',${chat},${chat},now()-interval '1 minute');
    INSERT INTO storage.buckets(id,name,public) VALUES('expense-receipts','expense-receipts',false) ON CONFLICT DO NOTHING;
  `)

  const reserve = async (update, message, album = "test-album") => JSON.parse(await sql(`
    SELECT public.expense_telegram_reserve_receipt(${bot},${update},${chat},${chat},${message},
      floor(extract(epoch FROM now()))::bigint,'${link}','${album}',repeat('a',64),
      jsonb_build_object('filename','receipt.pdf','size',100,'mime','application/pdf','kind','digital_pdf','sha256',repeat('b',64)));
  `))
  const reservations = await Promise.all([reserve(1, 1), reserve(1, 1), reserve(2, 2), reserve(2, 2)])
  assert.equal(new Set(reservations.map(result => result.claim_id)).size, 1)
  assert.deepEqual(reservations[0], reservations[1])
  assert.deepEqual(reservations[2], reservations[3])
  assert.notEqual(reservations[0].path, reservations[2].path)

  const paths = [reservations[0].path, reservations[2].path]
  for (const path of paths) assert.match(path, /^[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9-]+\.pdf$/)
  await sql(`
    INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
      ('expense-receipts','${paths[0]}','{"size":100,"mimetype":"application/pdf"}'),
      ('expense-receipts','${paths[1]}','{"size":100,"mimetype":"application/pdf"}');
  `)
  const results = await Promise.all(reservations.map(async (reservation, index) => {
    assert.match(reservation.receipt_id, /^[a-f0-9-]{36}$/)
    const suggestions = index < 2 ? "{}" : '{"supplier_name":"Race fixture"}'
    return JSON.parse(await sql(`SELECT public.expense_telegram_finish_receipt_with_reply('${reservation.receipt_id}','${suggestions}');`))
  }))
  assert.equal(results.filter(result => result.created).length, 1)
  assert.equal(new Set(results.map(result => result.attachment_id)).size, 2)
  assert.equal(await sql(`SELECT count(*)||'|'||min(supplier_name) FROM public.expense_claims WHERE tenant_id='${tenant}';`), "1|Race fixture")
  assert.equal(await sql(`SELECT count(*) FROM public.expense_claim_attachments WHERE tenant_id='${tenant}';`), "2")
  assert.equal(await sql(`SELECT count(*) FROM public.expense_claim_events WHERE tenant_id='${tenant}' AND action='submitted';`), "1")

  const claim = async receiptId => JSON.parse(await sql(`BEGIN; SET LOCAL ROLE service_role;
    SELECT public.expense_telegram_claim_confirmation(${bot},${receiptId ? `'${receiptId}'` : "NULL"});
    SELECT pg_sleep(0.05); COMMIT;`) || "null")
  const deliveries = (await Promise.all(reservations.map(reservation => claim(reservation.receipt_id)))).filter(Boolean)
  assert.equal(deliveries.length, 1)
  const delivery = deliveries[0]
  assert.equal(delivery.state, "sending")
  assert.equal(Number(delivery.chat_id), chat)
  assert.match(delivery.claim_id, /^[a-f0-9-]{36}$/)
  assert.match(delivery.token, /^[a-f0-9-]{36}$/)
  assert.equal(await sql(`BEGIN; SET LOCAL ROLE service_role;
    SELECT public.expense_telegram_finish_confirmation('${delivery.claim_id}','${delivery.token}','sent',42,NULL);
    COMMIT;`), "t")
  assert.equal(await claim(reservations[0].receipt_id), null)
  assert.equal(await sql(`SELECT count(*) FROM expense_claims_private.telegram_confirmations WHERE bot_id=${bot} AND state='sent' AND provider_message_id=42;`), "1")

  const queue = async (update, album) => {
    const receipt = await reserve(update, update, album)
    assert.match(receipt.receipt_id, /^[a-f0-9-]{36}$/)
    assert.match(receipt.claim_id, /^[a-f0-9-]{36}$/)
    assert.match(receipt.path, /^[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9-]+\.pdf$/)
    await sql(`INSERT INTO storage.objects(bucket_id,name,metadata)
      VALUES ('expense-receipts','${receipt.path}','{"size":100,"mimetype":"application/pdf"}');
      SELECT public.expense_telegram_finish_receipt_with_reply('${receipt.receipt_id}','{}');`)
    return receipt
  }
  const withHeldLock = async (action, statement, check) => {
    const lockSession = `telegram-${action}-${owner}`
    const locking = sql(`SET application_name = '${lockSession}'; BEGIN;
      ${statement}
      SELECT pg_sleep(3); COMMIT;`)
    locking.catch(() => {})
    try {
      let lockHeld = false
      for (let i = 0; i < 15 && !lockHeld; i++) {
        lockHeld = await sql(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE application_name='${lockSession}' AND wait_event='PgSleep'
        );`) === "t"
        if (!lockHeld) await delay(75)
      }
      assert.ok(lockHeld, `${action} must hold its row lock before claiming`)
      await check()
    } finally {
      await locking
    }
  }

  const locked = await queue(3, "locked-album")
  const next = await queue(4, "next-album")
  await withHeldLock("edit", `SELECT 1 FROM public.expense_claims WHERE id='${locked.claim_id}' FOR UPDATE;`, async () => {
    assert.deepEqual(await claim(null), { state: "deferred" })
    const ready = await claim(null)
    assert.equal(ready.state, "sending")
    assert.equal(ready.claim_id, next.claim_id)
    assert.equal(await claim(locked.receipt_id), null)
  })

  const revoked = await queue(5, "revoked-album")
  await withHeldLock("unlink", `UPDATE public.expense_telegram_links SET revoked_at=clock_timestamp() WHERE id='${link}';`, async () => {
    assert.deepEqual(await claim(revoked.receipt_id), { state: "suppressed" })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] !== "--local-disposable") throw Error("Requires the disposable local Supabase database")
  const sql = statement => new Promise((accept, reject) => {
    const child = spawn("docker", ["exec", "-i", "supabase_db_elite-release-20261012",
      "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
    let output = ""
    let errors = ""
    child.stdout.on("data", chunk => { output += chunk })
    child.stderr.on("data", chunk => { errors += chunk })
    child.on("error", reject)
    child.on("close", code => code === 0 ? accept(output.trim()) : reject(Error(errors)))
    child.stdin.end("SET statement_timeout='30s';" + statement)
  })
  await verifyTelegramReceiptConcurrency(sql)
  console.log("PASS: concurrent Telegram intake gets one confirmation, a locked claim defers alone, and unlink suppresses delivery")
}
