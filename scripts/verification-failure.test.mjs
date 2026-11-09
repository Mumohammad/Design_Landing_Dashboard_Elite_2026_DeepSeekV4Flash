import test from 'node:test'
import assert from 'node:assert/strict'
import {verificationFailureMetadata} from './lib/verification-failure.mjs'
for(const stage of ['open form','lost successful action response','retry with same form request identity','created receivable found through paged ledger search','new intent and mobile'])test('preserves fixed receivable stage: '+stage,()=>assert.equal(verificationFailureMetadata({verificationStage:stage}).verificationStage,stage))
test('does not log arbitrary stage strings or error payloads',()=>assert.deepEqual(verificationFailureMetadata({verificationStage:'DO_NOT_LOG_PRIVATE_VALUE',message:'DO_NOT_LOG_PRIVATE_VALUE',password:'DO_NOT_LOG_PRIVATE_VALUE'}),{}))
test('preserves only bounded UI counters and booleans',()=>assert.deepEqual(verificationFailureMetadata({verificationContext:{accountingRoute:true,transportFaultInjected:false,mainCount:1,dialogs:1,alerts:0,url:'DO_NOT_LOG_PRIVATE_VALUE',cookie:'DO_NOT_LOG_PRIVATE_VALUE'}}),{verificationContext:{accountingRoute:true,transportFaultInjected:false,mainCount:1,dialogs:1,alerts:0}}))
test('rejects string, negative, fractional and unbounded counters',()=>assert.deepEqual(verificationFailureMetadata({verificationContext:{accountingRoute:'private',transportFaultInjected:1,mainCount:-1,dialogs:1.5,alerts:100001}}),{}))
