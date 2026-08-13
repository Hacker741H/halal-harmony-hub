import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import {
  POS_OFFLINE_DATABASE_NAME,
  cachePosOfflineCatalogue,
  closePosOfflineCashSession,
  getPosOfflineOutboxEvents,
  getPosOfflineState,
  recordPosOfflineCashSale,
  resumePosOfflineSuspendedTicket,
  savePosOfflineActiveDraft,
  suspendPosOfflineDraft,
  type PosOfflineCashSessionCloseOutboxEvent,
  type PosOfflineSaleOutboxEvent,
  type PosOfflineScope,
} from "../src/lib/commerce-pos-offline";
import { synchronizeCommercePosOfflineOutbox } from "../src/lib/commerce-pos-sync";
import { createCommercePosDraft, createCommercePosId } from "../src/lib/commerce-pos-session";

Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDB });
Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });

const NativeDate = Date;
let deviceTime = NativeDate.parse("2026-08-03T08:00:00.000Z");
class FieldDate extends NativeDate {
  constructor(value?: string | number | Date) {
    super(value === undefined ? deviceTime : value instanceof NativeDate ? value.getTime() : value);
  }
  static now() { return deviceTime; }
}
Object.defineProperty(globalThis, "Date", { configurable: true, value: FieldDate });

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => reject(request.error ?? new Error("Unable to reset IndexedDB."));
    request.onblocked = () => reject(new Error("IndexedDB stayed locked."));
    request.onsuccess = () => resolve();
  });
}

const scope: PosOfflineScope = { locationId: "location-pos05-seven-days", userId: "cashier-pos05-seven-days" };
const salesPerDay = 50;
const dayCount = 7;
const expectedSales = salesPerDay * dayCount;

function makeDraft(day: number, ticket: number) {
  const pattern = ticket % 3;
  const articleQuantity = (ticket % 4) + 1;
  const serviceQuantity = (ticket % 2) + 1;
  const lines = pattern === 0 ? [{
    lineId: createCommercePosId("article-line"), lineType: "ARTICLE" as const, itemId: "article-pos05",
    label: "Article terrain", quantity: articleQuantity, unitPrice: 1_000,
  }] : pattern === 1 ? [{
    lineId: createCommercePosId("service-line"), lineType: "SERVICE" as const, itemId: createCommercePosId("service"),
    label: "Service terrain", quantity: serviceQuantity, unitPrice: 1_500, serviceNote: `Jour ${day + 1}`,
  }] : [{
    lineId: createCommercePosId("article-line"), lineType: "ARTICLE" as const, itemId: "article-pos05",
    label: "Article terrain", quantity: articleQuantity, unitPrice: 1_000,
  }, {
    lineId: createCommercePosId("service-line"), lineType: "SERVICE" as const, itemId: createCommercePosId("service"),
    label: "Service terrain", quantity: serviceQuantity, unitPrice: 1_500, serviceNote: `Ticket mixte J${day + 1}`,
  }];
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  return { ...createCommercePosDraft(scope.locationId, scope.userId), lines, cashReceived: total + ((ticket % 5) * 500) };
}

async function run() {
  const startedAt = performance.now();
  await deleteDatabase(POS_OFFLINE_DATABASE_NAME);
  await cachePosOfflineCatalogue(scope, [{ id: "article-pos05", name: "Article terrain", sku: "POS05", unit: "Pièce", quantity: 1_000, salePrice: 1_000 }]);
  let networkCallsDuringOfflinePhase = 0;
  const closeDays: string[] = [];

  for (let day = 0; day < dayCount; day += 1) {
    deviceTime = NativeDate.parse(`2026-08-${String(day + 3).padStart(2, "0")}T08:00:00.000Z`);
    for (let ticket = 0; ticket < salesPerDay; ticket += 1) {
      deviceTime += 60_000;
      let draft = makeDraft(day, ticket);
      await savePosOfflineActiveDraft(scope, draft);
      if (ticket === 12) {
        const suspendedId = createCommercePosId("suspended");
        await suspendPosOfflineDraft(scope, { id: suspendedId, suspendedAt: new Date().toISOString(), draft });
        const resumed = await resumePosOfflineSuspendedTicket(scope, suspendedId);
        assert.ok(resumed, "The daily suspended ticket must be resumable without network.");
        draft = resumed;
        await savePosOfflineActiveDraft(scope, draft);
      }
      await recordPosOfflineCashSale(scope, draft);
    }
    deviceTime = NativeDate.parse(`2026-08-${String(day + 3).padStart(2, "0")}T19:00:00.000Z`);
    const beforeClose = await getPosOfflineState(scope);
    const counted = (beforeClose.cashSessionSummary?.theoreticalCash ?? 0) - (day * 100);
    const closed = await closePosOfflineCashSession(scope, { countedCash: counted, note: day ? `Écart terrain J${day + 1}` : null });
    closeDays.push(closed.summary.closedAtDevice.slice(0, 10));
    if (day < dayCount - 1) {
      await savePosOfflineActiveDraft(scope, createCommercePosDraft(scope.locationId, scope.userId), { allowCreateAfterClosed: true });
    }
  }

  assert.equal(networkCallsDuringOfflinePhase, 0, "Seven offline days must not require any network call.");
  let events = await getPosOfflineOutboxEvents(scope);
  assert.equal(events.filter((event) => event.operation === "CREATE_CASH_SALE").length, expectedSales);
  assert.equal(events.filter((event) => event.operation === "CASH_SESSION_CLOSE").length, dayCount);
  assert.equal(new Set(closeDays).size, dayCount, "Each day must retain its own distinct closure date.");

  const serverSales = new Map<string, { receiptId: string; saleId: string; invoiceNumber: string; paymentId: string; operationId: string }>();
  const serverClosures = new Map<string, string>();
  let acceptedBeforeCut = 0;
  let networkAvailable = true;
  const saleTransport = async (event: PosOfflineSaleOutboxEvent) => {
    networkCallsDuringOfflinePhase += 1;
    const existing = serverSales.get(event.eventId);
    if (existing) return { ...existing, status: "PROCESSED" as const, saleNumber: `VTE-${existing.saleId.slice(-8)}`, amount: event.payload.total, errorCode: null, errorMessage: null };
    if (!networkAvailable || acceptedBeforeCut >= 139) {
      networkAvailable = false;
      throw new Error("Terrain network interruption");
    }
    acceptedBeforeCut += 1;
    const ids = { receiptId: createCommercePosId("receipt"), saleId: createCommercePosId("sale"), invoiceNumber: createCommercePosId("invoice"), paymentId: createCommercePosId("payment"), operationId: createCommercePosId("operation") };
    serverSales.set(event.eventId, ids);
    return { ...ids, status: "PROCESSED" as const, saleNumber: `VTE-${ids.saleId.slice(-8)}`, amount: event.payload.total, errorCode: null, errorMessage: null };
  };
  const closeTransport = async (event: PosOfflineCashSessionCloseOutboxEvent) => {
    networkCallsDuringOfflinePhase += 1;
    const sessionSales = events.filter((candidate) => candidate.operation === "CREATE_CASH_SALE" && candidate.cashSessionId === event.cashSessionId);
    assert.equal(sessionSales.every((sale) => serverSales.has(sale.eventId)), true, "A close must never reach the server before all session sales.");
    const existing = serverClosures.get(event.eventId);
    if (existing) return { closureId: existing, status: "SYNCED" as const, errorCode: null, errorMessage: null };
    const closureId = createCommercePosId("closure");
    serverClosures.set(event.eventId, closureId);
    return { closureId, status: "SYNCED" as const, errorCode: null, errorMessage: null };
  };

  const interrupted = await synchronizeCommercePosOfflineOutbox(scope, { sale: saleTransport, close: closeTransport });
  assert.equal(interrupted.synced, 141, "The first short connection must preserve 139 tickets and only the two fully covered daily closures.");
  assert.equal(serverSales.size, 139);
  assert.equal(serverClosures.size, 2, "Only sessions whose 50 tickets are complete may close before the interruption.");
  events = await getPosOfflineOutboxEvents(scope);
  assert.equal(events.filter((event) => event.status === "SYNCED").length, 141);
  assert.equal(events.filter((event) => event.operation === "CREATE_CASH_SALE" && event.status !== "SYNCED").length, expectedSales - 139);

  deviceTime += 60 * 60 * 1000;
  networkAvailable = true;
  acceptedBeforeCut = -10_000;
  const resumed = await synchronizeCommercePosOfflineOutbox(scope, { sale: saleTransport, close: closeTransport });
  assert.equal(resumed.failed, 0, "The next reconnection must resume only the remaining work.");
  assert.equal(serverSales.size, expectedSales);
  assert.equal(serverClosures.size, dayCount);
  events = await getPosOfflineOutboxEvents(scope);
  assert.equal(events.length, expectedSales + dayCount);
  assert.equal(events.every((event) => event.status === "SYNCED"), true);

  const saleCountBeforeReplay = serverSales.size;
  const closureCountBeforeReplay = serverClosures.size;
  for (const sale of events.filter((event): event is PosOfflineSaleOutboxEvent => event.operation === "CREATE_CASH_SALE").slice(0, 12)) await saleTransport(sale);
  for (const closure of events.filter((event): event is PosOfflineCashSessionCloseOutboxEvent => event.operation === "CASH_SESSION_CLOSE").slice(0, 3)) await closeTransport(closure);
  assert.equal(serverSales.size, saleCountBeforeReplay, "Replayed offline_sale_id values must not duplicate server sales.");
  assert.equal(serverClosures.size, closureCountBeforeReplay, "Replayed closing ids must not duplicate server closures.");

  const elapsedMs = Math.round(performance.now() - startedAt);
  console.log(JSON.stringify({ days: dayCount, tickets: expectedSales, closures: dayCount, firstConnectionTickets: 139, firstConnectionClosures: 2, finalSales: serverSales.size, finalClosures: serverClosures.size, duplicates: 0, elapsedMs }));
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  Object.defineProperty(globalThis, "Date", { configurable: true, value: NativeDate });
});
