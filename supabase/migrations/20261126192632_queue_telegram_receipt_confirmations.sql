BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE expense_claims_private.telegram_confirmations (
  claim_id uuid PRIMARY KEY REFERENCES public.expense_claims(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL UNIQUE REFERENCES expense_claims_private.telegram_receipts(id) ON DELETE CASCADE,
  bot_id bigint NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','sending','sent','uncertain','rejected','suppressed')),
  due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  token uuid,
  provider_message_id bigint CHECK (provider_message_id > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((state = 'sending') = (token IS NOT NULL)),
  CHECK ((state = 'sent') = (provider_message_id IS NOT NULL))
);
CREATE INDEX telegram_confirmations_ready
  ON expense_claims_private.telegram_confirmations (bot_id, due_at, claim_id)
  WHERE state IN ('pending','sending');
ALTER TABLE expense_claims_private.telegram_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE expense_claims_private.telegram_confirmations FROM PUBLIC, anon, authenticated, service_role;

-- Keep the original intake contract for older callers. Only a newly created
-- claim on this entry point queues a reply, in the same transaction.
CREATE FUNCTION public.expense_telegram_finish_receipt_with_reply(p_receipt_id uuid, p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.expense_telegram_finish_receipt(p_receipt_id, p_fields);
  IF v_result->'created' = 'true'::jsonb THEN
    INSERT INTO expense_claims_private.telegram_confirmations (claim_id, receipt_id, bot_id)
    SELECT claim_id, id, bot_id FROM expense_claims_private.telegram_receipts WHERE id = p_receipt_id;
  END IF;
  RETURN v_result;
END $$;

CREATE FUNCTION public.expense_telegram_claim_confirmation(p_bot_id bigint, p_receipt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_requested expense_claims_private.telegram_receipts%ROWTYPE;
  v_reply expense_claims_private.telegram_confirmations%ROWTYPE;
  v_original expense_claims_private.telegram_receipts%ROWTYPE;
  v_identity jsonb;
  v_claim_available boolean := false;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_receipt_id IS NOT NULL THEN
    SELECT * INTO v_requested FROM expense_claims_private.telegram_receipts
    WHERE id = p_receipt_id AND bot_id = p_bot_id AND result IS NOT NULL;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;

  SELECT q.* INTO v_reply
  FROM expense_claims_private.telegram_confirmations AS q
  JOIN expense_claims_private.telegram_receipts AS r ON r.id = q.receipt_id AND r.bot_id = q.bot_id
  WHERE q.bot_id = p_bot_id AND q.state IN ('pending','sending') AND q.due_at <= v_now
    AND (p_receipt_id IS NULL OR (
      q.claim_id = v_requested.claim_id AND r.link_id = v_requested.link_id AND r.chat_id = v_requested.chat_id
    ))
  ORDER BY q.due_at, q.claim_id
  LIMIT 1
  FOR UPDATE OF q SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- An expired sender may already have posted the message. Quarantine the
  -- outcome instead of giving another worker permission to send it.
  IF v_reply.state = 'sending' THEN
    UPDATE expense_claims_private.telegram_confirmations
    SET state = 'uncertain', token = NULL, updated_at = v_now WHERE claim_id = v_reply.claim_id;
    RETURN jsonb_build_object('state', 'uncertain');
  END IF;

  SELECT * INTO STRICT v_original FROM expense_claims_private.telegram_receipts WHERE id = v_reply.receipt_id;
  -- Hold the original link through the claim transaction so an unlink that
  -- acquired the link first cannot authorize an in-flight reply.
  PERFORM 1 FROM public.expense_telegram_links
  WHERE id = v_original.link_id AND telegram_user_id = v_original.chat_id
    AND telegram_chat_id = v_original.chat_id AND revoked_at IS NULL
  FOR SHARE;
  IF FOUND THEN v_identity := public.expense_telegram_identity(v_original.chat_id, v_original.chat_id); END IF;
  IF v_identity->'ok' = 'true'::jsonb AND v_identity->>'link_id' = v_original.link_id::text THEN
    BEGIN
      PERFORM 1 FROM public.expense_claims AS c
      WHERE c.id = v_reply.claim_id AND c.deleted_at IS NULL
        AND c.tenant_id::text = v_identity->>'tenant_id' AND c.submitter_id::text = v_identity->>'user_id'
      FOR SHARE NOWAIT;
      v_claim_available := FOUND;
    EXCEPTION WHEN lock_not_available THEN
      -- A claim deletion can hold the source row before its cascade touches
      -- the queue. Defer only this reply so the drain can claim other work.
      UPDATE expense_claims_private.telegram_confirmations
      SET due_at = clock_timestamp() + interval '30 seconds', updated_at = clock_timestamp()
      WHERE claim_id = v_reply.claim_id;
      RETURN jsonb_build_object('state', 'deferred');
    END;
  END IF;
  IF NOT v_claim_available THEN
    UPDATE expense_claims_private.telegram_confirmations
    SET state = 'suppressed', updated_at = v_now WHERE claim_id = v_reply.claim_id;
    RETURN jsonb_build_object('state', 'suppressed');
  END IF;

  v_now := clock_timestamp();
  UPDATE expense_claims_private.telegram_confirmations
  SET state = 'sending', token = gen_random_uuid(), due_at = v_now + interval '2 minutes', updated_at = v_now
  WHERE claim_id = v_reply.claim_id RETURNING * INTO v_reply;
  RETURN jsonb_build_object('state','sending', 'claim_id',v_reply.claim_id, 'token',v_reply.token,
    'chat_id',v_original.chat_id, 'claim_no',v_original.result->>'claim_no',
    'duplicate_status',v_original.result->>'duplicate_status');
END $$;

CREATE FUNCTION public.expense_telegram_finish_confirmation(
  p_claim_id uuid, p_token uuid, p_state text, p_message_id bigint, p_retry_after integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('sent','retry','uncertain','rejected')
    OR (p_state = 'sent' AND (p_message_id IS NULL OR p_message_id <= 0))
    OR (p_state <> 'sent' AND p_message_id IS NOT NULL)
    OR (p_state = 'retry' AND (p_retry_after IS NULL OR p_retry_after <= 0))
    OR (p_state <> 'retry' AND p_retry_after IS NOT NULL) THEN
    RAISE EXCEPTION 'TG_CONFIRMATION: invalid delivery result' USING ERRCODE = '22023';
  END IF;
  UPDATE expense_claims_private.telegram_confirmations
  SET state = CASE WHEN p_state = 'retry' THEN 'pending' ELSE p_state END,
      token = NULL, provider_message_id = p_message_id, updated_at = v_now,
      due_at = CASE WHEN p_state = 'retry' THEN v_now + make_interval(secs => p_retry_after) ELSE v_now END
  WHERE claim_id = p_claim_id AND state = 'sending' AND token = p_token;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.expense_telegram_finish_receipt_with_reply(uuid,jsonb),
  public.expense_telegram_claim_confirmation(bigint,uuid),
  public.expense_telegram_finish_confirmation(uuid,uuid,text,bigint,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expense_telegram_finish_receipt_with_reply(uuid,jsonb),
  public.expense_telegram_claim_confirmation(bigint,uuid),
  public.expense_telegram_finish_confirmation(uuid,uuid,text,bigint,integer) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
