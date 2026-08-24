const { chromium } = require("playwright");
const fs = require("fs");
const readline = require("readline");

const AUTH_FILE = "./auth.json";
const productsLink = "https://wukusy.app/dropshiper/category/3?page=2";
const fileName = "product_2.json";
function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
  });

  let context;

  context = await browser.newContext({
    storageState: AUTH_FILE,
  });

  const page = await context.newPage();
  // Yahan se scraping
  console.log("Starting scraping...");

  await page.goto(productsLink);

  const data = await page.locator("body").innerText();

  const productIds = await page
    .locator(".product-card")
    .evaluateAll((cards) => {
      return cards
        .map((card) => {
          const link = card.querySelector(
            'a[href*="/merchant/product-details/"]',
          );

          if (!link) return null;

          const href = link.getAttribute("href");

          const match = href.match(/\/merchant\/product-details\/(\d+)/);

          return match ? match[1] : null;
        })
        .filter(Boolean);
    });
  fs.writeFileSync(fileName, JSON.stringify(productIds, null, 2));

  console.log("all id is stored in " + fileName);
  // console.log(productIds);

  // Browser close
  await browser.close();
})();
