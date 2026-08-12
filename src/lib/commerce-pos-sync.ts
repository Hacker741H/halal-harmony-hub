import {
  canRetryPosOfflineOutboxEvent,
  getPosOfflineOutboxEvents,
  getPosOfflineOutboxRetryOrder,
  markPosOfflineOutboxFailed,
  markPosOfflineOutboxSynced,
  markPosOfflineOutboxSyncing,
  recoverPosOfflineSyncingEvents,
  type PosOfflineOutboxEvent,
  type PosOfflineScope,
  type PosOfflineServerReceipt,
} from "@/lib/commerce-pos-offline";
import { syncCommercePosOfflineSale } from "@/lib/commerce-pos.functions";

export type CommercePosSyncProgress = {
  total: number;
  completed: number;
  synced: number;
  failed: number;
  conflicts: number;
};

export type CommercePosSyncResult = CommercePosSyncProgress & {
  attempted: number;
};

export type CommercePosOfflineSyncTransport = (event: PosOfflineOutboxEvent) => Promise<PosOfflineServerReceipt>;

function toOfflineSaleRequest(event: PosOfflineOutboxEvent) {
  const total = Number.isFinite(event.payload.total)
    ? event.payload.total
    : event.payload.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  return {
    offlineSaleId: event.eventId,
    terminalId: event.terminalId,
    cashSessionId: event.cashSessionId,
    businessLocationId: event.locationId,
    cashierUserId: event.userId,
    createdAtDevice: event.createdAtDevice,
    payload: {
      ticketId: event.payload.ticketId,
      clientId: event.payload.clientId,
      paymentMethod: "CASH" as const,
      total,
      cashReceived: event.payload.cashReceived,
      changeDue: event.payload.changeDue,
      lines: event.payload.lines.map((line) => line.lineType === "ARTICLE"
        ? { lineType: "ARTICLE" as const, inventoryItemId: line.itemId, quantity: line.quantity, unitPrice: line.unitPrice }
        : { lineType: "SERVICE" as const, serviceName: line.label, serviceNote: line.serviceNote, quantity: line.quantity, unitPrice: line.unitPrice }),
    },
  };
}

export async function sendCommercePosOfflineSale(event: PosOfflineOutboxEvent): Promise<PosOfflineServerReceipt> {
  return syncCommercePosOfflineSale({ data: toOfflineSaleRequest(event) });
}

function getErrorDetails(error: unknown): { message: string; permanent: boolean } {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : null;
    const permanent = code === "22023" || code === "42501" || code === "23503";
    return { message: `${code ? `${code}: ` : ""}${error.message}`, permanent };
  }
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    const code = "code" in error && typeof error.code === "string" ? error.code : null;
    const permanent = code === "22023" || code === "42501" || code === "23503";
    return { message: `${code ? `${code}: ` : ""}${error.message}`, permanent };
  }
  return { message: "Synchronisation indisponible. La vente reste dans la caisse locale.", permanent: false };
}

/**
 * Drains a single cashier/location outbox in creation order. The caller owns
 * the browser-level lock; the server remains the definitive idempotency guard.
 */
export async function synchronizeCommercePosOfflineSales(
  scope: PosOfflineScope,
  transport: CommercePosOfflineSyncTransport = sendCommercePosOfflineSale,
  onProgress?: (progress: CommercePosSyncProgress) => void,
): Promise<CommercePosSyncResult> {
  const staleBefore = new Date(Date.now() - 90_000).toISOString();
  await recoverPosOfflineSyncingEvents(scope, staleBefore);

  const candidates = (await getPosOfflineOutboxEvents(scope))
    .filter((event) => canRetryPosOfflineOutboxEvent(event));
  const order = new Set(getPosOfflineOutboxRetryOrder(candidates));
  const events = candidates.filter((event) => order.has(event.eventId));
  const progress: CommercePosSyncProgress = { total: events.length, completed: 0, synced: 0, failed: 0, conflicts: 0 };
  onProgress?.(progress);

  for (const candidate of events) {
    const event = await markPosOfflineOutboxSyncing(scope, candidate.eventId);
    if (!event) continue;
    try {
      const receipt = await transport(event);
      if (receipt.status === "CONFLICT") {
        progress.conflicts += 1;
        await markPosOfflineOutboxFailed(scope, event.eventId, receipt.errorMessage ?? "Conflit de stock à contrôler.", "CONFLICT");
      } else {
        progress.synced += 1;
        await markPosOfflineOutboxSynced(scope, event.eventId, receipt);
      }
    } catch (error) {
      progress.failed += 1;
      const details = getErrorDetails(error);
      await markPosOfflineOutboxFailed(scope, event.eventId, `${details.permanent ? "PERMANENT: " : ""}${details.message}`);
    }
    progress.completed += 1;
    onProgress?.({ ...progress });
  }

  return { ...progress, attempted: progress.completed };
}
