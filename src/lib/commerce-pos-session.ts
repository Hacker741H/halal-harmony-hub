export const COMMERCE_POS_DRAFT_VERSION = 2;

export type CommercePosPaymentMethod = "CASH" | "WAVE" | "JEKO" | "CARD" | "OTHER";
export type CommercePosCheckoutState = "READY" | "PROCESSING" | "RECONCILIATION_REQUIRED";
export type CommercePosLineType = "ARTICLE" | "SERVICE";

interface CommercePosDraftLineBase {
  lineId: string;
  label: string;
  quantity: number;
  unitPrice: number;
}

export interface CommercePosArticleLine extends CommercePosDraftLineBase {
  lineType: "ARTICLE";
  itemId: string;
}

export interface CommercePosServiceLine extends CommercePosDraftLineBase {
  lineType: "SERVICE";
  /** Local-only row identity; never sent as an inventory reference. */
  itemId: string;
  serviceNote: string | null;
}

export type CommercePosDraftLine = CommercePosArticleLine | CommercePosServiceLine;

export interface CommercePosJekoPaymentState {
  status: "PENDING";
  requestReference: string;
}

export interface CommercePosDraft {
  version: typeof COMMERCE_POS_DRAFT_VERSION;
  sessionId: string;
  locationId: string;
  userId: string;
  lines: CommercePosDraftLine[];
  clientId: string | null;
  paymentMethod: CommercePosPaymentMethod;
  cashReceived: number | null;
  checkoutState: CommercePosCheckoutState;
  jekoPayment: CommercePosJekoPaymentState | null;
  updatedAt: string;
}

export interface CommercePosSuspendedTicket {
  id: string;
  suspendedAt: string;
  draft: CommercePosDraft;
}

export interface CommercePosStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CommercePosStockAvailability {
  itemId: string;
  label: string;
  availableQuantity: number;
}

export interface CommercePosStockConflict {
  itemId: string;
  label: string;
  requestedQuantity: number;
  availableQuantity: number;
}

const paymentMethods = new Set<CommercePosPaymentMethod>(["CASH", "WAVE", "JEKO", "CARD", "OTHER"]);
const checkoutStates = new Set<CommercePosCheckoutState>([
  "READY",
  "PROCESSING",
  "RECONCILIATION_REQUIRED",
]);

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function createCommercePosId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

// CHANTIER CAISSE : registerId optionnel, en toute fin de clé. Omis ou null
// = comportement historique exact (magasin non migré vers des postes
// nommés) -- même choix de compatibilité que scopeKey() côté IndexedDB.
export function commercePosDraftStorageKey(
  locationId: string,
  userId: string,
  registerId?: string | null,
): string {
  return registerId
    ? `halal_erp_pos_draft:${locationId}:${userId}:${registerId}`
    : `halal_erp_pos_draft:${locationId}:${userId}`;
}

export function commercePosSuspendedTicketsStorageKey(
  locationId: string,
  userId: string,
  registerId?: string | null,
): string {
  return registerId
    ? `halal_erp_pos_suspended:${locationId}:${userId}:${registerId}`
    : `halal_erp_pos_suspended:${locationId}:${userId}`;
}

export function createCommercePosDraft(locationId: string, userId: string): CommercePosDraft {
  return {
    version: COMMERCE_POS_DRAFT_VERSION,
    sessionId: createCommercePosId("pos"),
    locationId,
    userId,
    lines: [],
    clientId: null,
    paymentMethod: "CASH",
    cashReceived: null,
    checkoutState: "READY",
    jekoPayment: null,
    updatedAt: new Date().toISOString(),
  };
}

export function commercePosDraftHasContent(draft: CommercePosDraft): boolean {
  return (
    draft.lines.length > 0 ||
    draft.clientId !== null ||
    draft.paymentMethod !== "CASH" ||
    draft.cashReceived !== null ||
    draft.checkoutState !== "READY" ||
    draft.jekoPayment !== null
  );
}

export function commercePosDraftTotal(draft: CommercePosDraft): number {
  return draft.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
}

function parseLine(value: unknown): CommercePosDraftLine | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CommercePosDraftLine> & {
    lineType?: unknown;
    itemId?: unknown;
    serviceNote?: unknown;
  };
  const lineType =
    candidate.lineType === "SERVICE"
      ? "SERVICE"
      : candidate.lineType === "ARTICLE" || candidate.lineType === undefined
        ? "ARTICLE"
        : null;
  const lineId =
    typeof candidate.lineId === "string" && candidate.lineId
      ? candidate.lineId
      : lineType === "ARTICLE" && typeof candidate.itemId === "string" && candidate.itemId
        ? `article-${candidate.itemId}`
        : null;

  if (
    !lineType ||
    !lineId ||
    typeof candidate.label !== "string" ||
    !candidate.label.trim() ||
    !isFiniteNonNegative(candidate.quantity) ||
    candidate.quantity <= 0 ||
    !isFiniteNonNegative(candidate.unitPrice)
  )
    return null;

  if (lineType === "ARTICLE") {
    if (typeof candidate.itemId !== "string" || !candidate.itemId) return null;
    return {
      lineId,
      lineType,
      itemId: candidate.itemId,
      label: candidate.label,
      quantity: candidate.quantity,
      unitPrice: candidate.unitPrice,
    };
  }

  if (
    candidate.serviceNote !== null &&
    candidate.serviceNote !== undefined &&
    typeof candidate.serviceNote !== "string"
  )
    return null;
  return {
    lineId,
    lineType,
    itemId: typeof candidate.itemId === "string" && candidate.itemId ? candidate.itemId : lineId,
    label: candidate.label,
    quantity: candidate.quantity,
    unitPrice: candidate.unitPrice,
    serviceNote: candidate.serviceNote ?? null,
  };
}

export function parseCommercePosDraft(
  value: unknown,
  expectedLocationId: string,
  expectedUserId: string,
): CommercePosDraft | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<CommercePosDraft>;
  const rawVersion = (value as { version?: unknown }).version;
  if (
    (rawVersion !== 1 && rawVersion !== COMMERCE_POS_DRAFT_VERSION) ||
    candidate.locationId !== expectedLocationId ||
    candidate.userId !== expectedUserId ||
    typeof candidate.sessionId !== "string" ||
    !candidate.sessionId ||
    !Array.isArray(candidate.lines) ||
    !paymentMethods.has(candidate.paymentMethod as CommercePosPaymentMethod) ||
    !checkoutStates.has(candidate.checkoutState as CommercePosCheckoutState)
  )
    return null;

  const lines = candidate.lines.map(parseLine);
  if (lines.some((line) => line === null)) return null;
  if (candidate.clientId !== null && typeof candidate.clientId !== "string") return null;
  if (
    candidate.cashReceived !== null &&
    candidate.cashReceived !== undefined &&
    !isFiniteNonNegative(candidate.cashReceived)
  )
    return null;

  const jekoPayment = candidate.jekoPayment;
  if (
    jekoPayment !== null &&
    jekoPayment !== undefined &&
    (jekoPayment.status !== "PENDING" ||
      typeof jekoPayment.requestReference !== "string" ||
      !jekoPayment.requestReference)
  )
    return null;

  return {
    version: COMMERCE_POS_DRAFT_VERSION,
    sessionId: candidate.sessionId,
    locationId: expectedLocationId,
    userId: expectedUserId,
    lines: lines as CommercePosDraftLine[],
    clientId: candidate.clientId ?? null,
    paymentMethod: candidate.paymentMethod as CommercePosPaymentMethod,
    cashReceived: candidate.cashReceived ?? null,
    checkoutState: candidate.checkoutState as CommercePosCheckoutState,
    jekoPayment: jekoPayment ?? null,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString(),
  };
}

export function loadCommercePosDraft(
  storage: CommercePosStorage,
  locationId: string,
  userId: string,
  registerId?: string | null,
): CommercePosDraft | null {
  try {
    const stored = storage.getItem(commercePosDraftStorageKey(locationId, userId, registerId));
    return stored ? parseCommercePosDraft(JSON.parse(stored), locationId, userId) : null;
  } catch {
    return null;
  }
}

export function saveCommercePosDraft(
  storage: CommercePosStorage,
  draft: CommercePosDraft,
  registerId?: string | null,
): void {
  const key = commercePosDraftStorageKey(draft.locationId, draft.userId, registerId);
  if (!commercePosDraftHasContent(draft)) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify(draft));
}

export function removeCommercePosDraft(
  storage: CommercePosStorage,
  locationId: string,
  userId: string,
  registerId?: string | null,
): void {
  storage.removeItem(commercePosDraftStorageKey(locationId, userId, registerId));
}

export function loadCommercePosSuspendedTickets(
  storage: CommercePosStorage,
  locationId: string,
  userId: string,
  registerId?: string | null,
): CommercePosSuspendedTicket[] {
  try {
    const stored = storage.getItem(
      commercePosSuspendedTicketsStorageKey(locationId, userId, registerId),
    );
    if (!stored) return [];
    const values: unknown = JSON.parse(stored);
    if (!Array.isArray(values)) return [];
    return values.flatMap((value): CommercePosSuspendedTicket[] => {
      if (!value || typeof value !== "object") return [];
      const candidate = value as Partial<CommercePosSuspendedTicket>;
      if (
        typeof candidate.id !== "string" ||
        !candidate.id ||
        typeof candidate.suspendedAt !== "string"
      )
        return [];
      const draft = parseCommercePosDraft(candidate.draft, locationId, userId);
      return draft && commercePosDraftHasContent(draft) && draft.checkoutState === "READY"
        ? [{ id: candidate.id, suspendedAt: candidate.suspendedAt, draft }]
        : [];
    });
  } catch {
    return [];
  }
}

export function saveCommercePosSuspendedTickets(
  storage: CommercePosStorage,
  locationId: string,
  userId: string,
  tickets: readonly CommercePosSuspendedTicket[],
  registerId?: string | null,
): void {
  const key = commercePosSuspendedTicketsStorageKey(locationId, userId, registerId);
  if (!tickets.length) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify(tickets));
}

export function findCommercePosDraftLocation(
  storage: CommercePosStorage,
  locationIds: readonly string[],
  userId: string,
): string | null {
  for (const locationId of locationIds) {
    const draft = loadCommercePosDraft(storage, locationId, userId);
    if (draft && commercePosDraftHasContent(draft)) return locationId;
    if (loadCommercePosSuspendedTickets(storage, locationId, userId).length) return locationId;
  }
  return null;
}

export function getCommercePosStockConflicts(
  lines: readonly CommercePosDraftLine[],
  availability: readonly CommercePosStockAvailability[],
): CommercePosStockConflict[] {
  const availableByItem = new Map(availability.map((item) => [item.itemId, item]));
  const requestedByItem = new Map<string, { label: string; quantity: number }>();

  for (const line of lines) {
    if (line.lineType !== "ARTICLE") continue;
    const current = requestedByItem.get(line.itemId);
    requestedByItem.set(line.itemId, {
      label: line.label,
      quantity: (current?.quantity ?? 0) + line.quantity,
    });
  }

  return [...requestedByItem.entries()].flatMap(([itemId, requested]) => {
    const item = availableByItem.get(itemId);
    const availableQuantity = item?.availableQuantity ?? 0;
    if (requested.quantity <= availableQuantity) return [];
    return [
      {
        itemId,
        label: item?.label ?? requested.label,
        requestedQuantity: requested.quantity,
        availableQuantity,
      },
    ];
  });
}
