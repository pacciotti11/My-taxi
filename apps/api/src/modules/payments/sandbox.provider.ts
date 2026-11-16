import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type {
  AuthorizeParams,
  CaptureParams,
  ParsedWebhookEvent,
  PaymentProvider,
  ProviderResult,
  RefundParams,
} from "./payment-provider.interface";

export const SANDBOX_WEBHOOK_SECRET =
  process.env.SANDBOX_WEBHOOK_SECRET ?? "sandbox_webhook_secret_dev";

/**
 * TEST-MODE payment provider. Moves no real money. Behavior is deterministic
 * for tests: a payment method reference containing "fail" declines at
 * authorization; one containing "capture-fail" declines at capture.
 */
@Injectable()
export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = "sandbox";
  private readonly logger = new Logger(SandboxPaymentProvider.name);
  /** providerRef -> authorized state, to emulate provider-side validation. */
  private readonly intents = new Map<
    string,
    { amountMinor: number; methodRef: string; captured: boolean }
  >();

  async authorize(params: AuthorizeParams): Promise<ProviderResult> {
    if (params.paymentMethodRef.includes("fail") && !params.paymentMethodRef.includes("capture-fail")) {
      return {
        ok: false,
        errorCode: "card_declined",
        errorMessage: "Sandbox: card declined at authorization",
      };
    }
    const providerRef = `sandbox_pi_${randomUUID()}`;
    this.intents.set(providerRef, {
      amountMinor: params.amountMinor,
      methodRef: params.paymentMethodRef,
      captured: false,
    });
    this.logger.log(`[TEST MODE] Authorized ${params.amountMinor} ${params.currency} -> ${providerRef}`);
    return { ok: true, providerRef };
  }

  async capture(params: CaptureParams): Promise<ProviderResult> {
    const intent = this.intents.get(params.providerRef);
    // Accept unknown refs (e.g. after process restart) — the DB, not this
    // in-memory map, is the source of truth in sandbox mode.
    if (intent?.captured) {
      return { ok: true, providerRef: params.providerRef };
    }
    if (intent?.methodRef.includes("capture-fail")) {
      return {
        ok: false,
        errorCode: "capture_failed",
        errorMessage: "Sandbox: capture declined",
      };
    }
    if (intent) intent.captured = true;
    return { ok: true, providerRef: params.providerRef };
  }

  async cancelAuthorization(providerRef: string): Promise<ProviderResult> {
    this.intents.delete(providerRef);
    return { ok: true, providerRef };
  }

  async refund(params: RefundParams): Promise<ProviderResult> {
    return { ok: true, providerRef: `sandbox_re_${randomUUID()}` };
  }

  verifyWebhook(rawBody: Buffer, signatureHeader: string): ParsedWebhookEvent {
    const expected = createHmac("sha256", SANDBOX_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    const given = Buffer.from(signatureHeader ?? "", "utf8");
    const exp = Buffer.from(expected, "utf8");
    if (given.length !== exp.length || !timingSafeEqual(given, exp)) {
      throw new Error("Invalid webhook signature");
    }
    const payload = JSON.parse(rawBody.toString("utf8")) as {
      id: string;
      type: string;
      providerRef?: string;
      data?: Record<string, unknown>;
    };
    if (!payload.id || !payload.type) {
      throw new Error("Malformed webhook payload");
    }
    return {
      providerEventId: payload.id,
      type: payload.type,
      providerRef: payload.providerRef,
      data: payload.data ?? {},
    };
  }
}
