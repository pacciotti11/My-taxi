import { Injectable } from "@nestjs/common";
import { LedgerEntryType, Prisma } from "@privateride/database";
import { PrismaService } from "../../common/prisma.service";

export const Accounts = {
  passenger: (userId: string) => `passenger:${userId}`,
  driver: (driverProfileId: string) => `driver:${driverProfileId}`,
  platformCash: "platform:cash",
  platformRevenue: "platform:revenue",
} as const;

export interface LedgerEntryInput {
  type: LedgerEntryType;
  debitAccount: string;
  creditAccount: string;
  currency: string;
  amountMinor: number;
  idempotencyKey: string;
  rideId?: string;
  paymentId?: string;
  payoutId?: string;
  refundId?: string;
  memo?: string;
}

/**
 * Double-entry financial ledger. Every money movement is one row debiting
 * one account and crediting another, keyed by a unique idempotencyKey so a
 * replayed webhook or retried request can never book the same event twice.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Books an entry; returns false when the idempotency key already exists. */
  async book(
    entry: LedgerEntryInput,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx ?? this.prisma;
    try {
      await client.financialLedgerEntry.create({ data: entry });
      return true;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        return false;
      }
      throw e;
    }
  }

  /** Net balance of an account: credits minus debits. */
  async balance(account: string, currency: string): Promise<number> {
    const [credits, debits] = await Promise.all([
      this.prisma.financialLedgerEntry.aggregate({
        where: { creditAccount: account, currency },
        _sum: { amountMinor: true },
      }),
      this.prisma.financialLedgerEntry.aggregate({
        where: { debitAccount: account, currency },
        _sum: { amountMinor: true },
      }),
    ]);
    return (credits._sum.amountMinor ?? 0) - (debits._sum.amountMinor ?? 0);
  }

  async entriesForAccount(account: string, take = 100) {
    return this.prisma.financialLedgerEntry.findMany({
      where: {
        OR: [{ debitAccount: account }, { creditAccount: account }],
      },
      orderBy: { createdAt: "desc" },
      take,
    });
  }
}
