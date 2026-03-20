import { chromium } from 'playwright';
import * as fs from 'fs';

// Island Line MTR stations (Hong Kong Island)
const ISLAND_LINE_STATIONS = [
  { name: 'Kennedy Town', chinese: '堅尼地城' },
  { name: 'HKU', chinese: '香港大學' },
  { name: 'Sai Ying Pun', chinese: '西營盤' },
  { name: 'Sheung Wan', chinese: '上環' },
  { name: 'Central', chinese: '中環' },
  { name: 'Admiralty', chinese: '金鐘' },
  { name: 'Wan Chai', chinese: '灣仔' },
  { name: 'Causeway Bay', chinese: '銅鑼灣' },
  { name: 'Tin Hau', chinese: '天后' },
  { name: 'Fortress Hill', chinese: '炮台山' },
  { name: 'North Point', chinese: '北角' },
  { name: 'Quarry Bay', chinese: '鰂魚涌' },
  { name: 'Tai Koo', chinese: '太古' },
  { name: 'Sai Wan Ho', chinese: '西灣河' },
  { name: 'Shau Kei Wan', chinese: '筲箕灣' },
  { name: 'Heng Fa Chuen', chinese: '杏花邨' },
  { name: 'Chai Wan', chinese: '柴灣' },
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
const OUTPUT_FILE = 'output/openrice-island-line.json';

function loadExistingData(): Restaurant[] {
  if (fs.existsSync(PROGRESS_FILE)) {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    return data.restaurants || [];
  }
  return [];
}

function saveProgress(restaurants: Restaurant[], stationIndex: number) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    completed: stationIndex + 1,
    total: ISLAND_LINE_STATIONS.length,
    totalRestaurants: restaurants.length,
    lastStation: ISLAND_LINE_STATIONS[stationIndex]?.name || 'unknown',
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
      // Check for block page
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

    const maxScrolls = 20;
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
  const args = process.argv.slice(2);
  const stationArg = args[0];

  // Load existing data
  const allRestaurants = loadExistingData();
  console.log(`Loaded ${allRestaurants.length} existing restaurants from progress file`);

  // Determine which station(s) to scrape
  let stationsToScrape: { station: typeof ISLAND_LINE_STATIONS[0], index: number }[] = [];

  if (stationArg) {
    // Specific station requested
    const idx = ISLAND_LINE_STATIONS.findIndex(s =>
      s.name.toLowerCase() === stationArg.toLowerCase() ||
      s.chinese === stationArg
    );
    if (idx === -1) {
      console.log(`Station "${stationArg}" not found. Available stations:`);
      ISLAND_LINE_STATIONS.forEach((s, i) => console.log(`  ${i + 1}. ${s.name} (${s.chinese})`));
      process.exit(1);
    }
    stationsToScrape = [{ station: ISLAND_LINE_STATIONS[idx]!, index: idx }];
  } else {
    // Find next station that hasn't been scraped (has no restaurants)
    const scrapedStations = new Set(allRestaurants.map(r => r.station));
    const nextStation = ISLAND_LINE_STATIONS.findIndex(s => !scrapedStations.has(s.name));

    if (nextStation === -1) {
      console.log('All stations have been scraped!');
      console.log(`Total unique restaurants: ${allRestaurants.length}`);
      process.exit(0);
    }

    stationsToScrape = [{ station: ISLAND_LINE_STATIONS[nextStation]!, index: nextStation }];
    console.log(`Next station to scrape: ${ISLAND_LINE_STATIONS[nextStation]!.name}`);
  }

  console.log(`\nWill scrape: ${stationsToScrape[0]!.station.name} (${stationsToScrape[0]!.station.chinese})`);
  console.log(`Current total: ${allRestaurants.length} restaurants\n`);

  const browser = await chromium.launch({ headless: true });

  try {
    const { station, index } = stationsToScrape[0]!;
    const results = await scrapeStation(browser, station);

    // Merge with existing (preserve old data)
    allRestaurants.push(...results);

    // Deduplicate
    const unique = deduplicate(allRestaurants);

    // Save progress
    saveProgress(unique, index);

    console.log(`\n=== Summary ===`);
    console.log(`New from this station: ${results.length}`);
    console.log(`Total unique restaurants: ${unique.length}`);
    console.log(`Progress saved to ${PROGRESS_FILE}`);

    // Show what's next
    const scrapedStations = new Set(unique.map(r => r.station));
    const remaining = ISLAND_LINE_STATIONS.filter(s => !scrapedStations.has(s.name));
    if (remaining.length > 0) {
      console.log(`\nRemaining stations: ${remaining.length}`);
      console.log(`Next: ${remaining[0]!.name} (${remaining[0]!.chinese})`);
    }

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
