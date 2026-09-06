import { fetchAccessStatus, ORDINARY_ACCESS } from './access.js';

const APPEARANCE = Object.freeze({
  variables: {
    colorPrimary: '#238653',
    colorForeground: '#102018',
    colorBackground: '#ffffff',
    colorInputBackground: '#ffffff',
    colorInputText: '#102018',
    borderRadius: '0.75rem',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  },
});

function frontendApiFromKey(publishableKey) {
  const encodedDomain = publishableKey.split('_')[2];
  if (!encodedDomain) throw new Error('The Clerk publishable key is not valid.');
  const domainWithTerminator = window.atob(encodedDomain);
  return domainWithTerminator.slice(0, -1);
}

function loadScript({ src, marker, attributes = {} }) {
  if (document.querySelector(`script[${marker}]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.setAttribute(marker, '');
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('Clerk could not be loaded.')), { once: true });
    document.head.appendChild(script);
  });
}

async function loadClerk(frontendApi, publishableKey) {
  if (!window.__internal_ClerkUICtor) {
    await loadScript({ src: `https://${frontendApi}/npm/@clerk/ui@1/dist/ui.browser.js`, marker: 'data-feeveto-clerk-ui' });
  }
  if (!window.Clerk) {
    await loadScript({
      src: `https://${frontendApi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`,
      marker: 'data-feeveto-clerk-js',
      attributes: { 'data-clerk-publishable-key': publishableKey },
    });
  }
  if (!window.Clerk) throw new Error('Clerk did not initialize.');
  return window.Clerk;
}

function authElements() {
  return {
    loading: document.getElementById('auth-loading'),
    signedOut: document.getElementById('signed-out-controls'),
    signIn: document.getElementById('sign-in-button'),
    signUp: document.getElementById('sign-up-button'),
    signedIn: document.getElementById('signed-in-controls'),
    userButton: document.getElementById('user-button'),
    accessBadge: document.getElementById('access-badge'),
    status: document.getElementById('auth-status'),
  };
}

function renderAccessBadge(element, access) {
  element.hidden = true;
  element.textContent = '';
  if (access.isAdmin) element.textContent = 'Owner access';
  else if (access.betaAccess) element.textContent = 'Beta premium';
  else if (access.paidPremiumAccess) element.textContent = 'Premium';
  if (element.textContent) element.hidden = false;
}

export async function initializeAuth() {
  const elements = authElements();
  if (Object.values(elements).some((element) => !element)) return null;

  const publishableKey = __FEEVETO_CLERK_PUBLISHABLE_KEY__;
  if (!publishableKey) {
    elements.loading.hidden = true;
    elements.status.hidden = false;
    elements.status.textContent = 'Account sign-in is unavailable in this build.';
    return null;
  }

  try {
    const clerk = await loadClerk(frontendApiFromKey(publishableKey), publishableKey);
    await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor }, appearance: APPEARANCE });
    let userButtonMounted = false;
    let accessRequest = 0;

    const refreshAccess = async () => {
      const request = ++accessRequest;
      const access = await fetchAccessStatus(clerk);
      if (request !== accessRequest || !clerk.isSignedIn) return;
      renderAccessBadge(elements.accessBadge, access);
    };

    const renderAuth = () => {
      const signedIn = Boolean(clerk.isSignedIn);
      elements.loading.hidden = true;
      elements.status.hidden = true;
      elements.signedOut.hidden = signedIn;
      elements.signedIn.hidden = !signedIn;

      if (signedIn && !userButtonMounted) {
        clerk.mountUserButton(elements.userButton, { userProfileMode: 'modal' });
        userButtonMounted = true;
        void refreshAccess();
      } else if (!signedIn && userButtonMounted) {
        clerk.unmountUserButton(elements.userButton);
        userButtonMounted = false;
        accessRequest += 1;
        renderAccessBadge(elements.accessBadge, ORDINARY_ACCESS);
      }
    };

    elements.signIn.addEventListener('click', () => clerk.openSignIn());
    elements.signUp.addEventListener('click', () => clerk.openSignUp());
    clerk.addListener(renderAuth, { skipInitialEmit: true });
    renderAuth();
    return clerk;
  } catch {
    elements.loading.hidden = true;
    elements.signedOut.hidden = true;
    elements.signedIn.hidden = true;
    elements.status.hidden = false;
    elements.status.textContent = 'Account sign-in is temporarily unavailable.';
    return null;
  }
}
