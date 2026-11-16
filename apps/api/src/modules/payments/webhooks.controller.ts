import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../../common/prisma.service";
import { Public } from "../../common/guards/decorators";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ParsedWebhookEvent,
} from "./payment-provider.interface";
import { PaymentsService } from "./payments.service";

/**
 * Inbound payment webhooks. Signature-verified, persisted, idempotent:
 * an event id is processed at most once no matter how often it is delivered.
 */
@Controller({ path: "webhooks", version: "1" })
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  @Public()
  @Post("payments")
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-webhook-signature") sandboxSig?: string,
    @Headers("stripe-signature") stripeSig?: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) throw new BadRequestException("Missing body");

    let event: ParsedWebhookEvent;
    try {
      event = this.provider.verifyWebhook(
        rawBody,
        (this.provider.name === "stripe" ? stripeSig : sandboxSig) ?? "",
      );
    } catch (e) {
      throw new BadRequestException(`Webhook rejected: ${(e as Error).message}`);
    }

    // Persist-first idempotency: the unique (provider, providerEventId) pair
    // makes a replayed delivery a no-op.
    let stored;
    try {
      stored = await this.prisma.webhookEvent.create({
        data: {
          provider: this.provider.name,
          providerEventId: event.providerEventId,
          type: event.type,
          payload: event.data as object,
        },
      });
    } catch {
      this.logger.log(`Duplicate webhook ${event.providerEventId} ignored`);
      return { received: true, duplicate: true };
    }

    try {
      await this.process(event);
      await this.prisma.webhookEvent.update({
        where: { id: stored.id },
        data: { processedAt: new Date() },
      });
    } catch (e) {
      await this.prisma.webhookEvent.update({
        where: { id: stored.id },
        data: { error: (e as Error).message },
      });
      this.logger.error(
        `Webhook ${event.providerEventId} processing failed: ${(e as Error).message}`,
      );
      // 200 anyway: the event is persisted and can be reprocessed by an operator;
      // returning 5xx would make the provider hammer us with retries.
    }
    return { received: true };
  }

  private async process(event: ParsedWebhookEvent): Promise<void> {
    switch (event.type) {
      case "payment_intent.succeeded": // stripe
      case "payment.captured": { // sandbox
        if (!event.providerRef) return;
        const payment = await this.prisma.payment.findUnique({
          where: {
            provider_providerRef: {
              provider: this.provider.name,
              providerRef: event.providerRef,
            },
          },
        });
        if (!payment) return;
        // settleRide is idempotent; it completes the ride if still pending.
        await this.payments.settleRide(payment.rideId).catch((e) => {
          this.logger.warn(
            `settleRide from webhook skipped: ${(e as Error).message}`,
          );
        });
        break;
      }
      default:
        this.logger.log(`Unhandled webhook type ${event.type}`);
    }
  }
}
