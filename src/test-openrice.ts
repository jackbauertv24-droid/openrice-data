import { chromium } from 'playwright';
import * as fs from 'fs';

async function scrapeOpenRice() {
  console.log('OpenRice Scraper - 銅鑼灣 (Causeway Bay)\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  try {
    console.log('Navigating to OpenRice...');

    const baseUrl = 'https://www.openrice.com/zh/hongkong/restaurants?where=銅鑼灣';
    const allRestaurants: Record<string, unknown>[] = [];
    const seenUrls = new Set<string>();

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Get total restaurants from scrolling toast
    const totalInfo = await page.locator('.scrolling-toast-body').textContent().catch(() => null);
    console.log('Total restaurants available:', totalInfo);

    const maxRestaurants = 250;
    let scrollCount = 0;
    const maxScrolls = 25;
    let lastCount = 0;
    let noNewCount = 0;

    // Infinite scroll loop
    while (allRestaurants.length < maxRestaurants && scrollCount < maxScrolls) {
      scrollCount++;

      await page.waitForSelector('.poi-list-cell', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);

      // Extract restaurants
      const restaurants = await page.evaluate(() => {
        const results: Record<string, unknown>[] = [];
        const cells = document.querySelectorAll('.poi-list-cell');

        cells.forEach((cell) => {
          const nameEl = cell.querySelector('.poi-name');
          const name = nameEl?.textContent?.trim();

          const linkEl = cell.querySelector('a[href*="/r-"]:not([href*="/photos"]):not([href*="/review"])');
          const url = linkEl?.getAttribute('href');

          const titleContainer = cell.querySelector('.poi-list-cell-title');
          const addressEl = titleContainer?.nextElementSibling;
          const address = addressEl?.textContent?.trim();

          const lineInfoLinks = cell.querySelectorAll('.poi-list-cell-line-info-link span:last-child');
          const lineInfo = Array.from(lineInfoLinks).map(el => el.textContent?.trim()).filter(Boolean);

          const district = lineInfo[0] || '';
          const cuisine = lineInfo[1] || '';
          const price = lineInfo[2] || '';

          const statusEl = cell.querySelector('.opening-status');
          const status = statusEl?.textContent?.trim();

          const scoreEl = cell.querySelector('.smile.icon-wrapper .text');
          const score = scoreEl?.textContent?.trim();

          const tagEls = cell.querySelectorAll('.desktop-poi-tag');
          const tags = Array.from(tagEls).map(el => el.textContent?.trim()).filter(Boolean);

          const bookmarkEl = cell.querySelector('.tbb-count');
          const bookmarks = bookmarkEl?.textContent?.trim();

          const img = cell.querySelector('.first-photo-img');
          const imageUrl = img?.getAttribute('src') || img?.getAttribute('data-src');

          if (name && url) {
            results.push({
              name,
              url,
              address,
              district,
              cuisine,
              price,
              status,
              score,
              tags,
              bookmarks,
              imageUrl,
            });
          }
        });

        return results;
      });

      // Add new restaurants (dedupe by URL)
      let newCount = 0;
      for (const r of restaurants) {
        const url = r.url as string;
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          allRestaurants.push(r);
          newCount++;
        }
      }

      const progress = await page.locator('.scrolling-toast-body').textContent().catch(() => '');
      console.log(`Scroll ${scrollCount}: ${restaurants.length} on page, ${newCount} new, total: ${allRestaurants.length} ${progress ? `(${progress})` : ''}`);

      // Check if we're stuck (no new items for 3 consecutive scrolls)
      if (newCount === 0) {
        noNewCount++;
        if (noNewCount >= 3) {
          console.log('No new restaurants for 3 scrolls, stopping.');
          break;
        }
      } else {
        noNewCount = 0;
      }

      // Check if we've reached the end (page count equals current total)
      if (restaurants.length === lastCount && newCount === 0) {
        console.log('Reached end of list.');
        break;
      }
      lastCount = restaurants.length;

      // Scroll down
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }

    console.log(`\n=== Scraping Complete ===`);
    console.log(`Total restaurants scraped: ${allRestaurants.length}`);

    // Show sample
    if (allRestaurants.length > 0) {
      console.log('\nFirst 3 restaurants:');
      console.log(JSON.stringify(allRestaurants.slice(0, 3), null, 2));
    }

    // Save results
    const outputFile = 'output/openrice-causeway-bay.json';
    fs.writeFileSync(outputFile, JSON.stringify(allRestaurants, null, 2));
    console.log(`\nResults saved to ${outputFile}`);

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: 'logs/openrice-error.png' });
  } finally {
    await browser.close();
  }
}

scrapeOpenRice().catch(console.error);
