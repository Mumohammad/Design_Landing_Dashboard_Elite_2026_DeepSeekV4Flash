# VAT response selection correction

## Confirmed cause and scope

Current exact Preview `9a4fc52f73eed01aba5bc27432f3f37465b80bf2` failed VAT verification while reading the response body at helper line29, before any aggregate assertion ran. An owned, assertion-preserving diagnostic selected methodOPTIONS/status200 and failed with an unavailable response body. Both additional diagnostic runs were independently retired successfully. Their IDs are `304fccf8-3016-48f0-b742-0c2e3037df17` and `9636284d-adb7-4ed5-b60e-ac7a4afbb271`.

The listener previously selected by RPC pathname alone. Require the actual POST. Keep failed POST responses eligible, so HTTP failures cannot be hidden by the selector. All expected financial values, classification, paging, retry, locale and cleanup assertions remain unchanged. No application, database, grant or Production setting changes are required for this verifier repair.

## Work and verification

- [x] Reproduce the exact failure with the selected response method and independently verified cleanup.
- [x] Add a regression observing the real verifier's listener against preflight, unrelatedRPC, successfulPOST and rejectedPOST events; observeRED on the original selector.
- [x] RequirePOST in the listener and observeGREEN; include the regression in the existing CI guard command.
- [x] Run full local validation against a frozen inventory and get an independent scoped review.
- [x] Run the complete VAT browser helper against the exact staging Preview with the corrected local verifier and retire its fixtures; only response selection changed, financial assertions retained.
- [ ] Publish the reviewed candidate/Preview, run current-head hosted CI, and record the outcomes. Merge/Production remain blocked while required checks or launch issues remain unresolved.

Earlier reports describing this specific failure as an aggregate assertion were too broad: the recorded callsite was responseJSON reading. The selector change alone does not prove the totals correct; that requires completing the retained assertions. Other hosted failures, national-address schema mismatch, recovery access, exact invoice/sample identity and provider acceptance are separate gates.

The corrected local verifier completed the retained helper on the exact9a4fc52 staging application: outputVAT61.50, recoverableinput20.50, outputadjustments10.50, inputadjustments1.10 and net50.40. Finalized-only inclusion, unavailable/malformed reads, retry, paging and Arabic mobile checks passed; browser runtime errors0. Run `8e5b4d66-870d-473d-8a59-16d9c51bde03` has independent cleanupPASS. This is one complete helper with a changed local verifier, not acceptance of the whole audit/admin group or a newly published commit.

Independent scoped review found no material issue and separately ran the1case regression. The initial unit harness required cleanup stubs and the helper's wrapped sentinel message; the meaningfulRED selectedOPTIONS before the source correction, followed byGREEN. No real financial record or credentials were used in that unit test.

Full frozen local validation passed at2026-11-14T03:03:39.945Z: TypeScript, ESLint,2,919unit tests,525guards, production build and PDF bundle checks,0source drift. Evidence remains in ignored `supabase/.temp/vat-response-selection-validation-20261114`; the failing baseline is retained separately in `vat-response-selection-red-20261114.log`.
