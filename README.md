# OpenRice Web Scraper

A Node.js web scraper for JavaScript-heavy e-commerce websites with anti-detection features.

## Features

- **Playwright-based**: Handles dynamic content (SPA/React/Vue) with ease
- **Anti-detection**: User agent rotation, viewport randomization, human-like behavior
- **Multiple pagination strategies**: Click-based, infinite scroll, URL-based
- **Data validation**: Zod schemas for robust product data validation
- **Scheduled scraping**: Cron-based recurring jobs
- **Configurable**: Environment variables and programmatic configuration

## Quick Start

```bash
# Install dependencies
npm install

# Run scraper once
npm run scrape

# Start scheduled scraping
npm run schedule

# Test selectors
npm run test:select
```

## Configuration

Copy `.env.example` to `.env` and configure:

```env
# Target Website
TARGET_URL=https://example-shop.com/products

# Pagination
MAX_PAGES=10
MIN_DELAY_MS=2000
MAX_DELAY_MS=5000

# Output
OUTPUT_DIR=output
FILENAME_PATTERN=products-{timestamp}.json
```

## Project Structure

```
src/
├── index.ts              # Entry point
├── scraper/
│   ├── browser.ts        # Browser lifecycle management
│   ├── page.ts           # Navigation & pagination
│   ├── stealth.ts        # Anti-detection
│   └── products.ts       # Data extraction
├── utils/
│   ├── logger.ts         # Winston logging
│   ├── storage.ts        # JSON file output
│   └── retry.ts          # Retry with backoff
├── types/
│   └── product.ts        # TypeScript types & Zod schemas
└── config/
    └── index.ts          # Configuration management
```

## Usage Examples

### Basic Usage

```typescript
import { createScraper } from './src/index.js';

const scraper = createScraper({
  config: {
    targetUrl: 'https://example-shop.com/products',
    pagination: { type: 'click', maxPages: 5 },
  },
});

const result = await scraper.scrape();
console.log(`Scraped ${result.products.length} products`);
await scraper.close();
```

### Custom Selectors

```typescript
const scraper = createScraper({
  config: {
    targetUrl: 'https://shop.example.com',
    selectors: {
      productContainer: '.product-card',
      productName: 'h3.title',
      price: '.price-current',
      imageUrl: 'img.product-image',
      productUrl: 'a.product-link',
    },
  },
});
```

### Scheduled Scraping

```typescript
import { scheduleScraping } from './src/index.js';

const task = scheduleScraping('0 9 * * *', {}, (result) => {
  console.log(`Scraped ${result.products.length} products`);
});

// Stop scheduler
task.stop();
```

### Testing Selectors

```typescript
const scraper = createScraper();
const results = await scraper.testSelectors();

console.log(`Found ${results.containerCount} product containers`);
console.log('Selector results:', results.selectorResults);
```

## Pagination Strategies

### Click-Based
Clicks a "Next" button to navigate pages. Best for traditional pagination.

```typescript
pagination: { type: 'click', maxPages: 10 }
```

### Infinite Scroll
Scrolls down to load more products. Best for endless feed layouts.

```typescript
pagination: { type: 'scroll', maxPages: 1 }
```

### URL-Based
Modifies URL parameters directly. Fast but requires URL pattern knowledge.

```typescript
pagination: { type: 'url', maxPages: 10, urlParam: 'page' }
```

## Product Data Schema

```typescript
interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  originalPrice?: number;
  description?: string;
  imageUrl: string;
  productUrl: string;
  availability: boolean;
  category?: string;
  rating?: number;
  reviewCount?: number;
  scrapedAt: string;
}
```

## Anti-Detection Features

- User agent rotation with realistic browser fingerprints
- Viewport randomization
- Webdriver property hiding
- Human-like mouse movements and scrolling
- Random delays between actions
- Request header normalization

## Logging

Logs are written to both console and files:

- `logs/scraper.log` - All logs
- `logs/error.log` - Errors only

Configure log level with `LOG_LEVEL=debug|info|warn|error`.

## Commands

| Command | Description |
|---------|-------------|
| `npm run scrape` | Run scraper once |
| `npm run schedule` | Start cron scheduler |
| `npm run dev` | Run with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run clean` | Clear output directory |
| `npm run test:select` | Test selectors interactively |

## License

MIT
