import assert from "node:assert/strict";
import { parseIntent } from "../js/journeyModel.js";

// Read-only/public assessment checks. No account saves, deployment, or KV writes.
const base = process.argv[2] || "http://127.0.0.1:8787/";
async function call(path, body) {
  const response = await fetch(new URL(path, base), {
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, body: await response.json() };
}
for (const service of ["canva", "netflix", "chatgpt", "claude", "photoshop", "dropbox"]) {
  const initial = await call("/api/alternatives/recommendations", {
    serviceId: service,
    marketCurrency: "USD",
  });
  assert.equal(initial.status, 200);
  assert.ok(
    initial.body.items.length > 0,
    `${service} needs at least one checked guest suggestion`,
  );
  assert.ok(
    initial.body.items.every((item) => item.pricingModel !== "free"),
    "No restricted free records for guests",
  );
  assert.ok(
    initial.body.items.every((item) => item.feeVetoMatch?.score === null),
    "Sparse answers must not produce a precise personal score",
  );
  const { draft } = parseIntent(`${service} is too expensive`);
  const assessment = await call("/api/assessment", {
    draft,
    marketCurrency: "USD",
  });
  assert.equal(assessment.status, 200);
  assert.notEqual(
    assessment.body.assessment.alternatives.state,
    "catalogue_unavailable",
  );
  assert.equal(
    assessment.body.assessment.currentAnnualMinor,
    null,
    "No invented current price",
  );
  console.log(
    JSON.stringify({
      service,
      initialStatus: initial.status,
      suggestions: initial.body.items.length,
      assessmentStatus: assessment.status,
      action: assessment.body.assessment.action,
    }),
  );
}
const { draft } = parseIntent("Canva is too expensive");
const detailed = await call("/api/assessment", {
  draft: {
    ...draft,
    amountMinor: 2000,
    currency: "USD",
    country: "US",
    platform: "web",
    mustHave: ["templates"],
    audience: "solo",
    usage: "weekly",
  },
  marketCurrency: "USD",
});
assert.equal(detailed.status, 200);
assert.equal(detailed.body.assessment.currentAnnualMinor, 24000);
for (const item of detailed.body.assessment.alternatives.items)
  assert.ok(!item.unsupportedFeatures.includes("templates"));
const forbidden = await call("/api/audits");
assert.equal(forbidden.status, 401);
const unsupported = await call("/api/assessment", {
  draft: { originalRequest: "unknown provider" },
});
assert.equal(unsupported.status, 400);
assert.equal((await call("/api/does-not-exist")).status, 404);
console.log(
  JSON.stringify({
    detailedStatus: detailed.status,
    detailedAction: detailed.body.assessment.action,
    guestHistory: forbidden.status,
    unsupported: unsupported.status,
  }),
);
