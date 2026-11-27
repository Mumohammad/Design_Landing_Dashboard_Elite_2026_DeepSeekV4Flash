// Only fixed test steps and bounded counters may cross the verification log boundary.
const stages = new Set(['open form','lost successful action response','retry with same form request identity','created receivable found through paged ledger search','new intent and mobile'])
export function verificationFailureMetadata(error) {
 const result = {}
 if (stages.has(error?.verificationStage)) result.verificationStage = error.verificationStage
 const source = error?.verificationContext
 if (source && typeof source === 'object') {
  const context = {}
  for (const key of ['accountingRoute','transportFaultInjected']) if (typeof source[key] === 'boolean') context[key] = source[key]
  for (const key of ['mainCount','dialogs','alerts']) if (Number.isSafeInteger(source[key]) && source[key] >= 0 && source[key] <= 100000) context[key] = source[key]
  if (Object.keys(context).length) result.verificationContext = context
 }
 return result
}
