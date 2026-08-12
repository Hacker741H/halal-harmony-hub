import assert from "node:assert/strict";

import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import {
  POS_OFFLINE_DATABASE_NAME,
  cachePosOfflineCatalogue,
  getPosOfflineCatalogue,
  getPosOfflineOutboxEvents,
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

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createReceipt(eventId: string) {
  return {
    receiptId: `receipt-${eventId}`,
    status: "PROCESSED" as const,
    saleId: `sale-${eventId}`,
    saleNumber: `VTE-${eventId.slice(-6)}`,
    invoiceNumber: `FAC-${eventId.slice(-6)}`,
    paymentId: `payment-${eventId}`,
    operationId: `operation-${eventId}`,
    amount: 20_000,
    errorCode: null,
    errorMessage: null,
  };
}

async function createOfflineMixedSale(scope: PosOfflineScope) {
  const draft = {
    ...createCommercePosDraft(scope.locationId, scope.userId),
    lines: [
      { lineId: "article-chargeur", lineType: "ARTICLE" as const, itemId: "article-chargeur", label: "Chargeur Type C", quantity: 1, unitPrice: 5_000 },
      { lineId: createCommercePosId("service"), lineType: "SERVICE" as const, itemId: createCommercePosId("service-item"), label: "Réparation téléphone", quantity: 1, unitPrice: 15_000, serviceNote: "Diagnostic" },
    ],
    cashReceived: 25_000,
  };
  await savePosOfflineActiveDraft(scope, draft);
  return recordPosOfflineCashSale(scope, draft);
}

async function run(): Promise<void> {
  await deleteDatabase(POS_OFFLINE_DATABASE_NAME);
  const scope: PosOfflineScope = { locationId: "location-sync-test", userId: "cashier-sync-test" };

  await cachePosOfflineCatalogue(scope, [{
    id: "article-chargeur",
    name: "Chargeur Type C",
    sku: "USB-C-001",
    unit: "Pièce",
    quantity: 5,
    salePrice: 5_000,
  }]);

  const firstSale = await createOfflineMixedSale(scope);
  const pendingStock = await getPosOfflineCatalogue(scope);
  assert.equal(pendingStock[0]?.quantity, 4, "The offline article sale must reduce only local article stock.");

  let transportCalls = 0;
  const processedReceipts = new Map<string, ReturnType<typeof createReceipt>>();
  const idempotentTransport: CommercePosOfflineSyncTransport = async (event) => {
    transportCalls += 1;
    const existing = processedReceipts.get(event.eventId);
    if (existing) return existing;
    const receipt = createReceipt(event.eventId);
    processedReceipts.set(event.eventId, receipt);
    return receipt;
  };

  const initialSync = await synchronizeCommercePosOfflineSales(scope, idempotentTransport);
  assert.equal(initialSync.synced, 1, "The queued offline cash sale must synchronize automatically.");
  assert.equal(transportCalls, 1, "One queued sale must call the server once.");
  let events = await getPosOfflineOutboxEvents(scope);
  assert.equal(events[0]?.status, "SYNCED", "The receipt must keep a local synchronized proof.");
  assert.equal(events[0]?.serverAmount, 20_000, "The server receipt must retain the collected total, never the cash received.");

  await cachePosOfflineCatalogue(scope, [{
    id: "article-chargeur",
    name: "Chargeur Type C",
    sku: "USB-C-001",
    unit: "Pièce",
    quantity: 4,
    salePrice: 5_000,
  }]);
  const reconciledStock = await getPosOfflineCatalogue(scope);
  assert.equal(reconciledStock[0]?.quantity, 4, "The next server stock snapshot must not double-apply a synchronized offline sale.");

  const secondSale = await createOfflineMixedSale(scope);
  let responseLost = true;
  const responseLossTransport: CommercePosOfflineSyncTransport = async (event) => {
    transportCalls += 1;
    const existing = processedReceipts.get(event.eventId);
    if (existing) return existing;
    const receipt = createReceipt(event.eventId);
    processedReceipts.set(event.eventId, receipt);
    if (responseLost) {
      responseLost = false;
      throw new Error("Network timeout after the server committed the receipt.");
    }
    return receipt;
  };
  const firstAttempt = await synchronizeCommercePosOfflineSales(scope, responseLossTransport);
  assert.equal(firstAttempt.failed, 1, "A lost response must keep the sale retryable in the outbox.");
  events = await getPosOfflineOutboxEvents(scope);
  expect(events.some((event) => event.eventId === secondSale.eventId && event.status === "FAILED"), "The lost response must not be marked synchronized prematurely.");
  await wait(2_100);
  const retry = await synchronizeCommercePosOfflineSales(scope, responseLossTransport);
  assert.equal(retry.synced, 1, "A retry after a lost response must accept the existing server receipt.");
  assert.equal(processedReceipts.size, 2, "Retrying one offline id must not produce a second server sale.");

  const thirdSale = await createOfflineMixedSale(scope);
  const conflictTransport: CommercePosOfflineSyncTransport = async (event) => ({
    receiptId: `receipt-${event.eventId}`,
    status: "CONFLICT",
    saleId: null,
    saleNumber: null,
    invoiceNumber: null,
    paymentId: null,
    operationId: null,
    amount: 20_000,
    errorCode: "STOCK_CONFLICT",
    errorMessage: "Le stock serveur ne couvre plus ce ticket.",
  });
  const conflict = await synchronizeCommercePosOfflineSales(scope, conflictTransport);
  assert.equal(conflict.conflicts, 1, "A server stock conflict must be retained for control, never silently dropped.");
  events = await getPosOfflineOutboxEvents(scope);
  expect(events.some((event) => event.eventId === thirdSale.eventId && event.status === "CONFLICT"), "The conflicting ticket must remain visible locally.");

  const state = await getPosOfflineState(scope);
  assert.equal(state.pendingOutboxCount, 1, "Only the stock-conflict ticket must remain pending after successful synchronization.");
  console.log("POS offline synchronization tests passed.");
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
