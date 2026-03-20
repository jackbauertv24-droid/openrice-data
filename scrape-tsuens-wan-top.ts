import { chromium } from 'playwright';
import * as fs from 'fs';

// Top Tsuen Wan Line stations to scrape
const STATIONS_TO_SCRAPE = [
  { name: 'Mong Kok', chinese: '旺角' },
  { name: 'Tsim Sha Tsui', chinese: '尖沙咀' },
  { name: 'Yau Ma Tei', chinese: '油麻地' },
];

interface Restaurant {
  name: string;
  url: string;
  address: string;
  district: string;
  cuisine: string;
  price: string;
  status: string;
  score: string;
  tags: string[];
  bookmarks: string;
  imageUrl: string | null;
  station: string;
  stationChinese: string;
}

const PROGRESS_FILE = 'output/openrice-island-line-progress.json';

function loadExistingData(): Restaurant[] {
  if (fs.existsSync(PROGRESS_FILE)) {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    return data.restaurants || [];
  }
  return [];
}

function saveProgress(restaurants: Restaurant[]) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    totalRestaurants: restaurants.length,
    lastUpdated: new Date().toISOString(),
    restaurants,
  }, null, 2));
}

function deduplicate(restaurants: Restaurant[]): Restaurant[] {
  const unique = new Map<string, Restaurant>();
  for (const r of restaurants) {
    if (!unique.has(r.url)) {
      unique.set(r.url, r);
    }
  }
  return Array.from(unique.values());
}

async function scrapeStation(browser: any, station: { name: string; chinese: string }): Promise<Restaurant[]> {
  console.log(`\n=== Scraping ${station.name} (${station.chinese}) ===`);

  const baseUrl = `https://www.openrice.com/zh/hongkong/restaurants?where=${encodeURIComponent(station.chinese)}`;
  const restaurants: Restaurant[] = [];
  const seenUrls = new Set<string>();

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  try {
    console.log(`URL: ${baseUrl}`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Check if blocked or no results
    const hasResults = await page.locator('.poi-list-cell').count().catch(() => 0);
    if (hasResults === 0) {
      const pageContent = await page.content();
      if (pageContent.includes('blocked') || pageContent.includes('captcha') || pageContent.includes('Access Denied')) {
        console.log(`⚠️  POSSIBLY BLOCKED - no results and suspicious content`);
        await page.screenshot({ path: `logs/block-${station.name.toLowerCase().replace(/ /g, '-')}.png` });
        return restaurants;
      }
      console.log(`No restaurants found for ${station.name}`);
      return restaurants;
    }

    const totalInfo = await page.locator('.scrolling-toast-body').textContent().catch(() => null);
    console.log(`Available: ${totalInfo || 'unknown'}`);

    const maxScrolls = 25;
    let scrollCount = 0;
    let prevCount = 0;
    let stuckCount = 0;

    while (scrollCount < maxScrolls) {
      scrollCount++;

      await page.waitForSelector('.poi-list-cell', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);

      const extracted = await page.evaluate(() => {
        const results: any[] = [];
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
            results.push({ name, url, address, district, cuisine, price, status, score, tags, bookmarks, imageUrl });
          }
        });

        return results;
      });

      let newCount = 0;
      for (const r of extracted) {
        if (r.url && !seenUrls.has(r.url)) {
          seenUrls.add(r.url);
          restaurants.push({
            ...r,
            station: station.name,
            stationChinese: station.chinese,
          });
          newCount++;
        }
      }

      const progress = await page.locator('.scrolling-toast-body').textContent().catch(() => '');
      console.log(`  Scroll ${scrollCount}: +${newCount}, total: ${restaurants.length} ${progress ? `(${progress})` : ''}`);

      const currentDomCount = await page.locator('.poi-list-cell').count();
      if (currentDomCount === prevCount && newCount === 0) {
        stuckCount++;
        if (stuckCount >= 3) {
          console.log(`  Reached end or stuck.`);
          break;
        }
      } else {
        stuckCount = 0;
      }
      prevCount = currentDomCount;

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2500);
    }

    console.log(`  Completed: ${restaurants.length} restaurants`);
  } catch (error) {
    console.error(`  Error: ${error}`);
    await page.screenshot({ path: `logs/error-${station.name.toLowerCase().replace(/ /g, '-')}.png` });
  } finally {
    await context.close();
  }

  return restaurants;
}

async function main() {
  // Load existing data
  const allRestaurants = loadExistingData();
  console.log(`Loaded ${allRestaurants.length} existing restaurants from progress file`);

  // Track which stations are already scraped
  const scrapedStations = new Set(allRestaurants.map(r => r.station));

  // Find stations that need scraping
  const stationsToScrape = STATIONS_TO_SCRAPE.filter(s => !scrapedStations.has(s.name));

  if (stationsToScrape.length === 0) {
    console.log('All specified stations have been scraped!');
    console.log(`Total unique restaurants: ${allRestaurants.length}`);
    process.exit(0);
  }

  console.log(`\nStations to scrape: ${stationsToScrape.map(s => s.name).join(', ')}`);
  console.log(`Current total: ${allRestaurants.length} restaurants\n`);

  const browser = await chromium.launch({ headless: true });

  try {
    for (const station of stationsToScrape) {
      const results = await scrapeStation(browser, station);

      // Merge with existing
      allRestaurants.push(...results);

      // Deduplicate and save after each station
      const unique = deduplicate(allRestaurants);
      saveProgress(unique);

      console.log(`\n  Station ${station.name}: ${results.length} restaurants`);
      console.log(`  Running total: ${unique.length} unique restaurants`);

      // Wait between stations to avoid blocking
      if (stationsToScrape.indexOf(station) < stationsToScrape.length - 1) {
        console.log(`\n  Waiting 5 seconds before next station...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    const unique = deduplicate(allRestaurants);
    console.log(`\n=== Final Summary ===`);
    console.log(`Total unique restaurants: ${unique.length}`);
    console.log(`Data saved to ${PROGRESS_FILE}`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
