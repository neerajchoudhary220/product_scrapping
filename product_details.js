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

/**
 * Generate valuable, comma-separated search keywords from Title and Description
 */
function generateKeywords(
  title = "",
  descriptionText = "",
  parsedDescription = {},
) {
  const stopWords = new Set([
    "a",
    "about",
    "above",
    "after",
    "again",
    "against",
    "all",
    "am",
    "an",
    "and",
    "any",
    "are",
    "aren't",
    "as",
    "at",
    "be",
    "because",
    "been",
    "before",
    "being",
    "below",
    "between",
    "both",
    "but",
    "by",
    "can",
    "cannot",
    "could",
    "did",
    "do",
    "does",
    "doing",
    "down",
    "during",
    "each",
    "few",
    "for",
    "from",
    "further",
    "had",
    "has",
    "have",
    "having",
    "he",
    "her",
    "here",
    "hers",
    "herself",
    "him",
    "himself",
    "his",
    "how",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "itself",
    "just",
    "me",
    "more",
    "most",
    "my",
    "myself",
    "no",
    "nor",
    "not",
    "of",
    "off",
    "on",
    "once",
    "only",
    "or",
    "other",
    "our",
    "ours",
    "ourselves",
    "out",
    "over",
    "own",
    "same",
    "she",
    "should",
    "so",
    "some",
    "such",
    "than",
    "that",
    "the",
    "their",
    "theirs",
    "them",
    "themselves",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "through",
    "to",
    "too",
    "under",
    "until",
    "up",
    "very",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "which",
    "while",
    "who",
    "whom",
    "why",
    "with",
    "would",
    "you",
    "your",
    "yours",
    "yourself",
    "yourselves",
    "approx",
    "pc",
    "pcs",
    "piece",
    "pieces",
    "set",
    "pack",
    "description",
    "features",
    "specifications",
    "spec",
    "note",
    "details",
    "product",
    "item",
    "high",
    "quality",
    "best",
    "new",
    "buy",
    "online",
    "free",
    "price",
    "suitable",
    "easy",
    "make",
    "made",
    "great",
    "use",
    "using",
    "used",
    "durable",
    "perfect",
    "ideal",
  ]);

  const candidates = [];

  // 1. Clean Title as full keyphrase
  if (title) {
    const cleanTitle = title
      .replace(/[^\w\s-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (cleanTitle) candidates.push(cleanTitle);

    const titleWords = title
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopWords.has(w));

    // N-grams (bi-grams & tri-grams)
    for (let i = 0; i < titleWords.length - 1; i++) {
      candidates.push(`${titleWords[i]} ${titleWords[i + 1]}`);
      if (i < titleWords.length - 2) {
        candidates.push(
          `${titleWords[i]} ${titleWords[i + 1]} ${titleWords[i + 2]}`,
        );
      }
    }

    titleWords.forEach((w) => {
      if (w.length > 2) candidates.push(w);
    });
  }

  // 2. Features list
  if (parsedDescription && Array.isArray(parsedDescription.features)) {
    parsedDescription.features.forEach((feat) => {
      const clean = feat
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (clean.length > 3 && clean.length < 40) candidates.push(clean);
    });
  }

  // 3. Specifications map
  if (
    parsedDescription &&
    parsedDescription.specifications &&
    typeof parsedDescription.specifications === "object"
  ) {
    Object.entries(parsedDescription.specifications).forEach(([k, v]) => {
      if (k && v && typeof v === "string") {
        const specPhrase = `${k} ${v}`
          .replace(/[^\w\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        if (specPhrase.length < 35) candidates.push(specPhrase);
      }
    });
  }

  // Deduplicate and filter out noisy phrases
  const uniqueKeywords = [];
  const seen = new Set();

  candidates.forEach((kw) => {
    const cleaned = kw.trim();
    if (!cleaned || cleaned.length < 3) return;

    const words = cleaned.split(/\s+/).filter((w) => !stopWords.has(w));
    if (words.length === 0) return;

    const normalizedKey = words.join(" ");
    if (!seen.has(normalizedKey) && normalizedKey.length > 2) {
      seen.add(normalizedKey);
      uniqueKeywords.push(normalizedKey);
    }
  });

  return uniqueKeywords.slice(0, 15).join(", ");
}

/**
 * Extracts all product details in a single in-browser evaluation pass for speed
 */
async function extractProductFromPage(page, productId) {
  const productUrl = `${BASE_URL}/merchant/product-details/${productId}`;

  await page.goto(productUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // Short wait for essential product content to settle
  await page
    .waitForSelector(
      ".price-amount-blue, .product-title, h1, .product-detail-name, .title, .detail-title",
      { timeout: 10000 },
    )
    .catch(() => {});

  const extracted = await page.evaluate(() => {
    // 1. Title
    const titleEl = document.querySelector(
      "h1, h2, .product-title, .product-name, .product-detail-name, .title, .detail-title",
    );
    const title = titleEl ? titleEl.innerText.trim() : null;

    // 2. Price
    const priceEl = document.querySelector(".price-amount-blue");
    const price = priceEl ? priceEl.innerText.trim() : null;

    // 3. Specs
    let stock = null;
    let weight = null;
    let supplierRating = null;

    const specCards = document.querySelectorAll(".spec-card");
    specCards.forEach((card) => {
      const lbl = card.querySelector(".spec-label");
      const val = card.querySelector(".spec-value");
      if (lbl && val) {
        const labelText = lbl.innerText.trim().toLowerCase();
        const valText = val.innerText.trim();
        if (labelText === "inventory") stock = valText;
        else if (labelText === "weight") weight = valText;
        else if (labelText === "supplier rating") supplierRating = valText;
      }
    });

    // 4. Images
    const images = [];
    const thumbItems = document.querySelectorAll(
      ".thumbnails-vertical .thumbnail-item",
    );
    thumbItems.forEach((item) => {
      const onclick = item.getAttribute("onclick");
      if (onclick) {
        const match = onclick.match(/changeMainImage\('([^']+)'/);
        if (match && match[1]) images.push(match[1]);
      }
    });

    // 5. Description
    let descriptionData = {
      html: null,
      raw_text: null,
      parsed: {
        summary: null,
        features: [],
        specifications: {},
        package_includes: null,
        sections: [],
      },
    };

    const container = document.querySelector("#description .mb-4");
    if (container) {
      const htmlContent = container.innerHTML ? container.innerHTML.trim() : null;
      const rawText = container.innerText ? container.innerText.trim() : null;
      const features = [];
      const specifications = {};
      const sections = [];
      let summary = null;
      let packageIncludes = null;

      // Extract <li> elements as features
      const liElements = container.querySelectorAll("li");
      liElements.forEach((li) => {
        const text = li.innerText ? li.innerText.trim() : "";
        if (text && !features.includes(text)) features.push(text);
      });

      // Process text lines
      const lines = rawText
        ? rawText
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
        : [];

      let currentSection = null;

      lines.forEach((line) => {
        // Key-Value specifications
        if (
          line.includes(":") &&
          !line.toLowerCase().startsWith("http") &&
          line.indexOf(":") < 40
        ) {
          const parts = line.split(":");
          const key = parts[0].trim();
          const val = parts.slice(1).join(":").trim();
          if (key && val) {
            const lowerKey = key.toLowerCase();
            if (
              lowerKey.includes("package") ||
              lowerKey.includes("box include") ||
              lowerKey.includes("includes") ||
              lowerKey.includes("contain")
            ) {
              packageIncludes = val;
            } else {
              specifications[key] = val;
            }
            return;
          }
        }

        // Bullet points starting with •, -, *
        if (/^[•\-\*]\s*/.test(line)) {
          const featureText = line.replace(/^[•\-\*]\s*/, "").trim();
          if (featureText && !features.includes(featureText)) {
            features.push(featureText);
          }
          return;
        }

        // First long line as summary
        if (!summary && line.length > 15 && !line.includes(":")) {
          summary = line;
        }

        // Section headers ending with : or keyword headers
        if (
          line.endsWith(":") ||
          /^(description|features|specifications|how to use|note|highlights|dimensions|material)/i.test(
            line,
          )
        ) {
          if (currentSection && currentSection.content.length > 0) {
            sections.push(currentSection);
          }
          currentSection = {
            title: line.replace(/:$/, "").trim(),
            content: [],
          };
        } else if (currentSection) {
          currentSection.content.push(line);
        }
      });

      if (currentSection && currentSection.content.length > 0) {
        sections.push(currentSection);
      }

      descriptionData = {
        html: htmlContent,
        raw_text: rawText,
        parsed: {
          summary: summary || (lines.length > 0 ? lines[0] : null),
          features,
          specifications,
          package_includes: packageIncludes,
          sections,
        },
      };
    }

    return {
      title,
      price,
      stock,
      weight,
      supplierRating,
      images,
      descriptionData,
    };
  });

  const keywords = generateKeywords(
    extracted.title,
    extracted.descriptionData.raw_text,
    extracted.descriptionData.parsed,
  );

  return {
    deo_dap_product_id: String(productId),
    product_url: productUrl,
    title: extracted.title || null,
    keywords: keywords || null,
    price: extracted.price || null,
    stock: extracted.stock || null,
    weight: extracted.weight || null,
    supplier_rating: extracted.supplierRating || null,
    images: extracted.images || [],
    description: extracted.descriptionData.raw_text || null,
    description_parsed: {
      summary: extracted.descriptionData.parsed.summary || null,
      features: Array.isArray(extracted.descriptionData.parsed.features)
        ? extracted.descriptionData.parsed.features
        : [],
      specifications:
        extracted.descriptionData.parsed.specifications &&
        typeof extracted.descriptionData.parsed.specifications === "object"
          ? extracted.descriptionData.parsed.specifications
          : {},
      package_includes:
        extracted.descriptionData.parsed.package_includes || null,
      sections: Array.isArray(extracted.descriptionData.parsed.sections)
        ? extracted.descriptionData.parsed.sections
        : [],
    },
    scraped_at: new Date().toISOString(),
  };
}

/**
 * Scrape Product Details for each product ID in input JSON
 * Fully optimized with parallel workers, resource aborting, and single-pass DOM evaluation.
 */
async function scrapeProductDetails(
  options = {},
  onLog = console.log,
  onProgress = () => {},
  shouldStop = () => false,
) {
  const {
    inputFile = "product_1.json",
    outputFile = "products-data_1.json",
    headless = true,
    authFile = DEFAULT_AUTH,
    concurrency = 4,
  } = options;

  const targetInputFile = resolveDataPath(inputFile, "product_1.json");
  const targetOutputFile = resolveDataPath(outputFile, "products-data_1.json");
  const targetAuthFile = path.isAbsolute(authFile)
    ? authFile
    : path.join(__dirname, authFile);

  const numConcurrency = Math.max(1, Math.min(8, parseInt(concurrency, 10) || 4));

  const log = (msg, type = "info") => {
    if (typeof onLog === "function") onLog(msg, type);
  };

  log(`🚀 Starting Turbo Product Details Scraping...`);
  log(`📂 Input IDs File: ${targetInputFile}`);
  log(`💾 Output Data File: ${targetOutputFile}`);
  log(`⚡ Concurrency Workers: ${numConcurrency}`);
  log(`🕶️ Headless: ${headless ? "Yes" : "No"}`);

  if (!fs.existsSync(targetInputFile)) {
    throw new Error(`Input file not found: ${targetInputFile}`);
  }

  if (!fs.existsSync(targetAuthFile)) {
    log(
      `⚠️ Warning: Auth file '${targetAuthFile}' not found. Session may require login.`,
      "warn",
    );
  }

  const productIds = JSON.parse(fs.readFileSync(targetInputFile, "utf8"));
  log(`📦 Total Product IDs in input file: ${productIds.length}`);

  let products = [];
  if (fs.existsSync(targetOutputFile)) {
    try {
      products = JSON.parse(fs.readFileSync(targetOutputFile, "utf8"));
      log(`🔄 Already scraped products loaded: ${products.length}`);
    } catch (error) {
      log("⚠️ Output JSON is invalid. Starting fresh with empty data.", "warn");
      products = [];
    }
  }

  // Ensure output directory exists
  const outputDir = path.dirname(targetOutputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const flushToFile = () => {
    try {
      fs.writeFileSync(
        targetOutputFile,
        JSON.stringify(products, null, 2),
        "utf8",
      );
    } catch (err) {
      log(`⚠️ Error writing output file: ${err.message}`, "warn");
    }
  };

  let browser;
  try {
    browser = await chromium.launch({ headless });
    const contextOptions = {};
    if (fs.existsSync(targetAuthFile)) {
      contextOptions.storageState = targetAuthFile;
    }

    const context = await browser.newContext(contextOptions);

    // Abort heavy media/font/image assets to drastically speed up network transfers
    await context.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["image", "media", "font"].includes(resourceType)) {
        return route.abort();
      }
      return route.continue();
    });

    const total = productIds.length;
    let completedCount = 0;
    let currentIndex = 0;

    // Filter already scraped
    const alreadyScrapedMap = new Map();
    products.forEach((p) => {
      const id = String(p.deo_dap_product_id || p.id);
      alreadyScrapedMap.set(id, true);
    });

    // Check pre-completed items
    productIds.forEach((id) => {
      if (alreadyScrapedMap.has(String(id))) {
        completedCount++;
      }
    });

    if (completedCount > 0) {
      log(`⏩ Pre-skipped ${completedCount} already scraped product(s).`);
      onProgress(completedCount, total, `Resuming scraping...`);
    }

    // Parallel worker pool
    const workerPromises = [];
    for (let w = 0; w < numConcurrency; w++) {
      const workerId = w + 1;
      const workerTask = (async () => {
        const page = await context.newPage();
        try {
          while (true) {
            if (shouldStop()) break;

            let indexToProcess;
            // Get next index atomically
            if (currentIndex < total) {
              indexToProcess = currentIndex++;
            } else {
              break;
            }

            const productId = String(productIds[indexToProcess]);
            const currentItem = indexToProcess + 1;

            if (alreadyScrapedMap.has(productId)) {
              continue;
            }

            log(
              `🔎 [${currentItem}/${total}] [W${workerId}] Scraping Product ID: ${productId}`,
            );
            onProgress(
              completedCount,
              total,
              `Scraping ID ${productId}...`,
              productId,
            );

            let success = false;
            let attempts = 0;
            const maxAttempts = 2;

            while (!success && attempts < maxAttempts && !shouldStop()) {
              attempts++;
              try {
                const productData = await extractProductFromPage(
                  page,
                  productId,
                );
                products.push(productData);
                alreadyScrapedMap.set(productId, true);
                flushToFile();

                log(
                  `✅ [${currentItem}/${total}] Product ${productId} saved! Price: ${productData.price || "N/A"}, Stock: ${productData.stock || "N/A"}, Images: ${productData.images.length}`,
                  "success",
                );
                success = true;
              } catch (itemErr) {
                if (attempts >= maxAttempts) {
                  log(
                    `❌ [${currentItem}/${total}] Failed ID ${productId} after ${maxAttempts} attempts: ${itemErr.message}`,
                    "error",
                  );
                } else {
                  log(
                    `⚠️ [${currentItem}/${total}] Retrying ID ${productId} (${attempts}/${maxAttempts})...`,
                    "warn",
                  );
                  await page.waitForTimeout(500);
                }
              }
            }

            completedCount++;
            onProgress(
              completedCount,
              total,
              `Processed ID ${productId}`,
              productId,
            );
          }
        } finally {
          await page.close().catch(() => {});
        }
      })();

      workerPromises.push(workerTask);
    }

    await Promise.all(workerPromises);
    await browser.close();

    flushToFile();

    if (shouldStop()) {
      log(
        `🛑 Scraping process stopped by user. Progress saved: ${products.length} products.`,
        "warn",
      );
    } else {
      log(
        `🎉 Finished Product Details Scraping. Total items in ${targetOutputFile}: ${products.length}`,
        "success",
      );
    }

    return { success: true, count: products.length, file: targetOutputFile };
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    log(`❌ Scraping aborted: ${error.message}`, "error");
    throw error;
  }
}

if (require.main === module) {
  const inputFile = process.argv[2] || "./product_1.json";
  const outputFile = process.argv[3] || "./products-data_1.json";
  const concurrency = process.argv[4] || 4;
  scrapeProductDetails({ inputFile, outputFile, concurrency, headless: true })
    .then((res) => console.log("CLI Product Details Scraping Finished:", res))
    .catch((err) =>
      console.error("CLI Product Details Scraping Failed:", err.message),
    );
}

module.exports = { scrapeProductDetails };
