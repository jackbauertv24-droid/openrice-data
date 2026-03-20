import { Page, Locator } from 'playwright';
import { ScraperConfig, SelectorConfig } from '../config/index.js';
import { Product, RawProduct, ProductSchema, ScrapingError } from '../types/product.js';
import { scraperLogger } from '../utils/logger.js';

export interface ProductExtractorOptions {
  page: Page;
  config: ScraperConfig;
}

/**
 * Product Extractor - extracts product data from DOM
 */
export class ProductExtractor {
  private page: Page;
  private config: ScraperConfig;
  private selectors: SelectorConfig;

  constructor(options: ProductExtractorOptions) {
    this.page = options.page;
    this.config = options.config;
    this.selectors = options.config.selectors;
  }

  /**
   * Extract all products from current page
   */
  async extractProducts(): Promise<{ products: Product[]; errors: ScrapingError[] }> {
    const products: Product[] = [];
    const errors: ScrapingError[] = [];

    // Wait for product containers to be present
    const containers = await this.page.locator(this.selectors.productContainer).all();

    scraperLogger.info(`Found ${containers.length} product containers`);

    for (let i = 0; i < containers.length; i++) {
      try {
        const container = containers[i];
        if (!container) continue;
        const rawProduct = await this.extractFromContainer(container, i);
        const product = this.validateAndTransform(rawProduct);

        if (product) {
          products.push(product);
          scraperLogger.debug(`Extracted product: ${product.name}`);
        }
      } catch (error) {
        errors.push({
          message: error instanceof Error ? error.message : 'Unknown extraction error',
          selector: this.selectors.productContainer,
        });
        scraperLogger.warn(`Failed to extract product ${i}: ${error}`);
      }
    }

    return { products, errors };
  }

  /**
   * Extract raw product data from a container element
   */
  private async extractFromContainer(container: Locator, index: number): Promise<RawProduct> {
    const raw: RawProduct = {};

    // Extract ID from data attribute or generate from index
    raw.id = await this.extractAttribute(container, '[data-product-id]', 'data-product-id')
      || await this.extractAttribute(container, '[data-id]', 'data-id')
      || `product-${Date.now()}-${index}`;

    // Extract name
    raw.name = await this.extractText(container, this.selectors.productName);

    // Extract price
    const priceText = await this.extractText(container, this.selectors.price);
    raw.price = this.parsePrice(priceText);

    // Extract original price if selector provided
    if (this.selectors.originalPrice) {
      const originalPriceText = await this.extractText(container, this.selectors.originalPrice);
      raw.originalPrice = this.parsePrice(originalPriceText);
    }

    // Extract currency (try to detect from price text or use default)
    raw.currency = this.detectCurrency(priceText) || 'USD';

    // Extract description
    if (this.selectors.description) {
      raw.description = await this.extractText(container, this.selectors.description);
    }

    // Extract image URL
    raw.imageUrl = await this.extractAttribute(container, this.selectors.imageUrl, 'src')
      || await this.extractAttribute(container, this.selectors.imageUrl, 'data-src')
      || undefined;

    // Extract product URL
    const relativeUrl = await this.extractAttribute(container, this.selectors.productUrl, 'href');
    if (relativeUrl) {
      raw.productUrl = this.resolveUrl(relativeUrl);
    }

    // Extract availability
    if (this.selectors.availability) {
      const availabilityText = await this.extractText(container, this.selectors.availability);
      raw.availability = this.parseAvailability(availabilityText);
    } else {
      raw.availability = true; // Assume available by default
    }

    // Extract category
    if (this.selectors.category) {
      raw.category = await this.extractText(container, this.selectors.category);
    }

    // Extract rating
    if (this.selectors.rating) {
      const ratingText = await this.extractText(container, this.selectors.rating);
      raw.rating = this.parseRating(ratingText);
    }

    // Extract review count
    if (this.selectors.reviewCount) {
      const reviewText = await this.extractText(container, this.selectors.reviewCount);
      raw.reviewCount = this.parseReviewCount(reviewText);
    }

    // Add timestamp
    raw.scrapedAt = new Date().toISOString();

    return raw;
  }

  /**
   * Extract text from element within container
   */
  private async extractText(container: Locator, selector: string): Promise<string | undefined> {
    try {
      const element = container.locator(selector).first();
      const text = await element.textContent({ timeout: 1000 });
      return text?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Extract attribute from element within container
   */
  private async extractAttribute(
    container: Locator,
    selector: string,
    attribute: string
  ): Promise<string | undefined> {
    try {
      const element = container.locator(selector).first();
      const value = await element.getAttribute(attribute, { timeout: 1000 });
      return value || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Parse price string to number
   */
  private parsePrice(priceText?: string): number | undefined {
    if (!priceText) return undefined;

    // Remove currency symbols and whitespace
    const cleaned = priceText.replace(/[^0-9.,]/g, '').replace(',', '');

    const price = parseFloat(cleaned);
    return isNaN(price) ? undefined : price;
  }

  /**
   * Detect currency from price text
   */
  private detectCurrency(priceText?: string): string | undefined {
    if (!priceText) return undefined;

    const currencySymbols: Record<string, string> = {
      '$': 'USD',
      '€': 'EUR',
      '£': 'GBP',
      '¥': 'JPY',
      '₹': 'INR',
      'A$': 'AUD',
      'C$': 'CAD',
      'HK$': 'HKD',
      'S$': 'SGD',
    };

    for (const [symbol, code] of Object.entries(currencySymbols)) {
      if (priceText.includes(symbol)) {
        return code;
      }
    }

    // Check for currency codes
    const codeMatch = priceText.match(/\b(USD|EUR|GBP|JPY|INR|AUD|CAD|HKD|SGD)\b/i);
    if (codeMatch?.[1]) {
      return codeMatch[1].toUpperCase();
    }

    return undefined;
  }

  /**
   * Parse availability text
   */
  private parseAvailability(text?: string): boolean {
    if (!text) return true;

    const lowerText = text.toLowerCase();
    const unavailableIndicators = ['out of stock', 'unavailable', 'sold out', 'not available'];

    return !unavailableIndicators.some(indicator => lowerText.includes(indicator));
  }

  /**
   * Parse rating from text
   */
  private parseRating(text?: string): number | undefined {
    if (!text) return undefined;

    // Match patterns like "4.5", "4.5/5", "4.5 stars"
    const match = text.match(/(\d+(?:\.\d+)?)/);
    if (match?.[1]) {
      const rating = parseFloat(match[1]);
      if (rating >= 0 && rating <= 5) {
        return rating;
      }
    }

    return undefined;
  }

  /**
   * Parse review count from text
   */
  private parseReviewCount(text?: string): number | undefined {
    if (!text) return undefined;

    // Remove non-numeric characters except commas
    const cleaned = text.replace(/[^0-9,]/g, '').replace(',', '');
    const count = parseInt(cleaned, 10);

    return isNaN(count) ? undefined : count;
  }

  /**
   * Resolve relative URL to absolute
   */
  private resolveUrl(relativeUrl: string): string {
    try {
      if (relativeUrl.startsWith('http')) {
        return relativeUrl;
      }

      const baseUrl = new URL(this.config.targetUrl);
      return new URL(relativeUrl, baseUrl.origin).toString();
    } catch {
      return relativeUrl;
    }
  }

  /**
   * Validate and transform raw product to Product type
   */
  private validateAndTransform(raw: RawProduct): Product | null {
    try {
      // Check required fields
      if (!raw.name || raw.price === undefined || raw.price === null || !raw.imageUrl || !raw.productUrl) {
        scraperLogger.debug(`Skipping product - missing required fields`, {
          hasName: !!raw.name,
          hasPrice: raw.price !== undefined && raw.price !== null,
          hasImage: !!raw.imageUrl,
          hasUrl: !!raw.productUrl,
        });
        return null;
      }

      // Ensure imageUrl is valid URL
      let imageUrl = raw.imageUrl;
      if (!imageUrl.startsWith('http')) {
        imageUrl = this.resolveUrl(imageUrl);
      }

      // Ensure productUrl is valid URL
      let productUrl = raw.productUrl;
      if (!productUrl.startsWith('http')) {
        productUrl = this.resolveUrl(productUrl);
      }

      // Convert price to number if string
      const price = typeof raw.price === 'string' ? parseFloat(raw.price) : raw.price;

      const product: Product = {
        id: raw.id ?? '',
        name: raw.name,
        price: price,
        currency: raw.currency ?? 'USD',
        originalPrice: typeof raw.originalPrice === 'string' ? parseFloat(raw.originalPrice) : raw.originalPrice ?? undefined,
        description: raw.description ?? undefined,
        imageUrl: imageUrl,
        productUrl: productUrl,
        availability: typeof raw.availability === 'boolean' ? raw.availability : true,
        category: raw.category ?? undefined,
        rating: typeof raw.rating === 'string' ? parseFloat(raw.rating) : raw.rating ?? undefined,
        reviewCount: typeof raw.reviewCount === 'string' ? parseInt(raw.reviewCount, 10) : raw.reviewCount ?? undefined,
        scrapedAt: raw.scrapedAt ?? new Date().toISOString(),
      };

      // Validate with Zod schema
      return ProductSchema.parse(product);
    } catch (error) {
      scraperLogger.warn(`Product validation failed: ${error}`);
      return null;
    }
  }

  /**
   * Extract products using custom selectors
   */
  async extractWithCustomSelectors(customSelectors: Partial<SelectorConfig>): Promise<{
    products: Product[];
    errors: ScrapingError[];
  }> {
    const originalSelectors = { ...this.selectors };
    Object.assign(this.selectors, customSelectors);

    try {
      return await this.extractProducts();
    } finally {
      this.selectors = originalSelectors;
    }
  }

  /**
   * Test selectors on current page
   */
  async testSelectors(): Promise<{
    containerCount: number;
    sampleProducts: RawProduct[];
    selectorResults: Record<string, { found: boolean; sample?: string }>;
  }> {
    const containerCount = await this.page.locator(this.selectors.productContainer).count();
    const sampleProducts: RawProduct[] = [];
    const selectorResults: Record<string, { found: boolean; sample?: string }> = {};

    // Test each selector
    const selectorsToTest: (keyof SelectorConfig)[] = [
      'productName',
      'price',
      'imageUrl',
      'productUrl',
    ];

    for (const key of selectorsToTest) {
      const selector = this.selectors[key];
      if (!selector) continue;

      try {
        const element = this.page.locator(selector).first();
        const count = await element.count();
        if (count > 0) {
          const sample = await element.textContent({ timeout: 1000 });
          selectorResults[key] = { found: true, sample: sample?.trim() };
        } else {
          selectorResults[key] = { found: false };
        }
      } catch {
        selectorResults[key] = { found: false };
      }
    }

    // Extract sample products
    if (containerCount > 0) {
      const containers = await this.page.locator(this.selectors.productContainer).all();
      const sampleCount = Math.min(3, containers.length);

      for (let i = 0; i < sampleCount; i++) {
        try {
          const container = containers[i];
          if (!container) continue;
          const raw = await this.extractFromContainer(container, i);
          sampleProducts.push(raw);
        } catch {
          // Ignore errors for sample extraction
        }
      }
    }

    return {
      containerCount,
      sampleProducts,
      selectorResults,
    };
  }
}

/**
 * Create a product extractor instance
 */
export function createProductExtractor(options: ProductExtractorOptions): ProductExtractor {
  return new ProductExtractor(options);
}
