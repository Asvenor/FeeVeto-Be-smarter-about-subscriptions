export const ORDINARY_ACCESS = Object.freeze({
  authenticated: false,
  role: 'user',
  betaAccess: false,
  isAdmin: false,
  complimentaryPremiumAccess: false,
  paidPremiumAccess: false,
  premiumAccess: false,
});

export function normalizeServerAccess(value) {
  if (!value || typeof value !== 'object' || value.authenticated !== true) return ORDINARY_ACCESS;

  const isAdmin = value.role === 'admin' && value.isAdmin === true;
  const betaAccess = value.betaAccess === true;
  const complimentaryPremiumAccess = isAdmin || betaAccess;
  const paidPremiumAccess = value.paidPremiumAccess === true;

  return Object.freeze({
    authenticated: true,
    role: isAdmin ? 'admin' : 'user',
    betaAccess,
    isAdmin,
    complimentaryPremiumAccess,
    paidPremiumAccess,
    premiumAccess: complimentaryPremiumAccess || paidPremiumAccess,
  });
}

export async function fetchAccessStatus(clerk, fetchImplementation = window.fetch.bind(window)) {
  const token = await clerk?.session?.getToken();
  if (!token) return ORDINARY_ACCESS;

  try {
    const response = await fetchImplementation('./api/access', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return ORDINARY_ACCESS;
    return normalizeServerAccess(await response.json());
  } catch {
    return ORDINARY_ACCESS;
  }
}
