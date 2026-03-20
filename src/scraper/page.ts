import { Page, Locator } from 'playwright';
import { ScraperConfig, PaginationConfig } from '../config/index.js';
import { PaginationInfo } from '../types/product.js';
import { scraperLogger } from '../utils/logger.js';
import { sleep, withRetry } from '../utils/retry.js';
import { humanClick, randomScroll } from './stealth.js';

export interface NavigateOptions {
  waitForSelector?: string;
  waitTime?: number;
}

export interface PageHandlerOptions {
  page: Page;
  config: ScraperConfig;
}

/**
 * Page Handler - handles navigation and pagination
 */
export class PageHandler {
  private page: Page;
  private config: ScraperConfig;
  private currentPage: number = 1;

  constructor(options: PageHandlerOptions) {
    this.page = options.page;
    this.config = options.config;
  }

  /**
   * Navigate to URL with auto-wait
   */
  async navigate(url: string, options: NavigateOptions = {}): Promise<void> {
    scraperLogger.info(`Navigating to ${url}`);

    await withRetry(
      async () => {
        await this.page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.requestTimeout,
        });

        // Wait for network to settle
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
          scraperLogger.debug('Network idle timeout - continuing anyway');
        });
      },
      {
        maxAttempts: 3,
        initialDelayMs: 2000,
      }
    );

    // Random delay to appear human-like
    await this.randomDelay();

    // Wait for specific selector if provided
    if (options.waitForSelector) {
      await this.waitForSelector(options.waitForSelector);
    }

    // Additional wait time if specified
    if (options.waitTime) {
      await sleep(options.waitTime);
    }

    // Random scroll to trigger lazy loading
    await randomScroll(this.page);
  }

  /**
   * Wait for a selector with timeout
   */
  async waitForSelector(selector: string, timeout?: number): Promise<Locator> {
    const locator = this.page.locator(selector);
    await locator.waitFor({
      state: 'attached',
      timeout: timeout ?? this.config.requestTimeout,
    });
    return locator;
  }

  /**
   * Wait for dynamic content to load
   */
  async waitForContent(selector: string, minCount: number = 1): Promise<void> {
    await this.page.waitForFunction(
      ({ sel, count }) => {
        const elements = document.querySelectorAll(sel);
        return elements.length >= count;
      },
      { sel: selector, count: minCount },
      { timeout: this.config.requestTimeout }
    );
  }

  /**
   * Handle pagination - click based
   */
  async goToNextPageClick(): Promise<boolean> {
    const selector = this.config.selectors.nextPage;

    if (!selector) {
      return false;
    }

    try {
      const nextButton = this.page.locator(selector);

      // Check if button exists and is enabled
      const isVisible = await nextButton.isVisible().catch(() => false);
      const isDisabled = await nextButton.isDisabled().catch(() => false);

      if (!isVisible || isDisabled) {
        scraperLogger.info('No more pages - next button not available');
        return false;
      }

      // Get current product count to detect page change
      const currentCount = await this.getProductCount();

      // Human-like click
      await humanClick(this.page, selector);

      // Wait for page to change
      await this.waitForPageChange(currentCount);

      this.currentPage++;
      await this.randomDelay();

      return true;
    } catch (error) {
      scraperLogger.warn(`Failed to click next page: ${error}`);
      return false;
    }
  }

  /**
   * Handle pagination - infinite scroll
   */
  async scrollToLoadMore(maxScrolls: number = 50): Promise<number> {
    let scrollCount = 0;
    let previousHeight = 0;
    let currentHeight = await this.page.evaluate(() => document.body.scrollHeight);

    while (scrollCount < maxScrolls) {
      previousHeight = currentHeight;

      // Scroll to bottom
      await this.page.evaluate(() => {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth',
        });
      });

      // Wait for new content
      await sleep(this.config.pagination.scrollDelay ?? 1000);

      // Check if new content loaded
      currentHeight = await this.page.evaluate(() => document.body.scrollHeight);

      if (currentHeight === previousHeight) {
        // No new content - try a few more times to be sure
        let noChangeCount = 1;
        while (noChangeCount < 3) {
          await sleep(1000);
          currentHeight = await this.page.evaluate(() => document.body.scrollHeight);
          if (currentHeight > previousHeight) break;
          noChangeCount++;
        }

        if (currentHeight === previousHeight) {
          scraperLogger.info('Reached end of infinite scroll');
          break;
        }
      }

      scrollCount++;

      // Random scroll behavior occasionally
      if (Math.random() < 0.2) {
        await randomScroll(this.page);
      }
    }

    return scrollCount;
  }

  /**
   * Handle pagination - URL based
   */
  async goToNextPageUrl(baseUrl: string, pageParam: string = 'page'): Promise<string | null> {
    this.currentPage++;

    const url = new URL(baseUrl);
    url.searchParams.set(pageParam, this.currentPage.toString());

    try {
      await this.navigate(url.toString());
      return url.toString();
    } catch (error) {
      scraperLogger.warn(`Failed to navigate to page ${this.currentPage}`);
      return null;
    }
  }

  /**
   * Get current page number
   */
  getCurrentPage(): number {
    return this.currentPage;
  }

  /**
   * Reset page counter
   */
  resetPageCounter(): void {
    this.currentPage = 1;
  }

  /**
   * Get pagination info from page
   */
  async getPaginationInfo(): Promise<PaginationInfo> {
    const selector = this.config.selectors.paginationInfo;

    if (!selector) {
      return {
        currentPage: this.currentPage,
        totalPages: this.config.pagination.maxPages,
        hasMore: true,
      };
    }

    try {
      const paginationText = await this.page.locator(selector).textContent();

      if (!paginationText) {
        return {
          currentPage: this.currentPage,
          totalPages: this.config.pagination.maxPages,
          hasMore: true,
        };
      }

      // Try to extract page numbers from text like "Page 1 of 10" or "1 / 10"
      const match = paginationText.match(/(\d+)\s*(?:of|\/)\s*(\d+)/i);

      if (match?.[1] && match?.[2]) {
        return {
          currentPage: parseInt(match[1], 10),
          totalPages: parseInt(match[2], 10),
          hasMore: parseInt(match[1], 10) < parseInt(match[2], 10),
        };
      }
    } catch {
      // Ignore parsing errors
    }

    return {
      currentPage: this.currentPage,
      totalPages: this.config.pagination.maxPages,
      hasMore: true,
    };
  }

  /**
   * Check if there are more pages
   */
  async hasMorePages(): Promise<boolean> {
    if (this.currentPage >= this.config.pagination.maxPages) {
      return false;
    }

    const info = await this.getPaginationInfo();
    return info.hasMore;
  }

  /**
   * Get count of products on current page
   */
  private async getProductCount(): Promise<number> {
    return this.page.locator(this.config.selectors.productContainer).count();
  }

  /**
   * Wait for page content to change after pagination
   */
  private async waitForPageChange(previousCount: number): Promise<void> {
    await this.page.waitForFunction(
      ({ selector, count }) => {
        const elements = document.querySelectorAll(selector);
        return elements.length !== count;
      },
      { selector: this.config.selectors.productContainer, count: previousCount },
      { timeout: this.config.requestTimeout }
    );

    // Wait for network to settle
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  /**
   * Random delay between actions
   */
  private async randomDelay(): Promise<void> {
    const { minMs, maxMs } = this.config.delays;
    const delay = minMs + Math.random() * (maxMs - minMs);
    await sleep(Math.floor(delay));
  }

  /**
   * Take screenshot for debugging
   */
  async screenshot(name: string): Promise<Buffer> {
    return this.page.screenshot({
      path: `logs/screenshot-${name}-${Date.now()}.png`,
      fullPage: false,
    });
  }

  /**
   * Get the underlying page instance
   */
  getPage(): Page {
    return this.page;
  }
}

/**
 * Create a page handler instance
 */
export function createPageHandler(options: PageHandlerOptions): PageHandler {
  return new PageHandler(options);
}
