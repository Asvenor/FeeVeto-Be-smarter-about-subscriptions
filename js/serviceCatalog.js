export const PRODUCT_TYPES = Object.freeze([
  ['graphic_design', 'Graphic design'],
  ['streaming_video', 'Film and series streaming'],
  ['ai_assistant', 'AI assistant'],
  ['photo_editor', 'Photo editing'],
  ['cloud_storage', 'Cloud storage'],
  ['video_editing', 'Desktop video editing'],
  ['office_suite', 'Office applications'],
  ['pdf_editor', 'PDF editing'],
  ['note_taking', 'Notes and knowledge'],
  ['proofreading', 'Proofreading'],
  ['task_management', 'Task management'],
  ['password_manager', 'Password manager'],
  ['vpn', 'VPN'],
  ['music_streaming', 'Music streaming'],
  ['audiobooks', 'Audiobooks'],
  ['home_workouts', 'Home workouts'],
  ['meditation', 'Meditation'],
  ['game_catalogue', 'Game catalogue'],
  ['language_learning', 'Language learning'],
  ['online_courses', 'Online courses'],
]);

const requirementsByProductType = Object.freeze({
  graphic_design: [
    ['social_graphics', 'Social-media graphics'], ['presentations', 'Presentations'], ['templates', 'Templates'],
    ['background_removal', 'Background removal'], ['one_click_resize', 'One-click resizing'],
    ['brand_assets', 'Brand assets'], ['team_collaboration', 'Team collaboration'],
  ],
  streaming_video: [
    ['films', 'Films'], ['series', 'Series'], ['offline_downloads', 'Offline downloads'],
    ['ad_free', 'Ad-free playback'], ['specific_exclusives', 'Specific exclusives from the current service'],
  ],
  ai_assistant: [
    ['general_writing', 'General writing'], ['coding_chat', 'Coding help in chat'], ['document_analysis', 'Document analysis'],
    ['web_research', 'Web research'], ['image_generation', 'Image generation'],
    ['ide_terminal_agent', 'IDE or terminal coding agent'], ['high_usage_capacity', 'High usage capacity'],
  ],
  photo_editor: [
    ['basic_adjustments', 'Basic photo adjustments'], ['layers_masks', 'Layers and masks'], ['retouching', 'Retouching'],
    ['psd_import_export', 'PSD import and export'], ['offline_desktop', 'Offline desktop use'],
    ['batch_processing', 'Batch processing'], ['professional_workflow', 'Professional workflow'],
  ],
  cloud_storage: [
    ['device_sync', 'Device synchronization'], ['file_sharing', 'File sharing'], ['file_history', 'File history'],
    ['collaboration', 'Collaboration'], ['photo_backup', 'Photo backup'], ['end_to_end_encryption', 'End-to-end encryption'],
  ],
  video_editing: [
    ['desktop_editing', 'Desktop timeline editing'], ['color_grading', 'Advanced colour grading'],
    ['visual_effects', 'Visual effects and motion graphics'], ['audio_post', 'Audio post-production'],
    ['mobile_first_templates', 'Mobile-first social templates'], ['team_collaboration', 'Team collaboration'],
  ],
  office_suite: [
    ['documents', 'Documents'], ['spreadsheets', 'Spreadsheets'], ['presentations', 'Presentations'],
    ['microsoft_format_compatibility', 'Microsoft Office format compatibility'], ['offline_desktop', 'Offline desktop use'],
    ['team_collaboration', 'Real-time team collaboration'], ['cloud_storage_bundle', 'Bundled cloud storage'],
  ],
  pdf_editor: [
    ['edit_existing_text', 'Edit existing PDF text'], ['ocr', 'OCR for scanned documents'], ['forms', 'PDF forms'],
    ['redaction', 'Permanent redaction'], ['signatures', 'Signatures'], ['batch_processing', 'Batch operations'],
  ],
  note_taking: [
    ['offline_notes', 'Offline notes'], ['attachments', 'Attachments'], ['device_sync', 'Device synchronization'],
    ['sharing', 'Share notes'], ['team_collaboration', 'Team collaboration'], ['databases', 'Structured databases'],
  ],
  proofreading: [
    ['grammar_spelling', 'Grammar and spelling'], ['style_suggestions', 'Style suggestions'], ['multilingual', 'Multiple languages'],
    ['long_documents', 'Long-document checks'], ['browser_integration', 'Browser integration'], ['desktop_apps', 'Desktop apps'],
  ],
  task_management: [
    ['tasks', 'Tasks'], ['reminders', 'Reminders'], ['calendar', 'Calendar views'], ['filters', 'Custom filters'],
    ['recurring_tasks', 'Recurring tasks'], ['team_collaboration', 'Team collaboration'],
  ],
  password_manager: [
    ['device_sync', 'Synchronization across devices'], ['sharing', 'Secure sharing'], ['attachments', 'Encrypted attachments'],
    ['emergency_access', 'Emergency access'], ['family_plan', 'Family plan'], ['integrated_authenticator', 'Integrated authenticator'],
  ],
  vpn: [
    ['unlimited_data', 'Unlimited data'], ['multiple_devices', 'Multiple simultaneous devices'], ['streaming', 'Streaming support'],
    ['p2p', 'Peer-to-peer file sharing'], ['specific_server_location', 'A specific server country'],
  ],
  music_streaming: [
    ['on_demand_playback', 'On-demand playback'], ['ad_free', 'Ad-free listening'], ['offline_downloads', 'Offline listening'],
    ['family_plan', 'Family plan'], ['student_plan', 'Student plan'], ['lossless_audio', 'Lossless audio'],
  ],
  audiobooks: [
    ['modern_titles', 'Modern commercial titles'], ['specific_title', 'A specific audiobook'], ['offline_downloads', 'Offline listening'],
    ['family_plan', 'Family plan'], ['keep_after_cancel', 'Keep books after cancellation'],
  ],
  home_workouts: [
    ['workout_videos', 'Workout videos'], ['structured_programs', 'Structured programmes'], ['no_equipment', 'No-equipment workouts'],
    ['progress_tracking', 'Progress tracking'], ['personal_coaching', 'Personal coaching'],
  ],
  meditation: [
    ['guided_meditation', 'Guided meditation'], ['sleep_content', 'Sleep content'], ['offline_downloads', 'Offline listening'],
    ['courses', 'Meditation courses'], ['multilingual', 'Multiple languages'],
  ],
  game_catalogue: [
    ['specific_game', 'A specific required game'], ['online_multiplayer', 'Console online multiplayer'],
    ['game_catalogue', 'Rotating game catalogue'], ['cloud_gaming', 'Cloud gaming'], ['pc_games', 'PC games'],
  ],
  language_learning: [
    ['target_language', 'Your target language'], ['beginner_lessons', 'Beginner lessons'], ['advanced_lessons', 'Advanced lessons'],
    ['speaking_practice', 'Speaking practice'], ['offline_downloads', 'Offline lessons'], ['review_tools', 'Review tools'],
  ],
  online_courses: [
    ['specific_subject', 'A specific subject'], ['appropriate_level', 'Your learning level'],
    ['certificate', 'Certificate'], ['assessment', 'Assessment'], ['offline_downloads', 'Offline access'],
  ],
});

function definition(id, name, productType, aliases) {
  return { id, name, productType, aliases, requirements: requirementsByProductType[productType] };
}

const definitions = [
  definition('canva', 'Canva', 'graphic_design', ['canva', 'canva pro', 'canva teams', 'canva business']),
  definition('netflix', 'Netflix', 'streaming_video', ['netflix', 'netflix standard', 'netflix premium', 'netflix basic']),
  definition('chatgpt', 'ChatGPT', 'ai_assistant', ['chatgpt', 'chat gpt', 'chatgpt plus', 'openai chatgpt']),
  definition('photoshop', 'Adobe Photoshop', 'photo_editor', ['photoshop', 'adobe photoshop', 'photoshop cc', 'photoshop creative cloud']),
  definition('claude', 'Claude', 'ai_assistant', ['claude', 'claude pro', 'anthropic claude', 'claude ai']),
  definition('dropbox', 'Dropbox', 'cloud_storage', ['dropbox', 'dropbox plus', 'dropbox professional', 'dropbox basic']),
  definition('premiere', 'Adobe Premiere Pro', 'video_editing', ['premiere', 'premiere pro', 'adobe premiere', 'adobe premiere pro']),
  definition('capcut', 'CapCut', 'video_editing', ['capcut', 'capcut pro']),
  definition('microsoft_365', 'Microsoft 365', 'office_suite', ['microsoft 365', 'office 365', 'microsoft office']),
  definition('acrobat', 'Adobe Acrobat', 'pdf_editor', ['acrobat', 'adobe acrobat', 'acrobat pro', 'adobe acrobat pro']),
  definition('evernote', 'Evernote', 'note_taking', ['evernote', 'evernote personal', 'evernote professional']),
  definition('notion', 'Notion', 'note_taking', ['notion', 'notion plus', 'notion business']),
  definition('grammarly', 'Grammarly', 'proofreading', ['grammarly', 'grammarly pro', 'grammarly premium']),
  definition('todoist', 'Todoist', 'task_management', ['todoist', 'todoist pro']),
  definition('onepassword', '1Password', 'password_manager', ['1password', '1 password', '1password individual', '1password families']),
  definition('nordvpn', 'NordVPN', 'vpn', ['nordvpn', 'nord vpn']),
  definition('surfshark', 'Surfshark', 'vpn', ['surfshark', 'surfshark vpn']),
  definition('expressvpn', 'ExpressVPN', 'vpn', ['expressvpn', 'express vpn']),
  definition('spotify', 'Spotify Premium', 'music_streaming', ['spotify', 'spotify premium', 'spotify individual']),
  definition('audible', 'Audible', 'audiobooks', ['audible', 'audible premium plus', 'audible plus']),
  definition('peloton_app', 'Peloton App', 'home_workouts', ['peloton app', 'peloton app one', 'peloton app plus']),
  definition('apple_fitness', 'Apple Fitness+', 'home_workouts', ['apple fitness', 'apple fitness plus', 'fitness+']),
  definition('headspace', 'Headspace', 'meditation', ['headspace', 'headspace plus']),
  definition('calm', 'Calm', 'meditation', ['calm', 'calm premium']),
  definition('xbox_game_pass', 'Xbox Game Pass', 'game_catalogue', ['xbox game pass', 'game pass', 'pc game pass']),
  definition('playstation_plus', 'PlayStation Plus', 'game_catalogue', ['playstation plus', 'ps plus', 'playstation+']),
  definition('duolingo', 'Super Duolingo', 'language_learning', ['duolingo', 'super duolingo', 'duolingo max']),
  definition('coursera_plus', 'Coursera Plus', 'online_courses', ['coursera plus', 'coursera']),
];

export const SUPPORTED_SERVICES = Object.freeze(definitions.map((item) => Object.freeze({
  ...item,
  aliases: Object.freeze(item.aliases),
  requirements: Object.freeze(item.requirements.map((requirement) => Object.freeze(requirement))),
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
  if (subscription?.detailedReview?.serviceSelectionConfirmed === true) return serviceById(subscription.detailedReview.serviceId);
  return serviceById(subscription?.detailedReview?.serviceId) || detectSupportedService(subscription?.name);
}

export function requirementsForProductType(productType) {
  return requirementsByProductType[productType] || [];
}

export function matchingProfileFor(serviceId, productType) {
  const service = serviceById(serviceId);
  if (service?.productType === productType) return service;
  const label = PRODUCT_TYPES.find(([id]) => id === productType)?.[1];
  return label ? { id: `product:${productType}`, name: label, productType, requirements: requirementsForProductType(productType) } : null;
}

export function requirementLabel(serviceId, requirementId) {
  return serviceById(serviceId)?.requirements.find(([id]) => id === requirementId)?.[1]
    || Object.values(requirementsByProductType).flat().find(([id]) => id === requirementId)?.[1]
    || requirementId.replaceAll('_', ' ');
}
