const { chromium } = require("playwright");
const fs = require("fs");

const AUTH_FILE = "./auth.json";

// ================================
// CONFIG
// ================================

const PRODUCT_FILE = "./product_1.json";
const OUTPUT_FILE = "./products-data_1.json";

const BASE_URL = "https://wukusy.app";

// ================================
// HELPER FUNCTION
// Safe text extraction
// ================================

async function getText(locator) {
  try {
    const count = await locator.count();

    if (count === 0) {
      return null;
    }

    return (await locator.first().innerText()).trim();
  } catch (error) {
    return null;
  }
}

// ================================
// GET SPECIFICATION VALUE
//
// Example:
//
// <div class="spec-card">
//   <p class="spec-label">Inventory</p>
//   <p class="spec-value">114 units</p>
// </div>
//
// getSpecValue(page, "Inventory")
// returns "114 units"
// ================================

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

// ================================
// MAIN FUNCTION
// ================================

(async () => {
  // --------------------------------
  // Check product file
  // --------------------------------

  if (!fs.existsSync(PRODUCT_FILE)) {
    console.error(`File not found: ${PRODUCT_FILE}`);
    process.exit(1);
  }

  // --------------------------------
  // Check auth file
  // --------------------------------

  if (!fs.existsSync(AUTH_FILE)) {
    console.error(`Auth file not found: ${AUTH_FILE}`);
    process.exit(1);
  }

  // --------------------------------
  // Read Product IDs
  // --------------------------------

  const productIds = JSON.parse(fs.readFileSync(PRODUCT_FILE, "utf8"));

  console.log(`Total products found: ${productIds.length}`);

  // --------------------------------
  // Load already scraped products
  // --------------------------------

  let products = [];

  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      products = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));

      console.log(`Already scraped products: ${products.length}`);
    } catch (error) {
      console.log("Output JSON is invalid. Starting with empty data.");

      products = [];
    }
  }

  // --------------------------------
  // Launch Browser
  // --------------------------------

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    storageState: AUTH_FILE,
  });

  const page = await context.newPage();

  // --------------------------------
  // LOOP ALL PRODUCTS
  // --------------------------------

  for (const productId of productIds) {
    // --------------------------------
    // Skip already scraped product
    // --------------------------------

    const alreadyScraped = products.some(
      (product) => String(product.id) === String(productId),
    );

    if (alreadyScraped) {
      console.log(`Skipping ${productId} - Already scraped`);

      continue;
    }

    // --------------------------------
    // Dynamic Product URL
    // --------------------------------

    const productUrl = `${BASE_URL}/merchant/product-details/${productId}`;

    console.log("\n================================");
    console.log(`Scraping Product ID: ${productId}`);
    console.log(`URL: ${productUrl}`);
    console.log("================================\n");

    try {
      // --------------------------------
      // Open Product Page
      // --------------------------------

      await page.goto(productUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      // --------------------------------
      // Wait for product page
      // --------------------------------

      await page.waitForSelector(".thumbnails-vertical .thumbnail-item", {
        timeout: 30000,
      });

      // =================================
      // SCRAPE PRICE
      // =================================

      const price = await getText(page.locator(".price-amount-blue"));

      console.log(`Price: ${price}`);

      // =================================
      // SCRAPE INVENTORY / STOCK
      // =================================

      const stock = await getSpecValue(page, "Inventory");

      console.log(`Stock: ${stock}`);

      // =================================
      // SCRAPE WEIGHT
      // =================================

      const weight = await getSpecValue(page, "Weight");

      console.log(`Weight: ${weight}`);

      // =================================
      // SCRAPE SUPPLIER RATING
      // =================================

      const supplierRating = await getSpecValue(page, "Supplier Rating");

      console.log(`Supplier Rating: ${supplierRating}`);

      // =================================
      // EXTRACT ORIGINAL IMAGE URLs
      // =================================

      const images = await page
        .locator(".thumbnails-vertical .thumbnail-item")
        .evaluateAll((items) => {
          return items
            .map((item) => {
              const onclick = item.getAttribute("onclick");

              if (!onclick) {
                return null;
              }

              const match = onclick.match(/changeMainImage\('([^']+)'/);

              return match ? match[1] : null;
            })
            .filter(Boolean);
        });

      console.log(`Images found: ${images.length}`);

      // =================================
      // CLICK PRODUCT DESCRIPTION TAB
      // =================================

      const descriptionTab = page.locator("#description-tab");

      await descriptionTab.click();

      // --------------------------------
      // Wait for description tab
      // --------------------------------

      await page.waitForSelector("#description.show", {
        timeout: 10000,
      });

      // =================================
      // EXTRACT PRODUCT DESCRIPTION
      // =================================

      let description = null;

      const descriptionLocator = page.locator("#description .mb-4");

      if (await descriptionLocator.count()) {
        description = await descriptionLocator.first().innerText();

        description = description.replace(/\n\s*\n\s*\n/g, "\n\n").trim();
      }

      console.log(`Description: ${description ? "Extracted" : "Not found"}`);

      // =================================
      // CREATE PRODUCT DATA
      // =================================

      const productData = {
        deo_dap_product_id: String(productId),

        price: price,

        stock: stock,

        weight: weight,

        supplier_rating: supplierRating,

        images: images,

        description: description,
      };

      // =================================
      // ADD PRODUCT TO ARRAY
      // =================================

      products.push(productData);

      // =================================
      // SAVE IMMEDIATELY
      // =================================

      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(products, null, 2), "utf8");

      console.log(`✓ Product ${productId} saved successfully`);
    } catch (error) {
      console.error(`✗ Error scraping product ${productId}`);

      console.error(error.message);
    }

    // --------------------------------
    // Small delay
    // --------------------------------

    await page.waitForTimeout(1000);
  }

  // --------------------------------
  // FINISHED
  // --------------------------------

  console.log("\n================================");
  console.log("SCRAPING COMPLETED");
  console.log(`Total saved products: ${products.length}`);
  console.log(`Output file: ${OUTPUT_FILE}`);
  console.log("================================");

  await browser.close();
})();
