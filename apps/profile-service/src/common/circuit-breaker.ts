type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime: number | null = null;

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly resetTimeout: number = 30000,
    private readonly isInfrastructureError: (error: unknown) => boolean = () => true,
  ) {}

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (
        this.lastFailureTime &&
        Date.now() - this.lastFailureTime > this.resetTimeout
      ) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.reset();
      return result;
    } catch (error) {
      if (this.isInfrastructureError(error)) {
        this.recordFailure();
      }
      throw error;
    }
  }

  private recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  private reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
  }
}
