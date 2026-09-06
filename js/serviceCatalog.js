export const PRODUCT_TYPES = Object.freeze([
  ['graphic_design', 'Graphic design'],
  ['streaming_video', 'Film and series streaming'],
  ['ai_assistant', 'AI assistant'],
  ['photo_editor', 'Photo editing'],
  ['cloud_storage', 'Cloud storage'],
]);

const definitions = [
  {
    id: 'canva', name: 'Canva', productType: 'graphic_design', aliases: ['canva', 'canva pro', 'canva teams', 'canva business'],
    requirements: [
      ['social_graphics', 'Social-media graphics'], ['presentations', 'Presentations'], ['templates', 'Templates'],
      ['background_removal', 'Background removal'], ['brand_assets', 'Brand assets'], ['team_collaboration', 'Team collaboration'],
    ],
  },
  {
    id: 'netflix', name: 'Netflix', productType: 'streaming_video', aliases: ['netflix', 'netflix standard', 'netflix premium', 'netflix basic'],
    requirements: [
      ['films', 'Films'], ['series', 'Series'], ['offline_downloads', 'Offline downloads'], ['specific_exclusives', 'Specific Netflix-exclusive content'],
    ],
  },
  {
    id: 'chatgpt', name: 'ChatGPT', productType: 'ai_assistant', aliases: ['chatgpt', 'chat gpt', 'chatgpt plus', 'openai chatgpt'],
    requirements: [
      ['general_writing', 'General writing'], ['coding', 'Coding'], ['document_analysis', 'Document analysis'],
      ['web_research', 'Web research'], ['image_generation', 'Image generation'], ['high_usage_capacity', 'High usage capacity'],
    ],
  },
  {
    id: 'photoshop', name: 'Adobe Photoshop', productType: 'photo_editor', aliases: ['photoshop', 'adobe photoshop', 'photoshop cc', 'photoshop creative cloud'],
    requirements: [
      ['basic_adjustments', 'Basic photo adjustments'], ['layers_masks', 'Layers and masks'], ['retouching', 'Retouching'],
      ['psd_compatibility', 'PSD compatibility'], ['offline_desktop', 'Offline desktop use'], ['professional_workflow', 'Professional workflow'],
    ],
  },
  {
    id: 'claude', name: 'Claude', productType: 'ai_assistant', aliases: ['claude', 'claude pro', 'anthropic claude', 'claude ai'],
    requirements: [
      ['general_writing', 'General writing'], ['coding', 'Coding'], ['document_analysis', 'Document analysis'],
      ['web_research', 'Web research'], ['image_generation', 'Image generation'], ['high_usage_capacity', 'High usage capacity'],
    ],
  },
  {
    id: 'dropbox', name: 'Dropbox', productType: 'cloud_storage', aliases: ['dropbox', 'dropbox plus', 'dropbox professional', 'dropbox basic'],
    requirements: [
      ['device_sync', 'Device synchronization'], ['file_sharing', 'File sharing'], ['file_history', 'File history'], ['collaboration', 'Collaboration'],
    ],
  },
];

export const SUPPORTED_SERVICES = Object.freeze(definitions.map((definition) => Object.freeze({
  ...definition,
  aliases: Object.freeze(definition.aliases),
  requirements: Object.freeze(definition.requirements.map((requirement) => Object.freeze(requirement))),
})));

export const SERVICE_IDS = Object.freeze(SUPPORTED_SERVICES.map(({ id }) => id));
export const PRODUCT_TYPE_IDS = Object.freeze(PRODUCT_TYPES.map(([id]) => id));

function normalizedName(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function serviceById(id) {
  return SUPPORTED_SERVICES.find((service) => service.id === id) || null;
}

export function detectSupportedService(name) {
  const normalized = normalizedName(name);
  if (!normalized) return null;
  return SUPPORTED_SERVICES.find((service) => service.aliases.some((alias) => normalizedName(alias) === normalized)) || null;
}

export function supportedServiceFor(subscription) {
  return serviceById(subscription?.detailedReview?.serviceId) || detectSupportedService(subscription?.name);
}

export function requirementLabel(serviceId, requirementId) {
  return serviceById(serviceId)?.requirements.find(([id]) => id === requirementId)?.[1] || requirementId;
}
