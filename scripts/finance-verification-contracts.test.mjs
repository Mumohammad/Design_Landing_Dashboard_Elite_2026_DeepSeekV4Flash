import test from 'node:test'
import assert from 'node:assert/strict'
import { minorUnits, balancedLines, assertCounterEntry, parseVatCsv } from './lib/finance-verification-contracts.mjs'
const source = [{ account_id: 'cash', debit_amount: '23.45', credit_amount: '0' }, { account_id: 'income', debit_amount: '0', credit_amount: '23.45' }]
const reversal = source.map(row => ({ ...row, debit_amount: row.credit_amount, credit_amount: row.debit_amount }))
test('uses exact signed cents beyond safe floating integer range', () => {
  assert.equal(minorUnits('9007199254740993.45'), 900719925474099345n)
  assert.equal(minorUnits('-0.01'), -1n); assert.equal(minorUnits('1.2'), 120n)
})
test('rejects rounding, exponents, nonfinite and missing money', () => {
  for (const value of ['1.001','1e3',NaN,Infinity,'',null,undefined]) assert.throws(() => minorUnits(value))
})
test('requires complete positive balanced line evidence', () => {
  assert.equal(balancedLines(source).length, 2)
  for (const rows of [[],source.slice(0,1),[...source,{ account_id:'missing',debit_amount:'0.01',credit_amount:'0' }]]) assert.throws(() => balancedLines(rows))
})
test('rejects negative, both-sided and zero-only lines', () => {
  for (const invalid of [{debit_amount:'-1',credit_amount:'0'},{debit_amount:'1',credit_amount:'1'},{debit_amount:'0',credit_amount:'0'}]) assert.throws(() => balancedLines([{account_id:'cash',...invalid},source[1]]))
})
test('accepts only the exact swapped counter-entry independent of line order', () => { assertCounterEntry(source, reversal.toReversed()) })
test('rejects a second forward journal masquerading as reversal', () => { assert.throws(() => assertCounterEntry(source, source)) })
test('rejects balanced reversals with a wrong account or a changed amount', () => {
  assert.throws(() => assertCounterEntry(source,reversal.map(row=>({...row,account_id:row.account_id==='cash'?'other':row.account_id}))))
  assert.throws(() => assertCounterEntry(source,reversal.map(row=>({...row,debit_amount:row.debit_amount==='0'?'0':'23.46',credit_amount:row.credit_amount==='0'?'0':'23.46'}))))
})
test('accepts a complete VAT CSV and preserves signed fields and leading zeroes', () => {
  assert.deepEqual(parseVatCsv('\uFEFFperiod,status,net_position\r\n1902-02,open,-0.01\r\n'),[{period:'1902-02',status:'open',net_position:'-0.01'}])
})
test('rejects VAT CSV missing a row or column', () => {
  for(const csv of ['period,status\r\n','period,status\r\n1902-02\r\n','period,status\r\n1902-02,open,extra\r\n']) assert.throws(()=>parseVatCsv(csv))
})
test('rejects duplicate VAT columns or unexpected quoted/multiline content', () => {
  for(const csv of ['period,period\r\n1902-02,1902-02\r\n','period,status\r\n1902-02,"open"\r\n','period,status\r\n1902-02,open\r\nextra\r\n']) assert.throws(()=>parseVatCsv(csv))
})
