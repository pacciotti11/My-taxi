export interface ProviderResult {
  ok: boolean;
  /** Provider-side reference (e.g. payment intent id). */
  providerRef?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface AuthorizeParams {
  amountMinor: number;
  currency: string;
  /** Provider-side payment method reference (token), never raw card data. */
  paymentMethodRef: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface CaptureParams {
  providerRef: string;
  amountMinor: number;
  idempotencyKey: string;
}

export interface RefundParams {
  providerRef: string;
  amountMinor: number;
  idempotencyKey: string;
  reason?: string;
}

export interface ParsedWebhookEvent {
  providerEventId: string;
  type: string;
  providerRef?: string;
  data: Record<string, unknown>;
}

/**
 * Payment provider abstraction. The platform never touches card numbers:
 * clients tokenize through provider-hosted components and the API only ever
 * sees opaque method references.
 */
export interface PaymentProvider {
  readonly name: string;
  authorize(params: AuthorizeParams): Promise<ProviderResult>;
  capture(params: CaptureParams): Promise<ProviderResult>;
  cancelAuthorization(providerRef: string): Promise<ProviderResult>;
  refund(params: RefundParams): Promise<ProviderResult>;
  /** Throws on invalid signature. */
  verifyWebhook(rawBody: Buffer, signatureHeader: string): ParsedWebhookEvent;
}

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");
