import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  DEFAULT_OFFER_TIMEOUT_SECONDS,
  DEFAULT_SEARCH_TIMEOUT_SECONDS,
} from "@privateride/shared";
import { Queue, Worker } from "bullmq";
import { loadEnv } from "../../config/env";
import { MatchingService } from "./matching.service";

type MatchingJob =
  | { type: "search"; rideId: string }
  | { type: "offer-timeout"; assignmentId: string }
  | { type: "search-timeout"; rideId: string };

/**
 * Background coordination for matching: initial search, offer expiry and
 * overall search expiry. Not started in tests, where the service methods are
 * driven synchronously.
 */
@Injectable()
export class MatchingQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchingQueue.name);
  private queue: Queue<MatchingJob> | null = null;
  private worker: Worker<MatchingJob> | null = null;

  constructor(private readonly matching: MatchingService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    const connection = { url: loadEnv().REDIS_URL };
    this.queue = new Queue<MatchingJob>("matching", { connection });
    this.worker = new Worker<MatchingJob>(
      "matching",
      async (job) => {
        const data = job.data;
        if (data.type === "search") {
          const assignment = await this.matching.offerToNextDriver(data.rideId);
          if (assignment) {
            await this.scheduleOfferTimeout(assignment.id);
          } else {
            // No candidate right now; retry until the search window closes.
            await this.queue?.add(
              "matching",
              { type: "search", rideId: data.rideId },
              { delay: 5_000 },
            );
          }
        } else if (data.type === "offer-timeout") {
          const next = await this.matching.expireOffer(data.assignmentId);
          if (next) await this.scheduleOfferTimeout(next.id);
        } else if (data.type === "search-timeout") {
          await this.matching.expireSearch(data.rideId);
        }
      },
      { connection, concurrency: 5 },
    );
    this.worker.on("failed", (job, err) =>
      this.logger.error(`Matching job ${job?.id} failed: ${err.message}`),
    );
  }

  async startSearch(rideId: string): Promise<void> {
    if (!this.queue) return; // test mode
    await this.queue.add("matching", { type: "search", rideId });
    await this.queue.add(
      "matching",
      { type: "search-timeout", rideId },
      { delay: DEFAULT_SEARCH_TIMEOUT_SECONDS * 1000 },
    );
  }

  async scheduleOfferTimeout(assignmentId: string): Promise<void> {
    if (!this.queue) return;
    await this.queue.add(
      "matching",
      { type: "offer-timeout", assignmentId },
      { delay: (DEFAULT_OFFER_TIMEOUT_SECONDS + 1) * 1000 },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
