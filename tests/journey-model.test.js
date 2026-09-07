import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, journeyQuery, changeJourneyService, journeyFromSubscription, normalizeJourneyDraft, writeJourneyDraft, readJourneyDraft } from '../js/journeyModel.js';
import { requestJourneyAlternatives } from '../js/journeyApi.js';

test('sparse Canva sentence starts discovery without a price, login or detailed answers', () => {
  const {draft} = parseIntent('Canva is too expensive');
  assert.equal(draft.serviceId, 'canva'); assert.equal(draft.motivation, 'cost'); assert.equal(draft.amountMinor, null);
  const query = journeyQuery(draft, 'USD');
  assert.equal(query.serviceId, 'canva'); assert.deepEqual(query.mustHave, []);
});
test('ambiguous services request clarification and unknown names never invent a service', () => {
  assert.equal(parseIntent('Canva or Photoshop').candidates.length, 2);
  assert.equal(parseIntent('Canva or Photoshop').draft.serviceId, '');
  assert.equal(parseIntent('Switch from Canva to Photoshop').draft.serviceId, 'canva');
  assert.equal(parseIntent('a cheaper magic unicorn app').draft.productType, '');
});
test('explicit price, country and requirements are retained and can be corrected', () => {
  const {draft} = parseIntent('Canva costs CHF 120 per year in Switzerland. I need social posts but do not need team collaboration. I work alone.');
  assert.equal(draft.amountMinor, 12000); assert.equal(draft.currency, 'CHF'); assert.equal(draft.cycle, 'yearly'); assert.equal(draft.country, 'CH');
  assert.ok(draft.mustHave.includes('social_graphics')); assert.ok(draft.notNeeded.includes('team_collaboration')); assert.equal(draft.audience, 'solo');
  assert.equal(journeyQuery(draft, 'USD').country, 'CH');
  assert.equal(parseIntent('Canva 12,99 EUR monthly').draft.amountMinor, 1299);
});
test('service type changes clear incompatible answers while common answers survive', () => {
  const before = normalizeJourneyDraft({serviceId:'canva',mustHave:['templates'],tasks:['social_graphics'],country:'DE',amountMinor:1200,currency:'EUR',audience:'solo'});
  const next = changeJourneyService(before, 'dropbox');
  assert.deepEqual(next.mustHave, []); assert.deepEqual(next.tasks, []); assert.equal(next.country,'DE'); assert.equal(next.amountMinor,1200); assert.equal(next.audience,'solo');
});
test('legacy subscriptions keep detailed answers and unknown information stays unanswered', () => {
  const draft = journeyFromSubscription({name:'Canva',amountMinor:2000,currency:'CHF',cycle:'monthly',usage:'weekly',detailedReview:{serviceId:'canva',productType:'graphic_design',mustHaveRequirements:['templates'],acceptFreeLimits:false,activeContract:true}});
  assert.equal(draft.currency,'CHF'); assert.equal(draft.context.activeContract,true); assert.equal(journeyQuery(draft,'USD').acceptFreeLimits,false);
  assert.deepEqual(journeyQuery(draft,'USD').mustHave,['templates']);
  assert.equal(journeyFromSubscription({name:'Netflix',amountMinor:1000,currency:'USD',cycle:'monthly'}).serviceId,'netflix');
  assert.equal(normalizeJourneyDraft({}).usage,'');
});
test('draft storage is additive and restores unanswered values without saving protected results', () => {
  const entries = new Map([['feeveto_state_v2','untouched']]); const storage = {getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value)};
  writeJourneyDraft(storage, {...parseIntent('Canva is expensive').draft,secretOffers:[{name:'should not persist'}]});
  const draft = readJourneyDraft(storage);
  assert.equal(draft.amountMinor,null); assert.equal(entries.get('feeveto_state_v2'),'untouched'); assert.equal(draft.secretOffers,undefined);
});
test('guest discovery omits authorization, preserves catalogue errors and supports more results', async () => {
  let request;
  const fetchImplementation = async (url, options) => { request=options; return new Response(JSON.stringify({items:[],state:'no_matches',hasMore:false}),{status:200}); };
  await requestJourneyAlternatives({serviceId:'canva'}, '', {fetchImplementation});
  assert.equal(request.headers.Authorization,undefined);
  await assert.rejects(() => requestJourneyAlternatives({},'',{fetchImplementation:async()=>new Response(JSON.stringify({state:'catalogue_unavailable',error:'Unavailable'}),{status:503})}), error=>error.resultState==='catalogue_unavailable');
});
