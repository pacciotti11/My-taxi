import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditService } from "../../common/audit.service";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/types";
import { Accounts, LedgerService } from "./ledger.service";

/**
 * Driver payouts. In sandbox mode a payout is marked PAID immediately; a
 * real provider (Stripe Connect transfers) keeps it PENDING/IN_TRANSIT until
 * the provider confirms. A payout never exceeds the driver's ledger balance,
 * and capturing a passenger payment never auto-triggers one.
 */
@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async driverEarnings(actor: AuthenticatedUser, currency = "BGN") {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException("No driver profile");
    const account = Accounts.driver(profile.id);
    const [balanceMinor, entries, payouts] = await Promise.all([
      this.ledger.balance(account, currency),
      this.ledger.entriesForAccount(account, 50),
      this.prisma.payout.findMany({
        where: { driverProfileId: profile.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);
    return { currency, balanceMinor, entries, payouts };
  }

  async createPayout(
    actor: AuthenticatedUser,
    driverProfileId: string,
    currency = "BGN",
  ) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
    });
    if (!profile) throw new NotFoundException("Driver not found");
    const account = Accounts.driver(driverProfileId);
    const balanceMinor = await this.ledger.balance(account, currency);
    if (balanceMinor <= 0) {
      throw new BadRequestException("No positive balance to pay out");
    }

    const now = new Date();
    const payout = await this.prisma.payout.create({
      data: {
        driverProfileId,
        provider: "sandbox",
        providerRef: `sandbox_po_${now.getTime()}`,
        status: "PAID", // sandbox settles instantly; real providers stay PENDING
        currency,
        amountMinor: balanceMinor,
        periodStart: new Date(0),
        periodEnd: now,
      },
    });
    await this.ledger.book({
      type: "DRIVER_PAYOUT",
      debitAccount: account,
      creditAccount: Accounts.platformCash,
      currency,
      amountMinor: balanceMinor,
      idempotencyKey: `payout:${payout.id}`,
      payoutId: payout.id,
      memo: "Driver payout",
    });
    await this.audit.log({
      actorId: actor.id,
      action: "payout.create",
      entity: "Payout",
      entityId: payout.id,
      metadata: { driverProfileId, amountMinor: balanceMinor, currency },
    });
    return payout;
  }
}
