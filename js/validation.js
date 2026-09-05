import { toMinorUnits } from './calculations.js';

export function validateSubscriptionInput(formData) {
  const errors = {};
  const name = String(formData.get('name') || '').trim();
  const amountMinor = toMinorUnits(formData.get('price'));
  const cancellationUrl = String(formData.get('cancellationUrl') || '').trim();
  if (!name) errors.name = 'Enter a subscription name.';
  if (name.length > 80) errors.name = 'Use 80 characters or fewer.';
  if (amountMinor === null) errors.price = 'Enter a valid price of zero or more.';
  if (cancellationUrl) {
    try {
      const url = new URL(cancellationUrl);
      if (!['http:', 'https:'].includes(url.protocol)) errors.cancellationUrl = 'Use a complete http:// or https:// address.';
    } catch {
      errors.cancellationUrl = 'Use a complete http:// or https:// address.';
    }
  }
  return { valid: Object.keys(errors).length === 0, errors, values: { name, amountMinor, cancellationUrl } };
}

export function createId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
