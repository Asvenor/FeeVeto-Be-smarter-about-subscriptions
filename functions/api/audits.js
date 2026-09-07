import { json, methodNotAllowed } from '../_shared/http.js';
import { JourneyError, readJourneyBody, journeyIdentity, createJourneyAssessment } from '../_shared/journey-service.js';
import { normalizeJourneyDraft } from '../../js/journeyModel.js';
import { CURRENCIES } from '../../js/config.js';

const uuid=value=>typeof value==='string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
async function hash(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function visibleVersion(row,access){
  const restricted=row.access_scope==='complete' && !access.premiumAccess;
  return {auditId:row.audit_id,version:row.version_no,title:row.title,createdAt:row.created_at,
    ...JSON.parse(row.input_json),assessment:restricted?null:JSON.parse(row.assessment_json),restricted,
    ...(restricted?{message:'This historical comparison requires Premium. Your answers and history are retained; reevaluate for your current access.'}:{})};
}

export async function handleAuditsRequest(context,options={}){
  if(!['GET','POST'].includes(context.request.method))return methodNotAllowed(['GET','POST']);
  try {
    const {identity,access}=await journeyIdentity(context,{...options,required:true});
    const database=context.env?.FEEVETO_BILLING;
    if(!database?.prepare)throw new JourneyError(503,'Account audit storage is not configured. Your draft is kept; retry after configuration.');
    const owner=identity.userId;
    if(context.request.method==='GET'){
      const params=new URL(context.request.url).searchParams;
      if(params.has('id')){
        const id=params.get('id');if(!uuid(id))throw new JourneyError(404,'Audit not found.');
        const before=Number(params.get('before')) || Number.MAX_SAFE_INTEGER;
        const rows=(await database.prepare('SELECT * FROM saved_audit_versions WHERE owner_id = ? AND audit_id = ? AND version_no < ? ORDER BY version_no DESC LIMIT 51').bind(owner,id,before).all()).results;
        if(!rows.length)throw new JourneyError(404,'Audit not found.');
        return json({versions:rows.slice(0,50).map(row=>visibleVersion(row,access)),nextBefore:rows.length>50?rows[49].version_no:null});
      }
      const offset=Math.max(0,Math.min(100000,Number(params.get('offset'))||0));
      const rows=(await database.prepare(`SELECT audit_id, title, MAX(version_no) AS latest_version, MIN(created_at) AS created_at,
        MAX(created_at) AS updated_at, COUNT(*) AS versions FROM saved_audit_versions WHERE owner_id = ?
        GROUP BY audit_id ORDER BY latest_version DESC LIMIT 51 OFFSET ?`).bind(owner,offset).all()).results;
      return json({audits:rows.slice(0,50),nextOffset:rows.length>50?offset+50:null});
    }
    const body=await readJourneyBody(context.request);
    if(!uuid(body.requestKey))throw new JourneyError(400,'A valid save request identifier is required.');
    const auditId=body.auditId || '';
    if(auditId && !uuid(auditId))throw new JourneyError(404,'Audit not found.');
    const draft=normalizeJourneyDraft(body.draft || {});
    const marketCurrency=CURRENCIES.includes(body.marketCurrency)?body.marketCurrency:draft.currency;
    const requestHash=await hash({draft,marketCurrency,auditId});
    const existing=await database.prepare('SELECT * FROM saved_audit_versions WHERE owner_id = ? AND request_key = ?').bind(owner,body.requestKey).first();
    if(existing){
      if(existing.request_hash!==requestHash)throw new JourneyError(409,'This save identifier belongs to different answers. Start a new save.');
      return json({saved:visibleVersion(existing,access),duplicate:true});
    }
    if(auditId && !await database.prepare('SELECT 1 FROM saved_audit_versions WHERE owner_id = ? AND audit_id = ? LIMIT 1').bind(owner,auditId).first())throw new JourneyError(404,'Audit not found.');
    // The server recomputes from normalized answers; client-supplied roles or snapshots are never stored.
    const value=await createJourneyAssessment(context,{draft,marketCurrency},access,options);
    await database.prepare(`INSERT OR IGNORE INTO saved_audit_versions
      (audit_id, owner_id, request_key, request_hash, title, input_json, assessment_json, access_scope, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(auditId || crypto.randomUUID(),owner,body.requestKey,requestHash,
      draft.serviceName || draft.serviceId || draft.productType,JSON.stringify({draft,marketCurrency}),JSON.stringify(value.assessment),
      access.premiumAccess?'complete':'public',value.assessment.assessedAt).run();
    const stored=await database.prepare('SELECT * FROM saved_audit_versions WHERE owner_id = ? AND request_key = ?').bind(owner,body.requestKey).first();
    if(!stored)throw new Error('Save failed');
    if(stored.request_hash!==requestHash)throw new JourneyError(409,'A concurrent save used this identifier for different answers. Start a new save.');
    return json({saved:visibleVersion(stored,access)});
  }catch(error){return json({error:error.status?error.message:'Account audits are temporarily unavailable. Your draft is kept; retry.'},{status:error.status || 503});}
}
export const onRequest=handleAuditsRequest;
