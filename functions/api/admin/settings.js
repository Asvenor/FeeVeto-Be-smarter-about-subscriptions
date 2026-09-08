import { json, methodNotAllowed } from '../../_shared/http.js';
import { getOwnerSettings, ownerErrorResponse, ownerRuntime, readOwnerJson, requireOwner, updateOwnerSettings } from '../../_shared/owner-controls.js';

export async function handleAdminSettingsRequest(context, { identityResolver } = {}) {
  if (!['GET', 'PUT'].includes(context.request.method)) return methodNotAllowed(['GET', 'PUT']);
  try {
    const identity = await requireOwner(context, identityResolver);
    const settings = context.request.method === 'GET' ? await getOwnerSettings({ env: context.env })
      : await updateOwnerSettings({ env: context.env, actor: identity.userId, body: await readOwnerJson(context.request) });
    return json({ settings, runtime: ownerRuntime(context.env) });
  } catch (error) { return ownerErrorResponse(error); }
}
export const onRequest = handleAdminSettingsRequest;
