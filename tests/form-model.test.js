import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDetailedReview, requirementChoices, requirementsComplete, upsertSubscription } from '../js/formModel.js';
import { normalizeSubscription } from '../js/storage.js';

function formData(values = {}) {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, String(value));
  return data;
}

test('one form builds audit context and alternative requirements in one record', () => {
  const data = formData({
    category: 'software', serviceId: 'canva', productType: 'graphic_design', satisfaction: 'satisfied',
    householdUse: false, considerCheaper: true, considerFree: true, acceptFreeLimits: true,
    requirement_templates: 'must', requirement_presentations: 'nice', requirement_brand_assets: 'not_needed',
  });
  const review = buildDetailedReview(data, '2026-09-06T12:00:00.000Z');
  assert.equal(review.satisfaction, 'satisfied');
  assert.equal(review.householdUse, false);
  assert.deepEqual(review.mustHaveRequirements, ['templates']);
  assert.deepEqual(review.niceToHaveRequirements, ['presentations']);
  assert.deepEqual(review.notNeededRequirements, ['brand_assets']);
});

test('unanswered optional answers remain null rather than becoming No', () => {
  const review = buildDetailedReview(formData({ category: 'other' }));
  assert.equal(review.householdUse, null);
  assert.equal(review.considerCheaper, null);
  assert.equal(review.considerFree, null);
  assert.equal(review.activeContract, null);
  assert.equal(review.storageRequiredGb, null);
});

test('only requirements belonging to the current service are saved', () => {
  const data = formData({ requirement_templates: 'must', requirement_file_history: 'must' });
  assert.deepEqual(requirementChoices(data, 'canva').mustHaveRequirements, ['templates']);
  assert.deepEqual(requirementChoices(data, 'dropbox').mustHaveRequirements, ['file_history']);
});

test('changing service or product type prevents stale requirements from influencing the new match', () => {
  const data = formData({
    category: 'cloud', serviceId: 'dropbox', productType: 'cloud_storage',
    requirement_templates: 'must', requirement_file_sharing: 'nice',
  });
  const review = buildDetailedReview(data);
  assert.deepEqual(review.mustHaveRequirements, []);
  assert.deepEqual(review.niceToHaveRequirements, ['file_sharing']);
  assert.equal(review.categoryAnswers.basicFeaturesOnly, undefined);
});

test('requirement completeness distinguishes unanswered from not needed', () => {
  const partial = buildDetailedReview(formData({ category: 'software', serviceId: 'canva', productType: 'graphic_design', requirement_templates: 'must' }));
  assert.equal(requirementsComplete(partial), false);
  const completeData = formData({ category: 'software', serviceId: 'canva', productType: 'graphic_design' });
  for (const id of ['social_graphics', 'presentations', 'templates', 'background_removal', 'one_click_resize', 'brand_assets', 'team_collaboration']) completeData.set(`requirement_${id}`, 'not_needed');
  assert.equal(requirementsComplete(buildDetailedReview(completeData)), true);
  assert.equal(requirementsComplete({ ...buildDetailedReview(completeData), productType: 'photo_editor' }), false);
});

test('product-specific matching inputs are stored only when applicable', () => {
  const review = buildDetailedReview(formData({
    category: 'other', serviceId: 'duolingo', productType: 'language_learning',
    targetLanguage: 'German', learnerLevel: 'intermediate', specificSubject: 'History',
    requiredTitle: 'A title', requiredGame: 'A game', requiredServerCountry: 'CH',
  }));
  assert.equal(review.targetLanguage, 'German');
  assert.equal(review.learnerLevel, 'intermediate');
  assert.equal(review.specificSubject, '');
  assert.equal(review.requiredTitle, '');
  assert.equal(review.requiredGame, '');
  assert.equal(review.requiredServerCountry, '');
  assert.equal(buildDetailedReview(formData({ productType: 'game_catalogue', requiredGame: 'A game' })).requiredGame, 'A game');
  assert.equal(buildDetailedReview(formData({ productType: 'vpn', requiredServerCountry: 'ch' })).requiredServerCountry, 'CH');
  assert.equal(buildDetailedReview(formData({ productType: 'online_courses', specificSubject: 'History' })).specificSubject, 'History');
});

test('saving an edit replaces the existing subscription without duplication', () => {
  const original = { id: 'same-id', name: 'Before' };
  const updated = { id: 'same-id', name: 'After' };
  assert.deepEqual(upsertSubscription([original], updated), [updated]);
  assert.equal(upsertSubscription([original], updated).length, 1);
});

test('existing detailed-review data retains false, unanswered, and requirement priorities', () => {
  const item = normalizeSubscription({
    id: 'existing', name: 'Existing', amountMinor: 1000, currency: 'CHF', cycle: 'monthly', category: 'software', usage: 'monthly', importance: 'useful', status: 'active',
    detailedReview: {
      serviceId: 'canva', productType: 'graphic_design', householdUse: false, overlap: null,
      mustHaveRequirements: ['templates'], niceToHaveRequirements: ['presentations'], notNeededRequirements: ['brand_assets'],
      categoryAnswers: { basicFeaturesOnly: false, collaborationRequired: null },
    },
  });
  assert.equal(item.detailedReview.householdUse, false);
  assert.equal(item.detailedReview.overlap, null);
  assert.deepEqual(item.detailedReview.notNeededRequirements, ['brand_assets']);
  assert.equal(item.detailedReview.categoryAnswers.basicFeaturesOnly, false);
  assert.equal(item.detailedReview.categoryAnswers.collaborationRequired, null);
});
