import {
  type CreatePaymentInput,
  type CreateTransferInput,
  type PaymentProvider,
  PaymentProviderError,
  type ProviderPayment,
  type ProviderStore,
  type ProviderTransfer,
} from "./payment.types";
import { verifyJekoWebhookSignature } from "./payment.events";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface JekoProviderConfig {
  apiKey: string;
  apiKeyId: string;
  baseUrl: string;
  webhookSecret?: string;
  timeoutMs?: number;
  fetcher?: FetchLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return { raw: text };
  }
}

function requestIdFrom(response: Response, payload: unknown): string | undefined {
  const headerValue = response.headers.get("x-request-id") ?? response.headers.get("request-id");
  if (headerValue) return headerValue;
  return isRecord(payload) ? readText(payload.requestId) ?? readText(payload.request_id) : undefined;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  return readText(payload.message) ?? readText(payload.error) ?? fallback;
}

function requireConfig(config: JekoProviderConfig): Required<Pick<JekoProviderConfig, "apiKey" | "apiKeyId" | "baseUrl">> {
  if (!config.apiKey || !config.apiKeyId || !config.baseUrl) {
    throw new PaymentProviderError({
      provider: "JEKO",
      code: "PAYMENT_CONFIGURATION_ERROR",
      message: "La configuration serveur Jèko est incomplète.",
      retryable: false,
    });
  }
  return { apiKey: config.apiKey, apiKeyId: config.apiKeyId, baseUrl: config.baseUrl.replace(/\/$/, "") };
}

function toProviderPayment(payload: unknown): ProviderPayment {
  if (!isRecord(payload)) {
    throw new PaymentProviderError({ provider: "JEKO", code: "PAYMENT_RESPONSE_INVALID", message: "La réponse Jèko est invalide.", retryable: false });
  }
  const id = readText(payload.id);
  const status = readText(payload.status);
  const reference = readText(payload.reference);
  if (!id || !status || !reference) {
    throw new PaymentProviderError({ provider: "JEKO", code: "PAYMENT_RESPONSE_INVALID", message: "La réponse Jèko est incomplète.", retryable: false });
  }
  return { id, status, reference, redirectUrl: readText(payload.redirectUrl), raw: payload };
}

function toProviderTransfer(payload: unknown): ProviderTransfer {
  if (!isRecord(payload)) {
    throw new PaymentProviderError({ provider: "JEKO", code: "PAYMENT_RESPONSE_INVALID", message: "La réponse Jèko est invalide.", retryable: false });
  }
  const id = readText(payload.id);
  const status = readText(payload.status);
  if (!id || !status) {
    throw new PaymentProviderError({ provider: "JEKO", code: "PAYMENT_RESPONSE_INVALID", message: "La réponse Jèko est incomplète.", retryable: false });
  }
  return { id, status, reference: readText(payload.reference), raw: payload };
}

function toProviderStores(payload: unknown): ProviderStore[] {
  if (!Array.isArray(payload)) {
    throw new PaymentProviderError({
      provider: "JEKO",
      code: "PAYMENT_RESPONSE_INVALID",
      message: "La liste des magasins Jèko est invalide.",
      retryable: false,
    });
  }

  return payload.map((item) => {
    if (!isRecord(item)) {
      throw new PaymentProviderError({
        provider: "JEKO",
        code: "PAYMENT_RESPONSE_INVALID",
        message: "Un magasin Jèko est invalide.",
        retryable: false,
      });
    }
    const id = readText(item.id);
    const name = readText(item.name);
    if (!id || !name) {
      throw new PaymentProviderError({
        provider: "JEKO",
        code: "PAYMENT_RESPONSE_INVALID",
        message: "Un magasin Jèko est incomplet.",
        retryable: false,
      });
    }
    return { id, name };
  });
}

export class JekoProvider implements PaymentProvider {
  readonly name = "JEKO" as const;
  private readonly apiKey: string;
  private readonly apiKeyId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: FetchLike;
  private readonly webhookSecret?: string;

  constructor(config: JekoProviderConfig) {
    const required = requireConfig(config);
    this.apiKey = required.apiKey;
    this.apiKeyId = required.apiKeyId;
    this.baseUrl = required.baseUrl;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.fetcher = config.fetcher ?? fetch;
    this.webhookSecret = config.webhookSecret;
  }

  static fromEnvironment(environment: Record<string, string | undefined> = process.env): JekoProvider {
    return new JekoProvider({
      apiKey: environment.JEKO_API_KEY ?? "",
      apiKeyId: environment.JEKO_API_KEY_ID ?? "",
      baseUrl: environment.JEKO_BASE_URL ?? "",
      webhookSecret: environment.JEKO_WEBHOOK_SECRET,
    });
  }

  async listStores(): Promise<ProviderStore[]> {
    return toProviderStores(await this.request("/partner_api/stores", "GET"));
  }

  async createPayment(input: CreatePaymentInput): Promise<ProviderPayment> {
    const data = await this.request("/partner_api/payment_requests", "POST", {
      amountCents: input.amountCents,
      currency: input.currency,
      reference: input.reference,
      storeId: input.storeId,
      description: input.description,
      paymentDetails: input.paymentDetails.type === "redirect"
        ? {
            type: "redirect",
            data: {
              paymentMethod: input.paymentDetails.paymentMethod,
              successUrl: input.paymentDetails.successUrl,
              errorUrl: input.paymentDetails.errorUrl,
              forceProviderDirect: input.paymentDetails.forceProviderDirect,
              payerPhone: input.paymentDetails.payerPhone,
            },
          }
        : {
            type: "soundbox",
            data: {
              paymentMethod: input.paymentDetails.paymentMethod,
              deviceId: input.paymentDetails.deviceId,
            },
          },
    });
    return toProviderPayment(data);
  }

  async getPayment(paymentId: string): Promise<ProviderPayment> {
    const data = await this.request(`/partner_api/payment_requests/${encodeURIComponent(paymentId)}`, "GET");
    return toProviderPayment(data);
  }

  async createTransfer(input: CreateTransferInput): Promise<ProviderTransfer> {
    const recipient = "contactId" in input.recipient
      ? { contactId: input.recipient.contactId }
      : {
          name: input.recipient.name,
          paymentMethod: input.recipient.paymentMethod,
          identifier: input.recipient.identifier,
        };
    const data = await this.request("/partner_api/transfers", "POST", {
      storeId: input.storeId,
      amountCents: input.amountCents,
      currency: input.currency,
      description: input.description,
      reference: input.reference,
      ...recipient,
    });
    return toProviderTransfer(data);
  }

  async verifyWebhook(input: { rawBody: string; signature: string | null }): Promise<boolean> {
    if (!this.webhookSecret) {
      throw new PaymentProviderError({
        provider: "JEKO",
        code: "PAYMENT_CONFIGURATION_ERROR",
        message: "Le secret webhook Jèko est absent de la configuration serveur.",
        retryable: false,
      });
    }
    return verifyJekoWebhookSignature(input.rawBody, input.signature, this.webhookSecret);
  }

  async cancelPayment(_paymentId: string): Promise<never> {
    throw new PaymentProviderError({
      provider: "JEKO",
      code: "PAYMENT_OPERATION_NOT_SUPPORTED",
      message: "Jèko ne documente pas d’annulation de demande de paiement par API.",
      retryable: false,
    });
  }

  private async request(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<unknown> {
    const attempts = method === "GET" ? 3 : 1;
    let lastError: PaymentProviderError | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-API-KEY": this.apiKey,
            "X-API-KEY-ID": this.apiKeyId,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        const payload = await readJson(response);
        if (!response.ok) {
          lastError = new PaymentProviderError({
            provider: "JEKO",
            code: "PAYMENT_PROVIDER_ERROR",
            message: errorMessage(payload, "La requête Jèko a échoué."),
            status: response.status,
            retryable: method === "GET" && (response.status === 429 || response.status >= 500),
            requestId: requestIdFrom(response, payload),
          });
          if (!lastError.retryable || attempt === attempts) throw lastError;
        } else {
          return payload;
        }
      } catch (error) {
        if (error instanceof PaymentProviderError) {
          if (!error.retryable || attempt === attempts) throw error;
          lastError = error;
        } else if (error instanceof DOMException && error.name === "AbortError") {
          lastError = new PaymentProviderError({ provider: "JEKO", code: "PAYMENT_TIMEOUT", message: "La requête Jèko a expiré.", retryable: method === "GET" });
          if (attempt === attempts) throw lastError;
        } else {
          lastError = new PaymentProviderError({ provider: "JEKO", code: "PAYMENT_NETWORK_ERROR", message: "La requête réseau vers Jèko a échoué.", retryable: method === "GET" });
          if (attempt === attempts) throw lastError;
        }
      } finally {
        clearTimeout(timeout);
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 150 * attempt));
    }

    throw lastError ?? new PaymentProviderError({ provider: "JEKO", code: "PAYMENT_NETWORK_ERROR", message: "La requête Jèko a échoué.", retryable: false });
  }
}
