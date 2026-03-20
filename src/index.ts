import { config, createConfig, ScraperConfig } from './config/index.js';
import { BrowserManager, createBrowserManager } from './scraper/browser.js';
import { PageHandler, createPageHandler } from './scraper/page.js';
import { ProductExtractor, createProductExtractor } from './scraper/products.js';
import { StorageHandler } from './utils/storage.js';
import { scraperLogger } from './utils/logger.js';
import { Product, ScrapingResult, ScrapingError } from './types/product.js';
import { sleep } from './utils/retry.js';
import cron from 'node-cron';

export interface ScraperOptions {
  config?: Partial<ScraperConfig>;
  headless?: boolean;
}

/**
 * Main Scraper class - orchestrates all components
 */
export class Scraper {
  private config: ScraperConfig;
  private browserManager: BrowserManager | null = null;
  private storage: StorageHandler;
  private headless: boolean;

  constructor(options: ScraperOptions = {}) {
    this.config = createConfig(options.config);
    this.headless = options.headless ?? true;
    this.storage = new StorageHandler({ output: this.config.output });
  }

  /**
   * Initialize the scraper
   */
  async init(): Promise<void> {
    scraperLogger.info('Initializing scraper');

    this.browserManager = createBrowserManager({
      config: this.config,
      headless: this.headless,
      stealthConfig: {
        userAgent: this.config.userAgent,
        viewport: this.config.viewport,
      },
    });

    await this.browserManager.launch();
  }

  /**
   * Run the scraper once
   */
  async scrape(): Promise<ScrapingResult> {
    const startTime = Date.now();
    const errors: ScrapingError[] = [];
    const allProducts: Product[] = [];
    let totalPages = 0;

    if (!this.browserManager) {
      await this.init();
    }

    try {
      const page = await this.browserManager!.createPage();
      const pageHandler = createPageHandler({ page, config: this.config });
      const extractor = createProductExtractor({ page, config: this.config });

      // Navigate to target URL
      await pageHandler.navigate(this.config.targetUrl, {
        waitForSelector: this.config.selectors.productContainer,
      });

      // Handle pagination based on type
      const paginationType = this.config.pagination.type;
      let hasMorePages = true;

      while (hasMorePages && totalPages < this.config.pagination.maxPages) {
        totalPages++;
        scraperLogger.pageStart(page.url(), totalPages);

        // Wait for products to load
        await extractor.extractProducts().then(({ products, errors: pageErrors }) => {
          allProducts.push(...products);
          errors.push(...pageErrors);
          scraperLogger.pageComplete(totalPages, products.length);
        });

        // Check for more pages
        if (paginationType === 'click') {
          hasMorePages = await pageHandler.goToNextPageClick();
        } else if (paginationType === 'scroll') {
          const scrollResult = await pageHandler.scrollToLoadMore();
          hasMorePages = scrollResult > 0;
          // Infinite scroll loads all products in one session
          break;
        } else if (paginationType === 'url') {
          const nextUrl = await pageHandler.goToNextPageUrl(
            this.config.targetUrl,
            this.config.pagination.urlParam
          );
          hasMorePages = nextUrl !== null;
        }
      }

      await page.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ message, url: this.config.targetUrl });
      scraperLogger.error(`Scraping failed: ${message}`);
    }

    const duration = Date.now() - startTime;
    scraperLogger.scrapingComplete(allProducts.length, totalPages, duration);

    return {
      success: errors.length === 0 || allProducts.length > 0,
      products: allProducts,
      totalPages,
      errors,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Run scraper and save results
   */
  async scrapeAndSave(): Promise<string> {
    const result = await this.scrape();
    const filepath = await this.storage.saveResult(result);

    scraperLogger.info(`Results saved to ${filepath}`);

    return filepath;
  }

  /**
   * Test selectors on target page
   */
  async testSelectors(): Promise<{
    containerCount: number;
    sampleProducts: unknown[];
    selectorResults: Record<string, { found: boolean; sample?: string }>;
  }> {
    if (!this.browserManager) {
      await this.init();
    }

    const page = await this.browserManager!.createPage({ blockResources: false });

    try {
      await page.goto(this.config.targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.requestTimeout,
      });

      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      const extractor = createProductExtractor({ page, config: this.config });
      const results = await extractor.testSelectors();

      return {
        containerCount: results.containerCount,
        sampleProducts: results.sampleProducts,
        selectorResults: results.selectorResults,
      };
    } finally {
      await page.close();
    }
  }

  /**
   * Close the scraper
   */
  async close(): Promise<void> {
    if (this.browserManager) {
      await this.browserManager.close();
      this.browserManager = null;
    }
  }
}

/**
 * Create a scraper instance
 */
export function createScraper(options?: ScraperOptions): Scraper {
  return new Scraper(options);
}

/**
 * Schedule scraping with cron
 */
export function scheduleScraping(
  cronExpression: string,
  options?: ScraperOptions,
  callback?: (result: ScrapingResult) => void | Promise<void>
): cron.ScheduledTask {
  scraperLogger.info(`Scheduling scraper with cron: ${cronExpression}`);

  return cron.schedule(cronExpression, async () => {
    scraperLogger.info('Starting scheduled scrape');

    const scraper = createScraper(options);

    try {
      const result = await scraper.scrape();

      if (callback) {
        await callback(result);
      }

      // Save results
      const storage = new StorageHandler({ output: config.output });
      await storage.saveResult(result);
    } catch (error) {
      scraperLogger.error(`Scheduled scrape failed: ${error}`);
    } finally {
      await scraper.close();
    }
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse command line arguments
  const isScheduleMode = args.includes('--schedule');
  const isTestMode = args.includes('--test-selectors');
  const headless = !args.includes('--headed');

  const scraper = createScraper({ headless });

  try {
    if (isTestMode) {
      // Test selectors mode
      scraperLogger.info('Running in selector test mode');
      const results = await scraper.testSelectors();

      console.log('\n=== Selector Test Results ===\n');
      console.log(`Product containers found: ${results.containerCount}\n`);
      console.log('Selector Results:');

      for (const [key, value] of Object.entries(results.selectorResults)) {
        console.log(`  ${key}: ${value.found ? '✓' : '✗'}`);
        if (value.sample) {
          console.log(`    Sample: "${value.sample.substring(0, 50)}..."`);
        }
      }

      console.log('\nSample Products:');
      console.log(JSON.stringify(results.sampleProducts, null, 2));
    } else if (isScheduleMode) {
      // Scheduled mode
      scraperLogger.info('Starting in scheduled mode');

      const task = scheduleScraping(config.scheduleCron, { headless }, (result) => {
        scraperLogger.info(`Scheduled scrape complete: ${result.products.length} products`);
      });

      // Keep process running
      console.log(`Scheduler running with cron: ${config.scheduleCron}`);
      console.log('Press Ctrl+C to stop');

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\nStopping scheduler...');
        task.stop();
        await scraper.close();
        process.exit(0);
      });
    } else {
      // Single run mode
      scraperLogger.info('Running in single-run mode');

      const filepath = await scraper.scrapeAndSave();

      console.log(`\nScraping complete! Results saved to: ${filepath}`);
    }
  } catch (error) {
    scraperLogger.error(`Fatal error: ${error}`);
    process.exit(1);
  } finally {
    if (!isScheduleMode) {
      await scraper.close();
    }
  }
}

// Run main if this is the entry point
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
