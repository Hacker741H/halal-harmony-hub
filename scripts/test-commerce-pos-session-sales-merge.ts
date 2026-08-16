import assert from "node:assert/strict";

import { mergeCommercePosSessionSaleRows, type CommercePosSessionServerSale, type PosOfflineOutboxEvent, type PosOfflineSaleOutboxEvent } from "../src/lib/commerce-pos-offline";

/**
 * Mission maitre, Blocker A: "Mes ventes" used to read the local outbox
 * only, so an online-direct sale (create_commerce_cash_sale never writes an
 * outbox event) never appeared even though it was fully confirmed
 * server-side. This isolates the merge formula -- "server sales (anything
 * confirmed, online or offline-then-synced) + local events not yet SYNCED,
 * keyed by eventId, never by amount/time" -- from IndexedDB and the
 * network.
 */

function saleEvent(overrides: Partial<PosOfflineSaleOutboxEvent> & { eventId: string }): PosOfflineOutboxEvent {
  return {
    deviceId: "device-1", terminalId: "terminal-1", locationId: "loc-1", userId: "user-1",
    cashSessionId: "session-1", entityId: overrides.eventId, entityType: "SALE", operation: "CREATE_CASH_SALE",
    createdAtDevice: "2026-08-16T09:00:00.000Z", status: "PENDING", attemptCount: 0, lastAttemptAt: null, lastError: null, syncedAt: null,
    payload: { ticketId: overrides.eventId, clientId: null, paymentMethod: "CASH", total: 1000, cashReceived: 1000, changeDue: 0, lines: [
      { lineId: "line-1", lineType: "ARTICLE", itemId: "item-1", label: "Article", quantity: 1, unitPrice: 1000 },
    ] },
    ...overrides,
  } as PosOfflineOutboxEvent;
}

function serverSale(overrides: Partial<CommercePosSessionServerSale> & { id: string }): CommercePosSessionServerSale {
  return {
    saleNumber: `VTE-${overrides.id}`, createdAt: "2026-08-16T09:00:00.000Z", total: 1000,
    articleCount: 1, serviceCount: 0, paymentMethod: "CASH",
    ...overrides,
  };
}

function run() {
  // Empty session: neither source has anything -- must be [], not undefined
  // or an error.
  assert.deepEqual(mergeCommercePosSessionSaleRows([], null), []);
  assert.deepEqual(mergeCommercePosSessionSaleRows([], []), []);

  // The exact production bug: an online-direct sale has no outbox event at
  // all, only a server row. It must still appear.
  const onlineOnly = mergeCommercePosSessionSaleRows([], [serverSale({ id: "s1", total: 14000 })]);
  assert.equal(onlineOnly.length, 1, "an online-direct sale (server-only, no local event) must appear");
  assert.equal(onlineOnly[0].total, 14000);
  assert.equal(onlineOnly[0].syncStatus, "SYNCED");

  // A not-yet-synced offline sale, no server row yet: must appear from the
  // local side.
  const offlinePending = mergeCommercePosSessionSaleRows([saleEvent({ eventId: "e1", status: "PENDING" })], null);
  assert.equal(offlinePending.length, 1, "a pending offline sale must appear from the local outbox");
  assert.equal(offlinePending[0].syncStatus, "PENDING");

  // Core no-double-count contract: once an event is SYNCED, it must be
  // excluded from the local side -- the matching server row (same sale,
  // arrived via sync) is the only surviving copy. 1 server + 1 synced-local
  // (the same sale, post-sync) = 1 row, never 2.
  const afterSync = mergeCommercePosSessionSaleRows(
    [saleEvent({ eventId: "e1", status: "SYNCED", serverSaleId: "s1" })],
    [serverSale({ id: "s1" })],
  );
  assert.equal(afterSync.length, 1, "a SYNCED local event must never be counted alongside its own server row");

  // Mixed session: 1 confirmed server sale + 1 still-pending local sale =
  // 2 rows, never 1 (one side dropped) and never counted twice.
  const mixed = mergeCommercePosSessionSaleRows(
    [saleEvent({ eventId: "e2", status: "PENDING", createdAtDevice: "2026-08-16T09:05:00.000Z" })],
    [serverSale({ id: "s2", createdAt: "2026-08-16T09:00:00.000Z" })],
  );
  assert.equal(mixed.length, 2, "a mixed session must show both the confirmed server sale and the pending local one");

  // Sort order: newest first, across both sources together, not source by
  // source.
  const sortCheck = mergeCommercePosSessionSaleRows(
    [saleEvent({ eventId: "e-newest", status: "PENDING", createdAtDevice: "2026-08-16T09:10:00.000Z" })],
    [serverSale({ id: "s-oldest", createdAt: "2026-08-16T09:00:00.000Z" }), serverSale({ id: "s-middle", createdAt: "2026-08-16T09:05:00.000Z" })],
  );
  assert.deepEqual(sortCheck.map((row) => row.id), ["e-newest", "s-middle", "s-oldest"], "rows must be sorted newest-first across both sources combined");

  // A CONFLICT event (offline sale that failed to reconcile) must still be
  // visible -- it is not SYNCED, so it stays on the local side with its own
  // status, never silently dropped.
  const conflict = mergeCommercePosSessionSaleRows([saleEvent({ eventId: "e3", status: "CONFLICT" })], []);
  assert.equal(conflict.length, 1, "a CONFLICT event must still be visible, not silently dropped");
  assert.equal(conflict[0].syncStatus, "CONFLICT");

  // Ticket count must never change purely because a ticket crosses from
  // local to server on sync -- 1 (local, pending) before, 1 (server,
  // synced) after.
  const before = mergeCommercePosSessionSaleRows([saleEvent({ eventId: "e4", status: "PENDING" })], []);
  const after = mergeCommercePosSessionSaleRows([saleEvent({ eventId: "e4", status: "SYNCED", serverSaleId: "s4" })], [serverSale({ id: "s4" })]);
  assert.equal(before.length, after.length, "a ticket converging from local to server must not change the visible count");

  console.log(JSON.stringify({ passed: "SESSION_SALES_MERGE_TEST_PASSED", cases: 8 }));
}

run();
