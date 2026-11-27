# Preserve receipt originals across uncertain registration outcomes

The receipt registration helper currently removes Storage objects after every RPC error. A committed registration whose response is lost, or a retry that hits the unique storage-path constraint, can therefore lose its original supporting document.

Keep the existing server-only helper, caller guards, content validation, tenant/claim path checks and RPC authorization. Never delete an original from this helper: a failed response does not prove the object is unreferenced or exclusively owned by this attempt. Rejected/unregistered objects remain private pending a separately proven orphan-retirement policy; this change does not establish that policy or the complete Telegram inbox lifecycle.

For an unknown outcome or unique-path rejection, reconcile read-only against the exact tenant, claim, path, uploader, source, content hash, size, MIME, kind and normalized filename. Return only a valid attachment ID and the retained claim's valid duplicate status. Failed/mismatching reads remain a safe bilingual failure; no raw diagnostics reach users. Definite permission/workflow rejection must not become success through reconciliation. Validate successful RPC responses as well.

No database, provider, Production data/permission or secret changes are part of this repair. Tests use synthetic bytes and clients. Existing routes and UI stay unchanged. Full application validation and independent review precede publication; hosted acceptance and the remaining launch gates stay required.
