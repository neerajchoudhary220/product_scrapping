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
 * Scrape Product Details for each product ID in input JSON
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
  } = options;

  const targetInputFile = resolveDataPath(inputFile, "product_1.json");
  const targetOutputFile = resolveDataPath(outputFile, "products-data_1.json");
  const targetAuthFile = path.isAbsolute(authFile)
    ? authFile
    : path.join(__dirname, authFile);

  const log = (msg, type = "info") => {
    if (typeof onLog === "function") onLog(msg, type);
  };

  log(`🚀 Starting Product Details Scraping...`);
  log(`📂 Input IDs File: ${targetInputFile}`);
  log(`💾 Output Data File: ${targetOutputFile}`);
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
        log(`🛑 Task stopped by user at item ${index + 1}/${total}`, "warn");
        break;
      }

      const productId = String(productIds[index]);
      const currentItem = index + 1;

      const alreadyScraped = products.some(
        (p) => String(p.deo_dap_product_id || p.id) === productId,
      );
      if (alreadyScraped) {
        log(
          `⏩ Skipping ID ${productId} (${currentItem}/${total}) - Already scraped`,
        );
        completedCount++;
        onProgress(
          completedCount,
          total,
          `Skipped ${productId} (Already scraped)`,
          productId,
        );
        continue;
      }

      const productUrl = `${BASE_URL}/merchant/product-details/${productId}`;
      log(
        `🔎 [${currentItem}/${total}] Scraping Product ID: ${productId} (${productUrl})`,
      );
      onProgress(
        completedCount,
        total,
        `Scraping ID ${productId}...`,
        productId,
      );

      try {
        await page.goto(productUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await page.waitForSelector(".thumbnails-vertical .thumbnail-item", {
          timeout: 30000,
        });

        const title = await getText(
          page
            .locator(
              "h1, h2, .product-title, .product-name, .product-detail-name, .title, .detail-title",
            )
            .first(),
        );
        const price = await getText(page.locator(".price-amount-blue"));
        const stock = await getSpecValue(page, "Inventory");
        const weight = await getSpecValue(page, "Weight");
        const supplierRating = await getSpecValue(page, "Supplier Rating");

        const images = await page
          .locator(".thumbnails-vertical .thumbnail-item")
          .evaluateAll((items) => {
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
        await descriptionTab.click().catch(() => {});
        await page
          .waitForSelector("#description.show", { timeout: 10000 })
          .catch(() => {});

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

        const descriptionLocator = page.locator("#description .mb-4");
        if (await descriptionLocator.count()) {
          descriptionData = await descriptionLocator
            .first()
            .evaluate((container) => {
              if (!container) {
                return {
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
              }

              const htmlContent = container.innerHTML
                ? container.innerHTML.trim()
                : null;
              const rawText = container.innerText
                ? container.innerText.trim()
                : null;
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

              return {
                html: htmlContent,
                raw_text: rawText,
                parsed: {
                  summary: summary || (lines.length > 0 ? lines[0] : null),
                  features: features,
                  specifications: specifications,
                  package_includes: packageIncludes,
                  sections: sections,
                },
              };
            });
        }

        const keywords = generateKeywords(
          title,
          descriptionData.raw_text,
          descriptionData.parsed,
        );

        const productData = {
          deo_dap_product_id: String(productId),
          product_url: productUrl,
          title: title || null,
          keywords: keywords || null,
          price: price || null,
          stock: stock || null,
          weight: weight || null,
          supplier_rating: supplierRating || null,
          images: images || [],
          description: descriptionData.raw_text || null,
          description_parsed: {
            summary: descriptionData.parsed.summary || null,
            features: Array.isArray(descriptionData.parsed.features)
              ? descriptionData.parsed.features
              : [],
            specifications:
              descriptionData.parsed.specifications &&
              typeof descriptionData.parsed.specifications === "object"
                ? descriptionData.parsed.specifications
                : {},
            package_includes: descriptionData.parsed.package_includes || null,
            sections: Array.isArray(descriptionData.parsed.sections)
              ? descriptionData.parsed.sections
              : [],
          },
          scraped_at: new Date().toISOString(),
        };

        products.push(productData);

        // Ensure directory exists
        const outputDir = path.dirname(targetOutputFile);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(
          targetOutputFile,
          JSON.stringify(products, null, 2),
          "utf8",
        );

        log(
          `✅ [${currentItem}/${total}] Product ${productId} saved! Price: ${price || "N/A"}, Stock: ${stock || "N/A"}, Images: ${images.length}`,
          "success",
        );
      } catch (error) {
        log(
          `❌ [${currentItem}/${total}] Error scraping Product ID ${productId}: ${error.message}`,
          "error",
        );
      }

      completedCount++;
      onProgress(completedCount, total, `Processed ID ${productId}`, productId);
      await page.waitForTimeout(1000);
    }

    await browser.close();
    log(
      `🎉 Finished Product Details Scraping. Total items in ${targetOutputFile}: ${products.length}`,
      "success",
    );
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
  scrapeProductDetails({ inputFile, outputFile, headless: true })
    .then((res) => console.log("CLI Product Details Scraping Finished:", res))
    .catch((err) =>
      console.error("CLI Product Details Scraping Failed:", err.message),
    );
}

module.exports = { scrapeProductDetails };
