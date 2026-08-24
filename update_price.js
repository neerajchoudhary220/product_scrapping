const { chromium } = require("playwright");
const fs = require("fs");

const AUTH_FILE = "./auth.json";

// ========================================
// CONFIG
// ========================================

const PRODUCT_FILE = "./products-data_1.json";

const BASE_URL = "https://wukusy.app";

const CATEGORY_URL = `${BASE_URL}/dropshiper/category/3`;

const CART_URL = `${BASE_URL}/dropshiper/cart`;

const PROFIT_PERCENTAGE = 20;

// ========================================
// SAVE PRODUCTS
// ========================================

function saveProducts(products) {
  fs.writeFileSync(PRODUCT_FILE, JSON.stringify(products, null, 2), "utf8");
}

// ========================================
// PARSE PRICE
// ========================================

function parsePrice(price) {
  if (!price) {
    return null;
  }

  const cleaned = String(price)
    .replace(/[₹,\s]/g, "")
    .trim();

  const number = parseFloat(cleaned);

  return Number.isNaN(number) ? null : number;
}

// ========================================
// GET CART TOTAL
//
// Specifically targets:
//
// <tr class="table-active">
//     <th>Total (INR) :</th>
//     ...
//     <span id="totalUpdate">199.10</span>
// </tr>
// ========================================

async function getCartTotal(page) {
  const totalElement = page
    .locator(
      '//tr[th[normalize-space(.)="Total (INR) :"]]//span[@id="totalUpdate"]',
    )
    .first();

  await totalElement.waitFor({
    state: "visible",
    timeout: 30000,
  });

  const totalText = await totalElement.innerText();

  console.log(`Raw Cart Total: ${totalText}`);

  return parsePrice(totalText);
}

// ========================================
// REMOVE FIRST CART ITEM
//
// This directly finds:
//
// a[onclick*="removeCartId"]
//
// and clicks it.
// ========================================

async function removeFirstCartItem(page) {
  const removeButton = page.locator('a[onclick*="removeCartId"]').first();

  const count = await page.locator('a[onclick*="removeCartId"]').count();

  if (count === 0) {
    return false;
  }

  console.log("Clicking Remove button...");

  await removeButton.scrollIntoViewIfNeeded();

  await removeButton.click({
    timeout: 15000,
  });

  return true;
}

// ========================================
// CLEAR CART
//
// Keeps removing items until cart is empty.
// ========================================

async function clearCart(page) {
  await page.goto(CART_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(1000);

  while (true) {
    const removeButtons = page.locator('a[onclick*="removeCartId"]');

    const count = await removeButtons.count();

    if (count === 0) {
      console.log("Cart is empty.");
      break;
    }

    console.log(`Cart has ${count} item(s). Removing one...`);

    // Store count before clicking
    const previousCount = count;

    await removeButtons.first().scrollIntoViewIfNeeded();

    await removeButtons.first().click();

    // Wait until number of remove buttons decreases
    try {
      await page.waitForFunction(
        (oldCount) => {
          return (
            document.querySelectorAll('a[onclick*="removeCartId"]').length <
            oldCount
          );
        },
        previousCount,
        {
          timeout: 15000,
        },
      );
    } catch (error) {
      console.log("Cart did not update automatically. Reloading...");
    }

    await page.waitForTimeout(1000);

    await page.reload({
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(1000);
  }
}

// ========================================
// REMOVE CURRENT PRODUCT
//
// Since we clear the cart before every
// product, normally only ONE item should
// exist in the cart.
//
// This makes removal much more reliable.
// ========================================

async function removeCurrentProduct(page, productId) {
  console.log(`Removing product ${productId} from cart...`);

  const removeButtons = page.locator('a[onclick*="removeCartId"]');

  const countBefore = await removeButtons.count();

  if (countBefore === 0) {
    console.log("No Remove button found in cart.");

    return false;
  }

  console.log(`Found ${countBefore} remove button(s).`);

  await removeButtons.first().scrollIntoViewIfNeeded();

  await removeButtons.first().click();

  // Wait for cart item count to decrease

  try {
    await page.waitForFunction(
      (oldCount) => {
        return (
          document.querySelectorAll('a[onclick*="removeCartId"]').length <
          oldCount
        );
      },
      countBefore,
      {
        timeout: 15000,
      },
    );

    console.log(`✓ Product ${productId} removed.`);

    return true;
  } catch (error) {
    console.log("Remove action did not update page automatically.");
  }

  // Reload and verify

  await page.reload({
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(1000);

  const countAfter = await page.locator('a[onclick*="removeCartId"]').count();

  if (countAfter < countBefore) {
    console.log(`✓ Product ${productId} removed after reload.`);

    return true;
  }

  return false;
}

// ========================================
// MAIN
// ========================================

(async () => {
  // --------------------------------------
  // CHECK PRODUCT FILE
  // --------------------------------------

  if (!fs.existsSync(PRODUCT_FILE)) {
    console.error(`Product JSON not found: ${PRODUCT_FILE}`);

    process.exit(1);
  }

  // --------------------------------------
  // CHECK AUTH FILE
  // --------------------------------------

  if (!fs.existsSync(AUTH_FILE)) {
    console.error(`Auth file not found: ${AUTH_FILE}`);

    process.exit(1);
  }

  // --------------------------------------
  // LOAD PRODUCTS
  // --------------------------------------

  let products;

  try {
    products = JSON.parse(fs.readFileSync(PRODUCT_FILE, "utf8"));
  } catch (error) {
    console.error("Unable to read product JSON:");

    console.error(error.message);

    process.exit(1);
  }

  console.log(`Total products: ${products.length}`);

  // --------------------------------------
  // LAUNCH BROWSER
  // --------------------------------------

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    storageState: AUTH_FILE,
  });

  const page = await context.newPage();

  // ======================================
  // LOOP PRODUCTS
  // ======================================

  for (let index = 0; index < products.length; index++) {
    const product = products[index];

    const productId = String(product.deo_dap_product_id);

    console.log("\n");
    console.log("====================================");

    console.log(`Processing ${index + 1}/${products.length}`);

    console.log(`Product ID: ${productId}`);

    console.log("====================================");

    try {
      // ==================================
      // STEP 1
      // CLEAR CART FIRST
      // ==================================

      console.log("Checking and clearing cart...");

      await clearCart(page);

      // ==================================
      // STEP 2
      // OPEN CATEGORY PAGE
      // ==================================

      console.log("Opening category page...");

      await page.goto(CATEGORY_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      await page.waitForSelector(".product-card", {
        timeout: 30000,
      });

      // ==================================
      // STEP 3
      // FIND PRODUCT USING ID
      // ==================================

      const productLink = page.locator(
        `.product-card a[href="/merchant/product-details/${productId}"]`,
      );

      const productCount = await productLink.count();

      if (productCount === 0) {
        console.log(`⚠ Product ${productId} not found on category page.`);

        continue;
      }

      // ==================================
      // FIND PRODUCT CARD
      // ==================================

      const productCard = productLink
        .first()
        .locator("xpath=ancestor::div[contains(@class,'product-card')][1]");

      // ==================================
      // FIND ADD TO CART
      // ==================================

      const addToCartButton = productCard.locator("button.btn-cart");

      const addButtonCount = await addToCartButton.count();

      if (addButtonCount === 0) {
        console.log(`⚠ Add To Cart button not found for ${productId}`);

        continue;
      }

      // ==================================
      // STEP 4
      // ADD TO CART
      // ==================================

      console.log(`Adding ${productId} to cart...`);

      await addToCartButton.first().scrollIntoViewIfNeeded();

      await addToCartButton.first().click();

      await page.waitForTimeout(2000);

      // ==================================
      // STEP 5
      // OPEN CART
      // ==================================

      console.log("Opening cart...");

      await page.goto(CART_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      await page.waitForTimeout(1000);

      // ==================================
      // STEP 6
      // GET ACTUAL TOTAL
      //
      // FIXED:
      // specifically targets
      // Total (INR) row
      // ==================================

      const totalPrice = await getCartTotal(page);

      if (totalPrice === null) {
        throw new Error(`Unable to parse cart total for ${productId}`);
      }

      console.log(`Cart Price: ₹${totalPrice}`);

      // ==================================
      // STEP 7
      // CALCULATE PROFIT
      // ==================================

      const profitAmount = Number(
        ((totalPrice * PROFIT_PERCENTAGE) / 100).toFixed(2),
      );

      // ==================================
      // FINAL PRICE
      // ==================================

      const finalPrice = Number((totalPrice + profitAmount).toFixed(2));

      console.log(`Profit (${PROFIT_PERCENTAGE}%): ₹${profitAmount}`);

      console.log(`Final Price: ₹${finalPrice}`);

      // ==================================
      // STEP 8
      // UPDATE JSON
      // ==================================

      products[index] = {
        ...product,

        price: totalPrice,

        profit_amount: profitAmount,

        final_price: finalPrice,
      };

      // ==================================
      // SAVE IMMEDIATELY
      // ==================================

      saveProducts(products);

      console.log(`✓ Product ${productId} updated in JSON.`);

      // ==================================
      // STEP 9
      // REMOVE PRODUCT
      // ==================================

      const removed = await removeCurrentProduct(page, productId);

      if (!removed) {
        throw new Error(
          `FAILED TO REMOVE PRODUCT ${productId}. Next product will not be processed on top of it.`,
        );
      }

      console.log(`✓ Product ${productId} completed.`);
    } catch (error) {
      console.error(`✗ Error processing ${productId}`);

      console.error(error.message);

      // Emergency cleanup

      try {
        console.log("Attempting emergency cart cleanup...");

        if (!page.isClosed()) {
          await clearCart(page);
        }
      } catch (cleanupError) {
        console.error("Cart cleanup failed:", cleanupError.message);
      }
    }

    // ==================================
    // DELAY
    // ==================================

    if (!page.isClosed()) {
      await page.waitForTimeout(1000);
    }
  }

  // ======================================
  // FINISHED
  // ======================================

  console.log("\n");
  console.log("====================================");

  console.log("ALL PRODUCTS COMPLETED");

  console.log(`Updated JSON: ${PRODUCT_FILE}`);

  console.log("====================================");

  await browser.close();
})();
