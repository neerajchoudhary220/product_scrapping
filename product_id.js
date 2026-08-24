const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DEFAULT_AUTH = path.join(__dirname, "auth.json");

function resolveDataPath(filename) {
  if (!filename) return path.join(DATA_DIR, "product_2.json");
  if (path.isAbsolute(filename)) return filename;
  // If path already starts with data/, resolve relative to __dirname, else relative to DATA_DIR
  if (filename.startsWith("data/") || filename.startsWith("data\\")) {
    return path.join(__dirname, filename);
  }
  return path.join(DATA_DIR, filename);
}

/**
 * Scrape Product IDs from a given category URL
 */
async function scrapeProductIds(options = {}, onLog = console.log, onProgress = () => {}, shouldStop = () => false) {
  const {
    link = "https://wukusy.app/dropshiper/category/3?page=2",
    outputFile = "product_2.json",
    headless = true,
    authFile = DEFAULT_AUTH
  } = options;

  const targetOutputFile = resolveDataPath(outputFile);
  const targetAuthFile = path.isAbsolute(authFile) ? authFile : path.join(__dirname, authFile);

  const log = (msg, type = 'info') => {
    if (typeof onLog === 'function') onLog(msg, type);
  };

  log(`🚀 Starting Product ID Scraping...`);
  log(`🔗 Target URL: ${link}`);
  log(`📁 Output File: ${targetOutputFile}`);
  log(`🕶️ Headless Mode: ${headless ? 'Enabled' : 'Disabled'}`);

  if (!fs.existsSync(targetAuthFile)) {
    log(`⚠️ Warning: Auth file '${targetAuthFile}' not found. Session may require login.`, 'warn');
  }

  // Ensure data directory exists
  const outputDir = path.dirname(targetOutputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let browser;
  try {
    browser = await chromium.launch({ headless });
    
    let contextOptions = {};
    if (fs.existsSync(targetAuthFile)) {
      contextOptions.storageState = targetAuthFile;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    if (shouldStop()) throw new Error("Task cancelled by user");

    log(`🌐 Navigating to ${link}...`);
    onProgress(10, 100, "Navigating to page...");

    await page.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 });

    if (shouldStop()) throw new Error("Task cancelled by user");

    onProgress(40, 100, "Extracting product cards...");
    log(`🔍 Extracting product IDs from page...`);

    await page.waitForSelector(".product-card", { timeout: 15000 }).catch(() => {
      log(`⚠️ No .product-card elements found immediately, checking page content...`, 'warn');
    });

    const productIds = await page.locator(".product-card").evaluateAll((cards) => {
      return cards
        .map((card) => {
          const link = card.querySelector('a[href*="/merchant/product-details/"]');
          if (!link) return null;
          const href = link.getAttribute("href");
          const match = href.match(/\/merchant\/product-details\/(\d+)/);
          return match ? match[1] : null;
        })
        .filter(Boolean);
    });

    if (shouldStop()) throw new Error("Task cancelled by user");

    onProgress(80, 100, "Saving extracted IDs...");

    // Remove duplicates
    const uniqueIds = [...new Set(productIds)];
    
    fs.writeFileSync(targetOutputFile, JSON.stringify(uniqueIds, null, 2), "utf8");
    log(`✅ Successfully extracted ${uniqueIds.length} product IDs! Saved to ${targetOutputFile}`, 'success');
    onProgress(100, 100, `Done! Saved ${uniqueIds.length} IDs.`);

    await browser.close();
    return { success: true, count: uniqueIds.length, file: targetOutputFile, ids: uniqueIds };

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    log(`❌ Error in Product ID scraping: ${error.message}`, 'error');
    throw error;
  }
}

// Support direct CLI execution
if (require.main === module) {
  const link = process.argv[2] || "https://wukusy.app/dropshiper/category/3?page=2";
  const outputFile = process.argv[3] || "product_2.json";
  scrapeProductIds({ link, outputFile, headless: true })
    .then(res => console.log("CLI Execution Finished:", res))
    .catch(err => console.error("CLI Execution Failed:", err.message));
}

module.exports = { scrapeProductIds };


