import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectRecommendations, validateOffer } from '../functions/_shared/alternatives.js';
const fixture = JSON.parse(await readFile(new URL('../fixtures/catalogue.example.json', import.meta.url))).offers[0];
const fresh = new Date().toISOString().slice(0, 10);
const offer = changes => ({ ...fixture, relevantServices: ['canva'], productType: 'graphic_design', features: ['templates'], unsupportedFeatures: ['brand_assets'], unknownFeatures: [], countryAvailability: {status:'worldwide',countries:[]}, platforms:['web'], priceMinor:1000,priceCurrency:'USD',billingInterval:'monthly',verifiedAt:fresh, priceVerifiedAt:fresh, ...changes });
const query = changes => ({serviceId:'canva', mustHave:['templates'], niceToHave:['brand_assets'], platform:'web', country:'US', ...changes});
const pick = (changes = {}, answers = {}) => selectRecommendations([offer(changes)], query(answers), {premiumAccess:true}).items[0];

test('match is deterministic verified-priority coverage, not normalized catalogue rank', () => {
  const first = pick().feeVetoMatch;
  assert.equal(first.score, 75); // (40 essential + 10 platform + 10 country) / 80 selected weight
  assert.equal(first.label, 'FeeVeto Match');
  assert.deepEqual(first, pick().feeVetoMatch);
  assert.match(first.meaning, /Not a customer rating/);
  assert.ok(first.factors.some(f => f.status === 'unsupported' && /brand assets/i.test(f.reason)));
  assert.doesNotMatch(JSON.stringify(first), /rankScore|weight/);
  const competing = offer({id:'fictional-second',productName:'Another fictional fixture',features:['templates','brand_assets'],unsupportedFeatures:[]});
  const withCompetition = selectRecommendations([offer(), competing], query(), {premiumAccess:true}).items.find(item => item.id === fixture.id);
  assert.equal(withCompetition.feeVetoMatch.score, 75, 'Adding competitors must not change percentage');
});
test('unselected dimensions are absent and sparse answers have no precise percentage', () => {
  assert.equal(pick({}, {mustHave:[],niceToHave:[],platform:'',country:''}).feeVetoMatch.score, null);
  assert.equal(pick({}, {mustHave:[],niceToHave:[],platform:'',country:''}).feeVetoMatch.label, 'General match');
  assert.equal(pick({}, {niceToHave:[]}).feeVetoMatch.score, 100);
  assert.equal(pick({}, {country:'',platform:'',niceToHave:[]}).feeVetoMatch.score, null);
  assert.equal(pick({}, {country:'',platform:'',switchingTolerance:'moderate'}).feeVetoMatch.score, null, 'Must and nice features count as one dimension, not two');
  assert.equal(pick({}, {mustHave:[],niceToHave:[],platform:'',country:'',marketCurrency:'USD'}).feeVetoMatch.score, null);
});
test('unverified essentials, platform, country and stale records prevent precision', () => {
  for (const changes of [{features:[],unknownFeatures:['templates']},{platforms:[]},{countryAvailability:{status:'unknown',countries:[]}},{verifiedAt:'2020-01-01'}]) {
    assert.equal(pick(changes).feeVetoMatch.score, null);
  }
  assert.equal(pick({features:[],unsupportedFeatures:['templates','brand_assets']}), undefined, 'Unsupported must-have excludes instead of displaying a high score');
  assert.equal(pick({platforms:['ios']}), undefined);
  assert.equal(pick({countryAvailability:{status:'limited',countries:['CH']}}), undefined);
});
test('unknown prices are never zero and unverified preferences get no invented credit', () => {
  const item = pick({priceMinor:null,priceCurrency:null,priceVerifiedAt:null,billingInterval:'varies'}, {budgetMinor:1000,budgetCurrency:'USD'});
  assert.equal(item.price.amountMinor, null);
  assert.equal(item.feeVetoMatch.score, null, 'An explicit budget cannot be confirmed from an unknown price');
  assert.ok(item.feeVetoMatch.factors.some(f => f.status === 'unknown' && /budget/.test(f.reason)));
  const free = pick({pricingModel:'free',priceMinor:0,priceCurrency:null,billingInterval:null,upfrontCommitmentMonths:0,freePlanLimits:false}, {acceptFreeLimits:true});
  assert.ok(free.feeVetoMatch.factors.some(f => f.status === 'unknown' && /free-plan limits/.test(f.reason)));
  const paidUnknown = pick({priceMinor:null,priceCurrency:null,priceVerifiedAt:null,billingInterval:'varies'}, {includePaid:true,includeFree:false,budgetMinor:1000,budgetCurrency:'USD'});
  assert.equal(paidUnknown.feeVetoMatch.score,null);
  assert.ok(paidUnknown.feeVetoMatch.factors.some(f => /budget/.test(f.reason)), 'Choosing paid options must not erase a selected budget');
});
test('specific streaming content remains potential, and public access never reveals free plans', () => {
  const streaming = offer({relevantServices:['netflix'],productType:'streaming_video',features:['films'],unsupportedFeatures:[]});
  const item = selectRecommendations([streaming], {serviceId:'netflix',mustHave:['films'],country:'US',platform:'web',requiredTitle:'A required programme'}, {premiumAccess:true}).items[0];
  assert.equal(item.feeVetoMatch.score, null);
  const restricted = offer({pricingModel:'free',priceMinor:0,priceCurrency:null,billingInterval:null,upfrontCommitmentMonths:0});
  const result = selectRecommendations([restricted], query({includeFree:true,includePaid:false}));
  assert.equal(result.state, 'access_restricted'); assert.deepEqual(result.items, []);
});
test('optional external ratings require complete verifiable source information', () => {
  const fields = {externalRating:4.2,externalRatingScale:5,externalReviewCount:42,externalRatingSource:'Fictional reviews',externalRatingUrl:'https://example.com/reviews',externalRatingVerifiedAt:fresh};
  assert.equal(validateOffer(offer(fields)).reviewRating.value, 4.2);
  assert.equal(validateOffer(offer({...fields,externalRatingUrl:''})).reviewRating, null);
  assert.equal(validateOffer(offer()).reviewRating, null);
});
