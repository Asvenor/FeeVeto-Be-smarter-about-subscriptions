export const CLERK_APPEARANCE = Object.freeze({
  variables: {
    colorPrimary: '#16673d', colorForeground: '#102018', colorMutedForeground: '#5f6d63',
    colorBackground: '#ffffff', colorInputBackground: '#ffffff', colorInputText: '#102018',
    colorDanger: '#9b3f37', colorSuccess: '#16673d', colorWarning: '#8a5719',
    colorRing: 'rgba(7, 92, 54, 0.28)', colorModalBackdrop: 'rgba(16, 32, 24, 0.45)',
    borderRadius: '0.75rem', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  },
  elements: {
    userButtonTrigger: 'feeveto-profile-trigger',
    userButtonAvatarBox: 'feeveto-avatar-box',
    userButtonAvatarImage: 'feeveto-avatar-image',
    userPreviewAvatarBox: 'feeveto-preview-avatar-box',
    modalContent: 'feeveto-account-modal',
  },
});

export function avatarPresentation(user) {
  const names = [user?.firstName, user?.lastName].filter(Boolean);
  const initials = names.map((name) => Array.from(name.trim())[0] || '').join('').toLocaleUpperCase();
  return { generated: user?.hasImage === false, initials: initials || 'FV' };
}
