import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assessJourney,compareAnnualCost} from '../js/assessment.js';
import {normalizeJourneyDraft} from '../js/journeyModel.js';
import {selectRecommendations} from '../functions/_shared/alternatives.js';
import {handleAssessmentRequest} from '../functions/api/assessment.js';
const fixture=JSON.parse(await readFile(new URL('../fixtures/catalogue.example.json',import.meta.url))).offers[0];
const draft=normalizeJourneyDraft({serviceId:'canva',amountMinor:2000,currency:'USD',usage:'weekly',audience:'solo',motivation:'cost',mustHave:['templates'],platform:'web',country:'US',switchingTolerance:'easy'});
const offer={...fixture,priceMinor:12000,priceCurrency:'USD',billingInterval:'yearly',upfrontCommitmentMonths:12,priceVerifiedAt:'2026-09-06',verifiedAt:'2026-09-06',switchingDifficulty:'easy'};
function assess(input=draft,offers=[offer]){return assessJourney(input,selectRecommendations(offers,{serviceId:input.serviceId,productType:input.productType,country:input.country,platform:input.platform,mustHave:input.mustHave}));}
test('annual and monthly costs compare; unknown, intro, one-time and cross-currency never invent savings',()=>{
  const result=assess();assert.equal(result.alternatives.items[0].comparison.estimatedSavingsMinor,12000);
  assert.match(result.alternatives.items[0].comparison.commitment,/Annual/);
  for(const price of [{amountMinor:null},{amountMinor:100,currency:'CHF',billingInterval:'monthly'},{amountMinor:100,currency:'USD',billingInterval:'one_time'},{amountMinor:100,currency:'USD',billingInterval:'monthly',introductoryTerms:'First month'}])assert.equal(compareAnnualCost(draft,{price}).estimatedSavingsMinor,null);
  assert.equal(compareAnnualCost({...draft,amountMinor:null},{price:{amountMinor:0},pricingModel:'free'}).estimatedSavingsMinor,null);
});
test('checked cheaper replacements and same-provider plans produce distinct actions',()=>{
  assert.equal(assess().action,'switch');
  assert.equal(assess(draft,[{...offer,providerServiceId:'canva',relationship:'downgrade'}]).action,'downgrade');
});
test('keep and cancel are supported, unknown usage and critical backup never imply cancellation',()=>{
  assert.equal(assess({...draft,motivation:'explore'}).action,'keep');
  assert.equal(assess({...draft,usage:'never',mustHave:[],tasks:[]}).action,'cancel');
  assert.equal(assess({...draft,usage:'',mustHave:[],tasks:[]}).action,'review');
  assert.equal(assess({...draft,serviceId:'dropbox',productType:'cloud_storage',importance:'essential',usage:'never',mustHave:[]}).action,'keep');
});
test('unknown essential capability cannot yield a confirmed switch',()=>{
  const result=assess({...draft,mustHave:['background_removal']});
  assert.notEqual(result.action,'switch');assert.equal(result.selectedOfferId,null);
});
const context=body=>({request:new Request('https://app.test/api/assessment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env:{}});
test('guest server assessment reuses access filtering and ignores injected premium flags',async()=>{
  const response=await handleAssessmentRequest(context({draft,premiumAccess:true}),{provider:async(ctx,query,access)=>{assert.equal(access.premiumAccess,false);return selectRecommendations([offer],query,access);}});
  assert.equal(response.status,200);assert.equal((await response.json()).assessment.action,'switch');
});
test('catalogue failure preserves a basic assessment and explicitly offers retry',async()=>{
  const response=await handleAssessmentRequest(context({draft}),{provider:async()=>{throw new Error('storage');}});
  const body=await response.json();assert.equal(body.draft.amountMinor,2000);assert.equal(body.assessment.alternatives.state,'catalogue_unavailable');assert.notEqual(body.assessment.action,'switch');
});
test('body cap applies even without a Content-Length header',async()=>{
  const response=await handleAssessmentRequest(context({draft,extra:'x'.repeat(25000)}));assert.equal(response.status,413);
});
