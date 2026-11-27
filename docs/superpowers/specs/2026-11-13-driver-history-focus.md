# Preserve driver document history controls across reads

## Evidence and scope

Exact Preview `4438c071ea9b740c87809d3945dc1936ae776395` failed the unchanged driver-evidence browser acceptance assertion at retained-history literal search (`toBeFocused`). A separate owned staging run `c468fb28-e317-4a33-9be8-7e660d0f1c4d` reproduced that precise failure after top-level driver CRUD, operations and leave passed. The failure screenshot shows only the first character entered. Synthetic fixtures were independently retired successfully.

`DocumentsTab` returned a different parent hierarchy for loading/error versus successful results. Every search keystroke marks the read pending, unmounting the input and the independent document vault. This loses keyboard focus and the vault's selected category.

## Required behavior

Keep the document vault, history heading, replacement-history checkbox, search and pagination controls at stable React positions. Replace only the history result content for loading, errors, empty and successful reads. Preserve all existing queries, RLS, literal escaping, counts, stale-request cancellation, dialogs, upload decisions and routes. Loading must not present stale rows as current, and failure must remain distinguishable from an empty result.

Use the existing visual system and bilingual labels. Taste app-screen guidance applies to stable loading/error frames; a new marketing design, palette or stack is outside this repair.

## Verification and limits

Keep the existing browser focus, literal-match, paging, failed-read/retry and Arabic mobile assertions unchanged. Run lint, TypeScript, unit/guard suites, production build and PDF bundle checks, then request a fresh scoped review. Verify the corrected source in a browser before claiming the focus bug fixed. This repair alone cannot close schema/recovery, other hosted-group, invoice identity or provider launch blockers.
