import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import type {
  AuthorizeParams,
  CaptureParams,
  ParsedWebhookEvent,
  PaymentProvider,
  ProviderResult,
  RefundParams,
} from "./payment-provider.interface";

/**
 * Stripe adapter using the REST API (manual-capture PaymentIntents).
 *
 * ⚠️ UNVERIFIED INTEGRATION: written against the Stripe API shape but never
 * exercised against a real Stripe account from this environment. Before any
 * production use: (1) verify business eligibility for Stripe in Bulgaria and
 * Connect account types for driver payouts, (2) run the full flow against
 * Stripe test keys, (3) replace raw fetch with the official SDK if preferred.
 * Configuration: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET in the API env.
 */
@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";

  private get secretKey(): string {
    const key = loadEnv().STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "Stripe is selected (PAYMENT_PROVIDER=stripe) but STRIPE_SECRET_KEY is not configured",
      );
    }
    return key;
  }

  private async call(
    path: string,
    body: Record<string, string>,
    idempotencyKey?: string,
  ): Promise<{ ok: boolean; json: Record<string, unknown> }> {
    const res = await fetch(`https://api.stripe.com${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: new URLSearchParams(body).toString(),
    });
    const json = (await res.json()) as Record<string, unknown>;
    return { ok: res.ok, json };
  }

  async authorize(params: AuthorizeParams): Promise<ProviderResult> {
    const { ok, json } = await this.call(
      "/v1/payment_intents",
      {
        amount: String(params.amountMinor),
        currency: params.currency.toLowerCase(),
        payment_method: params.paymentMethodRef,
        capture_method: "manual",
        confirm: "true",
        "automatic_payment_methods[enabled]": "true",
        "automatic_payment_methods[allow_redirects]": "never",
      },
      params.idempotencyKey,
    );
    if (!ok) {
      const err = json.error as { code?: string; message?: string } | undefined;
      return { ok: false, errorCode: err?.code, errorMessage: err?.message };
    }
    return { ok: true, providerRef: json.id as string };
  }

  async capture(params: CaptureParams): Promise<ProviderResult> {
    const { ok, json } = await this.call(
      `/v1/payment_intents/${params.providerRef}/capture`,
      { amount_to_capture: String(params.amountMinor) },
      params.idempotencyKey,
    );
    if (!ok) {
      const err = json.error as { code?: string; message?: string } | undefined;
      return { ok: false, errorCode: err?.code, errorMessage: err?.message };
    }
    return { ok: true, providerRef: json.id as string };
  }

  async cancelAuthorization(providerRef: string): Promise<ProviderResult> {
    const { ok, json } = await this.call(
      `/v1/payment_intents/${providerRef}/cancel`,
      {},
    );
    return ok
      ? { ok: true, providerRef }
      : {
          ok: false,
          errorMessage: (json.error as { message?: string })?.message,
        };
  }

  async refund(params: RefundParams): Promise<ProviderResult> {
    const { ok, json } = await this.call(
      "/v1/refunds",
      {
        payment_intent: params.providerRef,
        amount: String(params.amountMinor),
      },
      params.idempotencyKey,
    );
    if (!ok) {
      const err = json.error as { code?: string; message?: string } | undefined;
      return { ok: false, errorCode: err?.code, errorMessage: err?.message };
    }
    return { ok: true, providerRef: json.id as string };
  }

  verifyWebhook(rawBody: Buffer, signatureHeader: string): ParsedWebhookEvent {
    const secret = loadEnv().STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");
    // Stripe-Signature: t=<ts>,v1=<hmac>,...
    const parts = new Map(
      signatureHeader.split(",").map((kv) => {
        const [k, ...rest] = kv.split("=");
        return [k, rest.join("=")] as const;
      }),
    );
    const t = parts.get("t");
    const v1 = parts.get("v1");
    if (!t || !v1) throw new Error("Malformed Stripe signature header");
    const expected = createHmac("sha256", secret)
      .update(`${t}.${rawBody.toString("utf8")}`)
      .digest("hex");
    const a = Buffer.from(v1, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("Invalid Stripe webhook signature");
    }
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) {
      throw new Error("Stripe webhook timestamp outside tolerance");
    }
    const payload = JSON.parse(rawBody.toString("utf8")) as {
      id: string;
      type: string;
      data?: { object?: { id?: string } };
    };
    return {
      providerEventId: payload.id,
      type: payload.type,
      providerRef: payload.data?.object?.id,
      data: (payload.data ?? {}) as Record<string, unknown>,
    };
  }
}
