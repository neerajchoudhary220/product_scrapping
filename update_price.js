const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DEFAULT_AUTH = path.join(__dirname, "auth.json");
const BASE_URL = "https://wukusy.app";
const DEFAULT_CART_URL = `${BASE_URL}/dropshiper/cart`;
const DEFAULT_CATEGORY_URL = `${BASE_URL}/dropshiper/category/3`;

function resolveDataPath(filename, defaultName = "products-data_1.json") {
  const target = filename || defaultName;
  if (path.isAbsolute(target)) return target;
  if (target.startsWith("data/") || target.startsWith("data\\")) {
    return path.join(__dirname, target);
  }
  return path.join(DATA_DIR, target);
}

function saveProducts(filePath, products) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(products, null, 2), "utf8");
}

function parsePrice(price) {
  if (!price) return null;
  const cleaned = String(price)
    .replace(/[₹,\s]/g, "")
    .trim();
  const number = parseFloat(cleaned);
  return Number.isNaN(number) ? null : number;
}

async function getPrice(page, locator) {
  const element = page.locator(locator).first();

  await element.waitFor({
    state: "visible",
    timeout: 30000,
  });

  const text = await element.innerText();

  return parsePrice(text);
}

// async function getCartTotal(page) {
//   const totalElement = page
//     .locator(
//       '//tr[th[normalize-space(.)="Total (INR) :"]]//span[@id="totalUpdate"]',
//     )
//     .first();

//   await totalElement.waitFor({ state: "visible", timeout: 30000 });
//   const totalText = await totalElement.innerText();
//   return parsePrice(totalText);
// }
// async function getSubTotal(page) {
//   const subTotalElement = page
//     .locator(
//       '//tr[td[normalize-space(.)="Sub Total (Item Cost) :"]]//td[@id="cart-subtotal"]',
//     )
//     .first();

//   await subTotalElement.waitFor({ state: "visible", timeout: 30000 });
//   const subTotalText = await subTotalElement.innerText();
//   return parsePrice(subTotalText);
// }

async function clearCart(page, log = () => {}) {
  await page.goto(DEFAULT_CART_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(1000);

  while (true) {
    const removeButtons = page.locator('a[onclick*="removeCartId"]');
    const count = await removeButtons.count();

    if (count === 0) {
      log("🛒 Cart is verified empty.");
      break;
    }

    log(`🛒 Cart has ${count} residual item(s). Clearing item...`);
    const previousCount = count;

    await removeButtons.first().scrollIntoViewIfNeeded();
    await removeButtons.first().click();

    try {
      await page.waitForFunction(
        (oldCount) =>
          document.querySelectorAll('a[onclick*="removeCartId"]').length <
          oldCount,
        previousCount,
        { timeout: 15000 },
      );
    } catch (error) {
      log("Reloading cart after removal action...", "warn");
    }

    await page.waitForTimeout(1000);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
  }
}

async function removeCurrentProduct(page, productId, log = () => {}) {
  log(`🗑️ Removing product ${productId} from cart...`);
  const removeButtons = page.locator('a[onclick*="removeCartId"]');
  const countBefore = await removeButtons.count();

  if (countBefore === 0) {
    log("⚠️ No remove button found in cart after total calculation.", "warn");
    return false;
  }

  await removeButtons.first().scrollIntoViewIfNeeded();
  await removeButtons.first().click();

  try {
    await page.waitForFunction(
      (oldCount) =>
        document.querySelectorAll('a[onclick*="removeCartId"]').length <
        oldCount,
      countBefore,
      { timeout: 15000 },
    );
    log(`✓ Product ${productId} removed from cart.`);
    return true;
  } catch (error) {
    log("Cart remove transition timeout, reloading to verify...", "warn");
  }

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1000);

  const countAfter = await page.locator('a[onclick*="removeCartId"]').count();
  return countAfter < countBefore;
}

/**
 * Update Product Prices by adding items to cart, reading total, and computing profit
 */
async function updateProductPrices(
  options = {},
  onLog = console.log,
  onProgress = () => {},
  shouldStop = () => false,
) {
  const {
    inputFile = "products-data_1.json",
    profitPercentage = 20,
    categoryUrl = DEFAULT_CATEGORY_URL,
    headless = true,
    authFile = DEFAULT_AUTH,
  } = options;

  const targetInputFile = resolveDataPath(inputFile, "products-data_1.json");
  const targetAuthFile = path.isAbsolute(authFile)
    ? authFile
    : path.join(__dirname, authFile);

  const log = (msg, type = "info") => {
    if (typeof onLog === "function") onLog(msg, type);
  };

  log(`🚀 Starting Price Calculation & Update Process...`);
  log(`📂 Input Data File: ${targetInputFile}`);
  log(`📈 Profit Margin: ${profitPercentage}%`);
  log(`🔗 Category Base URL: ${categoryUrl}`);
  log(`🕶️ Headless: ${headless ? "Yes" : "No"}`);

  if (!fs.existsSync(targetInputFile)) {
    throw new Error(`Product JSON not found: ${targetInputFile}`);
  }

  if (!fs.existsSync(targetAuthFile)) {
    log(
      `⚠️ Warning: Auth file '${targetAuthFile}' not found. Session may require login.`,
      "warn",
    );
  }

  let products;
  try {
    products = JSON.parse(fs.readFileSync(targetInputFile, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read or parse ${targetInputFile}: ${error.message}`,
    );
  }

  const total = products.length;
  log(`📦 Total products loaded: ${total}`);

  let browser;
  try {
    browser = await chromium.launch({ headless });
    const contextOptions = {};
    if (fs.existsSync(authFile)) {
      contextOptions.storageState = authFile;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    let completedCount = 0;

    for (let index = 0; index < total; index++) {
      if (shouldStop()) {
        log(`🛑 Task stopped by user at item ${index + 1}/${total}`, "warn");
        break;
      }

      const product = products[index];
      const productId = String(product.deo_dap_product_id || product.id);
      const currentItem = index + 1;

      log(`----------------------------------------`);
      log(`🔄 [${currentItem}/${total}] Processing Product ID: ${productId}`);
      onProgress(
        completedCount,
        total,
        `Processing ID ${productId}...`,
        productId,
      );

      try {
        log(`Step 1: Clearing cart before processing ${productId}...`);
        await clearCart(page, log);

        if (shouldStop()) break;

        log(`Step 2: Navigating to category page (${categoryUrl})...`);
        await page.goto(categoryUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await page.waitForSelector(".product-card", { timeout: 30000 });

        log(`Step 3: Locating product card for ID ${productId}...`);
        const productLink = page.locator(
          `.product-card a[href="/merchant/product-details/${productId}"]`,
        );
        const productCount = await productLink.count();

        if (productCount === 0) {
          log(
            `⚠️ Product ${productId} not found on category page. Skipping...`,
            "warn",
          );
          completedCount++;
          onProgress(
            completedCount,
            total,
            `Skipped ID ${productId} (Not found on page)`,
            productId,
          );
          continue;
        }

        const productCard = productLink
          .first()
          .locator("xpath=ancestor::div[contains(@class,'product-card')][1]");
        const addToCartButton = productCard.locator("button.btn-cart");

        if ((await addToCartButton.count()) === 0) {
          log(
            `⚠️ Add To Cart button missing for ${productId}. Skipping...`,
            "warn",
          );
          completedCount++;
          onProgress(
            completedCount,
            total,
            `Skipped ID ${productId} (No button)`,
            productId,
          );
          continue;
        }

        log(`Step 4: Adding product ${productId} to cart...`);
        await addToCartButton.first().scrollIntoViewIfNeeded();
        await addToCartButton.first().click();
        await page.waitForTimeout(2000);

        log(`Step 5: Navigating to cart to calculate total...`);
        await page.goto(DEFAULT_CART_URL, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await page.waitForTimeout(1000);

        log(`Step 6: Parsing cart price...`);
        const totalPrice = await getPrice(
          page,
          '//tr[th[normalize-space(.)="Total (INR) :"]]//span[@id="totalUpdate"]',
        );
        const subTotalPrice = await getPrice(
          page,
          '//tr[td[normalize-space(.)="Sub Total (Item Cost) :"]]//td[@id="cart-subtotal"]',
        );
        const shippingCharge = await getPrice(
          page,
          '//tr[td[contains(normalize-space(.), "Shipping Charge")]]//span[@id="totalShipping"]',
        );
        const codCharge = await getPrice(
          page,
          '//tr[@id="cod-hide"]//span[@id="codCharge"]',
        );
        const tax = await getPrice(
          page,
          '//tr[td[contains(normalize-space(.), "Tax")]]//span[@id="totalTax"]',
        );

        const shippingTax = await getPrice(
          page,
          '//tr[td[contains(normalize-space(.), "Shipping Tax")]]//span[@id="shipTax"]',
        );

        console.log("subTotalPrice", subTotalPrice);
        console.log("totalPrice", totalPrice);
        console.log("shipppingCharge", shippingCharge);
        console.log("codCharge", codCharge);
        console.log("shippingTax", shippingTax);
        console.log("tax", tax);

        if (totalPrice === null) {
          throw new Error(
            `Unable to parse cart total for product ${productId}`,
          );
        }

        const profitAmount = Number(
          ((subTotalPrice * Number(profitPercentage)) / 100).toFixed(2),
        );
        const finalPrice = Number((subTotalPrice + profitAmount).toFixed(2));

        log(
          `💰 Product ${productId} Pricing -> Base: ₹${totalPrice} | Profit (${profitPercentage}%): ₹${profitAmount} | Final: ₹${finalPrice}`,
        );

        products[index] = {
          ...product,
          price: subTotalPrice,
          profit_percentage: Number(profitPercentage),
          profit_amount: profitAmount,
          final_price: finalPrice,
          shippingCharge: Number(shippingCharge),
          codCharge: Number(codCharge),
          shippingTax: Number(shippingTax),
          tax: Number(tax),
          updated_at: new Date().toISOString(),
        };

        saveProducts(targetInputFile, products);
        log(`✅ Saved updated pricing to ${targetInputFile}`, "success");

        log(`Step 7: Cleaning cart item ${productId}...`);
        const removed = await removeCurrentProduct(page, productId, log);
        if (!removed) {
          log(
            `⚠️ Warning: Cart item removal verification unconfirmed for ${productId}`,
            "warn",
          );
        }

        log(
          `✨ [${currentItem}/${total}] Successfully updated Product ID ${productId}`,
          "success",
        );
      } catch (error) {
        log(
          `❌ Error processing Product ${productId}: ${error.message}`,
          "error",
        );
        try {
          if (!page.isClosed()) await clearCart(page, log);
        } catch (cleanupErr) {
          log(`Emergency cleanup error: ${cleanupErr.message}`, "error");
        }
      }

      completedCount++;
      onProgress(completedCount, total, `Completed ID ${productId}`, productId);
      if (!page.isClosed()) await page.waitForTimeout(1000);
    }

    await browser.close();
    log(
      `🎉 Finished Price Calculation & Updates. File ${targetInputFile} fully updated!`,
      "success",
    );
    return { success: true, count: products.length, file: targetInputFile };
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    log(`❌ Price update task failed: ${error.message}`, "error");
    throw error;
  }
}

if (require.main === module) {
  const inputFile = process.argv[2] || "./products-data_1.json";
  const profitPercentage = process.argv[3] || 20;
  updateProductPrices({ inputFile, profitPercentage, headless: true })
    .then((res) => console.log("CLI Price Update Finished:", res))
    .catch((err) => console.error("CLI Price Update Failed:", err.message));
}

module.exports = { updateProductPrices };
