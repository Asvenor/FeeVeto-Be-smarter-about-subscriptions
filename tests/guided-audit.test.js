import test from 'node:test';
import assert from 'node:assert/strict';
import { captureGuide } from '../js/guidedAudit.js';
import { parseIntent } from '../js/journeyModel.js';
const data = entries => { const value=new FormData(); for(const [key,item] of entries)value.append(key,item);return value; };
test('spending step retains billing basis and an explicit unknown does not become zero',()=>{
  const draft=parseIntent('Canva costs CHF 120 per year').draft;
  const updated=captureGuide(data([['price','15'],['currency','EUR'],['cycle','monthly']]),draft,1);
  assert.equal(updated.amountMinor,1500);assert.equal(updated.currency,'EUR');assert.equal(updated.cycle,'monthly');
  const unknown=captureGuide(data([['price','120'],['unknownPrice','on'],['currency','CHF'],['cycle','yearly']]),draft,1);
  assert.equal(unknown.amountMinor,null);assert.equal(unknown.currency,'CHF');assert.equal(unknown.cycle,'yearly');
});
test('needs capture retains separate priorities, supports skips, and preserves legacy context',()=>{
  const draft={...parseIntent('Canva is too expensive').draft,context:{activeContract:true}};
  const next=captureGuide(data([['task','social_graphics'],['priority_templates','must'],['priority_brand_assets','nice'],['usage','weekly'],['audience','solo'],['budget','5.50'],['budgetCurrency','USD'],['switchingTolerance','easy']]),draft,2);
  assert.deepEqual(next.mustHave,['templates']);assert.deepEqual(next.niceToHave,['brand_assets']);assert.equal(next.budgetMinor,550);assert.equal(next.context.activeContract,true);
  const skipped=captureGuide(data([]),next,2);assert.equal(skipped.usage,'');assert.equal(skipped.budgetMinor,null);assert.equal(skipped.context.activeContract,true);
});
test('invalid numbers are errors rather than silent empty defaults',()=>{
  assert.throws(()=>captureGuide(data([['price','-3']]),{},1),/valid price/);
  assert.throws(()=>captureGuide(data([['budget','-3']]),{},2),/valid monthly budget/);
});
