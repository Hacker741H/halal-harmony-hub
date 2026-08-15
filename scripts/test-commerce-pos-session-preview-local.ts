import assert from "node:assert/strict";

import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import {
  POS_OFFLINE_DATABASE_NAME,
  cachePosOfflineCatalogue,
  getPosOfflineState,
  recordPosOfflineCashSale,
  savePosOfflineActiveDraft,
  type PosOfflineScope,
} from "../src/lib/commerce-pos-offline";
import {
  synchronizeCommercePosOfflineSales,
  type CommercePosOfflineSyncTransport,
} from "../src/lib/commerce-pos-sync";
import { createCommercePosDraft, createCommercePosId } from "../src/lib/commerce-pos-session";

/**
 * Mission caisse (résumé pré-clôture): the local half of the merged summary
 * -- getPosOfflineCashSessionSummary must count offline sales not yet known
 * to be synced (B), survive a reload since IndexedDB is durable (E/F), and
 * drop a sale from the local count the instant its outbox event is marked
 * SYNCED so the server side (proven separately in
 * scripts/test-commerce-pos-session-preview.sql) becomes the sole owner of
 * it without ever being double-counted (D/G).
 */
Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDB });
Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => reject(request.error ?? new Error("Unable to reset IndexedDB for the test."));
    request.onblocked = () => reject(new Error("IndexedDB is locked during the test."));
    request.onsuccess = () => resolve();
  });
}

let receiptCounter = 0;
function createReceipt(eventId: string, amount: number) {
  receiptCounter += 1;
  return {
    receiptId: `receipt-${eventId}`,
    status: "PROCESSED" as const,
    saleId: `sale-${receiptCounter}`,
    saleNumber: `VTE-${String(receiptCounter).padStart(6, "0")}`,
    invoiceNumber: `FAC-${String(receiptCounter).padStart(6, "0")}`,
    paymentId: `payment-${receiptCounter}`,
    operationId: null,
    amount,
    errorCode: null,
    errorMessage: null,
  };
}

async function sellOneArticle(scope: PosOfflineScope, quantity: number, unitPrice: number) {
  const draft = {
    ...createCommercePosDraft(scope.locationId, scope.userId),
    lines: [{ lineId: createCommercePosId("article-line"), lineType: "ARTICLE" as const, itemId: "article-summary-test", label: "Article résumé", quantity, unitPrice }],
    cashReceived: quantity * unitPrice,
  };
  await savePosOfflineActiveDraft(scope, draft);
  return recordPosOfflineCashSale(scope, draft);
}

async function run(): Promise<void> {
  await deleteDatabase(POS_OFFLINE_DATABASE_NAME);
  const scope: PosOfflineScope = { locationId: "location-summary-local-test", userId: "cashier-summary-local-test" };

  await cachePosOfflineCatalogue(scope, [{ id: "article-summary-test", name: "Article résumé", sku: "SUM-1", unit: "Pièce", quantity: 100, salePrice: 500 }]);

  // TEST B: 4 offline sales, none synced yet -- must appear locally right away.
  const sale1 = await sellOneArticle(scope, 1, 1000);
  const sale2 = await sellOneArticle(scope, 1, 500);
  await sellOneArticle(scope, 1, 2500);
  await sellOneArticle(scope, 1, 3000);

  let state = await getPosOfflineState(scope);
  assert.equal(state.cashSessionSummary?.ticketCount, 4, "4 unsynced offline sales must show as 4 tickets locally.");
  assert.equal(state.cashSessionSummary?.theoreticalCash, 7000, "1000+500+2500+3000 → theoretical must be 7000.");

  // TEST F: reload (fresh read of the same durable IndexedDB) must preserve
  // the still-unsynced offline sales exactly.
  state = await getPosOfflineState(scope);
  assert.equal(state.cashSessionSummary?.ticketCount, 4, "A reload before any sync must not lose offline sales.");
  assert.equal(state.cashSessionSummary?.theoreticalCash, 7000);

  // Sync ALL 4 via a mocked transport -- proves the exclusion logic drops
  // every synced sale out of the local bucket, not just some of them.
  const amounts = new Map([[sale1.eventId, 1000], [sale2.eventId, 500]]);
  const transport: CommercePosOfflineSyncTransport = async (event) => createReceipt(event.eventId, amounts.get(event.eventId) ?? 0);
  const firstSync = await synchronizeCommercePosOfflineSales(scope, transport);
  assert.equal(firstSync.failed, 0, "Sync must not fail.");
  assert.equal(firstSync.synced, 4, "All 4 queued offline sales must synchronize.");

  // TEST D/G (local half): once synced, a sale must disappear from the local
  // contribution -- the server side owns it now (proven in the .sql test).
  state = await getPosOfflineState(scope);
  assert.equal(state.cashSessionSummary?.ticketCount, 0, "Every offline sale synced must leave zero local contribution -- the server side now owns all 4.");
  assert.equal(state.cashSessionSummary?.theoreticalCash, 0);

  // TEST G: retry the same sync pass again. Already-SYNCED events are not
  // retryable candidates -- nothing should change, no negative counts, no
  // resurrection of a synced ticket into the local bucket.
  const retrySync = await synchronizeCommercePosOfflineSales(scope, transport);
  assert.equal(retrySync.total, 0, "A retry once everything is SYNCED must find nothing left to retry.");
  state = await getPosOfflineState(scope);
  assert.equal(state.cashSessionSummary?.ticketCount, 0, "Retrying sync after full sync must not resurrect anything into the local count.");
  assert.equal(state.cashSessionSummary?.theoreticalCash, 0);

  // Mixed state: a brand-new offline sale recorded AFTER the first four
  // already synced. Must show as exactly 1 locally -- neither merged back
  // with the 4 already-synced sales nor lost.
  await sellOneArticle(scope, 2, 750);
  state = await getPosOfflineState(scope);
  assert.equal(state.cashSessionSummary?.ticketCount, 1, "A new unsynced sale after a full sync must count as exactly 1, not 0 and not 5.");
  assert.equal(state.cashSessionSummary?.theoreticalCash, 1500, "2 x 750 = 1500 for the one still-local sale.");

  // TEST E/F again, now in this mixed state: reload must preserve exactly
  // this local-only contribution.
  state = await getPosOfflineState(scope);
  assert.equal(state.cashSessionSummary?.ticketCount, 1, "Reload in a mixed synced/unsynced state must preserve the local-only count.");
  assert.equal(state.cashSessionSummary?.theoreticalCash, 1500);

  console.log(JSON.stringify({
    passed: "SESSION_PREVIEW_LOCAL_TEST_PASSED",
    afterFourOfflineSales: { ticketCount: 4, theoreticalCash: 7000 },
    afterFullSync: { ticketCount: 0, theoreticalCash: 0 },
    afterRetrySync: { ticketCount: 0, theoreticalCash: 0 },
    afterFifthSaleMixedState: { ticketCount: 1, theoreticalCash: 1500 },
  }));
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
