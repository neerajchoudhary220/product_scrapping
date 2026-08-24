const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DEFAULT_AUTH = path.join(__dirname, "auth.json");
const BASE_URL = "https://wukusy.app";

function resolveDataPath(filename, defaultName) {
  const target = filename || defaultName;
  if (path.isAbsolute(target)) return target;
  if (target.startsWith("data/") || target.startsWith("data\\")) {
    return path.join(__dirname, target);
  }
  return path.join(DATA_DIR, target);
}

async function getText(locator) {
  try {
    const count = await locator.count();
    if (count === 0) return null;
    return (await locator.first().innerText()).trim();
  } catch (error) {
    return null;
  }
}

async function getSpecValue(page, labelName) {
  try {
    const specCards = page.locator(".spec-card");
    const count = await specCards.count();
    for (let i = 0; i < count; i++) {
      const card = specCards.nth(i);
      const label = await getText(card.locator(".spec-label"));
      if (label && label.toLowerCase() === labelName.toLowerCase()) {
        return await getText(card.locator(".spec-value"));
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Scrape Product Details for each product ID in input JSON
 */
async function scrapeProductDetails(options = {}, onLog = console.log, onProgress = () => {}, shouldStop = () => false) {
  const {
    inputFile = "product_1.json",
    outputFile = "products-data_1.json",
    headless = true,
    authFile = DEFAULT_AUTH
  } = options;

  const targetInputFile = resolveDataPath(inputFile, "product_1.json");
  const targetOutputFile = resolveDataPath(outputFile, "products-data_1.json");
  const targetAuthFile = path.isAbsolute(authFile) ? authFile : path.join(__dirname, authFile);

  const log = (msg, type = 'info') => {
    if (typeof onLog === 'function') onLog(msg, type);
  };

  log(`🚀 Starting Product Details Scraping...`);
  log(`📂 Input IDs File: ${targetInputFile}`);
  log(`💾 Output Data File: ${targetOutputFile}`);
  log(`🕶️ Headless: ${headless ? 'Yes' : 'No'}`);

  if (!fs.existsSync(targetInputFile)) {
    throw new Error(`Input file not found: ${targetInputFile}`);
  }

  if (!fs.existsSync(targetAuthFile)) {
    log(`⚠️ Warning: Auth file '${targetAuthFile}' not found. Session may require login.`, 'warn');
  }

  const productIds = JSON.parse(fs.readFileSync(targetInputFile, "utf8"));
  log(`📦 Total Product IDs in input file: ${productIds.length}`);

  let products = [];
  if (fs.existsSync(targetOutputFile)) {
    try {
      products = JSON.parse(fs.readFileSync(targetOutputFile, "utf8"));
      log(`🔄 Already scraped products loaded: ${products.length}`);
    } catch (error) {
      log("⚠️ Output JSON is invalid. Starting fresh with empty data.", 'warn');
      products = [];
    }
  }

    let browser;
    try {
      browser = await chromium.launch({ headless });
      const contextOptions = {};
      if (fs.existsSync(targetAuthFile)) {
        contextOptions.storageState = targetAuthFile;
      }

      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();

      const total = productIds.length;
      let completedCount = 0;

      for (let index = 0; index < total; index++) {
        if (shouldStop()) {
          log(`🛑 Task stopped by user at item ${index + 1}/${total}`, 'warn');
          break;
        }

        const productId = String(productIds[index]);
        const currentItem = index + 1;

        const alreadyScraped = products.some((p) => String(p.deo_dap_product_id || p.id) === productId);
        if (alreadyScraped) {
          log(`⏩ Skipping ID ${productId} (${currentItem}/${total}) - Already scraped`);
          completedCount++;
          onProgress(completedCount, total, `Skipped ${productId} (Already scraped)`, productId);
          continue;
        }

        const productUrl = `${BASE_URL}/merchant/product-details/${productId}`;
        log(`🔎 [${currentItem}/${total}] Scraping Product ID: ${productId} (${productUrl})`);
        onProgress(completedCount, total, `Scraping ID ${productId}...`, productId);

        try {
          await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForSelector(".thumbnails-vertical .thumbnail-item", { timeout: 30000 });

          const price = await getText(page.locator(".price-amount-blue"));
          const stock = await getSpecValue(page, "Inventory");
          const weight = await getSpecValue(page, "Weight");
          const supplierRating = await getSpecValue(page, "Supplier Rating");

          const images = await page.locator(".thumbnails-vertical .thumbnail-item").evaluateAll((items) => {
            return items
              .map((item) => {
                const onclick = item.getAttribute("onclick");
                if (!onclick) return null;
                const match = onclick.match(/changeMainImage\('([^']+)'/);
                return match ? match[1] : null;
              })
              .filter(Boolean);
          });

          const descriptionTab = page.locator("#description-tab");
          await descriptionTab.click();
          await page.waitForSelector("#description.show", { timeout: 10000 }).catch(() => {});

          let description = null;
          const descriptionLocator = page.locator("#description .mb-4");
          if (await descriptionLocator.count()) {
            description = await descriptionLocator.first().innerText();
            description = description.replace(/\n\s*\n\s*\n/g, "\n\n").trim();
          }

          const productData = {
            deo_dap_product_id: productId,
            price: price,
            stock: stock,
            weight: weight,
            supplier_rating: supplierRating,
            images: images,
            description: description,
            scraped_at: new Date().toISOString()
          };

          products.push(productData);
          
          // Ensure directory exists
          const outputDir = path.dirname(targetOutputFile);
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          fs.writeFileSync(targetOutputFile, JSON.stringify(products, null, 2), "utf8");

          log(`✅ [${currentItem}/${total}] Product ${productId} saved! Price: ${price || 'N/A'}, Stock: ${stock || 'N/A'}, Images: ${images.length}`, 'success');
        } catch (error) {
          log(`❌ [${currentItem}/${total}] Error scraping Product ID ${productId}: ${error.message}`, 'error');
        }

        completedCount++;
        onProgress(completedCount, total, `Processed ID ${productId}`, productId);
        await page.waitForTimeout(1000);
      }

      await browser.close();
      log(`🎉 Finished Product Details Scraping. Total items in ${targetOutputFile}: ${products.length}`, 'success');
      return { success: true, count: products.length, file: targetOutputFile };

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    log(`❌ Scraping aborted: ${error.message}`, 'error');
    throw error;
  }
}

if (require.main === module) {
  const inputFile = process.argv[2] || "./product_1.json";
  const outputFile = process.argv[3] || "./products-data_1.json";
  scrapeProductDetails({ inputFile, outputFile, headless: true })
    .then(res => console.log("CLI Product Details Scraping Finished:", res))
    .catch(err => console.error("CLI Product Details Scraping Failed:", err.message));
}

module.exports = { scrapeProductDetails };

