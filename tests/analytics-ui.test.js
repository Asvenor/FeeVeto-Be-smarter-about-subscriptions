import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initializeAnalytics, productEvent } from '../js/analytics.js';
import { resultFeedback } from '../js/feedback.js';
const tick = () => new Promise(resolve=>setImmediate(resolve));
const setup = (navigator = {}, fetchImplementation) => {
  const dom = new JSDOM('<form id="intent-form"></form><input type="checkbox" id="analytics-consent"><p id="analytics-consent-status"></p>',{url:'https://feeveto.example/'});
  const calls=[];
  const analytics = initializeAnalytics({root:dom.window.document,storage:dom.window.localStorage,navigator,fetchImplementation:fetchImplementation||(async (url,options)=>{calls.push({url,...options});return Response.json({accepted:true});})});
  return {dom,calls,analytics,checkbox:dom.window.document.getElementById('analytics-consent')};
};
test('measurement is opt-in, bounded and sent without cookies, tokens, referrer or raw input', async () => {
  const {dom,calls,checkbox} = setup();
  assert.equal(await productEvent('intent_submitted',{serviceId:'canva',intent:'cost'}),false); assert.equal(calls.length,0);
  checkbox.checked=true; checkbox.dispatchEvent(new dom.window.Event('change')); await tick();
  assert.equal(calls.length,1); assert.deepEqual(JSON.parse(calls[0].body),{event:'landing_visit',returning:false});
  await productEvent('intent_submitted',{serviceId:'canva',intent:'cost'});
  assert.equal(calls[1].credentials,'omit'); assert.equal(calls[1].referrerPolicy,'no-referrer'); assert.equal(calls[1].headers.Authorization,undefined);
  assert.equal(await productEvent('intent_submitted',{request:'Canva costs $30'}),false); assert.equal(calls.length,2);
  for (let i=0;i<80;i++) await productEvent('intent_submitted',{serviceId:'canva'});
  assert.equal(calls.length,60);
  checkbox.checked=false; checkbox.dispatchEvent(new dom.window.Event('change')); assert.equal(await productEvent('intent_submitted'),false);
  assert.equal(dom.window.localStorage.getItem('feeveto_analytics_visited_v1'),null); dom.window.close();
});
test('saved consent and boolean returning marker restore, and privacy signals override them', async () => {
  const {dom,calls,checkbox} = setup(); checkbox.checked=true; checkbox.dispatchEvent(new dom.window.Event('change')); await tick();
  const restored=[];
  initializeAnalytics({root:dom.window.document,storage:dom.window.localStorage,navigator:{},fetchImplementation:async(_url,options)=>{restored.push(JSON.parse(options.body));return Response.json({accepted:true});}});
  await tick(); assert.equal(restored[0].returning,true);
  initializeAnalytics({root:dom.window.document,storage:dom.window.localStorage,navigator:{globalPrivacyControl:true},fetchImplementation:async()=>{throw new Error('Must not send');}});
  assert.equal(checkbox.disabled,true); assert.equal(await productEvent('landing_visit'),false); assert.equal(calls.length,1); dom.window.close();
});
test('feedback is explicit, minimal and retryable even without analytics consent', async () => {
  const original=globalThis.document; let fail=true; const submitted=[];
  const {dom,calls} = setup({},async(_url,options)=>{submitted.push(JSON.parse(options.body));return fail?Response.json({error:'unavailable'},{status:503}):Response.json({accepted:true});});
  try {
    globalThis.document=dom.window.document;
    const feedback=resultFeedback({serviceId:'netflix'}); dom.window.document.body.append(feedback);
    assert.equal(submitted.length,0); assert.equal(calls.length,0);
    [...feedback.querySelectorAll('button')].find(b=>b.textContent==='Not really').click(); assert.equal(submitted.length,0);
    [...feedback.querySelectorAll('button')].find(b=>b.textContent==='Bad alternatives').click(); await tick();
    assert.match(feedback.textContent,/not sent/); assert.deepEqual(submitted[0],{event:'result_feedback',serviceId:'netflix',surface:'discover',helpful:false,reason:'bad_alternatives'});
    fail=false; [...feedback.querySelectorAll('button')].find(b=>b.textContent==='Retry feedback').click(); await tick();
    assert.deepEqual(submitted[1],submitted[0]); assert.equal(feedback.disabled,true); assert.match(feedback.textContent,/feedback was sent/);
  } finally {globalThis.document=original;dom.window.close();}
});
