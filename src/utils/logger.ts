import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const logsDir = path.join(process.cwd(), 'logs');

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `[${timestamp}] ${level}: ${message} ${metaStr}`;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.json()
);

// Create logger instance
export function createLogger(level: string = 'info'): winston.Logger {
  return winston.createLogger({
    level,
    transports: [
      // Console transport
      new winston.transports.Console({
        format: consoleFormat,
      }),
      // File transport for all logs
      new winston.transports.File({
        filename: path.join(logsDir, 'scraper.log'),
        format: fileFormat,
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
      // File transport for errors only
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        format: fileFormat,
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
    ],
  });
}

// Default logger instance
export const logger = createLogger(process.env.LOG_LEVEL ?? 'info');

// Scraper-specific logging helpers
export const scraperLogger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    logger.info(message, meta);
  },

  warn: (message: string, meta?: Record<string, unknown>) => {
    logger.warn(message, meta);
  },

  error: (message: string, meta?: Record<string, unknown>) => {
    logger.error(message, meta);
  },

  debug: (message: string, meta?: Record<string, unknown>) => {
    logger.debug(message, meta);
  },

  // Scraping-specific log methods
  pageStart: (url: string, pageNum: number) => {
    logger.info(`Starting to scrape page ${pageNum}`, { url });
  },

  pageComplete: (pageNum: number, productsFound: number) => {
    logger.info(`Page ${pageNum} complete`, { productsFound });
  },

  productExtracted: (productName: string) => {
    logger.debug(`Product extracted: ${productName}`);
  },

  selectorFailed: (selector: string, context: string) => {
    logger.warn(`Selector failed: ${selector}`, { context });
  },

  retry: (attempt: number, maxAttempts: number, error: string) => {
    logger.warn(`Retry attempt ${attempt}/${maxAttempts}`, { error });
  },

  scrapingComplete: (totalProducts: number, totalPages: number, duration: number) => {
    logger.info(`Scraping complete`, {
      totalProducts,
      totalPages,
      duration: `${(duration / 1000).toFixed(2)}s`
    });
  },
};
