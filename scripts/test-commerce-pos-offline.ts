import assert from "node:assert/strict";

import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import {
  POS_OFFLINE_DATABASE_NAME,
  assertNoPosOfflineSecret,
  cachePosOfflineCatalogue,
  cachePosOfflineLocations,
  closePosOfflineCashSession,
  getCachedPosOfflineLocations,
  getPendingPosOfflineOutboxCount,
  getPosOfflineCatalogue,
  getPosOfflineOutboxRetryOrder,
  getPosOfflineState,
  getPosOfflineTerminal,
  recordPosOfflineCashSale,
  removePosOfflineSuspendedTicket,
  resumePosOfflineSuspendedTicket,
  savePosOfflineActiveDraft,
  suspendPosOfflineDraft,
  type PosOfflineScope,
} from "../src/lib/commerce-pos-offline";
import { synchronizeCommercePosOfflineCashSessionClosures, synchronizeCommercePosOfflineSales } from "../src/lib/commerce-pos-sync";
import { createCommercePosDraft, createCommercePosId } from "../src/lib/commerce-pos-session";

Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDB });
Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });

function expect(condition: unknown, message: string): asserts condition {
  assert.equal(condition, true, message);
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => reject(request.error ?? new Error("Unable to reset IndexedDB for the test."));
    request.onblocked = () => reject(new Error("IndexedDB is locked during the test."));
    request.onsuccess = () => resolve();
  });
}

async function run(): Promise<void> {
  await deleteDatabase(POS_OFFLINE_DATABASE_NAME);

  const scope: PosOfflineScope = {
    locationId: "location-test-offline",
    userId: "cashier-test-offline",
  };

  const firstTerminal = await getPosOfflineTerminal();
  const secondTerminal = await getPosOfflineTerminal();
  expect(firstTerminal.terminalId === secondTerminal.terminalId, "The terminal must retain one stable local identity.");

  await cachePosOfflineLocations(scope.userId, [{ id: scope.locationId, name: "Boutique test", code: "TEST" }]);
  const cachedLocations = await getCachedPosOfflineLocations(scope.userId);
  assert.deepEqual(cachedLocations, [{ id: scope.locationId, name: "Boutique test", code: "TEST" }]);

  await cachePosOfflineCatalogue(scope, [{
    id: "article-chargeur",
    name: "Chargeur Type C",
    sku: "USB-C-001",
    unit: "Piece",
    quantity: 20,
    salePrice: 5_000,
  }]);

  const draft = {
    ...createCommercePosDraft(scope.locationId, scope.userId),
    lines: [
      {
        lineId: "article-chargeur",
        lineType: "ARTICLE" as const,
        itemId: "article-chargeur",
        label: "Chargeur Type C",
        quantity: 3,
        unitPrice: 5_000,
      },
      {
        lineId: "service-reparation",
        lineType: "SERVICE" as const,
        itemId: createCommercePosId("service"),
        label: "Reparation telephone",
        quantity: 1,
        unitPrice: 15_000,
        serviceNote: "Diagnostic inclus",
      },
    ],
    cashReceived: 30_000,
  };

  await savePosOfflineActiveDraft(scope, draft);
  let state = await getPosOfflineState(scope);
  assert.equal(state.activeDraft?.lines.length, 2, "The active ticket must survive an IndexedDB reread.");

  const suspended = { id: createCommercePosId("suspended"), suspendedAt: new Date().toISOString(), draft };
  await suspendPosOfflineDraft(scope, suspended);
  await savePosOfflineActiveDraft(scope, createCommercePosDraft(scope.locationId, scope.userId));
  state = await getPosOfflineState(scope);
  assert.equal(state.suspendedTickets.length, 1, "A suspended ticket must persist offline.");

  const resumed = await resumePosOfflineSuspendedTicket(scope, suspended.id);
  assert.ok(resumed, "A suspended ticket must be resumable.");
  await savePosOfflineActiveDraft(scope, resumed);
  state = await getPosOfflineState(scope);
  assert.equal(state.suspendedTickets.length, 0, "Resuming removes only the suspended copy.");

  const recorded = await recordPosOfflineCashSale(scope, resumed);
  const duplicate = await recordPosOfflineCashSale(scope, resumed);
  assert.equal(recorded.eventId, duplicate.eventId, "A retry must reuse the stable event id.");
  assert.equal(await getPendingPosOfflineOutboxCount(scope), 1, "One offline sale must create one outbox event.");

  const catalogueAfterSale = await getPosOfflineCatalogue(scope);
  assert.equal(catalogueAfterSale.find((item) => item.id === "article-chargeur")?.quantity, 17, "Only the stock article must decrease local stock once.");

  await cachePosOfflineCatalogue(scope, [{
    id: "article-chargeur",
    name: "Chargeur Type C",
    sku: "USB-C-001",
    unit: "Piece",
    quantity: 20,
    salePrice: 5_000,
  }]);
  const catalogueAfterRefresh = await getPosOfflineCatalogue(scope);
  assert.equal(catalogueAfterRefresh.find((item) => item.id === "article-chargeur")?.quantity, 17, "A catalogue refresh must not undo a sale still waiting in the outbox.");

  state = await getPosOfflineState(scope);
  assert.equal(state.activeDraft?.lines.length, 0, "A blank active ticket must be ready after an offline sale.");
  assert.equal(state.pendingOutboxCount, 1, "The outbox must survive a reread after offline sale.");

  const closed = await closePosOfflineCashSession(scope, { countedCash: 29_000, note: "Écart de caisse test" });
  assert.equal(closed.summary.ticketCount, 1, "A close must summarize the paid ticket in its session.");
  assert.equal(closed.summary.articleTotal, 15_000, "Only article lines belong to the article summary.");
  assert.equal(closed.summary.serviceTotal, 15_000, "Only service lines belong to the service summary.");
  assert.equal(closed.summary.theoreticalCash, 30_000, "The theoretical cash must be the accepted ticket total, not cash received.");
  assert.equal(closed.summary.difference, -1_000, "The declared difference must remain visible.");

  const closeRetry = await closePosOfflineCashSession(scope, { countedCash: 29_000, note: "Écart de caisse test" });
  assert.equal(closeRetry.eventId, closed.eventId, "A local close retry must preserve its stable outbox event.");
  state = await getPosOfflineState(scope);
  assert.equal(state.cashSession?.status, "CLOSED_LOCAL", "The session must remain closed after a browser restart simulation.");
  assert.equal(state.cashSessionSummary?.difference, -1_000, "The persisted close summary must retain the discrepancy.");
  assert.equal(state.activeDraft, null, "A closed session must not reopen an active ticket.");
  assert.equal(state.pendingOutboxCount, 2, "The durable outbox must contain one sale and one close.");

  await assert.rejects(
    () => savePosOfflineActiveDraft(scope, createCommercePosDraft(scope.locationId, scope.userId)),
    /clôturée/i,
    "A closed session must reject any new ticket until a new session is started.",
  );

  let prematureCloseTransportCalled = false;
  const pendingCloseSync = await synchronizeCommercePosOfflineCashSessionClosures(scope, async () => {
    prematureCloseTransportCalled = true;
    throw new Error("A close must never reach the server before its sales.");
  });
  assert.equal(prematureCloseTransportCalled, false, "The close transport must wait for its pending sale.");
  assert.equal(pendingCloseSync.synced, 0, "A close with unsynchronized sales must remain pending.");
  state = await getPosOfflineState(scope);
  assert.equal(state.cashSession?.status, "SYNC_PENDING", "The closed session must visibly wait for its sales.");

  const saleSync = await synchronizeCommercePosOfflineSales(scope, async (event) => ({
    receiptId: `receipt-${event.eventId}`,
    status: "PROCESSED",
    saleId: "00000000-0000-0000-0000-000000000001",
    saleNumber: "VTE-TEST",
    invoiceNumber: "FAC-TEST",
    paymentId: "00000000-0000-0000-0000-000000000002",
    operationId: "00000000-0000-0000-0000-000000000003",
    amount: 30_000,
    errorCode: null,
    errorMessage: null,
  }));
  assert.equal(saleSync.synced, 1, "The offline sale must synchronize before its close.");

  let closeTransportCalled = false;
  const closeSync = await synchronizeCommercePosOfflineCashSessionClosures(scope, async (event) => {
    closeTransportCalled = true;
    assert.equal(event.eventId, closed.eventId, "The close transport must receive the durable close event.");
    return { closureId: "00000000-0000-0000-0000-000000000004", status: "SYNCED", errorCode: null, errorMessage: null };
  });
  assert.equal(closeTransportCalled, true, "The close must run only after all of its sales are synchronized.");
  assert.equal(closeSync.synced, 1, "The close must be acknowledged exactly once.");
  state = await getPosOfflineState(scope);
  assert.equal(state.cashSession?.status, "SYNCED", "The closed session must be marked synchronized only after its tickets.");

  const nextSessionDraft = createCommercePosDraft(scope.locationId, scope.userId);
  await savePosOfflineActiveDraft(scope, nextSessionDraft, { allowCreateAfterClosed: true });
  const anotherSuspended = {
    id: createCommercePosId("suspended"),
    suspendedAt: new Date().toISOString(),
    draft: { ...draft, sessionId: createCommercePosId("pos") },
  };
  await suspendPosOfflineDraft(scope, anotherSuspended);
  await removePosOfflineSuspendedTicket(scope, anotherSuspended.id);
  state = await getPosOfflineState(scope);
  assert.equal(state.suspendedTickets.length, 0, "Deleting a suspended ticket must not leave local lines.");

  assert.deepEqual(getPosOfflineOutboxRetryOrder([
    { eventId: "later", createdAtDevice: "2026-08-11T10:01:00.000Z", status: "PENDING" },
    { eventId: "first", createdAtDevice: "2026-08-11T10:00:00.000Z", status: "FAILED" },
    { eventId: "synced", createdAtDevice: "2026-08-11T09:00:00.000Z", status: "SYNCED" },
  ]), ["first", "later"], "The future sync must preserve durable event ordering.");

  assert.throws(() => assertNoPosOfflineSecret({ JEKO_API_KEY: "not-stored" }), /sensible/i, "Secrets must never enter IndexedDB.");

  console.log("POS offline local tests passed.");
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
