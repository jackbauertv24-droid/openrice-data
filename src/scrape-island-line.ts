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

async function scrapeStation(browser: any, station: { name: string; chinese: string }): Promise<Restaurant[]> {
  console.log(`\n=== Scraping ${station.name} (${station.chinese}) ===`);

  const baseUrl = `https://www.openrice.com/zh/hongkong/restaurants?where=${encodeURIComponent(station.chinese)}`;
  const restaurants: Restaurant[] = [];
  const seenUrls = new Set<string>();

  // Create fresh context and page for each station
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Check if page loaded correctly
    const hasResults = await page.locator('.poi-list-cell').count().catch(() => 0);
    if (hasResults === 0) {
      console.log(`No restaurants found for ${station.name}`);
      return restaurants;
    }

    // Get total count
    const totalInfo = await page.locator('.scrolling-toast-body').textContent().catch(() => null);
    console.log(`Available: ${totalInfo || 'unknown'}`);

    const maxScrolls = 25;
    let scrollCount = 0;
    let prevCount = 0;
    let stuckCount = 0;

    while (scrollCount < maxScrolls) {
      scrollCount++;

      await page.waitForSelector('.poi-list-cell', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(800);

      // Get current DOM count
      const currentDomCount = await page.locator('.poi-list-cell').count();

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

      // Check if we're stuck - DOM count unchanged and no new items
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

      // Scroll down and wait for content to load
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2500);
    }

    console.log(`  Completed: ${restaurants.length} restaurants`);
  } catch (error) {
    console.error(`  Error scraping ${station.name}:`, error);
  } finally {
    await context.close();
  }

  return restaurants;
}

async function main() {
  console.log('OpenRice Scraper - Island Line MTR Stations\n');
  console.log(`Stations to scrape: ${ISLAND_LINE_STATIONS.length}`);

  const browser = await chromium.launch({ headless: true });

  const allRestaurants: Restaurant[] = [];
  const startTime = Date.now();

  try {
    for (let i = 0; i < ISLAND_LINE_STATIONS.length; i++) {
      const station = ISLAND_LINE_STATIONS[i]!;
      console.log(`\n[${i + 1}/${ISLAND_LINE_STATIONS.length}] ${station.name}`);

      const results = await scrapeStation(browser, station);
      allRestaurants.push(...results);

      // Delay between stations to avoid rate limiting
      if (i < ISLAND_LINE_STATIONS.length - 1) {
        console.log(`  Waiting 3 seconds before next station...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Save progress after each station
      const progressFile = 'output/openrice-island-line-progress.json';
      fs.writeFileSync(progressFile, JSON.stringify({
        completed: i + 1,
        total: ISLAND_LINE_STATIONS.length,
        totalRestaurants: allRestaurants.length,
        lastStation: station.name,
        restaurants: allRestaurants,
      }, null, 2));
    }

    // Deduplicate across all stations (same restaurant might appear in nearby stations)
    const uniqueRestaurants = new Map<string, Restaurant>();
    for (const r of allRestaurants) {
      if (!uniqueRestaurants.has(r.url)) {
        uniqueRestaurants.set(r.url, r);
      }
    }

    const finalResults = Array.from(uniqueRestaurants.values());

    console.log('\n========================================');
    console.log('SCRAPING COMPLETE');
    console.log('========================================');
    console.log(`Total stations scraped: ${ISLAND_LINE_STATIONS.length}`);
    console.log(`Total restaurant entries: ${allRestaurants.length}`);
    console.log(`Unique restaurants: ${finalResults.length}`);
    console.log(`Duration: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);

    // Save final results
    const outputFile = 'output/openrice-island-line.json';
    fs.writeFileSync(outputFile, JSON.stringify(finalResults, null, 2));
    console.log(`\nResults saved to ${outputFile}`);

    // Summary by station
    console.log('\nSummary by station:');
    const byStation = finalResults.reduce((acc, r) => {
      acc[r.station] = (acc[r.station] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    for (const s of ISLAND_LINE_STATIONS) {
      console.log(`  ${s.name}: ${byStation[s.name] || 0}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
