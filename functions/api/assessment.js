import { json, methodNotAllowed } from "../_shared/http.js";
import {
  readJourneyBody,
  journeyIdentity,
  createJourneyAssessment,
} from "../_shared/journey-service.js";

export async function handleAssessmentRequest(context, options = {}) {
  if (context.request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    const body = await readJourneyBody(context.request);
    const { access } = await journeyIdentity(context, options);
    return json(await createJourneyAssessment(context, body, access, options));
  } catch (error) {
    return json(
      {
        error: error.status
          ? error.message
          : "Assessment is temporarily unavailable. Your answers are kept; retry.",
      },
      { status: error.status || 503 },
    );
  }
}
export const onRequest = handleAssessmentRequest;
