import { BrowserContext, Page } from 'playwright';
import { scraperLogger } from '../utils/logger.js';

// Realistic user agents
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

// Common viewport sizes
const viewports = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
];

// Common locales and timezones
const locales = ['en-US', 'en-GB', 'en-CA'];
const timezones = ['America/New_York', 'America/Los_Angeles', 'Europe/London'];

export interface StealthConfig {
  userAgent?: string;
  viewport?: { width: number; height: number };
  locale?: string;
  timezone?: string;
}

/**
 * Get a random element from an array
 */
function randomChoice<T>(arr: T[]): T {
  const index = Math.floor(Math.random() * arr.length);
  return arr[index]!;
}

/**
 * Generate random viewport with slight variations
 */
function randomizeViewport(base?: { width: number; height: number }): { width: number; height: number } {
  const baseViewport = base ?? randomChoice(viewports);
  // Add slight randomization (±5%)
  const widthVariation = Math.floor(baseViewport.width * (0.95 + Math.random() * 0.1));
  const heightVariation = Math.floor(baseViewport.height * (0.95 + Math.random() * 0.1));
  return { width: widthVariation, height: heightVariation };
}

/**
 * Get stealth configuration with randomization
 */
export function getStealthConfig(overrides: StealthConfig = {}): Required<StealthConfig> {
  return {
    userAgent: overrides.userAgent ?? randomChoice(userAgents),
    viewport: randomizeViewport(overrides.viewport),
    locale: overrides.locale ?? randomChoice(locales),
    timezone: overrides.timezone ?? randomChoice(timezones),
  };
}

/**
 * Apply stealth evasion scripts to a page
 */
export async function applyStealthToPage(page: Page): Promise<void> {
  // Hide webdriver property
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  // Hide automation indicators
  await page.addInitScript(() => {
    // Remove Chrome automation flag
    // @ts-expect-error - Removing property from window
    delete window.__nightmare;
    // @ts-expect-error - Removing property from window
    delete window._phantom;
    // @ts-expect-error - Removing property from window
    delete window._selenium;
    // @ts-expect-error - Removing property from window
    delete window.callPhantom;
    // @ts-expect-error - Removing property from window
    delete window.callSelenium;
    // @ts-expect-error - Removing property from window
    delete window.spawn;
  });

  // Mock plugins
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ],
    });
  });

  // Mock languages
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  });

  // Mock hardwareConcurrency (CPU cores)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
    });
  });

  // Mock deviceMemory
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
    });
  });

  // Hide Playwright-specific properties
  await page.addInitScript(() => {
    // @ts-expect-error - Removing property from window
    delete window.__playwright;
    // @ts-expect-error - Removing property from window
    delete window.__pw_manual;
    // @ts-expect-error - Removing property from window
    delete window.__PW_inspect;
  });

  // Mock permissions
  await page.addInitScript(() => {
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);
  });

  // Mock WebGL vendor and renderer
  await page.addInitScript(() => {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };
  });

  // Mock Chrome runtime
  await page.addInitScript(() => {
    // @ts-expect-error - Adding property to window
    window.chrome = {
      runtime: {},
    };
  });

  // Prevent iframe content window detection
  await page.addInitScript(() => {
    const originalContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get: function () {
        const result = originalContentWindow?.get?.call(this);
        if (result) {
          Object.defineProperty(result.navigator, 'webdriver', { get: () => undefined });
        }
        return result;
      },
    });
  });

  scraperLogger.debug('Applied stealth scripts to page');
}

/**
 * Apply stealth to a browser context
 * Note: timezone, locale, userAgent, and viewport should be set when creating the context
 * This function adds HTTP headers that help with stealth
 */
export async function applyStealthToContext(context: BrowserContext, config: StealthConfig = {}): Promise<void> {
  const stealthConfig = getStealthConfig(config);

  await context.setExtraHTTPHeaders({
    'Accept-Language': `${stealthConfig.locale},en;q=0.9`,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
  });

  scraperLogger.debug('Applied stealth configuration to context', {
    userAgent: stealthConfig.userAgent,
    viewport: stealthConfig.viewport,
    locale: stealthConfig.locale,
    timezone: stealthConfig.timezone,
  });
}

/**
 * Human-like mouse movement
 */
export async function humanMouseMove(page: Page, targetX: number, targetY: number): Promise<void> {
  // Get current mouse position (approximate)
  const steps = 10 + Math.floor(Math.random() * 10);

  // Generate bezier-like curve points
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    // Add some randomness to the path
    const jitterX = (Math.random() - 0.5) * 10;
    const jitterY = (Math.random() - 0.5) * 10;

    const x = Math.round(targetX * progress + jitterX);
    const y = Math.round(targetY * progress + jitterY);

    await page.mouse.move(Math.max(0, x), Math.max(0, y));
    await sleep(10 + Math.random() * 20);
  }
}

/**
 * Human-like click
 */
export async function humanClick(page: Page, selector: string): Promise<void> {
  const element = await page.waitForSelector(selector, { state: 'visible' });
  const box = await element.boundingBox();

  if (!box) {
    throw new Error(`Element ${selector} not visible`);
  }

  // Add randomness to click position within element
  const x = box.x + box.width * (0.2 + Math.random() * 0.6);
  const y = box.y + box.height * (0.2 + Math.random() * 0.6);

  await humanMouseMove(page, x, y);
  await sleep(50 + Math.random() * 100);

  await page.mouse.down();
  await sleep(50 + Math.random() * 50);
  await page.mouse.up();

  // Small delay after click
  await sleep(100 + Math.random() * 200);
}

/**
 * Human-like typing
 */
export async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await page.click(selector);

  for (const char of text) {
    await page.keyboard.type(char, { delay: 50 + Math.random() * 100 });
  }
}

/**
 * Random scroll behavior
 */
export async function randomScroll(page: Page): Promise<void> {
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewportHeight = await page.evaluate(() => window.innerHeight);

  // Scroll a random amount
  const scrollAmount = Math.min(
    viewportHeight * (0.5 + Math.random()),
    scrollHeight - viewportHeight
  );

  await page.evaluate((amount) => {
    window.scrollTo({
      top: amount,
      behavior: 'smooth',
    });
  }, scrollAmount);

  await sleep(500 + Math.random() * 500);
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
