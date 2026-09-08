import { SERVICE_IDS } from './serviceCatalog.js';

export const PRODUCT_EVENTS = Object.freeze(['landing_visit', 'intent_submitted', 'service_recognized', 'alternatives_requested', 'alternatives_shown', 'alternative_clicked', 'advanced_audit_started', 'advanced_audit_completed', 'account_signup_started', 'audit_saved', 'result_feedback']);
export const FEEDBACK_REASONS = Object.freeze(['bad_alternatives', 'wrong_subscription', 'too_little_information', 'confusing', 'other']);
const INTENTS = ['cost', 'free', 'replace', 'cancel', 'needs', 'complexity', 'unused', 'explore'];
const SURFACES = ['discover', 'advanced', 'subscription', 'account'];
export function safeProductEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['event', 'serviceId', 'intent', 'surface', 'count', 'helpful', 'reason', 'returning'].includes(key))
    || !PRODUCT_EVENTS.includes(value.event)) return null;
  if (value.serviceId !== undefined && value.serviceId !== '' && !SERVICE_IDS.includes(value.serviceId)) return null;
  if (value.intent !== undefined && !INTENTS.includes(value.intent)) return null;
  if (value.surface !== undefined && !SURFACES.includes(value.surface)) return null;
  if (value.count !== undefined && (!Number.isInteger(value.count) || value.count < 0 || value.count > 12 || value.event !== 'alternatives_shown')) return null;
  if (value.returning !== undefined && (typeof value.returning !== 'boolean' || value.event !== 'landing_visit')) return null;
  if (value.event === 'result_feedback') {
    if (typeof value.helpful !== 'boolean' || (value.helpful ? value.reason !== undefined : !FEEDBACK_REASONS.includes(value.reason))) return null;
  } else if (value.helpful !== undefined || value.reason !== undefined) return null;
  return { event: value.event, serviceId: value.serviceId || '', intent: value.intent || 'explore', surface: value.surface || 'discover',
    count: value.count === undefined ? '' : value.count === 0 ? 'none' : value.count <= 3 ? 'one_to_three' : 'four_to_twelve',
    helpful: value.helpful === undefined ? '' : value.helpful ? 'yes' : 'no', reason: value.reason || '',
    returning: value.returning === undefined ? '' : value.returning ? 'returning_browser' : 'first_observed_visit' };
}
