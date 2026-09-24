const fs = require("fs");
const path = require("path");
const { scrapeProductIds } = require("./product_id");
const { scrapeProductDetails } = require("./product_details");
const { updateProductPrices } = require("./update_price");

const DATA_DIR = path.join(__dirname, "data");
const DEFAULT_AUTH = path.join(__dirname, "auth.json");

/**
 * Builds the page URL by replacing or setting the page query parameter.
 */
function buildPageUrl(baseUrl, pageNum) {
  try {
    const urlObj = new URL(baseUrl);
    urlObj.searchParams.set("page", pageNum);
    return urlObj.toString();
  } catch (err) {
    if (baseUrl.includes("page=")) {
      return baseUrl.replace(/page=\d+/, `page=${pageNum}`);
    }
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}page=${pageNum}`;
  }
}

/**
 * Builds output filename for a specific page number based on user pattern.
 * e.g. "kitchen-n.json" + page 1 => "kitchen-1.json"
 */
function buildPageOutputFileName(pattern, pageNum) {
  if (!pattern) return `kitchen-${pageNum}.json`;

  let name = pattern.trim();

  if (/-n(\.json)?$/i.test(name)) {
    return name.replace(/-n(\.json)?$/i, `-${pageNum}.json`);
  }
  if (/_n(\.json)?$/i.test(name)) {
    return name.replace(/_n(\.json)?$/i, `_${pageNum}.json`);
  }
  if (/{page}/i.test(name)) {
    return name.replace(/{page}/gi, `${pageNum}`);
  }
  if (/\b[nN]\b/.test(name)) {
    return name.replace(/\b[nN]\b/g, `${pageNum}`);
  }

  if (name.toLowerCase().endsWith(".json")) {
    const base = name.slice(0, -5);
    return `${base}-${pageNum}.json`;
  }

  return `${name}-${pageNum}.json`;
}

/**
 * Auto Multi-Page Scraper: Sequentially scrapes product IDs, details, and updates prices for each page.
 */
async function autoScrapeMultiPage(
  options = {},
  onLog = console.log,
  onProgress = () => {},
  shouldStop = () => false
) {
  const {
    url = "https://wukusy.app/dropshiper/category/3",
    totalPages = 1,
    outputFile = "kitchen-n.json",
    profitPercentage = 20,
    headless = true,
    authFile = DEFAULT_AUTH,
  } = options;

  const totalPagesCount = Math.max(1, parseInt(totalPages, 10) || 1);
  const log = (msg, type = "info") => {
    if (typeof onLog === "function") onLog(msg, type);
  };

  log(`🚀 Starting Auto Multi-Page Scraping Process...`, "info");
  log(`🔗 Base Target URL: ${url}`, "info");
  log(`📄 Total Pages: ${totalPagesCount}`, "info");
  log(`📁 Output File Pattern: ${outputFile}`, "info");
  log(`📈 Profit Margin: ${profitPercentage}%`, "info");
  log(`🕶️ Headless: ${headless ? "Yes" : "No"}`, "info");

  const results = [];

  for (let pageNum = 1; pageNum <= totalPagesCount; pageNum++) {
    if (shouldStop()) {
      log(
        `🛑 Auto Scraping process cancelled by user at page ${pageNum}/${totalPagesCount}`,
        "warn"
      );
      break;
    }

    const pageUrl = buildPageUrl(url, pageNum);
    const pageOutputFile = buildPageOutputFileName(outputFile, pageNum);
    const tempIdsFile = `temp_ids_page_${pageNum}_${Date.now()}.json`;

    log(`==================================================`, "info");
    log(
      `🔄 [PAGE ${pageNum}/${totalPagesCount}] Starting full pipeline...`,
      "info"
    );
    log(`🌐 Page URL: ${pageUrl}`, "info");
    log(`💾 Target Page Output File: ${pageOutputFile}`, "info");

    const pageProgressBase = ((pageNum - 1) / totalPagesCount) * 100;
    const pageProgressRange = (1 / totalPagesCount) * 100;

    const reportPageProgress = (subPercent, statusText, item = null) => {
      const overallPercent = Math.min(
        100,
        Math.round(pageProgressBase + (subPercent / 100) * pageProgressRange)
      );
      onProgress(
        overallPercent,
        100,
        `[Page ${pageNum}/${totalPagesCount}] ${statusText}`,
        item
      );
    };

    reportPageProgress(0, `Extracting Product IDs for Page ${pageNum}...`);

    try {
      // Step 1: Scrape Product IDs for this page
      log(`Step 1/3: Extracting Product IDs for page ${pageNum}...`, "info");
      await scrapeProductIds(
        { link: pageUrl, outputFile: tempIdsFile, headless, authFile },
        (msg, type) => log(`[Page ${pageNum} IDs] ${msg}`, type),
        (curr, tot, text) =>
          reportPageProgress((curr / tot) * 30, text),
        shouldStop
      );

      if (shouldStop()) break;

      const tempIdsPath = path.isAbsolute(tempIdsFile)
        ? tempIdsFile
        : path.join(DATA_DIR, tempIdsFile);

      let ids = [];
      if (fs.existsSync(tempIdsPath)) {
        try {
          ids = JSON.parse(fs.readFileSync(tempIdsPath, "utf8"));
        } catch (e) {}
      }

      if (!ids || ids.length === 0) {
        log(
          `⚠️ [Page ${pageNum}/${totalPagesCount}] No product IDs found. Skipping details & price update for page ${pageNum}.`,
          "warn"
        );
        if (fs.existsSync(tempIdsPath)) {
          fs.unlinkSync(tempIdsPath);
        }
        continue;
      }

      log(
        `[Page ${pageNum}/${totalPagesCount}] Extracted ${ids.length} product IDs. Moving to Step 2...`,
        "success"
      );

      // Step 2: Scrape Product Details
      log(
        `Step 2/3: Fetching product details for ${ids.length} products...`,
        "info"
      );
      reportPageProgress(30, `Fetching details for ${ids.length} products...`);
      await scrapeProductDetails(
        {
          inputFile: tempIdsFile,
          outputFile: pageOutputFile,
          headless,
          authFile,
        },
        (msg, type) => log(`[Page ${pageNum} Details] ${msg}`, type),
        (curr, tot, text, item) =>
          reportPageProgress(30 + (curr / tot) * 40, text, item),
        shouldStop
      );

      // Clean up temp IDs file
      if (fs.existsSync(tempIdsPath)) {
        fs.unlinkSync(tempIdsPath);
      }

      if (shouldStop()) break;

      // Step 3: Update Product Prices
      log(
        `Step 3/3: Calculating & updating product prices (Cart check & Profit ${profitPercentage}%)...`,
        "info"
      );
      reportPageProgress(70, `Updating product prices...`);
      await updateProductPrices(
        {
          inputFile: pageOutputFile,
          profitPercentage,
          categoryUrl: pageUrl,
          headless,
          authFile,
        },
        (msg, type) => log(`[Page ${pageNum} Price] ${msg}`, type),
        (curr, tot, text, item) =>
          reportPageProgress(70 + (curr / tot) * 30, text, item),
        shouldStop
      );

      log(
        `✅ [PAGE ${pageNum}/${totalPagesCount}] Successfully completed! Output saved to: ${pageOutputFile}`,
        "success"
      );
      results.push({ page: pageNum, file: pageOutputFile, count: ids.length });
    } catch (err) {
      log(`❌ Error processing Page ${pageNum}: ${err.message}`, "error");
      const tempIdsPath = path.isAbsolute(tempIdsFile)
        ? tempIdsFile
        : path.join(DATA_DIR, tempIdsFile);
      if (fs.existsSync(tempIdsPath)) {
        fs.unlinkSync(tempIdsPath);
      }
    }
  }

  log(
    `🎉 [AUTO PIPELINE FINISHED] Completed multi-page scraping for ${results.length}/${totalPagesCount} page(s).`,
    "success"
  );
  onProgress(100, 100, "All pages completed!");
  return {
    success: true,
    completedPages: results.length,
    totalPages: totalPagesCount,
    results,
  };
}

module.exports = { autoScrapeMultiPage, buildPageUrl, buildPageOutputFileName };
