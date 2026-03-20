import { chromium, Browser, BrowserContext, Page, LaunchOptions } from 'playwright';
import { ScraperConfig } from '../config/index.js';
import { applyStealthToPage, applyStealthToContext, StealthConfig } from './stealth.js';
import { scraperLogger } from '../utils/logger.js';

export interface BrowserManagerOptions {
  config: ScraperConfig;
  headless?: boolean;
  stealthConfig?: StealthConfig;
}

export interface PageOptions {
  blockResources?: boolean;
  userAgent?: string;
}

/**
 * Browser Manager - handles browser lifecycle and page creation
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private config: ScraperConfig;
  private headless: boolean;
  private stealthConfig: StealthConfig;
  private activePages: Set<Page> = new Set();

  constructor(options: BrowserManagerOptions) {
    this.config = options.config;
    this.headless = options.headless ?? true;
    this.stealthConfig = options.stealthConfig ?? {};
  }

  /**
   * Launch browser with stealth configuration
   */
  async launch(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }

    const launchOptions: LaunchOptions = {
      headless: this.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    };

    // Add proxy if configured
    if (this.config.proxy.enabled && this.config.proxy.url) {
      launchOptions.proxy = {
        server: this.config.proxy.url,
      };
    }

    scraperLogger.info('Launching browser', { headless: this.headless });

    this.browser = await chromium.launch(launchOptions);

    scraperLogger.info('Browser launched successfully');

    return this.browser;
  }

  /**
   * Create a new browser context with stealth settings
   */
  async createContext(): Promise<BrowserContext> {
    if (!this.browser) {
      await this.launch();
    }

    if (this.context) {
      await this.context.close();
    }

    this.context = await this.browser!.newContext({
      viewport: this.config.viewport,
      userAgent: this.stealthConfig.userAgent ?? this.config.userAgent,
      locale: this.stealthConfig.locale ?? 'en-US',
      timezoneId: this.stealthConfig.timezone ?? 'America/New_York',
      ignoreHTTPSErrors: true,
    });

    // Apply stealth configuration
    await applyStealthToContext(this.context, {
      ...this.stealthConfig,
      viewport: this.config.viewport,
    });

    scraperLogger.debug('Created new browser context with stealth configuration');

    return this.context;
  }

  /**
   * Create a new page with stealth and optional resource blocking
   */
  async createPage(options: PageOptions = {}): Promise<Page> {
    if (!this.context) {
      await this.createContext();
    }

    const page = await this.context!.newPage();

    // Apply stealth evasion scripts
    await applyStealthToPage(page);

    // Set default timeout
    page.setDefaultTimeout(this.config.requestTimeout);
    page.setDefaultNavigationTimeout(this.config.requestTimeout);

    // Block unnecessary resources for faster scraping
    if (options.blockResources !== false) {
      await this.setupResourceBlocking(page);
    }

    // Track active pages
    this.activePages.add(page);

    // Clean up on close
    page.on('close', () => {
      this.activePages.delete(page);
    });

    // Handle console logs
    page.on('console', msg => {
      if (msg.type() === 'error') {
        scraperLogger.debug(`Browser console error: ${msg.text()}`);
      }
    });

    // Handle page errors
    page.on('pageerror', error => {
      scraperLogger.debug(`Page error: ${error.message}`);
    });

    return page;
  }

  /**
   * Setup resource blocking for faster page loads
   */
  private async setupResourceBlocking(page: Page): Promise<void> {
    await page.route('**/*', route => {
      const resourceType = route.request().resourceType();

      // Block images, fonts, stylesheets, and media for faster scraping
      const blockedTypes = ['image', 'font', 'media'];

      if (blockedTypes.includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });
  }

  /**
   * Close all pages except the main one
   */
  async closeExtraPages(): Promise<void> {
    const pages = this.context?.pages() ?? [];

    for (const page of pages.slice(1)) {
      await page.close();
    }
  }

  /**
   * Get current context
   */
  getContext(): BrowserContext | null {
    return this.context;
  }

  /**
   * Get browser instance
   */
  getBrowser(): Browser | null {
    return this.browser;
  }

  /**
   * Check if browser is running
   */
  isRunning(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  /**
   * Close browser and clean up
   */
  async close(): Promise<void> {
    // Close all active pages first
    for (const page of this.activePages) {
      try {
        await page.close();
      } catch {
        // Page might already be closed
      }
    }
    this.activePages.clear();

    // Close context
    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    // Close browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      scraperLogger.info('Browser closed');
    }
  }

  /**
   * Restart browser (useful for session rotation)
   */
  async restart(): Promise<Browser> {
    await this.close();
    return this.launch();
  }

  /**
   * Take a screenshot for debugging
   */
  async screenshot(page: Page, name: string): Promise<Buffer> {
    const screenshot = await page.screenshot({
      path: `logs/screenshot-${name}-${Date.now()}.png`,
      fullPage: false,
    });

    scraperLogger.debug(`Screenshot saved: ${name}`);

    return screenshot;
  }
}

/**
 * Create a browser manager instance
 */
export function createBrowserManager(options: BrowserManagerOptions): BrowserManager {
  return new BrowserManager(options);
}
