import { scraperLogger } from './logger.js';

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  shouldRetry?: (error: Error) => boolean;
}

const defaultOptions: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, options: RetryOptions): number {
  const baseDelay = Math.min(
    options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1),
    options.maxDelayMs
  );

  // Add jitter (±25%)
  const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);

  return Math.floor(baseDelay + jitter);
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry this error
      if (opts.shouldRetry && !opts.shouldRetry(lastError)) {
        throw lastError;
      }

      // Check if we've exhausted attempts
      if (attempt >= opts.maxAttempts) {
        scraperLogger.error(`All ${opts.maxAttempts} retry attempts exhausted`, {
          error: lastError.message,
        });
        throw lastError;
      }

      const delay = calculateDelay(attempt, opts);
      scraperLogger.retry(attempt, opts.maxAttempts, lastError.message);

      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError ?? new Error('Retry failed');
}

/**
 * Retry specifically for network operations
 */
export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3
): Promise<T> {
  return withRetry(fn, {
    maxAttempts,
    initialDelayMs: 2000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    shouldRetry: (error) => {
      const message = error.message.toLowerCase();
      // Retry on network-related errors
      return (
        message.includes('timeout') ||
        message.includes('econnrefused') ||
        message.includes('econnreset') ||
        message.includes('enotfound') ||
        message.includes('network') ||
        message.includes('socket') ||
        message.includes('503') ||
        message.includes('502') ||
        message.includes('429')
      );
    },
  });
}

/**
 * Wrap a function to add retry logic
 */
export function retryable<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  options: Partial<RetryOptions> = {}
): T {
  return (async (...args: Parameters<T>) => {
    return withRetry(() => fn(...args), options);
  }) as T;
}
