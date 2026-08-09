/**
 * Provider-neutral payment primitives. Values sent to a provider stay in the
 * provider's documented unit; ERP finance amounts are never inferred here.
 */
export type PaymentProviderName = "JEKO" | (string & {});

export type PaymentMethod = "wave" | "orange" | "mtn" | "moov" | "djamo" | "bank";

export interface ProviderMoney {
  amount: number;
  currency: string;
}

export interface RedirectPaymentDetails {
  type: "redirect";
  paymentMethod: Exclude<PaymentMethod, "bank">;
  successUrl: string;
  errorUrl: string;
  payerPhone?: string;
  forceProviderDirect?: boolean;
}

export interface SoundboxPaymentDetails {
  type: "soundbox";
  paymentMethod: Exclude<PaymentMethod, "bank">;
  deviceId: string;
}

export type ProviderPaymentDetails = RedirectPaymentDetails | SoundboxPaymentDetails;

export interface CreatePaymentInput {
  /** Amount in the unit required by the provider API. */
  amountCents: number;
  currency: string;
  reference: string;
  storeId: string;
  description?: string;
  paymentDetails: ProviderPaymentDetails;
}

export interface ProviderPayment {
  id: string;
  status: string;
  reference: string;
  redirectUrl?: string;
  raw: unknown;
}

export interface ProviderStore {
  id: string;
  name: string;
}

export interface ExistingContactTransferRecipient {
  contactId: string;
}

export interface InlineMobileMoneyTransferRecipient {
  name: string;
  paymentMethod: Exclude<PaymentMethod, "bank">;
  identifier: { reference: string };
}

export type TransferRecipient = ExistingContactTransferRecipient | InlineMobileMoneyTransferRecipient;

export interface CreateTransferInput {
  /** Amount in the unit required by the provider API. */
  amountCents: number;
  currency: string;
  storeId: string;
  description: string;
  reference?: string;
  recipient: TransferRecipient;
}

export interface ProviderTransfer {
  id: string;
  status: string;
  reference?: string;
  raw: unknown;
}

export interface PaymentProviderErrorDetails {
  provider: PaymentProviderName;
  code:
    | "PAYMENT_CONFIGURATION_ERROR"
    | "PAYMENT_NETWORK_ERROR"
    | "PAYMENT_TIMEOUT"
    | "PAYMENT_PROVIDER_ERROR"
    | "PAYMENT_RESPONSE_INVALID"
    | "PAYMENT_OPERATION_NOT_SUPPORTED";
  message: string;
  status?: number;
  retryable: boolean;
  requestId?: string;
}

export class PaymentProviderError extends Error {
  readonly provider: PaymentProviderName;
  readonly code: PaymentProviderErrorDetails["code"];
  readonly status?: number;
  readonly retryable: boolean;
  readonly requestId?: string;

  constructor(details: PaymentProviderErrorDetails) {
    super(details.message);
    this.name = "PaymentProviderError";
    this.provider = details.provider;
    this.code = details.code;
    this.status = details.status;
    this.retryable = details.retryable;
    this.requestId = details.requestId;
  }
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  listStores(): Promise<ProviderStore[]>;
  createPayment(input: CreatePaymentInput): Promise<ProviderPayment>;
  getPayment(paymentId: string): Promise<ProviderPayment>;
  createTransfer(input: CreateTransferInput): Promise<ProviderTransfer>;
  verifyWebhook(input: { rawBody: string; signature: string | null }): Promise<boolean>;
  cancelPayment(paymentId: string): Promise<never>;
}
