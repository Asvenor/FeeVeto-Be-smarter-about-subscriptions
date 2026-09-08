// Presentation only: views retain the original DOM, form drafts and controllers.
const ROUTES = Object.freeze({ top: 'discover', discover: 'discover', 'how-it-works': 'discover', audit: 'audit', results: 'audit', 'subscription-editor': 'audit', 'saved-audits': 'saved', 'personal-audit': 'review', privacy: 'help', faq: 'help', pricing: 'pricing', 'owner-settings': 'admin' });
const PRIMARY = { discover: 'Discover', audit: 'My subscriptions', saved: 'Saved audits' };
const HOME = { discover: 'top', audit: 'audit', saved: 'saved-audits' };

export function openDisclosures(target) {
  for (let node = target; node; node = node.parentElement) {
    if (node.tagName === 'DETAILS') node.open = true;
  }
}

export function revealContent(id, root = document) {
  root.dispatchEvent(new root.defaultView.CustomEvent('feeveto:navigate', { detail: { id, focus: false } }));
  openDisclosures(root.getElementById(id));
}

export function initializeExperience(root = document) {
  const view = root.defaultView;
  const panels = [...root.querySelectorAll('[data-view]')];
  if (!panels.length) return null;
  let current = 'discover', previousPrimary = 'discover', revision = 0;
  const targetFor = id => root.getElementById(id);
  const routeFor = id => ROUTES[id] || targetFor(id)?.closest('[data-view]')?.dataset.view;
  const hashId = () => { try { return decodeURIComponent(view.location.hash.slice(1)) || 'top'; } catch { return 'top'; } };

  function activate(id, { history = false, focus = true } = {}) {
    let next = routeFor(id);
    if (!next || !targetFor(id)) return false;
    if (next === 'review' && targetFor('personal-audit')?.hidden) {
      id = 'top';
      next = 'discover';
      // A history entry may outlive its account result. Replace that unavailable
      // destination instead of adding another entry or exposing an empty wrapper.
      if (routeFor(hashId()) === 'review') {
        view.history.replaceState(view.history.state, '', `${view.location.pathname}${view.location.search}#top`);
      }
    }
    if (PRIMARY[current]) previousPrimary = current;
    if (next !== current) revision++;
    current = next;
    for (const panel of panels) panel.hidden = panel.dataset.view !== next;
    root.body.dataset.activeView = next;
    root.body.dataset.viewRevision = String(revision);
    for (const link of root.querySelectorAll('[data-view-link]')) {
      const selected = link.dataset.viewLink === (next === 'review' ? previousPrimary : next);
      if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    for (const back of root.querySelectorAll('[data-review-back]')) {
      back.href = `#${HOME[previousPrimary]}`;
      back.textContent = `← ${PRIMARY[previousPrimary]}`;
    }
    if (history && view.location.hash !== `#${id}`) view.history.pushState(null, '', `#${id}`);
    const target = targetFor(id);
    openDisclosures(target);
    if (focus) {
      const heading = target.matches('h1,h2,h3,input,textarea,select,button,summary') ? target : target.querySelector('h1,h2,h3,summary') || target;
      if (!heading.matches('input,textarea,select,button,summary,a')) heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      target.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    }
    return true;
  }

  root.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const id = link.getAttribute('href').slice(1);
    if (!routeFor(id)) return;
    event.preventDefault();
    activate(id, { history: true });
  });
  root.addEventListener('feeveto:navigate', event => activate(event.detail.id, { history: true, focus: event.detail.focus !== false }));
  view.addEventListener('hashchange', () => activate(hashId()));
  view.addEventListener('popstate', () => activate(hashId()));
  root.getElementById('show-entry')?.addEventListener('click', () => {
    activate('subscription-editor', { history: true, focus: false });
    targetFor('name')?.focus();
  });
  // A validation error inside a collapsed optional group must be reachable.
  root.addEventListener('invalid', event => openDisclosures(event.target), true);
  const initial = hashId();
  activate(routeFor(initial) ? initial : 'top', { focus: false });
  return { activate, get current() { return current; } };
}
