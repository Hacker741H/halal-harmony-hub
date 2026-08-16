import {
  createCommercePosDraft,
  createCommercePosId,
  type CommercePosDraft,
  type CommercePosDraftLine,
  type CommercePosSuspendedTicket,
} from "@/lib/commerce-pos-session";

/**
 * The POS is deliberately isolated from the generic application cache.  These
 * records are a local work queue only; Supabase remains the financial source of
 * truth and POS-04B will be the only layer allowed to drain the outbox.
 */
export const POS_OFFLINE_DATABASE_NAME = "halal-erp-pos-offline";
export const POS_OFFLINE_DATABASE_VERSION = 1;

export const POS_OFFLINE_STORES = {
  terminal: "pos_terminal",
  catalog: "pos_catalog",
  stockSnapshot: "pos_stock_snapshot",
  sessions: "pos_sessions",
  tickets: "pos_tickets",
  ticketLines: "pos_ticket_lines",
  suspendedTickets: "pos_suspended_tickets",
  outbox: "pos_outbox",
  syncState: "pos_sync_state",
} as const;

export type PosOfflineScope = {
  locationId: string;
  userId: string;
};

export type PosOfflineLocation = {
  id: string;
  name: string;
  code: string;
};

export type PosOfflineCatalogueInput = {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  category: string | null;
  quantity: number;
  salePrice: number | null;
};

export type PosOfflineCatalogueItem = PosOfflineCatalogueInput & {
  scopeKey: string;
  syncedAtDevice: string;
};

export type PosOfflineSessionStatus = "OPEN" | "CLOSED_LOCAL" | "SYNC_PENDING" | "SYNCED";
export type PosOfflineOutboxStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT";
export type PosOfflineTicketStatus = "ACTIVE" | "SUSPENDED" | "PAID_LOCAL";

export type PosOfflineTerminal = {
  id: "current";
  terminalId: string;
  createdAtDevice: string;
  updatedAtDevice: string;
  locationsByUser: Record<string, PosOfflineLocation[]>;
};

export type PosOfflineCashSession = {
  id: string;
  scopeKey: string;
  terminalId: string;
  locationId: string;
  cashierUserId: string;
  status: PosOfflineSessionStatus;
  openedAtDevice: string;
  closedAtDevice: string | null;
  closingEventId: string | null;
  closeSummary: PosOfflineCashSessionClosePayload | null;
  lastSyncError: string | null;
};

export type PosOfflineCashSessionSummary = {
  ticketCount: number;
  articleTotal: number;
  articleQuantityTotal: number;
  serviceTotal: number;
  cashTotal: number;
  /** Always 0 for the local contribution: the offline POS only ever accepts
   * cash (see recordPosOfflineCashSale) -- never fabricated for a payment
   * method this device cannot actually take. */
  mobileMoneyTotal: number;
  otherPaymentTotal: number;
  theoreticalCash: number;
  cancelledTicketCount: number;
};

/** Structural shape of the server-side preview (get_commerce_pos_cash_session_preview).
 * Declared locally rather than imported from commerce-pos.functions.ts to keep this
 * module's layering (pure client storage, no server dependency) intact. */
export type CommercePosCashSessionServerTotals = {
  ticketCount: number;
  articleTotal: number;
  articleQuantityTotal: number;
  serviceTotal: number;
  cashTotal: number;
  mobileMoneyTotal: number;
  otherPaymentTotal: number;
  theoreticalCash: number;
};

/**
 * The pre-closure summary is server totals (every sale already confirmed
 * server-side, online or offline-then-synced) plus the local-only
 * contribution (offline sales not yet known to be synced -- see
 * getPosOfflineCashSessionSummary, which already excludes anything synced).
 * The two are disjoint by construction: a ticket's outbox event is either
 * SYNCED (counted server-side only) or not (counted locally only), never
 * both -- so straight addition never double-counts. No network yet (server
 * is null) falls back to the local contribution alone, which is already the
 * whole truth when nothing has synced.
 */
export function mergeCommercePosCashSessionSummaries(
  local: PosOfflineCashSessionSummary | null,
  server: CommercePosCashSessionServerTotals | null,
): PosOfflineCashSessionSummary | null {
  if (!local && !server) return null;
  if (!server) return local;
  return {
    ticketCount: server.ticketCount + (local?.ticketCount ?? 0),
    articleTotal: server.articleTotal + (local?.articleTotal ?? 0),
    articleQuantityTotal: server.articleQuantityTotal + (local?.articleQuantityTotal ?? 0),
    serviceTotal: server.serviceTotal + (local?.serviceTotal ?? 0),
    cashTotal: server.cashTotal + (local?.cashTotal ?? 0),
    mobileMoneyTotal: server.mobileMoneyTotal + (local?.mobileMoneyTotal ?? 0),
    otherPaymentTotal: server.otherPaymentTotal + (local?.otherPaymentTotal ?? 0),
    theoreticalCash: server.theoreticalCash + (local?.theoreticalCash ?? 0),
    cancelledTicketCount: local?.cancelledTicketCount ?? 0,
  };
}

/** Structural shape of one row in get_commerce_pos_cash_session_preview's
 * `sales` array. Declared locally for the same layering reason as
 * CommercePosCashSessionServerTotals above. */
export type CommercePosSessionServerSale = {
  id: string;
  saleNumber: string;
  createdAt: string;
  total: number;
  articleCount: number;
  serviceCount: number;
  paymentMethod: string | null;
};

export type CommercePosSessionSaleRow = {
  id: string;
  createdAt: string;
  total: number;
  articleCount: number;
  serviceCount: number;
  paymentMethod: string | null;
  label: string;
  syncStatus: PosOfflineOutboxStatus;
};

/**
 * Mission maitre, Blocker A: "Mes ventes" used to read only the local
 * outbox, so an online-direct sale (create_commerce_cash_sale, which never
 * writes an outbox event) never appeared even though it was fully
 * confirmed server-side. Same merge principle as
 * mergeCommercePosCashSessionSummaries: server sales are the source of
 * truth for anything already confirmed (online or offline-then-synced);
 * the local complement is exactly the outbox events not yet SYNCED, keyed
 * by their own eventId, never by amount/time. A ticket never appears in
 * both lists at once, so straight concatenation never double-counts, and a
 * ticket crossing from local to server on sync changes which list it comes
 * from without changing the total count on screen.
 */
export function mergeCommercePosSessionSaleRows(
  localEvents: readonly PosOfflineOutboxEvent[],
  serverSales: readonly CommercePosSessionServerSale[] | null,
): CommercePosSessionSaleRow[] {
  const fromServer: CommercePosSessionSaleRow[] = (serverSales ?? []).map((sale) => ({
    id: sale.id,
    createdAt: sale.createdAt,
    total: sale.total,
    articleCount: sale.articleCount,
    serviceCount: sale.serviceCount,
    paymentMethod: sale.paymentMethod,
    label: sale.saleNumber,
    syncStatus: "SYNCED",
  }));
  const fromLocal: CommercePosSessionSaleRow[] = localEvents
    .filter((event): event is PosOfflineSaleOutboxEvent => event.operation === "CREATE_CASH_SALE" && event.status !== "SYNCED")
    .map((event) => ({
      id: event.eventId,
      createdAt: event.createdAtDevice,
      total: event.payload.total,
      articleCount: event.payload.lines.filter((line) => line.lineType === "ARTICLE").length,
      serviceCount: event.payload.lines.filter((line) => line.lineType === "SERVICE").length,
      paymentMethod: event.payload.paymentMethod,
      label: event.serverInvoiceNumber ?? `Ticket ${event.eventId.slice(-8).toUpperCase()}`,
      syncStatus: event.status,
    }));
  return [...fromServer, ...fromLocal].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type PosOfflineCashSessionClosePayload = PosOfflineCashSessionSummary & {
  openedAtDevice: string;
  closedAtDevice: string;
  /** NULL = not counted by the cashier (mission caisse: this is now normal
   * and permanent, not a missing-data bug). Never coerced to 0. */
  countedCash: number | null;
  difference: number | null;
  note: string | null;
};

type PosOfflineOutboxBase = {
  eventId: string;
  deviceId: string;
  terminalId: string;
  locationId: string;
  userId: string;
  cashSessionId: string;
  entityId: string;
  createdAtDevice: string;
  status: PosOfflineOutboxStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  syncedAt: string | null;
};

export type PosOfflineSaleOutboxEvent = PosOfflineOutboxBase & {
  entityType: "SALE";
  operation: "CREATE_CASH_SALE";
  payload: {
    ticketId: string;
    clientId: string | null;
    paymentMethod: "CASH";
    /** Snapshot of the ticket total at the moment cash was accepted. */
    total: number;
    cashReceived: number | null;
    changeDue: number;
    lines: CommercePosDraftLine[];
  };
  serverReceiptId?: string;
  serverSaleId?: string;
  serverInvoiceNumber?: string;
  serverPaymentId?: string;
  serverOperationId?: string;
  serverAmount?: number;
  stockReconciledAt?: string;
};

export type PosOfflineCashSessionCloseOutboxEvent = PosOfflineOutboxBase & {
  entityType: "CASH_SESSION";
  operation: "CASH_SESSION_CLOSE";
  payload: PosOfflineCashSessionClosePayload;
  serverClosureId?: string;
  serverStatus?: "SYNCED" | "REVIEW_REQUIRED";
};

export type PosOfflineOutboxEvent = PosOfflineSaleOutboxEvent | PosOfflineCashSessionCloseOutboxEvent;

type PosOfflineTicketRecord = {
  id: string;
  scopeKey: string;
  terminalId: string;
  cashSessionId: string;
  status: PosOfflineTicketStatus;
  suspendedTicketId: string | null;
  suspendedAt: string | null;
  clientId: string | null;
  paymentMethod: CommercePosDraft["paymentMethod"];
  cashReceived: number | null;
  checkoutState: CommercePosDraft["checkoutState"];
  jekoPayment: CommercePosDraft["jekoPayment"];
  offlineSaleEventId: string;
  paidAtDevice: string | null;
  updatedAt: string;
  createdAtDevice: string;
};

type PosOfflineTicketLineRecord = {
  id: string;
  ticketId: string;
  line: CommercePosDraftLine;
};

type PosOfflineSuspendedTicketRecord = {
  id: string;
  scopeKey: string;
  ticketId: string;
  suspendedAt: string;
};

type PosOfflineStockRecord = {
  id: string;
  scopeKey: string;
  itemId: string;
  /** Last quantity received from the server before local, unsynced sales. */
  serverQuantity: number;
  availableQuantity: number;
  syncedAtDevice: string;
  updatedAtDevice: string;
};

type PosOfflineSyncStateRecord = {
  scopeKey: string;
  networkHint: "ONLINE" | "OFFLINE" | "UNKNOWN";
  updatedAtDevice: string;
};

export type PosOfflineDatabaseState = {
  terminal: PosOfflineTerminal;
  activeDraft: CommercePosDraft | null;
  suspendedTickets: CommercePosSuspendedTicket[];
  catalogue: PosOfflineCatalogueItem[];
  pendingOutboxCount: number;
  outboxEvents: PosOfflineOutboxEvent[];
  cashSession: PosOfflineCashSession | null;
  cashSessionSummary: PosOfflineCashSessionSummary | null;
};

function isPosOfflineSaleEvent(event: PosOfflineOutboxEvent): event is PosOfflineSaleOutboxEvent {
  return event.operation === "CREATE_CASH_SALE";
}

function scopeKey({ locationId, userId }: PosOfflineScope): string {
  return `${locationId}:${userId}`;
}

function catalogueKey(scope: PosOfflineScope, itemId: string): string {
  return `${scopeKey(scope)}:${itemId}`;
}

function lineKey(ticketId: string, lineId: string): string {
  return `${ticketId}:${lineId}`;
}

function now(): string {
  return new Date().toISOString();
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Le stockage local de caisse est indisponible."));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onabort = () => reject(transaction.error ?? new Error("La mise à jour locale de caisse a été annulée."));
    transaction.onerror = () => reject(transaction.error ?? new Error("La mise à jour locale de caisse a échoué."));
    transaction.oncomplete = () => resolve();
  });
}

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string | string[]): void {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false });
}

function openPosOfflineDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB n’est pas disponible sur ce navigateur."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(POS_OFFLINE_DATABASE_NAME, POS_OFFLINE_DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Impossible d’ouvrir la caisse hors connexion."));
    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(POS_OFFLINE_STORES.terminal)) {
        database.createObjectStore(POS_OFFLINE_STORES.terminal, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(POS_OFFLINE_STORES.catalog)) {
        const store = database.createObjectStore(POS_OFFLINE_STORES.catalog, { keyPath: "id" });
        ensureIndex(store, "scopeKey", "scopeKey");
      }
      if (!database.objectStoreNames.contains(POS_OFFLINE_STORES.stockSnapshot)) {
        const store = database.createObjectStore(POS_OFFLINE_STORES.stockSnapshot, { keyPath: "id" });
        ensureIndex(store, "scopeKey", "scopeKey");
        ensureIndex(store, "scopeItem", ["scopeKey", "itemId"]);
      }
      if (!database.objectStoreNames.contains(POS_OFFLINE_STORES.sessions)) {
        const store = database.createObjectStore(POS_OFFLINE_STORES.sessions, { keyPath: "id" });
        ensureIndex(store, "scopeKey", "scopeKey");
        ensureIndex(store, "scopeStatus", ["scopeKey", "status"]);
      }
      if (!database.objectStoreNames.contains(POS_OFFLINE_STORES.tickets)) {
        const store = database.createObjectStore(POS_OFFLINE_STORES.tickets, { keyPath: "id" });
        ensureIndex(store, "scopeKey", "scopeKey");
        ensureIndex(store, "scopeStatus", ["scopeKey", "status"]);
      }
      if (!database.objectStoreNames.contains(POS_OFFLINE_STORES.ticketLines)) {
        const store = database.createObjectStore(POS_OFFLINE_STORES.ticketLines, { keyPath: "id" });
        ensureIndex(store, "ticketId", "ticketId");
      }
      if (!database.objectStoreNames.contains(POS_OFFLINE_STORES.suspendedTickets)) {
        const store = database.createObjectStore(POS_OFFLINE_STORES.suspendedTickets, { keyPath: "id" });
        ensureIndex(store, "scopeKey", "scopeKey");
        ensureIndex(store, "ticketId", "ticketId");
      }
      if (!database.objectStoreNames.contains(POS_OFFLINE_STORES.outbox)) {
        const store = database.createObjectStore(POS_OFFLINE_STORES.outbox, { keyPath: "eventId" });
        ensureIndex(store, "scopeKey", ["locationId", "userId"]);
        ensureIndex(store, "status", "status");
        ensureIndex(store, "createdAtDevice", "createdAtDevice");
      }
      if (!database.objectStoreNames.contains(POS_OFFLINE_STORES.syncState)) {
        database.createObjectStore(POS_OFFLINE_STORES.syncState, { keyPath: "scopeKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function inTransaction<T>(stores: readonly string[], mode: IDBTransactionMode, run: (storesByName: Record<string, IDBObjectStore>) => Promise<T>): Promise<T> {
  const database = await openPosOfflineDatabase();
  try {
    const transaction = database.transaction(stores, mode);
    const completion = transactionDone(transaction);
    const storesByName = Object.fromEntries(stores.map((name) => [name, transaction.objectStore(name)]));
    const result = await run(storesByName);
    await completion;
    return result;
  } finally {
    database.close();
  }
}

async function getAllByIndex<T>(store: IDBObjectStore, indexName: string, value: IDBValidKey): Promise<T[]> {
  const records = await requestResult<unknown[]>(store.index(indexName).getAll(IDBKeyRange.only(value)));
  return records as T[];
}

async function deleteTicketLines(lines: IDBObjectStore, ticketId: string): Promise<void> {
  const existing = await getAllByIndex<PosOfflineTicketLineRecord>(lines, "ticketId", ticketId);
  await Promise.all(existing.map((line) => requestResult(lines.delete(line.id))));
}

async function ticketToDraft(tickets: IDBObjectStore, lines: IDBObjectStore, ticketId: string): Promise<CommercePosDraft | null> {
  const ticket = await requestResult<PosOfflineTicketRecord | undefined>(tickets.get(ticketId));
  if (!ticket) return null;
  const lineRecords = await getAllByIndex<PosOfflineTicketLineRecord>(lines, "ticketId", ticketId);
  return {
    version: 2,
    sessionId: ticket.id,
    locationId: ticket.scopeKey.slice(0, ticket.scopeKey.lastIndexOf(":")),
    userId: ticket.scopeKey.slice(ticket.scopeKey.lastIndexOf(":") + 1),
    lines: lineRecords.map((record) => record.line),
    clientId: ticket.clientId,
    paymentMethod: ticket.paymentMethod,
    cashReceived: ticket.cashReceived,
    checkoutState: ticket.checkoutState,
    jekoPayment: ticket.jekoPayment,
    updatedAt: ticket.updatedAt,
  };
}

async function getOrCreateTerminalInTransaction(store: IDBObjectStore): Promise<PosOfflineTerminal> {
  const existing = await requestResult<PosOfflineTerminal | undefined>(store.get("current"));
  if (existing) return existing;
  const timestamp = now();
  const terminal: PosOfflineTerminal = {
    id: "current",
    terminalId: createCommercePosId("terminal"),
    createdAtDevice: timestamp,
    updatedAtDevice: timestamp,
    locationsByUser: {},
  };
  await requestResult(store.put(terminal));
  return terminal;
}

async function getOrCreateOpenSession(
  sessions: IDBObjectStore,
  scope: PosOfflineScope,
  terminalId: string,
  allowCreateAfterClosed = false,
): Promise<PosOfflineCashSession> {
  const scopedSessions = await getAllByIndex<PosOfflineCashSession>(sessions, "scopeKey", scopeKey(scope));
  const openSession = scopedSessions.find((session) => session.status === "OPEN");
  if (openSession) {
    const normalized = normalizePosOfflineCashSession(openSession, scope);
    if (normalized !== openSession) await requestResult(sessions.put(normalized));
    return normalized;
  }

  if (scopedSessions.length && !allowCreateAfterClosed) {
    throw new Error("Cette session de caisse est clôturée. Ouvrez une nouvelle session pour enregistrer une vente.");
  }

  const session: PosOfflineCashSession = {
    id: createCommercePosId("cash-session"),
    scopeKey: scopeKey(scope),
    terminalId,
    locationId: scope.locationId,
    cashierUserId: scope.userId,
    status: "OPEN",
    openedAtDevice: now(),
    closedAtDevice: null,
    closingEventId: null,
    closeSummary: null,
    lastSyncError: null,
  };
  await requestResult(sessions.put(session));
  return session;
}

async function saveTicketDraft(
  stores: Record<string, IDBObjectStore>,
  scope: PosOfflineScope,
  draft: CommercePosDraft,
  status: PosOfflineTicketStatus,
  suspendedTicketId: string | null = null,
  suspendedAt: string | null = null,
  allowCreateAfterClosed = false,
): Promise<PosOfflineTicketRecord> {
  const terminal = await getOrCreateTerminalInTransaction(stores[POS_OFFLINE_STORES.terminal]);
  const tickets = stores[POS_OFFLINE_STORES.tickets];
  const existing = await requestResult<PosOfflineTicketRecord | undefined>(tickets.get(draft.sessionId));
  const session = existing
    ? await requestResult<PosOfflineCashSession | undefined>(stores[POS_OFFLINE_STORES.sessions].get(existing.cashSessionId))
    : await getOrCreateOpenSession(stores[POS_OFFLINE_STORES.sessions], scope, terminal.terminalId, allowCreateAfterClosed);
  if (!session || session.scopeKey !== scopeKey(scope) || session.status !== "OPEN") {
    throw new Error("Cette session de caisse est clôturée. Ouvrez une nouvelle session pour enregistrer une vente.");
  }
  const timestamp = now();
  const ticket: PosOfflineTicketRecord = {
    id: draft.sessionId,
    scopeKey: scopeKey(scope),
    terminalId: existing?.terminalId ?? terminal.terminalId,
    cashSessionId: session.id,
    status,
    suspendedTicketId,
    suspendedAt,
    clientId: draft.clientId,
    paymentMethod: draft.paymentMethod,
    cashReceived: draft.cashReceived,
    checkoutState: draft.checkoutState,
    jekoPayment: draft.jekoPayment,
    offlineSaleEventId: existing?.offlineSaleEventId ?? createCommercePosId("pos-event"),
    paidAtDevice: existing?.paidAtDevice ?? null,
    updatedAt: draft.updatedAt,
    createdAtDevice: existing?.createdAtDevice ?? timestamp,
  };
  await requestResult(tickets.put(ticket));
  await deleteTicketLines(stores[POS_OFFLINE_STORES.ticketLines], ticket.id);
  await Promise.all(draft.lines.map((line) => requestResult(stores[POS_OFFLINE_STORES.ticketLines].put({ id: lineKey(ticket.id, line.lineId), ticketId: ticket.id, line } satisfies PosOfflineTicketLineRecord))));
  return ticket;
}

export function posOfflineStorageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

export async function getPosOfflineTerminal(): Promise<PosOfflineTerminal> {
  return inTransaction([POS_OFFLINE_STORES.terminal], "readwrite", async (stores) => getOrCreateTerminalInTransaction(stores[POS_OFFLINE_STORES.terminal]));
}

export async function cachePosOfflineLocations(userId: string, locations: readonly PosOfflineLocation[]): Promise<void> {
  if (!userId) return;
  await inTransaction([POS_OFFLINE_STORES.terminal], "readwrite", async (stores) => {
    const terminal = await getOrCreateTerminalInTransaction(stores[POS_OFFLINE_STORES.terminal]);
    terminal.locationsByUser[userId] = locations.map((location) => ({ ...location }));
    terminal.updatedAtDevice = now();
    await requestResult(stores[POS_OFFLINE_STORES.terminal].put(terminal));
  });
}

export async function getCachedPosOfflineLocations(userId: string): Promise<PosOfflineLocation[]> {
  if (!userId) return [];
  return inTransaction([POS_OFFLINE_STORES.terminal], "readonly", async (stores) => {
    const terminal = await requestResult<PosOfflineTerminal | undefined>(stores[POS_OFFLINE_STORES.terminal].get("current"));
    return terminal?.locationsByUser[userId]?.map((location) => ({ ...location })) ?? [];
  });
}

export async function cachePosOfflineCatalogue(scope: PosOfflineScope, items: readonly PosOfflineCatalogueInput[]): Promise<PosOfflineCatalogueItem[]> {
  const timestamp = now();
  return inTransaction([POS_OFFLINE_STORES.catalog, POS_OFFLINE_STORES.stockSnapshot], "readwrite", async (stores) => {
    const catalogue = stores[POS_OFFLINE_STORES.catalog];
    const stock = stores[POS_OFFLINE_STORES.stockSnapshot];
    const currentScopeKey = scopeKey(scope);
    const normalized = items
      .filter((item) => item.id && item.name.trim() && isFiniteNonNegative(item.quantity))
      .map((item) => ({
        id: catalogueKey(scope, item.id),
        scopeKey: currentScopeKey,
        itemId: item.id,
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        category: item.category,
        salePrice: item.salePrice,
        syncedAtDevice: timestamp,
      }));

    const existing = await getAllByIndex<{ id: string }>(catalogue, "scopeKey", currentScopeKey);
    const receivedIds = new Set(normalized.map((item) => item.id));
    await Promise.all(existing.filter((item) => !receivedIds.has(item.id)).map((item) => requestResult(catalogue.delete(item.id))));
    await Promise.all(normalized.map((item) => requestResult(catalogue.put(item))));

    // A background catalogue refresh must not restore quantities already sold
    // locally and still waiting in the outbox. Keep the local delta until the
    // future POS-04B server acknowledgement establishes a new baseline.
    const validSources = new Map(
      items
        .filter(
          (item) =>
            item.id.trim().length > 0 &&
            item.name.trim().length > 0 &&
            isFiniteNonNegative(item.quantity),
        )
        .map((item) => [item.id, item]),
    );

    for (const item of normalized) {
      const source = validSources.get(item.itemId);
      if (!source) {
        continue;
      }

      const recordId = catalogueKey(scope, item.itemId);
      const current = await requestResult<PosOfflineStockRecord | undefined>(stock.get(recordId));
      const previousServerQuantity = current?.serverQuantity ?? current?.availableQuantity ?? source.quantity;
      const pendingLocalDeduction = Math.max(previousServerQuantity - (current?.availableQuantity ?? source.quantity), 0);
      await requestResult(stock.put({
        id: recordId,
        scopeKey: currentScopeKey,
        itemId: item.itemId,
        serverQuantity: source.quantity,
        availableQuantity: Math.max(source.quantity - pendingLocalDeduction, 0),
        syncedAtDevice: timestamp,
        updatedAtDevice: timestamp,
      } satisfies PosOfflineStockRecord));
    }
    const sourceById = new Map(items.map((item) => [item.id, item]));
    return normalized.flatMap((item): PosOfflineCatalogueItem[] => {
      const source = sourceById.get(item.itemId);
      if (!source) return [];
      return [{
        id: item.itemId,
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        category: item.category,
        quantity: source.quantity,
        salePrice: item.salePrice,
        scopeKey: item.scopeKey,
        syncedAtDevice: item.syncedAtDevice,
      }];
    });
  });
}

export async function getPosOfflineCatalogue(scope: PosOfflineScope): Promise<PosOfflineCatalogueItem[]> {
  return inTransaction([POS_OFFLINE_STORES.catalog, POS_OFFLINE_STORES.stockSnapshot], "readonly", async (stores) => {
    const currentScopeKey = scopeKey(scope);
    const catalogue = await getAllByIndex<{
      id: string;
      scopeKey: string;
      itemId: string;
      name: string;
      sku: string | null;
      unit: string | null;
      category: string | null;
      salePrice: number | null;
      syncedAtDevice: string;
    }>(stores[POS_OFFLINE_STORES.catalog], "scopeKey", currentScopeKey);
    const stock = await getAllByIndex<PosOfflineStockRecord>(stores[POS_OFFLINE_STORES.stockSnapshot], "scopeKey", currentScopeKey);
    const stockByItem = new Map(stock.map((item) => [item.itemId, item.availableQuantity]));
    return catalogue.map((item) => ({
      id: item.itemId,
      name: item.name,
      sku: item.sku,
      unit: item.unit,
      category: item.category,
      quantity: stockByItem.get(item.itemId) ?? 0,
      salePrice: item.salePrice,
      scopeKey: item.scopeKey,
      syncedAtDevice: item.syncedAtDevice,
    })).sort((left, right) => left.name.localeCompare(right.name, "fr"));
  });
}

function normalizePosOfflineCashSession(session: PosOfflineCashSession, scope: PosOfflineScope): PosOfflineCashSession {
  return {
    ...session,
    locationId: session.locationId ?? scope.locationId,
    cashierUserId: session.cashierUserId ?? scope.userId,
    closingEventId: session.closingEventId ?? null,
    closeSummary: session.closeSummary ?? null,
    lastSyncError: session.lastSyncError ?? null,
  };
}

/**
 * Local-only contribution to the pre-closure summary: cash sales collected
 * on this device that are NOT yet known to be reflected server-side. A
 * ticket's own offlineSaleEventId is the stable identity key -- the same one
 * the server treats as the sale's idempotency key (see
 * sync_commerce_pos_offline_sale) -- so this never depends on amount/time
 * heuristics. Anything already SYNCED is excluded here on purpose: the
 * server-side preview (get_commerce_pos_cash_session_preview) already counts
 * it, via commercial_sales itself, and summing it again here would double it.
 */
async function getPosOfflineCashSessionSummary(
  tickets: readonly PosOfflineTicketRecord[],
  ticketLines: IDBObjectStore,
  cashSessionId: string,
  syncedSaleEventIds: ReadonlySet<string>,
): Promise<PosOfflineCashSessionSummary> {
  const paidTickets = tickets.filter((ticket) =>
    ticket.cashSessionId === cashSessionId
    && ticket.status === "PAID_LOCAL"
    && !syncedSaleEventIds.has(ticket.offlineSaleEventId));
  let articleTotal = 0;
  let articleQuantityTotal = 0;
  let serviceTotal = 0;
  for (const ticket of paidTickets) {
    const lines = await getAllByIndex<PosOfflineTicketLineRecord>(ticketLines, "ticketId", ticket.id);
    for (const { line } of lines) {
      const amount = line.quantity * line.unitPrice;
      if (line.lineType === "SERVICE") serviceTotal += amount;
      else { articleTotal += amount; articleQuantityTotal += line.quantity; }
    }
  }
  const cashTotal = articleTotal + serviceTotal;
  return {
    ticketCount: paidTickets.length,
    articleTotal,
    articleQuantityTotal,
    serviceTotal,
    cashTotal,
    mobileMoneyTotal: 0,
    otherPaymentTotal: 0,
    theoreticalCash: cashTotal,
    cancelledTicketCount: 0,
  };
}

export async function getPosOfflineState(scope: PosOfflineScope): Promise<PosOfflineDatabaseState> {
  return inTransaction([
    POS_OFFLINE_STORES.terminal,
    POS_OFFLINE_STORES.catalog,
    POS_OFFLINE_STORES.stockSnapshot,
    POS_OFFLINE_STORES.sessions,
    POS_OFFLINE_STORES.tickets,
    POS_OFFLINE_STORES.ticketLines,
    POS_OFFLINE_STORES.suspendedTickets,
    POS_OFFLINE_STORES.outbox,
  ], "readonly", async (stores) => {
    const terminal = await requestResult<PosOfflineTerminal | undefined>(stores[POS_OFFLINE_STORES.terminal].get("current"));
    const actualTerminal = terminal ?? {
      id: "current" as const,
      terminalId: "",
      createdAtDevice: "",
      updatedAtDevice: "",
      locationsByUser: {},
    };
    const currentScopeKey = scopeKey(scope);
    const scopedTickets = await getAllByIndex<PosOfflineTicketRecord>(stores[POS_OFFLINE_STORES.tickets], "scopeKey", currentScopeKey);
    const activeTicket = scopedTickets.find((ticket) => ticket.status === "ACTIVE");
    const activeDraft = activeTicket ? await ticketToDraft(stores[POS_OFFLINE_STORES.tickets], stores[POS_OFFLINE_STORES.ticketLines], activeTicket.id) : null;
    const suspensions = await getAllByIndex<PosOfflineSuspendedTicketRecord>(stores[POS_OFFLINE_STORES.suspendedTickets], "scopeKey", currentScopeKey);
    const suspendedTickets = (await Promise.all(suspensions.map(async (suspension) => {
      const draft = await ticketToDraft(stores[POS_OFFLINE_STORES.tickets], stores[POS_OFFLINE_STORES.ticketLines], suspension.ticketId);
      return draft ? { id: suspension.id, suspendedAt: suspension.suspendedAt, draft } : null;
    }))).filter((ticket): ticket is CommercePosSuspendedTicket => ticket !== null).sort((left, right) => right.suspendedAt.localeCompare(left.suspendedAt));
    const catalogue = await getPosOfflineCatalogueInTransaction(stores, scope);
    const outbox = await requestResult<PosOfflineOutboxEvent[]>(stores[POS_OFFLINE_STORES.outbox].getAll());
    const outboxEvents = outbox
      .filter((event) => event.locationId === scope.locationId && event.userId === scope.userId)
      .sort((left, right) => right.createdAtDevice.localeCompare(left.createdAtDevice) || right.eventId.localeCompare(left.eventId));
    const pendingOutboxCount = outboxEvents.filter((event) => event.status !== "SYNCED").length;
    const sessions = (await getAllByIndex<PosOfflineCashSession>(stores[POS_OFFLINE_STORES.sessions], "scopeKey", currentScopeKey))
      .map((session) => normalizePosOfflineCashSession(session, scope))
      .sort((left, right) => right.openedAtDevice.localeCompare(left.openedAtDevice));
    const cashSession = sessions.find((session) => session.status === "OPEN") ?? sessions[0] ?? null;
    const syncedSaleEventIds = new Set(
      outboxEvents.filter((event) => event.operation === "CREATE_CASH_SALE" && event.status === "SYNCED").map((event) => event.eventId),
    );
    const cashSessionSummary = cashSession?.closeSummary ?? (cashSession
      ? await getPosOfflineCashSessionSummary(scopedTickets, stores[POS_OFFLINE_STORES.ticketLines], cashSession.id, syncedSaleEventIds)
      : null);
    return { terminal: actualTerminal, activeDraft, suspendedTickets, catalogue, pendingOutboxCount, outboxEvents, cashSession, cashSessionSummary };
  });
}

async function getPosOfflineCatalogueInTransaction(stores: Record<string, IDBObjectStore>, scope: PosOfflineScope): Promise<PosOfflineCatalogueItem[]> {
  const currentScopeKey = scopeKey(scope);
  const catalogue = await getAllByIndex<{
    scopeKey: string;
    itemId: string;
    name: string;
    sku: string | null;
    unit: string | null;
    category: string | null;
    salePrice: number | null;
    syncedAtDevice: string;
  }>(stores[POS_OFFLINE_STORES.catalog], "scopeKey", currentScopeKey);
  const stock = await getAllByIndex<PosOfflineStockRecord>(stores[POS_OFFLINE_STORES.stockSnapshot], "scopeKey", currentScopeKey);
  const stockByItem = new Map(stock.map((item) => [item.itemId, item.availableQuantity]));
  return catalogue.map((item) => ({
    id: item.itemId,
    name: item.name,
    sku: item.sku,
    unit: item.unit,
    category: item.category,
    quantity: stockByItem.get(item.itemId) ?? 0,
    salePrice: item.salePrice,
    scopeKey: item.scopeKey,
    syncedAtDevice: item.syncedAtDevice,
  })).sort((left, right) => left.name.localeCompare(right.name, "fr"));
}

export async function savePosOfflineActiveDraft(
  scope: PosOfflineScope,
  draft: CommercePosDraft,
  options?: { allowCreateAfterClosed?: boolean },
): Promise<void> {
  await inTransaction([
    POS_OFFLINE_STORES.terminal,
    POS_OFFLINE_STORES.sessions,
    POS_OFFLINE_STORES.tickets,
    POS_OFFLINE_STORES.ticketLines,
  ], "readwrite", async (stores) => {
    const tickets = stores[POS_OFFLINE_STORES.tickets];
    const activeTickets = await getAllByIndex<PosOfflineTicketRecord>(tickets, "scopeKey", scopeKey(scope));
    const obsoleteTickets = activeTickets.filter((ticket) => ticket.status === "ACTIVE" && ticket.id !== draft.sessionId);
    await Promise.all(obsoleteTickets.map(async (ticket) => {
      await deleteTicketLines(stores[POS_OFFLINE_STORES.ticketLines], ticket.id);
      await requestResult(tickets.delete(ticket.id));
    }));
    await saveTicketDraft(stores, scope, draft, "ACTIVE", null, null, options?.allowCreateAfterClosed);
  });
}

export async function suspendPosOfflineDraft(scope: PosOfflineScope, ticket: CommercePosSuspendedTicket): Promise<void> {
  await inTransaction([
    POS_OFFLINE_STORES.terminal,
    POS_OFFLINE_STORES.sessions,
    POS_OFFLINE_STORES.tickets,
    POS_OFFLINE_STORES.ticketLines,
    POS_OFFLINE_STORES.suspendedTickets,
  ], "readwrite", async (stores) => {
    await saveTicketDraft(stores, scope, ticket.draft, "SUSPENDED", ticket.id, ticket.suspendedAt);
    await requestResult(stores[POS_OFFLINE_STORES.suspendedTickets].put({
      id: ticket.id,
      scopeKey: scopeKey(scope),
      ticketId: ticket.draft.sessionId,
      suspendedAt: ticket.suspendedAt,
    } satisfies PosOfflineSuspendedTicketRecord));
  });
}

export async function resumePosOfflineSuspendedTicket(scope: PosOfflineScope, ticketId: string): Promise<CommercePosDraft | null> {
  return inTransaction([
    POS_OFFLINE_STORES.tickets,
    POS_OFFLINE_STORES.ticketLines,
    POS_OFFLINE_STORES.suspendedTickets,
  ], "readwrite", async (stores) => {
    const suspended = await requestResult<PosOfflineSuspendedTicketRecord | undefined>(stores[POS_OFFLINE_STORES.suspendedTickets].get(ticketId));
    if (!suspended || suspended.scopeKey !== scopeKey(scope)) return null;
    const draft = await ticketToDraft(stores[POS_OFFLINE_STORES.tickets], stores[POS_OFFLINE_STORES.ticketLines], suspended.ticketId);
    if (!draft) return null;
    const ticket = await requestResult<PosOfflineTicketRecord | undefined>(stores[POS_OFFLINE_STORES.tickets].get(suspended.ticketId));
    if (!ticket) return null;
    await requestResult(stores[POS_OFFLINE_STORES.tickets].put({ ...ticket, status: "ACTIVE", suspendedTicketId: null, suspendedAt: null, updatedAt: now() }));
    await requestResult(stores[POS_OFFLINE_STORES.suspendedTickets].delete(ticketId));
    return { ...draft, updatedAt: now() };
  });
}

export async function removePosOfflineSuspendedTicket(scope: PosOfflineScope, ticketId: string): Promise<void> {
  await inTransaction([POS_OFFLINE_STORES.tickets, POS_OFFLINE_STORES.ticketLines, POS_OFFLINE_STORES.suspendedTickets], "readwrite", async (stores) => {
    const suspended = await requestResult<PosOfflineSuspendedTicketRecord | undefined>(stores[POS_OFFLINE_STORES.suspendedTickets].get(ticketId));
    if (!suspended || suspended.scopeKey !== scopeKey(scope)) return;
    await deleteTicketLines(stores[POS_OFFLINE_STORES.ticketLines], suspended.ticketId);
    await requestResult(stores[POS_OFFLINE_STORES.tickets].delete(suspended.ticketId));
    await requestResult(stores[POS_OFFLINE_STORES.suspendedTickets].delete(ticketId));
  });
}

export async function recordPosOfflineCashSale(scope: PosOfflineScope, draft: CommercePosDraft): Promise<{ eventId: string; nextDraft: CommercePosDraft }> {
  if (draft.paymentMethod !== "CASH") throw new Error("Seules les espèces peuvent être enregistrées hors connexion.");
  if (!draft.lines.length) throw new Error("Le ticket hors connexion ne contient aucune ligne.");

  return inTransaction([
    POS_OFFLINE_STORES.terminal,
    POS_OFFLINE_STORES.sessions,
    POS_OFFLINE_STORES.tickets,
    POS_OFFLINE_STORES.ticketLines,
    POS_OFFLINE_STORES.stockSnapshot,
    POS_OFFLINE_STORES.outbox,
    POS_OFFLINE_STORES.syncState,
  ], "readwrite", async (stores) => {
    const ticket = await saveTicketDraft(stores, scope, draft, "PAID_LOCAL");
    const total = draft.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const paidAtDevice = now();
    await requestResult(stores[POS_OFFLINE_STORES.tickets].put({ ...ticket, status: "PAID_LOCAL", paidAtDevice, updatedAt: paidAtDevice }));

    const outbox = stores[POS_OFFLINE_STORES.outbox];
    const existingEvent = await requestResult<PosOfflineOutboxEvent | undefined>(outbox.get(ticket.offlineSaleEventId));
    const isNewEvent = !existingEvent;
    if (isNewEvent) {
      const event: PosOfflineOutboxEvent = {
        eventId: ticket.offlineSaleEventId,
        deviceId: ticket.terminalId,
        terminalId: ticket.terminalId,
        locationId: scope.locationId,
        userId: scope.userId,
        cashSessionId: ticket.cashSessionId,
        entityType: "SALE",
        entityId: ticket.id,
        operation: "CREATE_CASH_SALE",
        payload: {
          ticketId: ticket.id,
          clientId: draft.clientId,
          paymentMethod: "CASH",
          total,
          cashReceived: draft.cashReceived,
          changeDue: Math.max((draft.cashReceived ?? total) - total, 0),
          lines: draft.lines,
        },
        createdAtDevice: paidAtDevice,
        status: "PENDING",
        attemptCount: 0,
        lastAttemptAt: null,
        lastError: null,
        syncedAt: null,
      };
      assertNoPosOfflineSecret(event);
      await requestResult(outbox.put(event));
    }

    // A retry must reuse the same event and never decrement the local stock a
    // second time. POS-04B will apply the same stable event id server-side.
    if (isNewEvent) {
      const stock = stores[POS_OFFLINE_STORES.stockSnapshot];
      for (const line of draft.lines) {
        if (line.lineType !== "ARTICLE") continue;
        const recordId = catalogueKey(scope, line.itemId);
        const current = await requestResult<PosOfflineStockRecord | undefined>(stock.get(recordId));
        const availableQuantity = Math.max((current?.availableQuantity ?? 0) - line.quantity, 0);
        await requestResult(stock.put({
          id: recordId,
          scopeKey: scopeKey(scope),
          itemId: line.itemId,
          serverQuantity: current?.serverQuantity ?? current?.availableQuantity ?? 0,
          availableQuantity,
          syncedAtDevice: current?.syncedAtDevice ?? paidAtDevice,
          updatedAtDevice: paidAtDevice,
        } satisfies PosOfflineStockRecord));
      }
    }
    await requestResult(stores[POS_OFFLINE_STORES.syncState].put({
      scopeKey: scopeKey(scope),
      networkHint: "OFFLINE",
      updatedAtDevice: paidAtDevice,
    } satisfies PosOfflineSyncStateRecord));

    const nextDraft = createCommercePosDraft(scope.locationId, scope.userId);
    await saveTicketDraft(stores, scope, nextDraft, "ACTIVE");
    return { eventId: ticket.offlineSaleEventId, nextDraft };
  });
}

export type ClosePosOfflineCashSessionInput = {
  /** Mission caisse: the cashier no longer counts cash at close time. NULL
   * (or omitted) means "not counted here" -- never coerced to a fake 0. The
   * server computes the real expected amount from actual sales, and the
   * manager records what was physically received later, independently. */
  countedCash?: number | null;
  note?: string | null;
};

export async function closePosOfflineCashSession(
  scope: PosOfflineScope,
  input: ClosePosOfflineCashSessionInput,
): Promise<{ session: PosOfflineCashSession; summary: PosOfflineCashSessionClosePayload; eventId: string }> {
  const hasCountedCash = input.countedCash !== null && input.countedCash !== undefined;
  if (hasCountedCash && (!Number.isFinite(input.countedCash as number) || (input.countedCash as number) < 0)) {
    throw new Error("Le montant d'espèces comptées est invalide.");
  }
  const note = input.note?.trim() || null;
  if (note && note.length > 1000) throw new Error("La note d'écart est trop longue.");

  return inTransaction([
    POS_OFFLINE_STORES.terminal,
    POS_OFFLINE_STORES.sessions,
    POS_OFFLINE_STORES.tickets,
    POS_OFFLINE_STORES.ticketLines,
    POS_OFFLINE_STORES.suspendedTickets,
    POS_OFFLINE_STORES.outbox,
    POS_OFFLINE_STORES.syncState,
  ], "readwrite", async (stores) => {
    const terminal = await getOrCreateTerminalInTransaction(stores[POS_OFFLINE_STORES.terminal]);
    const sessions = (await getAllByIndex<PosOfflineCashSession>(stores[POS_OFFLINE_STORES.sessions], "scopeKey", scopeKey(scope)))
      .map((session) => normalizePosOfflineCashSession(session, scope))
      .sort((left, right) => right.openedAtDevice.localeCompare(left.openedAtDevice));
    const current = sessions.find((session) => session.status === "OPEN");
    if (!current) {
      const closed = sessions[0];
      if (closed?.closeSummary && closed.closingEventId) {
        return { session: closed, summary: closed.closeSummary, eventId: closed.closingEventId };
      }
      throw new Error("Aucune session de caisse ouverte n'est disponible à clôturer.");
    }
    if (current.terminalId !== terminal.terminalId) throw new Error("Cette session n'appartient pas à ce poste de caisse.");

    const tickets = await getAllByIndex<PosOfflineTicketRecord>(stores[POS_OFFLINE_STORES.tickets], "scopeKey", scopeKey(scope));
    const unfinishedTickets = tickets.filter((ticket) => ticket.cashSessionId === current.id && (ticket.status === "ACTIVE" || ticket.status === "SUSPENDED"));
    for (const ticket of unfinishedTickets) {
      const lines = await getAllByIndex<PosOfflineTicketLineRecord>(stores[POS_OFFLINE_STORES.ticketLines], "ticketId", ticket.id);
      if (lines.length) throw new Error("Terminez, suspendez ailleurs ou abandonnez le ticket en cours avant de clôturer la caisse.");
      await deleteTicketLines(stores[POS_OFFLINE_STORES.ticketLines], ticket.id);
      await requestResult(stores[POS_OFFLINE_STORES.tickets].delete(ticket.id));
      if (ticket.suspendedTicketId) await requestResult(stores[POS_OFFLINE_STORES.suspendedTickets].delete(ticket.suspendedTicketId));
    }

    const outboxAtClose = await requestResult<PosOfflineOutboxEvent[]>(stores[POS_OFFLINE_STORES.outbox].getAll());
    const syncedSaleEventIdsAtClose = new Set(
      outboxAtClose.filter((event) => event.operation === "CREATE_CASH_SALE" && event.status === "SYNCED").map((event) => event.eventId),
    );
    const totals = await getPosOfflineCashSessionSummary(tickets, stores[POS_OFFLINE_STORES.ticketLines], current.id, syncedSaleEventIdsAtClose);
    const closedAtDevice = now();
    const summary: PosOfflineCashSessionClosePayload = {
      ...totals,
      openedAtDevice: current.openedAtDevice,
      closedAtDevice,
      countedCash: hasCountedCash ? (input.countedCash as number) : null,
      difference: hasCountedCash ? (input.countedCash as number) - totals.theoreticalCash : null,
      note,
    };
    const eventId = createCommercePosId("cash-close");
    const event: PosOfflineCashSessionCloseOutboxEvent = {
      eventId,
      deviceId: terminal.terminalId,
      terminalId: terminal.terminalId,
      locationId: scope.locationId,
      userId: scope.userId,
      cashSessionId: current.id,
      entityType: "CASH_SESSION",
      entityId: current.id,
      operation: "CASH_SESSION_CLOSE",
      payload: summary,
      createdAtDevice: closedAtDevice,
      status: "PENDING",
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      syncedAt: null,
    };
    assertNoPosOfflineSecret(event);
    await requestResult(stores[POS_OFFLINE_STORES.outbox].put(event));
    const closedSession: PosOfflineCashSession = {
      ...current,
      status: "CLOSED_LOCAL",
      closedAtDevice,
      closingEventId: eventId,
      closeSummary: summary,
      lastSyncError: null,
    };
    await requestResult(stores[POS_OFFLINE_STORES.sessions].put(closedSession));
    await requestResult(stores[POS_OFFLINE_STORES.syncState].put({
      scopeKey: scopeKey(scope),
      networkHint: "OFFLINE",
      updatedAtDevice: closedAtDevice,
    } satisfies PosOfflineSyncStateRecord));
    return { session: closedSession, summary, eventId };
  });
}

export async function updatePosOfflineNetworkHint(scope: PosOfflineScope, networkHint: PosOfflineSyncStateRecord["networkHint"]): Promise<void> {
  await inTransaction([POS_OFFLINE_STORES.syncState], "readwrite", async (stores) => {
    await requestResult(stores[POS_OFFLINE_STORES.syncState].put({ scopeKey: scopeKey(scope), networkHint, updatedAtDevice: now() } satisfies PosOfflineSyncStateRecord));
  });
}

export async function getPendingPosOfflineOutboxCount(scope: PosOfflineScope): Promise<number> {
  return inTransaction([POS_OFFLINE_STORES.outbox], "readonly", async (stores) => {
    const events = await requestResult<PosOfflineOutboxEvent[]>(stores[POS_OFFLINE_STORES.outbox].getAll());
    return events.filter((event) => event.locationId === scope.locationId && event.userId === scope.userId && event.status !== "SYNCED").length;
  });
}

export async function getPosOfflineOutboxEvents(scope: PosOfflineScope): Promise<PosOfflineOutboxEvent[]> {
  return inTransaction([POS_OFFLINE_STORES.outbox], "readonly", async (stores) => {
    const events = await requestResult<PosOfflineOutboxEvent[]>(stores[POS_OFFLINE_STORES.outbox].getAll());
    return events
      .filter((event) => event.locationId === scope.locationId && event.userId === scope.userId)
      .sort((left, right) => left.createdAtDevice.localeCompare(right.createdAtDevice) || left.eventId.localeCompare(right.eventId));
  });
}

export async function recoverPosOfflineSyncingEvents(scope: PosOfflineScope, staleBefore: string): Promise<void> {
  await inTransaction([POS_OFFLINE_STORES.outbox], "readwrite", async (stores) => {
    const outbox = stores[POS_OFFLINE_STORES.outbox];
    const events = await requestResult<PosOfflineOutboxEvent[]>(outbox.getAll());
    await Promise.all(events
      .filter((event) => event.locationId === scope.locationId && event.userId === scope.userId && event.status === "SYNCING" && (!event.lastAttemptAt || event.lastAttemptAt < staleBefore))
      .map((event) => requestResult(outbox.put({
        ...event,
        status: "FAILED" as const,
        lastError: "La synchronisation a été interrompue avant sa confirmation.",
      }))));
  });
}

export async function markPosOfflineOutboxSyncing(scope: PosOfflineScope, eventId: string): Promise<PosOfflineOutboxEvent | null> {
  return inTransaction([POS_OFFLINE_STORES.outbox], "readwrite", async (stores) => {
    const outbox = stores[POS_OFFLINE_STORES.outbox];
    const event = await requestResult<PosOfflineOutboxEvent | undefined>(outbox.get(eventId));
    if (!event || event.locationId !== scope.locationId || event.userId !== scope.userId || (event.status !== "PENDING" && event.status !== "FAILED")) return null;
    const nextEvent: PosOfflineOutboxEvent = {
      ...event,
      status: "SYNCING",
      attemptCount: event.attemptCount + 1,
      lastAttemptAt: now(),
      lastError: null,
    };
    await requestResult(outbox.put(nextEvent));
    return nextEvent;
  });
}

export async function markPosOfflineOutboxFailed(
  scope: PosOfflineScope,
  eventId: string,
  error: string,
  status: Extract<PosOfflineOutboxStatus, "FAILED" | "CONFLICT"> = "FAILED",
): Promise<void> {
  await inTransaction([POS_OFFLINE_STORES.outbox, POS_OFFLINE_STORES.sessions], "readwrite", async (stores) => {
    const outbox = stores[POS_OFFLINE_STORES.outbox];
    const event = await requestResult<PosOfflineOutboxEvent | undefined>(outbox.get(eventId));
    if (!event || event.locationId !== scope.locationId || event.userId !== scope.userId) return;
    const nextError = error.slice(0, 280);
    await requestResult(outbox.put({ ...event, status, lastError: nextError } satisfies PosOfflineOutboxEvent));
    if (event.operation === "CASH_SESSION_CLOSE") {
      const session = await requestResult<PosOfflineCashSession | undefined>(stores[POS_OFFLINE_STORES.sessions].get(event.cashSessionId));
      if (session) await requestResult(stores[POS_OFFLINE_STORES.sessions].put({
        ...normalizePosOfflineCashSession(session, scope),
        status: "SYNC_PENDING",
        lastSyncError: nextError,
      }));
    }
  });
}

export function canRetryPosOfflineOutboxEvent(event: PosOfflineOutboxEvent, currentTime = Date.now()): boolean {
  if (event.status === "PENDING") return true;
  if (event.status !== "FAILED" || event.lastError?.startsWith("PERMANENT:")) return false;
  if (!event.lastAttemptAt) return true;
  const delayMs = Math.min(5 * 60_000, 1_000 * (2 ** Math.min(event.attemptCount, 8)));
  return currentTime - Date.parse(event.lastAttemptAt) >= delayMs;
}

export type PosOfflineServerReceipt = {
  receiptId: string;
  status: "PROCESSED" | "CONFLICT";
  saleId: string | null;
  saleNumber: string | null;
  invoiceNumber: string | null;
  paymentId: string | null;
  operationId: string | null;
  amount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export async function markPosOfflineOutboxSynced(
  scope: PosOfflineScope,
  eventId: string,
  receipt: PosOfflineServerReceipt,
): Promise<void> {
  if (receipt.status !== "PROCESSED" || !receipt.saleId || !receipt.receiptId) {
    throw new Error("Le reçu serveur ne permet pas de confirmer la vente hors connexion.");
  }
  await inTransaction([POS_OFFLINE_STORES.outbox, POS_OFFLINE_STORES.stockSnapshot], "readwrite", async (stores) => {
    const outbox = stores[POS_OFFLINE_STORES.outbox];
    const event = await requestResult<PosOfflineOutboxEvent | undefined>(outbox.get(eventId));
    if (!event || event.locationId !== scope.locationId || event.userId !== scope.userId || event.status === "SYNCED") return;
    if (!isPosOfflineSaleEvent(event)) throw new Error("Cet événement n'est pas une vente hors connexion.");

    const reconciledAt = now();
    if (!event.stockReconciledAt) {
      const stock = stores[POS_OFFLINE_STORES.stockSnapshot];
      for (const line of event.payload.lines) {
        if (line.lineType !== "ARTICLE") continue;
        const recordId = catalogueKey(scope, line.itemId);
        const current = await requestResult<PosOfflineStockRecord | undefined>(stock.get(recordId));
        if (!current) continue;
        await requestResult(stock.put({
          ...current,
          availableQuantity: current.availableQuantity + line.quantity,
          updatedAtDevice: reconciledAt,
        } satisfies PosOfflineStockRecord));
      }
    }

    await requestResult(outbox.put({
      ...event,
      status: "SYNCED",
      syncedAt: reconciledAt,
      lastError: null,
      serverReceiptId: receipt.receiptId,
      serverSaleId: receipt.saleId ?? undefined,
      serverInvoiceNumber: receipt.invoiceNumber ?? undefined,
      serverPaymentId: receipt.paymentId ?? undefined,
      serverOperationId: receipt.operationId ?? undefined,
      serverAmount: receipt.amount ?? undefined,
      stockReconciledAt: event.stockReconciledAt ?? reconciledAt,
    } satisfies PosOfflineOutboxEvent));
  });
}

export type PosOfflineCashSessionCloseServerReceipt = {
  closureId: string | null;
  /** Mission caisse: the automatic report generated 1:1 with the closure. */
  reportId?: string | null;
  status: "SYNCED" | "REVIEW_REQUIRED" | "PENDING_SALES";
  errorCode: string | null;
  errorMessage: string | null;
};

export async function markPosOfflineCashSessionClosePending(scope: PosOfflineScope, eventId: string, reason: string): Promise<void> {
  await inTransaction([POS_OFFLINE_STORES.outbox, POS_OFFLINE_STORES.sessions], "readwrite", async (stores) => {
    const event = await requestResult<PosOfflineOutboxEvent | undefined>(stores[POS_OFFLINE_STORES.outbox].get(eventId));
    if (!event || event.locationId !== scope.locationId || event.userId !== scope.userId || event.operation !== "CASH_SESSION_CLOSE") return;
    await requestResult(stores[POS_OFFLINE_STORES.outbox].put({ ...event, status: "PENDING", lastError: reason.slice(0, 280) }));
    const session = await requestResult<PosOfflineCashSession | undefined>(stores[POS_OFFLINE_STORES.sessions].get(event.cashSessionId));
    if (session) await requestResult(stores[POS_OFFLINE_STORES.sessions].put({ ...normalizePosOfflineCashSession(session, scope), status: "SYNC_PENDING", lastSyncError: reason.slice(0, 280) }));
  });
}

export async function markPosOfflineCashSessionCloseSynced(
  scope: PosOfflineScope,
  eventId: string,
  receipt: PosOfflineCashSessionCloseServerReceipt,
): Promise<void> {
  if (!receipt.closureId || (receipt.status !== "SYNCED" && receipt.status !== "REVIEW_REQUIRED")) {
    throw new Error("Le reçu serveur ne permet pas de confirmer la clôture de caisse.");
  }
  await inTransaction([POS_OFFLINE_STORES.outbox, POS_OFFLINE_STORES.sessions], "readwrite", async (stores) => {
    const event = await requestResult<PosOfflineOutboxEvent | undefined>(stores[POS_OFFLINE_STORES.outbox].get(eventId));
    if (!event || event.locationId !== scope.locationId || event.userId !== scope.userId || event.operation !== "CASH_SESSION_CLOSE") return;
    const syncedAt = now();
    await requestResult(stores[POS_OFFLINE_STORES.outbox].put({
      ...event,
      status: "SYNCED",
      syncedAt,
      lastError: receipt.errorMessage,
      serverClosureId: receipt.closureId,
      serverStatus: receipt.status,
    }));
    const session = await requestResult<PosOfflineCashSession | undefined>(stores[POS_OFFLINE_STORES.sessions].get(event.cashSessionId));
    if (session) await requestResult(stores[POS_OFFLINE_STORES.sessions].put({
      ...normalizePosOfflineCashSession(session, scope),
      status: "SYNCED",
      lastSyncError: receipt.errorMessage,
    }));
  });
}

export async function findPosOfflineDraftLocation(locationIds: readonly string[], userId: string): Promise<string | null> {
  if (!locationIds.length || !userId || !posOfflineStorageAvailable()) return null;
  return inTransaction([POS_OFFLINE_STORES.tickets], "readonly", async (stores) => {
    for (const locationId of locationIds) {
      const tickets = await getAllByIndex<PosOfflineTicketRecord>(stores[POS_OFFLINE_STORES.tickets], "scopeKey", `${locationId}:${userId}`);
      if (tickets.some((ticket) => ticket.status === "ACTIVE" || ticket.status === "SUSPENDED")) return locationId;
    }
    return null;
  });
}

export function assertNoPosOfflineSecret(value: unknown): void {
  const sensitiveKey = /(?:password|secret|api[_-]?key|authorization|access[_-]?token|service[_-]?role)/i;
  const inspect = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      entry.forEach(inspect);
      return;
    }
    if (!entry || typeof entry !== "object") return;
    Object.entries(entry).forEach(([key, nested]) => {
      if (sensitiveKey.test(key)) throw new Error("Une donnée sensible ne peut pas être enregistrée dans la caisse hors connexion.");
      inspect(nested);
    });
  };
  inspect(value);
}

export function getPosOfflineOutboxRetryOrder(events: readonly Pick<PosOfflineOutboxEvent, "createdAtDevice" | "eventId" | "status">[]): string[] {
  return events
    .filter((event) => event.status === "PENDING" || event.status === "FAILED")
    .slice()
    .sort((left, right) => left.createdAtDevice.localeCompare(right.createdAtDevice) || left.eventId.localeCompare(right.eventId))
    .map((event) => event.eventId);
}
