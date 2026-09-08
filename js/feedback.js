import { feedbackEvent } from './analytics.js';
import { FEEDBACK_REASONS } from './telemetrySchema.js';

export function resultFeedback({ serviceId = '', surface = 'discover' } = {}) {
  const node = (tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; return el; };
  const group = node('fieldset'); group.className = 'result-feedback'; group.append(node('legend', 'Was this useful?'));
  const help = node('p', 'Only your choice and the recognized service are sent—not your request, spending or answers.'); help.className = 'field-help'; group.append(help);
  const choices = node('div'); choices.className = 'feedback-choices';
  const yes = node('button', 'Yes'), no = node('button', 'Not really');
  for (const button of [yes, no]) { button.type = 'button'; button.className = 'button button-secondary button-small'; choices.append(button); }
  const reasons = node('div'); reasons.className = 'feedback-choices'; reasons.hidden = true;
  const status = node('p'); status.setAttribute('role', 'status');
  const retry = node('button', 'Retry feedback'); retry.type = 'button'; retry.className = 'button button-secondary button-small'; retry.hidden = true;
  let last, busy = false;
  async function submit(value) {
    if (busy) return; busy = true; last = value; retry.hidden = true; group.disabled = true; status.textContent = 'Sending feedback…';
    const accepted = await feedbackEvent({ serviceId, surface, ...value });
    busy = false; group.disabled = accepted; retry.hidden = accepted;
    status.textContent = accepted ? 'Thank you. Your feedback was sent.' : 'Feedback was not sent. It may be unavailable, offline, or disabled by your privacy settings. Your choice is kept.';
  }
  yes.addEventListener('click', () => void submit({ helpful: true }));
  no.addEventListener('click', () => { reasons.hidden = false; reasons.querySelector('button')?.focus(); });
  for (const reason of FEEDBACK_REASONS) {
    const button = node('button', {bad_alternatives:'Bad alternatives',wrong_subscription:'Wrong subscription',too_little_information:'Too little information',confusing:'Confusing',other:'Other'}[reason]);
    button.type = 'button'; button.className = 'button button-secondary button-small';
    button.addEventListener('click', () => void submit({ helpful: false, reason })); reasons.append(button);
  }
  retry.addEventListener('click', () => void submit(last));
  group.append(choices, reasons, status, retry); return group;
}
