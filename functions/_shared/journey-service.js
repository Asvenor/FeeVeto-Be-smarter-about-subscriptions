import { normalizeJourneyDraft, journeyQuery } from '../../js/journeyModel.js';
import { assessJourney } from '../../js/assessment.js';
import { CURRENCIES } from '../../js/config.js';
import { curatedRecommendations } from './catalogue-provider.js';
import { getVerifiedIdentity } from './clerk-access.js';
import { getPaidPremiumAccess } from './billing-access.js';
import { resolveAccess } from './access-policy.js';

export class JourneyError extends Error {
  constructor(status,message){super(message);this.status=status;}
}
export async function readJourneyBody(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new JourneyError(415,'Send a JSON request.');
  const reader = request.body?.getReader();
  if (!reader) throw new JourneyError(400,'A JSON request is required.');
  let size=0;const chunks=[];
  try {
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>24000){await reader.cancel();throw new JourneyError(413,'Request is too large.');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const body=JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body!=='object' || Array.isArray(body)) throw new Error('Invalid body');
    return body;
  } catch(error){if(error instanceof JourneyError)throw error;throw new JourneyError(400,'A valid JSON object is required.');}
}
export async function journeyIdentity(context,{required=false,identityResolver=getVerifiedIdentity,paidAccessResolver=getPaidPremiumAccess}={}) {
  if (!context.request.headers.get('authorization')) {
    if(required)throw new JourneyError(401,'Sign in to save or open account audits.');
    return {identity:null,access:resolveAccess()};
  }
  let identity;
  try {identity=await identityResolver(context);}catch{throw new JourneyError(503,'Account verification is unavailable. Your answers are kept; retry shortly.');}
  if(!identity)throw new JourneyError(401,'Your session could not be verified. Sign in again.');
  const paidPremiumAccess=await paidAccessResolver({userId:identity.userId,env:context.env});
  return {identity,access:resolveAccess({authenticated:true,privateMetadata:identity.user.privateMetadata,paidPremiumAccess})};
}
export async function createJourneyAssessment(context,body,access,{provider=curatedRecommendations,now=new Date()}={}) {
  const draft=normalizeJourneyDraft(body.draft || {});
  if(!draft.productType)throw new JourneyError(400,'Choose a supported product type before creating this assessment.');
  const marketCurrency=CURRENCIES.includes(body.marketCurrency)?body.marketCurrency:draft.currency;
  let alternatives;
  try {alternatives=await provider(context,journeyQuery(draft,marketCurrency,{limit:12}),access);}
  catch {alternatives={state:'catalogue_unavailable',items:[],message:'The catalogue could not be checked. Your answers are kept; retry to load comparisons.'};}
  return {draft,marketCurrency,assessment:assessJourney(draft,alternatives,{now,marketCurrency})};
}
