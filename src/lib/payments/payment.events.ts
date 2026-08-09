export type JekoWebhookTransactionKind = "PAYMENT" | "TRANSFER" | "UNKNOWN";

export interface JekoWebhookEvent {
  id: string;
  amount: { amount: number; currency: string };
  status: string;
  transactionType: string;
  transactionKind: JekoWebhookTransactionKind;
  reference: string | null;
  providerRequestId: string | null;
  executedAt: string | null;
  raw: Record<string, unknown>;
}

export class PaymentEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentEventValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PaymentEventValidationError(`${label} est obligatoire.`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function requiredAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new PaymentEventValidationError("Le montant Jèko est invalide.");
  }
  return value;
}

export function normalizeJekoTransactionKind(value: string): JekoWebhookTransactionKind {
  const normalized = value.toLowerCase().replace(/[\s_-]/g, "");
  if (normalized === "payment" || normalized === "paymentrequest") return "PAYMENT";
  if (normalized === "transfer") return "TRANSFER";
  return "UNKNOWN";
}

export function parseJekoWebhookEvent(payload: unknown): JekoWebhookEvent {
  if (!isRecord(payload)) {
    throw new PaymentEventValidationError("Le payload Jèko doit être un objet JSON.");
  }

  const amount = payload.amount;
  if (!isRecord(amount)) {
    throw new PaymentEventValidationError("Le montant Jèko est absent.");
  }

  const details = isRecord(payload.transactionDetails) ? payload.transactionDetails : null;
  const currency = requiredText(amount.currency, "La devise Jèko").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new PaymentEventValidationError("La devise Jèko est invalide.");
  }

  const transactionType = requiredText(payload.transactionType, "Le type de transaction Jèko");
  return {
    id: requiredText(payload.id, "L’identifiant de transaction Jèko"),
    amount: { amount: requiredAmount(amount.amount), currency },
    status: requiredText(payload.status, "Le statut Jèko").toLowerCase(),
    transactionType,
    transactionKind: normalizeJekoTransactionKind(transactionType),
    reference: optionalText(details?.reference),
    providerRequestId: optionalText(details?.id),
    executedAt: optionalText(payload.executedAt),
    raw: payload,
  };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export async function createJekoWebhookSignature(rawBody: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  return hex(new Uint8Array(signature));
}

export async function verifyJekoWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;
  const normalizedSignature = signature.trim().replace(/^sha256=/i, "").toLowerCase();
  const expectedSignature = await createJekoWebhookSignature(rawBody, secret);
  return constantTimeEqual(expectedSignature, normalizedSignature);
}
