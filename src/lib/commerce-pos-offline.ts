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
  status: PosOfflineSessionStatus;
  openedAtDevice: string;
  closedAtDevice: string | null;
};

export type PosOfflineOutboxEvent = {
  eventId: string;
  deviceId: string;
  terminalId: string;
  locationId: string;
  userId: string;
  cashSessionId: string;
  entityType: "SALE";
  entityId: string;
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
  createdAtDevice: string;
  status: PosOfflineOutboxStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  syncedAt: string | null;
  serverReceiptId?: string;
  serverSaleId?: string;
  serverInvoiceNumber?: string;
  serverPaymentId?: string;
  serverOperationId?: string;
  serverAmount?: number;
  stockReconciledAt?: string;
};

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

type PosOfflineDatabaseState = {
  terminal: PosOfflineTerminal;
  activeDraft: CommercePosDraft | null;
  suspendedTickets: CommercePosSuspendedTicket[];
  catalogue: PosOfflineCatalogueItem[];
  pendingOutboxCount: number;
  outboxEvents: PosOfflineOutboxEvent[];
};

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

async function getOrCreateOpenSession(sessions: IDBObjectStore, scope: PosOfflineScope, terminalId: string): Promise<PosOfflineCashSession> {
  const scopedSessions = await getAllByIndex<PosOfflineCashSession>(sessions, "scopeKey", scopeKey(scope));
  const openSession = scopedSessions.find((session) => session.status === "OPEN");
  if (openSession) return openSession;

  const session: PosOfflineCashSession = {
    id: createCommercePosId("cash-session"),
    scopeKey: scopeKey(scope),
    terminalId,
    status: "OPEN",
    openedAtDevice: now(),
    closedAtDevice: null,
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
): Promise<PosOfflineTicketRecord> {
  const terminal = await getOrCreateTerminalInTransaction(stores[POS_OFFLINE_STORES.terminal]);
  const tickets = stores[POS_OFFLINE_STORES.tickets];
  const existing = await requestResult<PosOfflineTicketRecord | undefined>(tickets.get(draft.sessionId));
  const session = existing
    ? { id: existing.cashSessionId }
    : await getOrCreateOpenSession(stores[POS_OFFLINE_STORES.sessions], scope, terminal.terminalId);
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
      quantity: stockByItem.get(item.itemId) ?? 0,
      salePrice: item.salePrice,
      scopeKey: item.scopeKey,
      syncedAtDevice: item.syncedAtDevice,
    })).sort((left, right) => left.name.localeCompare(right.name, "fr"));
  });
}

export async function getPosOfflineState(scope: PosOfflineScope): Promise<PosOfflineDatabaseState> {
  return inTransaction([
    POS_OFFLINE_STORES.terminal,
    POS_OFFLINE_STORES.catalog,
    POS_OFFLINE_STORES.stockSnapshot,
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
    return { terminal: actualTerminal, activeDraft, suspendedTickets, catalogue, pendingOutboxCount, outboxEvents };
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
    quantity: stockByItem.get(item.itemId) ?? 0,
    salePrice: item.salePrice,
    scopeKey: item.scopeKey,
    syncedAtDevice: item.syncedAtDevice,
  })).sort((left, right) => left.name.localeCompare(right.name, "fr"));
}

export async function savePosOfflineActiveDraft(scope: PosOfflineScope, draft: CommercePosDraft): Promise<void> {
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
    await saveTicketDraft(stores, scope, draft, "ACTIVE");
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
  await inTransaction([POS_OFFLINE_STORES.outbox], "readwrite", async (stores) => {
    const outbox = stores[POS_OFFLINE_STORES.outbox];
    const event = await requestResult<PosOfflineOutboxEvent | undefined>(outbox.get(eventId));
    if (!event || event.locationId !== scope.locationId || event.userId !== scope.userId) return;
    await requestResult(outbox.put({ ...event, status, lastError: error.slice(0, 280) } satisfies PosOfflineOutboxEvent));
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
