import fs from 'fs';
import path from 'path';
import { Product, ScrapingResult } from '../types/product.js';
import { OutputConfig } from '../config/index.js';
import { scraperLogger } from './logger.js';

export interface StorageOptions {
  output: OutputConfig;
}

export class StorageHandler {
  private outputDir: string;
  private filenamePattern: string;

  constructor(options: StorageOptions) {
    this.outputDir = path.resolve(options.output.directory);
    this.filenamePattern = options.output.filenamePattern;

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Generate filename with timestamp
   */
  private generateFilename(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return this.filenamePattern.replace('{timestamp}', timestamp);
  }

  /**
   * Get full filepath for output
   */
  private getFilePath(customFilename?: string): string {
    const filename = customFilename ?? this.generateFilename();
    return path.join(this.outputDir, filename);
  }

  /**
   * Save products to JSON file
   */
  async saveProducts(products: Product[], customFilename?: string): Promise<string> {
    const filepath = this.getFilePath(customFilename);

    const output = {
      scrapedAt: new Date().toISOString(),
      totalProducts: products.length,
      products,
    };

    await fs.promises.writeFile(filepath, JSON.stringify(output, null, 2), 'utf-8');
    scraperLogger.info(`Saved ${products.length} products to ${filepath}`);

    return filepath;
  }

  /**
   * Save full scraping result
   */
  async saveResult(result: ScrapingResult, customFilename?: string): Promise<string> {
    const filepath = this.getFilePath(customFilename);

    await fs.promises.writeFile(filepath, JSON.stringify(result, null, 2), 'utf-8');
    scraperLogger.info(`Saved scraping result to ${filepath}`);

    return filepath;
  }

  /**
   * Append products to existing file or create new one
   */
  async appendProducts(products: Product[], filename: string): Promise<string> {
    const filepath = this.getFilePath(filename);

    let existingProducts: Product[] = [];

    if (fs.existsSync(filepath)) {
      try {
        const content = await fs.promises.readFile(filepath, 'utf-8');
        const data = JSON.parse(content);
        existingProducts = data.products ?? [];
      } catch {
        // File doesn't exist or is invalid, start fresh
        existingProducts = [];
      }
    }

    // Merge products (deduplicate by id)
    const productMap = new Map<string, Product>();

    for (const product of existingProducts) {
      productMap.set(product.id, product);
    }

    for (const product of products) {
      productMap.set(product.id, product);
    }

    const mergedProducts = Array.from(productMap.values());

    await this.saveProducts(mergedProducts, filename);

    return filepath;
  }

  /**
   * Load products from file
   */
  async loadProducts(filename: string): Promise<Product[]> {
    const filepath = this.getFilePath(filename);

    if (!fs.existsSync(filepath)) {
      return [];
    }

    try {
      const content = await fs.promises.readFile(filepath, 'utf-8');
      const data = JSON.parse(content);
      return data.products ?? [];
    } catch (error) {
      scraperLogger.error(`Failed to load products from ${filepath}`, { error });
      return [];
    }
  }

  /**
   * List all output files
   */
  listOutputFiles(): string[] {
    if (!fs.existsSync(this.outputDir)) {
      return [];
    }

    return fs.readdirSync(this.outputDir)
      .filter(file => file.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first
  }

  /**
   * Clear output directory
   */
  async clearOutput(): Promise<void> {
    const files = this.listOutputFiles();

    for (const file of files) {
      const filepath = path.join(this.outputDir, file);
      await fs.promises.unlink(filepath);
    }

    scraperLogger.info(`Cleared ${files.length} files from output directory`);
  }

  /**
   * Get statistics about stored data
   */
  getStats(): { totalFiles: number; totalSize: number } {
    const files = this.listOutputFiles();
    let totalSize = 0;

    for (const file of files) {
      const filepath = path.join(this.outputDir, file);
      const stats = fs.statSync(filepath);
      totalSize += stats.size;
    }

    return {
      totalFiles: files.length,
      totalSize,
    };
  }
}
