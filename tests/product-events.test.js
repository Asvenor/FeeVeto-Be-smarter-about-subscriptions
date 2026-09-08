import test from 'node:test';
import assert from 'node:assert/strict';
import { handleProductEvent } from '../functions/api/events.js';
import { safeProductEvent, PRODUCT_EVENTS } from '../js/telemetrySchema.js';
import { handleRecommendationsRequest } from '../functions/api/alternatives/recommendations.js';

const event = {event:'intent_submitted',serviceId:'canva',intent:'cost'};
const request = (body = event, headers = {}, path = '') => new Request(`https://feeveto.example/api/events${path}`, {method:'POST',headers:{Origin:'https://feeveto.example','Content-Type':'application/json',...headers},body: typeof body === 'string' ? body : JSON.stringify(body)});
function backend(overrides = {}) {
  const points = [], keys = [];
  return {points,keys,env:{PRODUCT_ANALYTICS_ENABLED:'true',FEEVETO_EVENTS:{writeDataPoint:point=>points.push(point)},FEEVETO_EVENT_LIMIT:{limit:async({key})=>{keys.push(key);return {success:true};}},...overrides}};
}
test('event schema allows only normalized fields, never financial or identifying information', () => {
  for (const name of PRODUCT_EVENTS.filter(name=>name!=='result_feedback')) assert.ok(safeProductEvent({event:name}));
  for (const [key,value] of Object.entries({request:'My bill',price:299,amountMinor:299,email:'a@example.com',token:'private',userId:'account',country:'US',notes:'private',url:'https://secret.example'})) assert.equal(safeProductEvent({...event,[key]:value}),null);
  assert.equal(safeProductEvent({...event,serviceId:'My private subscription'}),null);
  assert.equal(safeProductEvent({...event,intent:'My wife hates it'}),null);
  assert.equal(safeProductEvent({...event,count:1}),null);
  assert.equal(safeProductEvent({event:'alternatives_shown',count:13}),null);
  assert.equal(safeProductEvent({event:'alternatives_shown',count:7}).count,'four_to_twelve');
  assert.equal(safeProductEvent({event:'result_feedback',helpful:false,reason:'confusing'}).reason,'confusing');
  assert.equal(safeProductEvent({event:'result_feedback',helpful:false,reason:'free text'}),null);
  assert.equal(safeProductEvent({event:'result_feedback',helpful:true,reason:'confusing'}),null);
});
test('event endpoint stores fixed fields only, with no identity or network data', async () => {
  const {env,points,keys} = backend();
  const response = await handleProductEvent({env,request:request(event,{'cf-connecting-ip':'192.0.2.1',Authorization:'Bearer not-analytics',Cookie:'not-analytics',Referer:'https://feeveto.example/private'})});
  assert.equal(response.status,200); assert.equal((await response.json()).accepted,true);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(keys,['192.0.2.1']);
  assert.deepEqual(points,[{indexes:['intent_submitted'],doubles:[1],blobs:['intent_submitted','canva','cost','discover','','','','']}]);
  assert.doesNotMatch(JSON.stringify(points),/192\.0|Bearer|Cookie|private/);
});
test('privacy signals, missing bindings, storage errors and abuse limits fail safely', async () => {
  for (const headers of [{DNT:'1'},{'Sec-GPC':'1'}]) {
    const {env,points} = backend(); const response = await handleProductEvent({env,request:request(event,headers)});
    assert.equal((await response.json()).accepted,false); assert.equal(points.length,0);
  }
  for (const change of [{PRODUCT_ANALYTICS_ENABLED:'false'},{FEEVETO_EVENTS:null},{FEEVETO_EVENT_LIMIT:null},{FEEVETO_EVENTS:{writeDataPoint(){throw new Error('sensitive internal configuration');}}}]) {
    const {env} = backend(change); const response = await handleProductEvent({env,request:request()});
    assert.equal(response.status,503); assert.doesNotMatch(await response.text(),/sensitive internal/);
  }
  const {env,points} = backend({FEEVETO_EVENT_LIMIT:{limit:async()=>({success:false})}});
  const response = await handleProductEvent({env,request:request()}); assert.equal(response.status,429); assert.equal(response.headers.get('retry-after'),'60'); assert.equal(points.length,0);
});
test('cross-origin, query-string and invalid/oversized event payloads are rejected', async () => {
  const {env,points} = backend();
  for (const req of [request(event,{Origin:'https://attacker.example'}),request(event,{'Sec-Fetch-Site':'cross-site'}),request(event,{},'?email=private')]) assert.equal((await handleProductEvent({env,request:req})).status,403);
  for (const body of ['{invalid',[],{...event,secret:'private'}]) assert.equal((await handleProductEvent({env,request:request(body)})).status,400);
  assert.equal((await handleProductEvent({env,request:request('x'.repeat(1025))})).status,413);
  assert.equal((await handleProductEvent({env,request:request(event,{'Content-Type':'text/plain'})})).status,415);
  assert.equal((await handleProductEvent({env,request:new Request('https://feeveto.example/api/events')})).status,405);
  assert.equal(points.length,0);
});
test('recommendation body limit also bounds chunked requests before auth or catalogue access', async () => {
  let touched = false;
  const stream = new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(12001)));controller.close();}});
  const response = await handleRecommendationsRequest({request:new Request('https://feeveto.example/api/alternatives/recommendations',{method:'POST',headers:{'Content-Type':'application/json'},body:stream,duplex:'half'})}, {catalogueLoader:async()=>{touched=true;return []}});
  assert.equal(response.status,413); assert.equal(touched,false);
});
