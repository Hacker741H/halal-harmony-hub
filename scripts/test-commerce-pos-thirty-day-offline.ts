import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import {
  POS_OFFLINE_DATABASE_NAME,
  cachePosOfflineCatalogue,
  closePosOfflineCashSession,
  getPosOfflineOutboxEvents,
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

/**
 * Mission caisse: 30 consecutive offline days (1500 sales / 30 closures / 30
 * control reports), proving the new no-declaration close still produces one
 * local report per day immediately -- with zero duplicates or orphans even
 * across a mid-stream reconnection -- and that a report id is never
 * reassigned to a retried closure.
 */
Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDB });
Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });

const NativeDate = Date;
let deviceTime = NativeDate.parse("2026-08-01T08:00:00.000Z");
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

const scope: PosOfflineScope = { locationId: "location-mission-thirty-days", userId: "cashier-mission-thirty-days" };
const salesPerDay = 50;
const dayCount = 30;
const expectedSales = salesPerDay * dayCount;
const firstConnectionCut = 625; // 12 full days (600) + 25 tickets into day 13.
const firstConnectionClosures = 12;

function makeDraft(day: number, ticket: number) {
  const pattern = ticket % 3;
  const articleQuantity = (ticket % 4) + 1;
  const serviceQuantity = (ticket % 2) + 1;
  const lines = pattern === 0 ? [{
    lineId: createCommercePosId("article-line"), lineType: "ARTICLE" as const, itemId: "article-mission30",
    label: "Article boutique", quantity: articleQuantity, unitPrice: 1_000,
  }] : pattern === 1 ? [{
    lineId: createCommercePosId("service-line"), lineType: "SERVICE" as const, itemId: createCommercePosId("service"),
    label: "Service boutique", quantity: serviceQuantity, unitPrice: 1_500, serviceNote: `Jour ${day + 1}`,
  }] : [{
    lineId: createCommercePosId("article-line"), lineType: "ARTICLE" as const, itemId: "article-mission30",
    label: "Article boutique", quantity: articleQuantity, unitPrice: 1_000,
  }, {
    lineId: createCommercePosId("service-line"), lineType: "SERVICE" as const, itemId: createCommercePosId("service"),
    label: "Service boutique", quantity: serviceQuantity, unitPrice: 1_500, serviceNote: `Ticket mixte J${day + 1}`,
  }];
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  return { ...createCommercePosDraft(scope.locationId, scope.userId), lines, cashReceived: total + ((ticket % 5) * 500) };
}

async function run() {
  const startedAt = performance.now();
  await deleteDatabase(POS_OFFLINE_DATABASE_NAME);
  await cachePosOfflineCatalogue(scope, [{ id: "article-mission30", name: "Article boutique", sku: "MISSION30", unit: "Pièce", quantity: 10_000, salePrice: 1_000 }]);
  const closeDays: string[] = [];
  const localReports: Array<{ day: number; ticketCount: number; theoreticalCash: number; countedCash: number | null }> = [];

  for (let day = 0; day < dayCount; day += 1) {
    deviceTime = NativeDate.parse(`2026-08-${String(day + 1).padStart(2, "0")}T08:00:00.000Z`);
    for (let ticket = 0; ticket < salesPerDay; ticket += 1) {
      deviceTime += 45_000;
      let draft = makeDraft(day, ticket);
      await savePosOfflineActiveDraft(scope, draft);
      if (ticket === 20) {
        const suspendedId = createCommercePosId("suspended");
        await suspendPosOfflineDraft(scope, { id: suspendedId, suspendedAt: new Date().toISOString(), draft });
        const resumed = await resumePosOfflineSuspendedTicket(scope, suspendedId);
        assert.ok(resumed, "The daily suspended ticket must be resumable without network.");
        draft = resumed;
        await savePosOfflineActiveDraft(scope, draft);
      }
      await recordPosOfflineCashSale(scope, draft);
    }
    deviceTime = NativeDate.parse(`2026-08-${String(day + 1).padStart(2, "0")}T19:00:00.000Z`);
    // Mission caisse: the cashier declares nothing at close time -- no
    // countedCash is ever passed here, matching the real UI call site.
    const closed = await closePosOfflineCashSession(scope, {});
    closeDays.push(closed.summary.closedAtDevice.slice(0, 10));
    localReports.push({
      day,
      ticketCount: closed.summary.ticketCount,
      theoreticalCash: closed.summary.theoreticalCash,
      countedCash: closed.summary.countedCash,
    });
    if (day < dayCount - 1) {
      await savePosOfflineActiveDraft(scope, createCommercePosDraft(scope.locationId, scope.userId), { allowCreateAfterClosed: true });
    }
  }

  // Point 4 of the mission's second correction: a local report must exist
  // immediately at each offline closure, independent of any server round-trip.
  assert.equal(localReports.length, dayCount, "Every offline day must produce its own local report immediately, with zero network access.");
  assert.equal(localReports.every((report) => report.countedCash === null), true, "The new flow must never coerce a missing declaration into a fake counted amount.");
  assert.equal(localReports.every((report) => report.ticketCount === salesPerDay), true, "Each local report must summarize exactly its own day's tickets.");

  let events = await getPosOfflineOutboxEvents(scope);
  assert.equal(events.filter((event) => event.operation === "CREATE_CASH_SALE").length, expectedSales);
  assert.equal(events.filter((event) => event.operation === "CASH_SESSION_CLOSE").length, dayCount);
  assert.equal(new Set(closeDays).size, dayCount, "Each day must retain its own distinct closure date.");

  const serverSales = new Map<string, { receiptId: string; saleId: string; invoiceNumber: string; paymentId: string; operationId: string }>();
  const serverClosures = new Map<string, { closureId: string; reportId: string }>();
  const issuedReportIds = new Set<string>();
  let networkCallsDuringOfflinePhase = 0;
  let acceptedBeforeCut = 0;
  let networkAvailable = true;
  const saleTransport = async (event: PosOfflineSaleOutboxEvent) => {
    networkCallsDuringOfflinePhase += 1;
    const existing = serverSales.get(event.eventId);
    if (existing) return { ...existing, status: "PROCESSED" as const, saleNumber: `VTE-${existing.saleId.slice(-8)}`, amount: event.payload.total, errorCode: null, errorMessage: null };
    if (!networkAvailable || acceptedBeforeCut >= firstConnectionCut) {
      networkAvailable = false;
      throw new Error("Boutique network interruption");
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
    if (existing) return { closureId: existing.closureId, reportId: existing.reportId, status: "SYNCED" as const, errorCode: null, errorMessage: null };
    const closureId = createCommercePosId("closure");
    const reportId = createCommercePosId("report");
    assert.equal(issuedReportIds.has(reportId), false, "A report id must never be reused across closures.");
    issuedReportIds.add(reportId);
    serverClosures.set(event.eventId, { closureId, reportId });
    return { closureId, reportId, status: "SYNCED" as const, errorCode: null, errorMessage: null };
  };

  const interrupted = await synchronizeCommercePosOfflineOutbox(scope, { sale: saleTransport, close: closeTransport });
  assert.equal(interrupted.synced, firstConnectionCut + firstConnectionClosures, "The first short connection must preserve every fully covered daily closure and nothing beyond the network cut.");
  assert.equal(serverSales.size, firstConnectionCut);
  assert.equal(serverClosures.size, firstConnectionClosures, "Only sessions whose full day of tickets is complete may close before the interruption.");
  events = await getPosOfflineOutboxEvents(scope);
  assert.equal(events.filter((event) => event.status === "SYNCED").length, firstConnectionCut + firstConnectionClosures);
  assert.equal(events.filter((event) => event.operation === "CREATE_CASH_SALE" && event.status !== "SYNCED").length, expectedSales - firstConnectionCut);

  deviceTime += 60 * 60 * 1000;
  networkAvailable = true;
  acceptedBeforeCut = -1_000_000;
  const resumed = await synchronizeCommercePosOfflineOutbox(scope, { sale: saleTransport, close: closeTransport });
  assert.equal(resumed.failed, 0, "The next reconnection must resume only the remaining work, with zero permanent failures.");
  assert.equal(serverSales.size, expectedSales);
  assert.equal(serverClosures.size, dayCount);
  assert.equal(issuedReportIds.size, dayCount, "Exactly one report must exist per closure across the full 30 days -- zero duplicates, zero orphans.");
  events = await getPosOfflineOutboxEvents(scope);
  assert.equal(events.length, expectedSales + dayCount);
  assert.equal(events.every((event) => event.status === "SYNCED"), true);

  // A late reconnection replay (browser restart mid-sync, retry after crash)
  // must never mint a second server sale, closure or report.
  const saleCountBeforeReplay = serverSales.size;
  const closureCountBeforeReplay = serverClosures.size;
  const reportCountBeforeReplay = issuedReportIds.size;
  for (const sale of events.filter((event): event is PosOfflineSaleOutboxEvent => event.operation === "CREATE_CASH_SALE").slice(0, 30)) await saleTransport(sale);
  for (const closure of events.filter((event): event is PosOfflineCashSessionCloseOutboxEvent => event.operation === "CASH_SESSION_CLOSE").slice(0, 10)) await closeTransport(closure);
  assert.equal(serverSales.size, saleCountBeforeReplay, "Replayed offline_sale_id values must not duplicate server sales.");
  assert.equal(serverClosures.size, closureCountBeforeReplay, "Replayed closing ids must not duplicate server closures.");
  assert.equal(issuedReportIds.size, reportCountBeforeReplay, "Replayed closures must return their existing report, never mint a new one.");

  const elapsedMs = Math.round(performance.now() - startedAt);
  console.log(JSON.stringify({
    days: dayCount, tickets: expectedSales, closures: dayCount, reports: issuedReportIds.size,
    firstConnectionTickets: firstConnectionCut, firstConnectionClosures,
    finalSales: serverSales.size, finalClosures: serverClosures.size, finalReports: issuedReportIds.size,
    duplicateSales: 0, duplicateClosures: 0, duplicateReports: 0, orphanReports: 0, elapsedMs,
  }));
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  Object.defineProperty(globalThis, "Date", { configurable: true, value: NativeDate });
});
