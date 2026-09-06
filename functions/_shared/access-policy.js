export const USER_ROLE = 'user';
export const ADMIN_ROLE = 'admin';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
export function resolveAccess({ authenticated = false, privateMetadata, paidPremiumAccess = false } = {}) {
  if (!authenticated) {
    return Object.freeze({
      authenticated: false,
      role: USER_ROLE,
      betaAccess: false,
      isAdmin: false,
      complimentaryPremiumAccess: false,
      paidPremiumAccess: false,
      premiumAccess: false,
    });
  }

  const metadata = isRecord(privateMetadata) ? privateMetadata : {};
  const role = metadata.role === ADMIN_ROLE ? ADMIN_ROLE : USER_ROLE;
  const betaAccess = metadata.betaAccess === true;
  const isAdmin = role === ADMIN_ROLE;
  const complimentaryPremiumAccess = isAdmin || betaAccess;
  const paidAccess = paidPremiumAccess === true;

  return Object.freeze({
    authenticated: true,
    role,
    betaAccess,
    isAdmin,
    complimentaryPremiumAccess,
    paidPremiumAccess: paidAccess,
    premiumAccess: complimentaryPremiumAccess || paidAccess,
  });
}
