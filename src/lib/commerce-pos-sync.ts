import {
  canRetryPosOfflineOutboxEvent,
  getPosOfflineOutboxEvents,
  getPosOfflineOutboxRetryOrder,
  markPosOfflineOutboxFailed,
  markPosOfflineOutboxSynced,
  markPosOfflineOutboxSyncing,
  markPosOfflineCashSessionClosePending,
  markPosOfflineCashSessionCloseSynced,
  recoverPosOfflineSyncingEvents,
  type PosOfflineOutboxEvent,
  type PosOfflineScope,
  type PosOfflineServerReceipt,
  type PosOfflineCashSessionCloseOutboxEvent,
  type PosOfflineCashSessionCloseServerReceipt,
} from "@/lib/commerce-pos-offline";
import { closeCommercePosCashSession, syncCommercePosOfflineSale } from "@/lib/commerce-pos.functions";
import { classifyError, getErrorMessage, isRetryableCategory } from "@/lib/error-classification";

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
export type CommercePosOfflineCashSessionCloseSyncTransport = (event: PosOfflineCashSessionCloseOutboxEvent) => Promise<PosOfflineCashSessionCloseServerReceipt>;

export type CommercePosOfflineOutboxTransports = {
  sale?: CommercePosOfflineSyncTransport;
  close?: CommercePosOfflineCashSessionCloseSyncTransport;
};

function toOfflineSaleRequest(event: Extract<PosOfflineOutboxEvent, { operation: "CREATE_CASH_SALE" }>) {
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
  if (event.operation !== "CREATE_CASH_SALE") throw new Error("Cet événement n'est pas une vente hors connexion.");
  return syncCommercePosOfflineSale({ data: toOfflineSaleRequest(event) });
}

/**
 * Mission caisse: the cashier no longer declares anything at close time, so
 * only identity/timing crosses the wire -- close_commerce_pos_cash_session
 * computes the real totals itself from already-synced server sales. The
 * local payload still carries the declared totals (used for the cashier's
 * immediate local summary/report, per the offline continuity requirement)
 * but they are deliberately never sent here.
 */
function toOfflineCashSessionCloseRequest(event: PosOfflineCashSessionCloseOutboxEvent) {
  return {
    cashSessionId: event.cashSessionId,
    terminalId: event.terminalId,
    businessLocationId: event.locationId,
    cashierUserId: event.userId,
    eventId: event.eventId,
    openedAtDevice: event.payload.openedAtDevice,
    closedAtDevice: event.payload.closedAtDevice,
  };
}

export async function sendCommercePosOfflineCashSessionClose(event: PosOfflineCashSessionCloseOutboxEvent): Promise<PosOfflineCashSessionCloseServerReceipt> {
  const receipt = await closeCommercePosCashSession({ data: toOfflineCashSessionCloseRequest(event) });
  return { closureId: receipt.closureId, reportId: receipt.reportId, status: receipt.status, errorCode: receipt.errorCode ?? null, errorMessage: receipt.errorMessage ?? null };
}

/**
 * P1-1 (audit de stabilisation) : lisait error.code pour décider si une
 * erreur était définitive -- ce champ ne survit jamais au transport
 * serveur -> client (seul .message traverse, voir
 * src/lib/error-classification.ts), donc `permanent` valait toujours
 * `false` en pratique. Une vente hors-ligne réellement rejetée (permission
 * révoquée, règle de stock violée, donnée invalide) était donc indiscernable
 * d'un problème réseau, et réessayée indéfiniment au lieu d'être signalée
 * au caissier.
 *
 * Classification maintenant partagée avec router.tsx : seule "network" est
 * retentable (voir isRetryableCategory) -- les cinq autres catégories,
 * y compris une forme d'erreur non reconnue, sont définitives, puisque
 * rien n'indique alors un problème de connexion.
 */
export function getErrorDetails(error: unknown): { message: string; permanent: boolean } {
  const message = getErrorMessage(error);
  // `permanent` vient toujours du classificateur, jamais d'un cas
  // particulier codé en dur ici -- un objet vide, une chaîne brute ou
  // `null` lancés n'ont pas de message extractible, mais classifyError()
  // les classe déjà correctement en "server" (ni network, ni aucune des
  // catégories connues), donc isRetryableCategory() les marque déjà comme
  // non-retryable. Seul le TEXTE affiché change selon qu'un message reste
  // extractible ; jamais la décision retryable/permanent.
  const permanent = !isRetryableCategory(classifyError(error));
  if (!message) {
    return { message: "Synchronisation indisponible. La vente reste dans la caisse locale.", permanent };
  }
  return { message, permanent };
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
    .filter((event): event is Extract<PosOfflineOutboxEvent, { operation: "CREATE_CASH_SALE" }> => event.operation === "CREATE_CASH_SALE" && canRetryPosOfflineOutboxEvent(event));
  const candidatesById = new Map(candidates.map((event) => [event.eventId, event]));
  const events = getPosOfflineOutboxRetryOrder(candidates)
    .map((eventId) => candidatesById.get(eventId))
    .filter((event): event is Extract<PosOfflineOutboxEvent, { operation: "CREATE_CASH_SALE" }> => Boolean(event));
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

/**
 * Session closures are intentionally processed only after every sale belonging
 * to that session is synced. A pending, failed or conflicting sale keeps the
 * durable close event waiting; it never pretends the day is complete.
 */
export async function synchronizeCommercePosOfflineCashSessionClosures(
  scope: PosOfflineScope,
  transport: CommercePosOfflineCashSessionCloseSyncTransport = sendCommercePosOfflineCashSessionClose,
  onProgress?: (progress: CommercePosSyncProgress) => void,
): Promise<CommercePosSyncResult> {
  const events = await getPosOfflineOutboxEvents(scope);
  const candidates = events
    .filter((event): event is PosOfflineCashSessionCloseOutboxEvent => event.operation === "CASH_SESSION_CLOSE" && canRetryPosOfflineOutboxEvent(event))
    .sort((left, right) => left.createdAtDevice.localeCompare(right.createdAtDevice) || left.eventId.localeCompare(right.eventId));
  const progress: CommercePosSyncProgress = { total: candidates.length, completed: 0, synced: 0, failed: 0, conflicts: 0 };
  onProgress?.(progress);

  for (const candidate of candidates) {
    const unresolvedSales = events.some((event) => event.operation === "CREATE_CASH_SALE" && event.cashSessionId === candidate.cashSessionId && event.status !== "SYNCED");
    if (unresolvedSales) {
      await markPosOfflineCashSessionClosePending(scope, candidate.eventId, "Clôture en attente : une ou plusieurs ventes de cette session ne sont pas encore synchronisées.");
      continue;
    }
    const event = await markPosOfflineOutboxSyncing(scope, candidate.eventId);
    if (!event || event.operation !== "CASH_SESSION_CLOSE") continue;
    try {
      const receipt = await transport(event);
      if (receipt.status === "PENDING_SALES") {
        await markPosOfflineCashSessionClosePending(scope, event.eventId, receipt.errorMessage ?? "Clôture en attente des ventes de cette session.");
      } else {
        await markPosOfflineCashSessionCloseSynced(scope, event.eventId, receipt);
        progress.synced += 1;
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

/**
 * One resumable automatic pass over the durable outbox. Sales are always
 * attempted before closures; a closure still performs its own session-level
 * guard and therefore cannot overtake a failed or conflicting ticket.
 */
export async function synchronizeCommercePosOfflineOutbox(
  scope: PosOfflineScope,
  transports: CommercePosOfflineOutboxTransports = {},
  onProgress?: (progress: CommercePosSyncProgress) => void,
): Promise<CommercePosSyncResult> {
  const initial = await getPosOfflineOutboxEvents(scope);
  const unresolvedTotal = initial.filter((event) => event.status !== "SYNCED").length;
  let salesCompleted = 0;
  let salesTotal = 0;
  let salesResult: CommercePosSyncResult | null = null;
  const report = (progress: CommercePosSyncProgress) => onProgress?.({
    total: unresolvedTotal,
    completed: Math.min(unresolvedTotal, salesCompleted + progress.completed),
    synced: (salesResult?.synced ?? 0) + progress.synced,
    failed: (salesResult?.failed ?? 0) + progress.failed,
    conflicts: (salesResult?.conflicts ?? 0) + progress.conflicts,
  });

  const sales = await synchronizeCommercePosOfflineSales(scope, transports.sale, (progress) => {
    salesTotal = progress.total;
    onProgress?.({ ...progress, total: unresolvedTotal });
  });
  salesResult = sales;
  salesCompleted = sales.completed;
  const closures = await synchronizeCommercePosOfflineCashSessionClosures(scope, transports.close, report);
  const result: CommercePosSyncResult = {
    total: unresolvedTotal,
    completed: Math.min(unresolvedTotal, sales.completed + closures.completed),
    synced: sales.synced + closures.synced,
    failed: sales.failed + closures.failed,
    conflicts: sales.conflicts + closures.conflicts,
    attempted: sales.attempted + closures.attempted,
  };
  // Keep the otherwise useful batch total visible even when no sale was
  // retryable yet because it is in backoff after a short network interruption.
  if (salesTotal === 0 && closures.total === 0) onProgress?.(result);
  return result;
}
