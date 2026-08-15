import assert from "node:assert/strict";

import { mergeCommercePosCashSessionSummaries, type PosOfflineCashSessionSummary } from "../src/lib/commerce-pos-offline";

/**
 * Mission caisse (résumé pré-clôture): the merge formula is
 * "server totals + local-not-yet-synced totals". This isolates that pure
 * arithmetic from IndexedDB and the network so the "no double counting"
 * contract (server and local contributions are disjoint by construction --
 * see getPosOfflineCashSessionSummary's SYNCED exclusion) is checked
 * directly, independent of the offline/sync machinery around it.
 */

function summary(overrides: Partial<PosOfflineCashSessionSummary>): PosOfflineCashSessionSummary {
  return {
    ticketCount: 0, articleTotal: 0, articleQuantityTotal: 0, serviceTotal: 0,
    cashTotal: 0, otherPaymentTotal: 0, theoreticalCash: 0, cancelledTicketCount: 0,
    ...overrides,
  };
}

function run() {
  // TEST A/no-network baseline: nothing on either side yields null, not a
  // fabricated zero object -- callers must be able to tell "no session" apart
  // from "empty session".
  assert.equal(mergeCommercePosCashSessionSummaries(null, null), null);

  // No server data yet (never fetched, or offline from the very first sale):
  // the local contribution alone is the whole truth, returned as-is.
  const localOnly = summary({ ticketCount: 2, articleTotal: 4500, theoreticalCash: 4500 });
  assert.deepEqual(mergeCommercePosCashSessionSummaries(localOnly, null), localOnly);

  // Server has data, nothing pending locally (e.g. an online-only session,
  // the exact case that used to read zero): server totals pass through.
  const serverOnly = { ticketCount: 4, articleTotal: 10000, articleQuantityTotal: 20, serviceTotal: 0, cashTotal: 10000, otherPaymentTotal: 0, theoreticalCash: 10000 };
  assert.deepEqual(mergeCommercePosCashSessionSummaries(null, serverOnly), {
    ...serverOnly, cancelledTicketCount: 0,
  });

  // TEST C: 2 online (server) + 2 offline not yet synced (local) = 4, never
  // 2 (server ignored) and never 6 (either side double-applied).
  const server2 = { ticketCount: 2, articleTotal: 5000, articleQuantityTotal: 10, serviceTotal: 0, cashTotal: 5000, otherPaymentTotal: 0, theoreticalCash: 5000 };
  const local2 = summary({ ticketCount: 2, articleTotal: 5000, articleQuantityTotal: 10, cashTotal: 5000, theoreticalCash: 5000 });
  const merged = mergeCommercePosCashSessionSummaries(local2, server2);
  assert.equal(merged?.ticketCount, 4, "mixed session must total 4 tickets, not 2 or 6");
  assert.equal(merged?.articleTotal, 10000);
  assert.equal(merged?.articleQuantityTotal, 20);
  assert.equal(merged?.theoreticalCash, 10000);

  // TEST D/G shape: once a previously-local sale syncs, it must move from
  // the local side to the server side without changing the total -- server
  // grows by exactly what local shrinks by.
  const beforeSync = mergeCommercePosCashSessionSummaries(
    summary({ ticketCount: 1, articleTotal: 3000, theoreticalCash: 3000 }),
    { ticketCount: 3, articleTotal: 7000, articleQuantityTotal: 14, serviceTotal: 0, cashTotal: 7000, otherPaymentTotal: 0, theoreticalCash: 7000 },
  );
  const afterSync = mergeCommercePosCashSessionSummaries(
    summary({ ticketCount: 0, articleTotal: 0, theoreticalCash: 0 }),
    { ticketCount: 4, articleTotal: 10000, articleQuantityTotal: 20, serviceTotal: 0, cashTotal: 10000, otherPaymentTotal: 0, theoreticalCash: 10000 },
  );
  assert.equal(beforeSync?.theoreticalCash, afterSync?.theoreticalCash, "a sale converging from local to server must not change the visible total");
  assert.equal(beforeSync?.ticketCount, afterSync?.ticketCount);

  console.log(JSON.stringify({ passed: "SESSION_SUMMARY_MERGE_TEST_PASSED", cases: 5 }));
}

run();
