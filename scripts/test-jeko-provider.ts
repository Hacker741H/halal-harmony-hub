import assert from "node:assert/strict";

import { JekoProvider } from "../src/lib/payments/jeko.provider";
import {
  createJekoWebhookSignature,
  parseJekoWebhookEvent,
  PaymentEventValidationError,
  verifyJekoWebhookSignature,
} from "../src/lib/payments/payment.events";
import { PaymentProviderError } from "../src/lib/payments/payment.types";

const webhookSecret = "test-webhook-secret";
const successfulPaymentPayload = {
  id: "txn-test-payment-001",
  amount: { amount: 12500, currency: "XOF" },
  status: "success",
  transactionType: "payment",
  executedAt: "2026-08-08T10:00:00.000Z",
  transactionDetails: { id: "pr-test-001", reference: "FAC-2026-000045" },
};

async function expectProviderError(
  operation: () => Promise<unknown>,
  expectedCode: PaymentProviderError["code"],
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    return error instanceof PaymentProviderError && error.code === expectedCode;
  });
}

async function run(): Promise<void> {
  const rawBody = JSON.stringify(successfulPaymentPayload);
  const signature = await createJekoWebhookSignature(rawBody, webhookSecret);
  assert.equal(await verifyJekoWebhookSignature(rawBody, signature, webhookSecret), true, "valid HMAC must be accepted");
  assert.equal(await verifyJekoWebhookSignature(rawBody, "invalid", webhookSecret), false, "invalid HMAC must be rejected");

  const paymentEvent = parseJekoWebhookEvent(successfulPaymentPayload);
  assert.equal(paymentEvent.transactionKind, "PAYMENT", "payment webhook must be classified as payment");
  assert.equal(paymentEvent.reference, "FAC-2026-000045", "invoice reference must be preserved");

  const transferEvent = parseJekoWebhookEvent({
    ...successfulPaymentPayload,
    id: "txn-test-transfer-001",
    transactionType: "transfer",
  });
  assert.equal(transferEvent.transactionKind, "TRANSFER", "transfer webhook must not be classified as a payment");

  assert.throws(
    () => parseJekoWebhookEvent({ id: "missing-fields" }),
    PaymentEventValidationError,
    "malformed payload must be rejected before persistence",
  );

  const responsePayload = {
    id: "pr-test-001",
    status: "pending",
    reference: "FAC-2026-000045",
    redirectUrl: "https://pay.jeko.africa/payment/pr-test-001",
  };
  let capturedHeaders: Headers | undefined;
  const provider = new JekoProvider({
    apiKey: "test-api-key",
    apiKeyId: "test-api-key-id",
    webhookSecret,
    baseUrl: "https://api.jeko.africa",
    fetcher: async (input, init) => {
      capturedHeaders = new Headers(init?.headers);
      if (String(input).endsWith("/partner_api/stores")) {
        return new Response(JSON.stringify([{ id: "store-test", name: "Magasin de test" }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(responsePayload), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const paymentRequest = await provider.createPayment({
    amountCents: 1_250_000,
    currency: "XOF",
    reference: "FAC-2026-000045",
    storeId: "store-test",
    paymentDetails: {
      type: "redirect",
      paymentMethod: "wave",
      successUrl: "https://erp.example.test/payment/success",
      errorUrl: "https://erp.example.test/payment/error",
    },
  });
  assert.equal(paymentRequest.id, "pr-test-001", "provider must return Jèko payment request ID");
  assert.deepEqual(await provider.listStores(), [{ id: "store-test", name: "Magasin de test" }], "provider must list Jèko stores");
  assert.equal(capturedHeaders?.get("X-API-KEY"), "test-api-key", "provider must use Jèko API key header");
  assert.equal(capturedHeaders?.get("X-API-KEY-ID"), "test-api-key-id", "provider must use Jèko API key ID header");
  assert.equal(await provider.verifyWebhook({ rawBody, signature }), true, "provider must verify with webhook secret, not API key");

  await expectProviderError(() => provider.cancelPayment("pr-test-001"), "PAYMENT_OPERATION_NOT_SUPPORTED");

  const apiErrorProvider = new JekoProvider({
    apiKey: "test-api-key",
    apiKeyId: "test-api-key-id",
    baseUrl: "https://api.jeko.africa",
    fetcher: async () => new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 }),
  });
  await expectProviderError(
    () => apiErrorProvider.getPayment("pr-test-001"),
    "PAYMENT_PROVIDER_ERROR",
  );

  const timeoutProvider = new JekoProvider({
    apiKey: "test-api-key",
    apiKeyId: "test-api-key-id",
    baseUrl: "https://api.jeko.africa",
    timeoutMs: 1,
    fetcher: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("AbortSignal missing"));
        return;
      }
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  });
  await expectProviderError(
    () => timeoutProvider.getPayment("pr-test-001"),
    "PAYMENT_TIMEOUT",
  );

  console.info("Jèko provider tests passed.");
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown test failure";
  console.error(`Jèko provider tests failed: ${message}`);
  process.exitCode = 1;
});
