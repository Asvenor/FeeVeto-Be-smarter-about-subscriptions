import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase} from './helpers/sqlite-d1.js';
import {handleAuditsRequest} from '../functions/api/audits.js';
const draft={serviceId:'canva',originalRequest:'Canva is expensive',amountMinor:1700,currency:'CHF',usage:'weekly'};
const key=()=>crypto.randomUUID();
async function setup(){
  const database=await testDatabase();
  async function request(user='alice',{method='GET',body,path='',metadata={}}={}){
    return handleAuditsRequest({request:new Request(`https://app.test/api/audits${path}`,{method,headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${user}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env:{FEEVETO_BILLING:database}},
      {identityResolver:async()=>({userId:user,user:{privateMetadata:metadata}}),paidAccessResolver:async()=>false,provider:async(ctx,query,access)=>({items:[],state:'no_match',accessScope:access.premiumAccess?'complete':'public'})});
  }
  return {request,database};
}
test('server requires identity and ignores forged owner, premium and result snapshots',async()=>{
  const {request,database}=await setup();
  assert.equal((await request('')).status,401);
  const body=await (await request('alice',{method:'POST',body:{draft,requestKey:key(),ownerId:'bob',premiumAccess:true,assessment:{title:'FORGED'}}})).json();
  assert.equal(body.saved.draft.currency,'CHF');assert.notEqual(body.saved.assessment.title,'FORGED');
  assert.equal((await request('bob',{path:`?id=${body.saved.auditId}`})).status,404);
  assert.equal((await request('bob',{method:'POST',body:{draft,requestKey:key(),auditId:body.saved.auditId}})).status,404);database.close();
});
test('retry is idempotent; reevaluation appends a dated version without overwriting history',async()=>{
  const {request,database}=await setup();const body={draft,requestKey:key()};
  const first=(await (await request('alice',{method:'POST',body})).json()).saved;
  const retry=await (await request('alice',{method:'POST',body})).json();assert.equal(retry.saved.version,first.version);
  const changed=await request('alice',{method:'POST',body:{...body,draft:{...draft,amountMinor:2000}}});assert.equal(changed.status,409);
  const next=(await (await request('alice',{method:'POST',body:{draft:{...draft,amountMinor:2000},requestKey:key(),auditId:first.auditId}})).json()).saved;
  assert.equal(next.auditId,first.auditId);assert.notEqual(next.version,first.version);
  const history=await (await request('alice',{path:`?id=${first.auditId}`})).json();assert.equal(history.versions.length,2);assert.equal(history.versions[1].draft.amountMinor,1700);
  assert.equal((await (await request()).json()).audits.length,1);database.close();
});
test('concurrent duplicate requests create only one history record',async()=>{
  const {request,database}=await setup();const body={draft,requestKey:key()};
  const results=await Promise.all([request('alice',{method:'POST',body}),request('alice',{method:'POST',body})]);
  const a=await results[0].json(),b=await results[1].json();assert.equal(a.saved.version,b.saved.version);
  const rows=await (await request()).json();assert.equal(rows.audits[0].versions,1);database.close();
});
test('revoking complimentary access hides old restricted snapshots, not account answers or history',async()=>{
  const {request,database}=await setup();
  for(const metadata of [{role:'admin'},{role:'user',betaAccess:true}]){
    const saved=(await (await request('alice',{method:'POST',metadata,body:{draft,requestKey:key()}})).json()).saved;
    assert.ok(saved.assessment);
    const plain=(await (await request('alice',{path:`?id=${saved.auditId}`})).json()).versions[0];
    assert.equal(plain.assessment,null);assert.equal(plain.restricted,true);assert.equal(plain.draft.amountMinor,1700);
  }
  database.close();
});
test('missing database and invalid body return recoverable errors without creating a record',async()=>{
  const response=await handleAuditsRequest({request:new Request('https://app.test/api/audits',{headers:{Authorization:'Bearer test'}}),env:{}},{identityResolver:async()=>({userId:'alice',user:{}}),paidAccessResolver:async()=>false});assert.equal(response.status,503);
  const {request,database}=await setup();assert.equal((await request('alice',{method:'POST',body:{draft,requestKey:'bad'}})).status,400);assert.equal((await (await request()).json()).audits.length,0);database.close();
});
