import test from 'node:test'
import assert from 'node:assert/strict'
import {accountingActionRoute} from './verify-local-receivables.mjs'
const match=accountingActionRoute('http://localhost:3107')
for(const path of ['/accounting','/accounting?tab=receivables','/accounting?lang=ar&tab=receivables'])test('receivable fault targets exact page including query: '+path,()=>assert.equal(match(new URL(path,'http://localhost:3107')),true))
for(const url of ['http://foreign.test/accounting?tab=receivables','http://localhost:3108/accounting','http://localhost:3107/accounting-other','http://localhost:3107/accounting/child','http://localhost:3107/invoices'])test('receivable fault never targets another origin or path: '+url,()=>assert.equal(match(new URL(url)),false))
