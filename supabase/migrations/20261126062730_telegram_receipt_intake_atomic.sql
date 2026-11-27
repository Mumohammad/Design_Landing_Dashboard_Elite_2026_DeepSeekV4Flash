BEGIN;

-- Reserve a stable object path before reaching Storage. A claim becomes
-- visible only when its original and attachment metadata can be committed.
CREATE TABLE expense_claims_private.telegram_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id bigint NOT NULL,
  update_id bigint NOT NULL,
  chat_id bigint NOT NULL,
  message_id bigint NOT NULL,
  link_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  media_group text,
  fingerprint text NOT NULL,
  file_data jsonb NOT NULL,
  storage_path text NOT NULL UNIQUE,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (bot_id, chat_id, message_id)
);
CREATE INDEX telegram_receipts_update_idx ON expense_claims_private.telegram_receipts (bot_id, update_id, created_at DESC);
CREATE INDEX telegram_receipts_album_idx ON expense_claims_private.telegram_receipts
  (link_id, bot_id, media_group, created_at DESC) WHERE media_group IS NOT NULL;
ALTER TABLE expense_claims_private.telegram_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE expense_claims_private.telegram_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.expense_telegram_identity(p_tg_user bigint,p_chat bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE sender public.expense_telegram_links; settings public.expense_claim_settings;
BEGIN
  SELECT * INTO sender FROM public.expense_telegram_links
    WHERE telegram_user_id = p_tg_user AND telegram_chat_id = p_chat AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_linked'); END IF;
  IF expense_claims_private.tenant_of(sender.user_id) IS DISTINCT FROM sender.tenant_id
    OR expense_claims_private.user_can(sender.user_id,'create') IS NOT TRUE THEN
    RETURN jsonb_build_object('ok',false,'reason','not_authorized');
  END IF;
  settings := expense_claims_private.settings(sender.tenant_id);
  IF NOT settings.telegram_enabled THEN RETURN jsonb_build_object('ok',false,'reason','disabled'); END IF;
  RETURN jsonb_build_object('ok',true,'user_id',sender.user_id,'tenant_id',sender.tenant_id,
    'currency',settings.default_currency,'link_id',sender.id);
END;
$$;

CREATE FUNCTION public.expense_telegram_reserve_receipt(
  p_bot_id bigint, p_update_id bigint, p_sender_id bigint, p_chat_id bigint,
  p_message_id bigint, p_message_date bigint, p_link_id uuid, p_media_group text, p_fingerprint text, p_file jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sender public.expense_telegram_links;
  receipt expense_claims_private.telegram_receipts;
  claim_id uuid;
  object_id uuid := gen_random_uuid();
  extension text;
BEGIN
  extension := CASE p_file->>'mime'
    WHEN 'application/pdf' THEN 'pdf' WHEN 'application/xml' THEN 'xml'
    WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp'
    WHEN 'image/heic' THEN 'heic' WHEN 'image/heif' THEN 'heif'
  END;
  IF p_bot_id IS NULL OR p_bot_id <= 0 OR p_update_id IS NULL OR p_update_id < 0
    OR p_message_id IS NULL OR p_message_id <= 0 OR p_sender_id IS NULL OR p_sender_id <= 0
    OR p_message_date IS NULL OR p_message_date <= 0 OR p_link_id IS NULL
    OR p_chat_id IS DISTINCT FROM p_sender_id OR length(p_media_group) NOT BETWEEN 1 AND 64
    OR (p_fingerprint ~ '^[a-f0-9]{64}$') IS NOT TRUE OR extension IS NULL
    OR (p_file->>'sha256' ~ '^[a-f0-9]{64}$') IS NOT TRUE
    OR (length(p_file->>'filename') BETWEEN 1 AND 200) IS NOT TRUE
    OR (p_file->>'filename' !~ '[/\\]') IS NOT TRUE
    OR (p_file->>'kind' IN ('photo','scanned_pdf','digital_pdf','structured_einvoice')) IS NOT TRUE
    OR (p_file->>'size' ~ '^[0-9]{1,8}$') IS NOT TRUE THEN
    RAISE EXCEPTION 'TG_RECEIPT_CONFLICT: invalid receipt identity or metadata';
  END IF;
  IF (p_file->>'size')::integer NOT BETWEEN 1 AND 10485760 THEN
    RAISE EXCEPTION 'TG_RECEIPT_CONFLICT: invalid receipt size';
  END IF;

  -- Lock order for both entry points is link, then receipt, then claim.
  -- This serializes messages within an album and orders revocation with intake.
  SELECT * INTO sender FROM public.expense_telegram_links
    WHERE id = p_link_id AND telegram_user_id = p_sender_id AND telegram_chat_id = p_chat_id AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND OR public.expense_telegram_identity(p_sender_id,p_chat_id)->>'ok' IS DISTINCT FROM 'true'
    OR p_message_date < extract(epoch FROM date_trunc('second',sender.linked_at)) THEN
    RAISE EXCEPTION 'TG_RECEIPT_DENIED: active Telegram link required';
  END IF;

  SELECT * INTO receipt FROM expense_claims_private.telegram_receipts r
    WHERE r.bot_id = p_bot_id AND r.chat_id = p_chat_id AND r.message_id = p_message_id;
  IF FOUND THEN
    IF receipt.link_id <> sender.id OR receipt.update_id <> p_update_id
      OR receipt.fingerprint <> p_fingerprint OR receipt.file_data <> p_file
      OR receipt.media_group IS DISTINCT FROM p_media_group THEN
      RAISE EXCEPTION 'TG_RECEIPT_CONFLICT: message already belongs to another receipt';
    END IF;
  ELSE
    -- Telegram can choose a new update sequence after a week of inactivity.
    -- Bind update IDs over the redelivery window and keep message keys durable.
    PERFORM pg_advisory_xact_lock(hashtextextended('telegram-receipt:' || p_bot_id::text || ':' || p_update_id::text,0));
    IF EXISTS (SELECT 1 FROM expense_claims_private.telegram_receipts r
      WHERE r.bot_id = p_bot_id AND r.update_id = p_update_id AND r.created_at > now() - interval '48 hours') THEN
      RAISE EXCEPTION 'TG_RECEIPT_CONFLICT: update already belongs to another receipt';
    END IF;
    IF p_media_group IS NOT NULL THEN
      SELECT r.claim_id INTO claim_id FROM expense_claims_private.telegram_receipts r
        WHERE r.link_id = sender.id AND r.bot_id = p_bot_id AND r.media_group = p_media_group
        ORDER BY r.created_at DESC LIMIT 1;
      IF NOT FOUND THEN
        -- A rollout can start between two pages of an existing album.
        SELECT c.id INTO claim_id FROM public.expense_claims c
          WHERE c.tenant_id = sender.tenant_id AND c.submitter_id = sender.user_id
            AND c.telegram_media_group = p_media_group AND c.source = 'telegram' AND c.deleted_at IS NULL
            AND c.created_at >= greatest(sender.linked_at, now() - interval '15 minutes')
          ORDER BY c.created_at DESC,c.id LIMIT 1;
      END IF;
    END IF;
    claim_id := coalesce(claim_id, gen_random_uuid());
    INSERT INTO expense_claims_private.telegram_receipts
      (bot_id,update_id,chat_id,message_id,link_id,claim_id,media_group,fingerprint,file_data,storage_path)
    VALUES (p_bot_id,p_update_id,p_chat_id,p_message_id,sender.id,claim_id,p_media_group,p_fingerprint,p_file,
      sender.tenant_id::text || '/' || claim_id::text || '/' || object_id::text || '.' || extension)
    RETURNING * INTO receipt;
  END IF;
  RETURN jsonb_build_object('receipt_id',receipt.id,'claim_id',receipt.claim_id,
    'path',receipt.storage_path,'completed',receipt.result IS NOT NULL);
END;
$$;

CREATE FUNCTION public.expense_telegram_finish_receipt(p_receipt_id uuid,p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  intake expense_claims_private.telegram_receipts;
  sender public.expense_telegram_links;
  claim public.expense_claims;
  object_metadata jsonb;
  attachment jsonb;
  created boolean;
  confirmation jsonb;
  identity jsonb;
BEGIN
  SELECT * INTO intake FROM expense_claims_private.telegram_receipts WHERE id = p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TG_RECEIPT_CONFLICT: receipt reservation required'; END IF;
  SELECT * INTO sender FROM public.expense_telegram_links WHERE id = intake.link_id AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TG_RECEIPT_DENIED: active Telegram link required'; END IF;
  identity := public.expense_telegram_identity(sender.telegram_user_id,sender.telegram_chat_id);
  IF identity->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'TG_RECEIPT_DENIED: active Telegram link required'; END IF;
  SELECT * INTO STRICT intake FROM expense_claims_private.telegram_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF intake.result IS NOT NULL THEN RETURN intake.result || '{"created":false}'::jsonb; END IF;
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object' OR octet_length(p_fields::text) > 131072 THEN
    RAISE EXCEPTION 'TG_RECEIPT_CONFLICT: invalid claim suggestions';
  END IF;

  SELECT metadata INTO object_metadata FROM storage.objects
    WHERE bucket_id = 'expense-receipts' AND name = intake.storage_path FOR SHARE;
  IF NOT FOUND OR object_metadata->>'size' IS DISTINCT FROM intake.file_data->>'size'
    OR lower(object_metadata->>'mimetype') IS DISTINCT FROM intake.file_data->>'mime' THEN
    RAISE EXCEPTION 'TG_RECEIPT_OBJECT: verified receipt upload required';
  END IF;

  SELECT * INTO claim FROM public.expense_claims WHERE id = intake.claim_id FOR UPDATE;
  created := NOT FOUND;
  IF created THEN
    INSERT INTO public.expense_claims
      (id,tenant_id,claim_no,submitter_id,currency,source,status,submitted_at,telegram_media_group,created_by,updated_by)
    VALUES (intake.claim_id,sender.tenant_id,
      'EXP-' || to_char(now() AT TIME ZONE 'Asia/Riyadh','YYMM') || '-' ||
        upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),
      sender.user_id,identity->>'currency','telegram','submitted',now(),intake.media_group,sender.user_id,sender.user_id)
    RETURNING * INTO claim;
    IF p_fields <> '{}'::jsonb THEN
      PERFORM expense_claims_private.apply_fields(claim.id,p_fields,sender.user_id);
    END IF;
    PERFORM expense_claims_private.log(claim,sender.user_id,'submitted',NULL,'submitted',
      jsonb_build_object('fields',p_fields - 'ocr_suggestions'),'Submitted via Telegram (details unverified)','telegram');
  ELSIF claim.tenant_id <> sender.tenant_id OR claim.submitter_id <> sender.user_id OR claim.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'TG_RECEIPT_CONFLICT: receipt claim unavailable';
  ELSIF intake.media_group IS NOT NULL AND claim.status = 'submitted' AND claim.version = 1 AND p_fields <> '{}'::jsonb THEN
    -- An uncaptioned page can finish first. Fill suggestions once while
    -- the claim still has its original version; preserve any human edits.
    PERFORM expense_claims_private.apply_fields(claim.id,p_fields,sender.user_id);
    PERFORM expense_claims_private.log(claim,sender.user_id,'edited','submitted','submitted',
      jsonb_build_object('fields',p_fields - 'ocr_suggestions'),'Album caption received (details unverified)','telegram');
  END IF;

  attachment := public.expense_claim_attach(sender.user_id,claim.id,intake.storage_path,
    intake.file_data->>'filename',intake.file_data->>'mime',(intake.file_data->>'size')::integer,
    intake.file_data->>'sha256',intake.file_data->>'kind','telegram');
  confirmation := jsonb_build_object('claim_id',claim.id,'claim_no',claim.claim_no,'created',created,
    'attachment_id',attachment->>'id','duplicate_status',attachment->>'duplicate_status');
  UPDATE expense_claims_private.telegram_receipts SET result = confirmation WHERE id = p_receipt_id;
  RETURN confirmation;
END;
$$;

REVOKE ALL ON FUNCTION public.expense_telegram_reserve_receipt(bigint,bigint,bigint,bigint,bigint,bigint,uuid,text,text,jsonb),
  public.expense_telegram_finish_receipt(uuid,jsonb), public.expense_telegram_identity(bigint,bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expense_telegram_reserve_receipt(bigint,bigint,bigint,bigint,bigint,bigint,uuid,text,text,jsonb),
  public.expense_telegram_finish_receipt(uuid,jsonb), public.expense_telegram_identity(bigint,bigint) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
