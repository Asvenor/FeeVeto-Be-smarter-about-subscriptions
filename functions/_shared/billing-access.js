// Stripe will replace this server-side resolver later. Keeping paid access in a
// separate module prevents complimentary Clerk metadata from becoming billing state.
export async function getPaidPremiumAccess() {
  return false;
}
