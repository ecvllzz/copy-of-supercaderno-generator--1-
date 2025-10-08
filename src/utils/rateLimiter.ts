/**
 * Simple sliding window rate limiter that enforces a minimum interval between
 * API calls. It mirrors the behaviour described in the critical analysis: wait
 * only as long as needed instead of an unconditional delay.
 */
export class RateLimiter {
  private lastCall = 0;

  constructor(private readonly minIntervalMs: number) {}

  async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCall;

    if (elapsed < this.minIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minIntervalMs - elapsed));
    }

    this.lastCall = Date.now();
  }
}

export const defaultRateLimiter = new RateLimiter(1_000);
