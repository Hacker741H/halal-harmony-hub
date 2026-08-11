import assert from "node:assert/strict";

import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import {
  POS_OFFLINE_DATABASE_NAME,
  assertNoPosOfflineSecret,
  cachePosOfflineCatalogue,
  cachePosOfflineLocations,
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
