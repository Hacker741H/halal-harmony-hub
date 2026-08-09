import { createClient } from "npm:@supabase/supabase-js@2";
import {
  parseJekoWebhookEvent,
  PaymentEventValidationError,
  verifyJekoWebhookSignature,
} from "../../../src/lib/payments/payment.events.ts";

type EventRow = {
  id: string;
  status: string;
  last_error_code: string | null;
  payment_id: string | null;
  finance_operation_id: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toEventRow(value: unknown): EventRow | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string") return null;
  return {
    id: value.id,
    status: value.status,
    last_error_code: typeof value.last_error_code === "string" ? value.last_error_code : null,
    payment_id: typeof value.payment_id === "string" ? value.payment_id : null,
    finance_operation_id: typeof value.finance_operation_id === "string" ? value.finance_operation_id : null,
  };
}

function permanentFailure(code: string | null): boolean {
  return code !== null && /^PJE(?:K[1-9]|1[0-3])$/.test(code);
}

Deno.serve(async (request) => {
  const startedAt = performance.now();
  if (request.method !== "POST") {
    return Response.json({ error: "Méthode non autorisée." }, { status: 405 });
  }

  const webhookSecret = Deno.env.get("JEKO_WEBHOOK_SECRET");
  const rawBody = await request.text();
  if (!webhookSecret) {
    console.error("Le webhook Jèko n’est pas configuré.");
    return Response.json({ error: "Configuration serveur indisponible." }, { status: 503 });
  }

  const signatureValid = await verifyJekoWebhookSignature(
    rawBody,
    request.headers.get("Jeko-Signature"),
    webhookSecret,
  );
  if (!signatureValid) {
    console.warn("Webhook Jèko refusé : signature invalide.");
    return Response.json({ error: "Signature invalide." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return Response.json({ error: "Payload JSON invalide." }, { status: 400 });
  }

  let event;
  try {
    event = parseJekoWebhookEvent(payload);
  } catch (error) {
    const message = error instanceof PaymentEventValidationError ? error.message : "Payload Jèko invalide.";
    console.warn("Webhook Jèko refusé : payload invalide.", { message });
    return Response.json({ error: "Payload invalide." }, { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Le serveur Jèko ne peut pas joindre Supabase : configuration incomplète.", {
      provider: "JEKO",
      transactionId: event.id,
    });
    return Response.json({ error: "Configuration serveur indisponible." }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: insertError } = await supabase.from("payment_events").insert({
    provider: "JEKO",
    transaction_id: event.id,
    event_type: "transaction.completed",
    payload: event.raw,
    reference: event.reference,
    provider_request_id: event.providerRequestId,
    provider_amount: event.amount.amount,
    currency: event.amount.currency,
  });

  if (insertError && insertError.code !== "23505") {
    console.error("Webhook Jèko : enregistrement de l’événement impossible.", {
      provider: "JEKO",
      transactionId: event.id,
      code: insertError.code ?? null,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return Response.json({ error: "Événement non enregistré." }, { status: 500 });
  }

  const { data: existingEvent, error: existingEventError } = await supabase
    .from("payment_events")
    .select("id, status, last_error_code, payment_id, finance_operation_id")
    .eq("provider", "JEKO")
    .eq("transaction_id", event.id)
    .maybeSingle();

  const persistedEvent = toEventRow(existingEvent);
  if (existingEventError || !persistedEvent) {
    console.error("Webhook Jèko : événement enregistré mais introuvable.", {
      provider: "JEKO",
      transactionId: event.id,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return Response.json({ error: "Événement introuvable." }, { status: 500 });
  }

  if (persistedEvent.status === "PROCESSED") {
    console.info("Webhook Jèko rejoué sans effet.", {
      provider: "JEKO",
      transactionId: event.id,
      eventId: persistedEvent.id,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return Response.json({ status: "already_processed" });
  }

  const { data: processed, error: processingError } = await supabase.rpc("process_jeko_payment_event", {
    p_event_id: persistedEvent.id,
  });
  const processedEvent = toEventRow(processed);
  if (processingError || !processedEvent) {
    console.error("Webhook Jèko : traitement financier impossible.", {
      provider: "JEKO",
      transactionId: event.id,
      eventId: persistedEvent.id,
      code: processingError?.code ?? null,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return Response.json({ error: "Traitement temporairement indisponible." }, { status: 500 });
  }

  if (processedEvent.status !== "PROCESSED") {
    const status = permanentFailure(processedEvent.last_error_code) ? 422 : 500;
    console.warn("Webhook Jèko non comptabilisé.", {
      provider: "JEKO",
      transactionId: event.id,
      eventId: processedEvent.id,
      failureCode: processedEvent.last_error_code,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return Response.json({ error: "Événement reçu mais non comptabilisé." }, { status });
  }

  console.info("Webhook Jèko traité.", {
    provider: "JEKO",
    transactionId: event.id,
    eventId: processedEvent.id,
    paymentId: processedEvent.payment_id,
    operationId: processedEvent.finance_operation_id,
    durationMs: Math.round(performance.now() - startedAt),
  });
  return Response.json({ status: "processed" });
});
