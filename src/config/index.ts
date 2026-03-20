import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

export interface SelectorConfig {
  productContainer: string;
  productName: string;
  price: string;
  originalPrice?: string;
  description?: string;
  imageUrl: string;
  productUrl: string;
  availability?: string;
  category?: string;
  rating?: string;
  reviewCount?: string;
  nextPage?: string;
  paginationInfo?: string;
}

export interface PaginationConfig {
  type: 'click' | 'scroll' | 'url';
  maxPages: number;
  scrollDelay?: number;
  urlParam?: string;
}

export interface DelayConfig {
  minMs: number;
  maxMs: number;
}

export interface OutputConfig {
  directory: string;
  filenamePattern: string;
}

export interface ProxyConfig {
  enabled: boolean;
  url?: string;
}

export interface ScraperConfig {
  targetUrl: string;
  selectors: SelectorConfig;
  pagination: PaginationConfig;
  delays: DelayConfig;
  output: OutputConfig;
  proxy: ProxyConfig;
  requestTimeout: number;
  logLevel: string;
  scheduleCron: string;
  userAgent?: string;
  viewport: {
    width: number;
    height: number;
  };
}

// Default selectors for common e-commerce patterns
const defaultSelectors: SelectorConfig = {
  productContainer: '[data-product-id], .product-item, .product-card, article[data-testid*="product"]',
  productName: 'h2, h3, .product-name, .product-title, [data-testid*="name"]',
  price: '.price, .product-price, [data-testid*="price"], .current-price',
  originalPrice: '.original-price, .was-price, .old-price, [data-testid*="original"]',
  description: '.description, .product-description, p',
  imageUrl: 'img[src], img[data-src]',
  productUrl: 'a[href]',
  availability: '.availability, .stock, [data-testid*="stock"]',
  category: '.category, .breadcrumb, [data-testid*="category"]',
  rating: '.rating, .stars, [data-testid*="rating"]',
  reviewCount: '.review-count, .reviews, [data-testid*="review"]',
  nextPage: '.next, .pagination-next, a[rel="next"], [aria-label*="next"]',
  paginationInfo: '.pagination, .page-info',
};

// Create configuration from environment
export function createConfig(overrides?: Partial<ScraperConfig>): ScraperConfig {
  return {
    targetUrl: overrides?.targetUrl ?? process.env.TARGET_URL ?? '',
    selectors: overrides?.selectors ?? defaultSelectors,
    pagination: {
      type: overrides?.pagination?.type ?? 'click',
      maxPages: overrides?.pagination?.maxPages ?? parseInt(process.env.MAX_PAGES ?? '10', 10),
      scrollDelay: overrides?.pagination?.scrollDelay ?? 1000,
      urlParam: overrides?.pagination?.urlParam ?? 'page',
    },
    delays: {
      minMs: overrides?.delays?.minMs ?? parseInt(process.env.MIN_DELAY_MS ?? '2000', 10),
      maxMs: overrides?.delays?.maxMs ?? parseInt(process.env.MAX_DELAY_MS ?? '5000', 10),
    },
    output: {
      directory: overrides?.output?.directory ?? process.env.OUTPUT_DIR ?? 'output',
      filenamePattern: overrides?.output?.filenamePattern ?? process.env.FILENAME_PATTERN ?? 'products-{timestamp}.json',
    },
    proxy: {
      enabled: !!process.env.PROXY_URL,
      url: process.env.PROXY_URL,
    },
    requestTimeout: overrides?.requestTimeout ?? parseInt(process.env.REQUEST_TIMEOUT ?? '30000', 10),
    logLevel: overrides?.logLevel ?? process.env.LOG_LEVEL ?? 'info',
    scheduleCron: overrides?.scheduleCron ?? process.env.SCHEDULE_CRON ?? '0 9 * * *',
    userAgent: overrides?.userAgent ?? process.env.USER_AGENT,
    viewport: {
      width: overrides?.viewport?.width ?? parseInt(process.env.VIEWPORT_WIDTH ?? '1920', 10),
      height: overrides?.viewport?.height ?? parseInt(process.env.VIEWPORT_HEIGHT ?? '1080', 10),
    },
  };
}

// Default configuration instance
export const config = createConfig();
