# OpenRice Scraper Progress

## Project Overview

Web scraper for OpenRice Hong Kong restaurant data using Playwright with anti-detection features.

## Current Status: BLOCKED

OpenRice has blocked the server IP address. All requests return `content-length: 0`.

```
x-request-ip: 49.51.182.223
content-length: 0
```

## Successful Scraping Results

### Single Station: Causeway Bay (銅鑼灣)
- **Date:** 2026-03-19
- **Restaurants scraped:** 240
- **File:** `output/openrice-causeway-bay.json` (⚠️ overwritten by later failed runs)

### Island Line MTR Stations (Partial)
- **Date:** 2026-03-19
- **Duration:** 10.3 minutes
- **Total entries:** 1,411
- **Unique restaurants:** 1,346

| Station | Chinese | Count | Status |
|---------|---------|-------|--------|
| Kennedy Town | 堅尼地城 | 225 | ✅ Full |
| HKU | 香港大學 | 240 | ✅ Full |
| Sai Ying Pun | 西營盤 | 223 | ✅ Full |
| Sheung Wan | 上環 | 254 | ✅ Full |
| Central | 中環 | 30 | ⚠️ Partial |
| Admiralty | 金鐘 | 225 | ✅ Full |
| Wan Chai | 灣仔 | 5 | ❌ Failed |
| Causeway Bay | 銅鑼灣 | 15 | ❌ Failed |
| Tin Hau | 天后 | 15 | ❌ Failed |
| Fortress Hill | 炮台山 | 15 | ❌ Failed |
| North Point | 北角 | 10 | ❌ Failed |
| Quarry Bay | 鰂魚涌 | 15 | ❌ Failed |
| Tai Koo | 太古 | 15 | ❌ Failed |
| Sai Wan Ho | 西灣河 | 15 | ❌ Failed |
| Shau Kei Wan | 筲箕灣 | 15 | ❌ Failed |
| Heng Fa Chuen | 杏花邨 | 15 | ❌ Failed |
| Chai Wan | 柴灣 | 14 | ❌ Failed |

## Technical Findings

### OpenRice Website Structure
- **Pagination:** Infinite scroll (not click-based)
- **Restaurant container:** `.poi-list-cell`
- **Items per scroll:** 15 restaurants
- **Progress indicator:** `.scrolling-toast-body` (shows "X / 250")

### Data Fields Extracted
```typescript
interface Restaurant {
  name: string;           // .poi-name
  url: string;            // a[href*="/r-"]
  address: string;        // sibling of .poi-list-cell-title
  district: string;       // .poi-list-cell-line-info-link (1st)
  cuisine: string;        // .poi-list-cell-line-info-link (2nd)
  price: string;          // .poi-list-cell-line-info-link (3rd)
  status: string;         // .opening-status
  score: string;          // .smile.icon-wrapper .text
  tags: string[];         // .desktop-poi-tag[]
  bookmarks: string;      // .tbb-count
  imageUrl: string | null; // .first-photo-img (NOT WORKING)
}
```

### Issues Identified

1. **Image URL extraction broken** - All `imageUrl` values are null. The selector `.first-photo-img` exists but `src`/`data-src` attributes not captured correctly.

2. **Scroll timing issues** - Later stations (7-17) failed to load new content. Possible causes:
   - Rate limiting kicked in mid-session
   - Browser context reused across stations
   - Insufficient wait time between scrolls

3. **Data overwrite bug** - Progress file overwrites previous data instead of preserving it.

## Files

| File | Purpose |
|------|---------|
| `src/test-openrice.ts` | Single station scraper (working) |
| `src/scrape-island-line.ts` | Multi-station scraper (needs fix) |
| `output/openrice-causeway-bay.json` | Results (currently empty due to block) |
| `output/openrice-island-line.json` | Results (currently empty due to block) |
| `logs/openrice-homepage.png` | Screenshot from successful run |

## Island Line MTR Stations (Target List)

```typescript
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
```

## Next Steps

1. **Wait for IP unblock** - Try again later to see if block is temporary
2. **Fix image extraction** - Debug `.first-photo-img` selector
3. **Fix scroll timing** - Increase wait time or use fresh browser context per station
4. **Prevent data overwrite** - Save each station to separate file, never overwrite existing files
5. **Consider proxy** - If block persists, may need residential proxy or VPN

## How to Resume

```bash
# Test if block is lifted
curl -I "https://www.openrice.com/zh/hongkong/restaurants?where=銅鑼灣"

# If response has content-length > 0, run scraper
npx ts-node src/scrape-island-line.ts
```
