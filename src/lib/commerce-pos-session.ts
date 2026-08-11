export const COMMERCE_POS_DRAFT_VERSION = 1;

export type CommercePosPaymentMethod = "CASH" | "WAVE" | "JEKO" | "CARD" | "OTHER";
export type CommercePosCheckoutState = "READY" | "PROCESSING" | "RECONCILIATION_REQUIRED";

export interface CommercePosDraftLine {
  itemId: string;
  label: string;
  quantity: number;
  unitPrice: number;
}

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
const checkoutStates = new Set<CommercePosCheckoutState>(["READY", "PROCESSING", "RECONCILIATION_REQUIRED"]);

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function createSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `pos-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function commercePosDraftStorageKey(locationId: string, userId: string): string {
  return `halal_erp_pos_draft:${locationId}:${userId}`;
}

export function createCommercePosDraft(locationId: string, userId: string): CommercePosDraft {
  return {
    version: COMMERCE_POS_DRAFT_VERSION,
    sessionId: createSessionId(),
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
  return draft.lines.length > 0
    || draft.clientId !== null
    || draft.paymentMethod !== "CASH"
    || draft.cashReceived !== null
    || draft.checkoutState !== "READY"
    || draft.jekoPayment !== null;
}

export function commercePosDraftTotal(draft: CommercePosDraft): number {
  return draft.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
}

export function parseCommercePosDraft(value: unknown, expectedLocationId: string, expectedUserId: string): CommercePosDraft | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<CommercePosDraft>;
  if (
    candidate.version !== COMMERCE_POS_DRAFT_VERSION
    || candidate.locationId !== expectedLocationId
    || candidate.userId !== expectedUserId
    || typeof candidate.sessionId !== "string"
    || !candidate.sessionId
    || !Array.isArray(candidate.lines)
    || !paymentMethods.has(candidate.paymentMethod as CommercePosPaymentMethod)
    || !checkoutStates.has(candidate.checkoutState as CommercePosCheckoutState)
  ) {
    return null;
  }

  const lines = candidate.lines.flatMap((line): CommercePosDraftLine[] => {
    if (
      !line
      || typeof line.itemId !== "string"
      || !line.itemId
      || typeof line.label !== "string"
      || !line.label
      || !isFiniteNonNegative(line.quantity)
      || line.quantity <= 0
      || !isFiniteNonNegative(line.unitPrice)
    ) {
      return [];
    }

    return [{ itemId: line.itemId, label: line.label, quantity: line.quantity, unitPrice: line.unitPrice }];
  });

  if (lines.length !== candidate.lines.length) return null;
  if (candidate.clientId !== null && typeof candidate.clientId !== "string") return null;
  if (candidate.cashReceived !== null && candidate.cashReceived !== undefined && !isFiniteNonNegative(candidate.cashReceived)) return null;

  const jekoPayment = candidate.jekoPayment;
  if (jekoPayment !== null && jekoPayment !== undefined && (
    jekoPayment.status !== "PENDING" || typeof jekoPayment.requestReference !== "string" || !jekoPayment.requestReference
  )) {
    return null;
  }

  return {
    version: COMMERCE_POS_DRAFT_VERSION,
    sessionId: candidate.sessionId,
    locationId: expectedLocationId,
    userId: expectedUserId,
    lines,
    clientId: candidate.clientId ?? null,
    paymentMethod: candidate.paymentMethod as CommercePosPaymentMethod,
    cashReceived: candidate.cashReceived ?? null,
    checkoutState: candidate.checkoutState as CommercePosCheckoutState,
    jekoPayment: jekoPayment ?? null,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString(),
  };
}

export function loadCommercePosDraft(storage: CommercePosStorage, locationId: string, userId: string): CommercePosDraft | null {
  try {
    const stored = storage.getItem(commercePosDraftStorageKey(locationId, userId));
    return stored ? parseCommercePosDraft(JSON.parse(stored), locationId, userId) : null;
  } catch {
    return null;
  }
}

export function saveCommercePosDraft(storage: CommercePosStorage, draft: CommercePosDraft): void {
  const key = commercePosDraftStorageKey(draft.locationId, draft.userId);
  if (!commercePosDraftHasContent(draft)) {
    storage.removeItem(key);
    return;
  }

  storage.setItem(key, JSON.stringify(draft));
}

export function removeCommercePosDraft(storage: CommercePosStorage, locationId: string, userId: string): void {
  storage.removeItem(commercePosDraftStorageKey(locationId, userId));
}

export function findCommercePosDraftLocation(storage: CommercePosStorage, locationIds: readonly string[], userId: string): string | null {
  for (const locationId of locationIds) {
    const draft = loadCommercePosDraft(storage, locationId, userId);
    if (draft && commercePosDraftHasContent(draft)) return locationId;
  }

  return null;
}

export function getCommercePosStockConflicts(
  lines: readonly CommercePosDraftLine[],
  availability: readonly CommercePosStockAvailability[],
): CommercePosStockConflict[] {
  const availableByItem = new Map(availability.map((item) => [item.itemId, item]));

  return lines.flatMap((line) => {
    const item = availableByItem.get(line.itemId);
    const availableQuantity = item?.availableQuantity ?? 0;
    if (line.quantity <= availableQuantity) return [];

    return [{
      itemId: line.itemId,
      label: item?.label ?? line.label,
      requestedQuantity: line.quantity,
      availableQuantity,
    }];
  });
}
