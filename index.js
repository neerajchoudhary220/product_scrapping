const { chromium } = require("playwright");
const fs = require("fs");
const readline = require("readline");

const AUTH_FILE = "./auth.json";

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
    headless: false,
  });

  let context;

  // Check if saved session exists
  if (fs.existsSync(AUTH_FILE)) {
    console.log("Using saved session...");

    context = await browser.newContext({
      storageState: AUTH_FILE,
    });
  } else {
    console.log("No saved session found. Please login...");

    context = await browser.newContext();
  }

  const page = await context.newPage();

  await page.goto("https://wukusy.app/login");

  // Agar session pehle se hai to directly scraping start kar sakte ho
  if (!fs.existsSync(AUTH_FILE)) {
    console.log("\nPlease login manually in the browser.");

    const answer = await ask("\nAfter login, save session? (yes/no): ");

    if (answer === "yes" || answer === "y") {
      await context.storageState({
        path: AUTH_FILE,
      });

      console.log("Session saved successfully!");
    } else {
      console.log("Session not saved.");
    }
  }

  // Yahan se scraping
  console.log("Starting scraping...");

  await page.goto("https://wukusy.app/dropshiper/category/3");

  const data = await page.locator("body").innerText();

  console.log(data);

  // Browser close
  // await browser.close();
})();
