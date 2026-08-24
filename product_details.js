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
          await descriptionTab.click().catch(() => {});
          await page.waitForSelector("#description.show", { timeout: 10000 }).catch(() => {});

          let descriptionData = {
            html: null,
            raw_text: null,
            parsed: {
              summary: null,
              features: [],
              specifications: {},
              package_includes: null,
              sections: []
            }
          };

          const descriptionLocator = page.locator("#description .mb-4");
          if (await descriptionLocator.count()) {
            descriptionData = await descriptionLocator.first().evaluate((container) => {
              if (!container) {
                return {
                  html: null,
                  raw_text: null,
                  parsed: {
                    summary: null,
                    features: [],
                    specifications: {},
                    package_includes: null,
                    sections: []
                  }
                };
              }

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
              const lines = rawText ? rawText.split("\n").map(l => l.trim()).filter(Boolean) : [];

              let currentSection = null;

              lines.forEach((line) => {
                // Key-Value specifications
                if (line.includes(":") && !line.toLowerCase().startsWith("http") && line.indexOf(":") < 40) {
                  const parts = line.split(":");
                  const key = parts[0].trim();
                  const val = parts.slice(1).join(":").trim();
                  if (key && val) {
                    const lowerKey = key.toLowerCase();
                    if (lowerKey.includes("package") || lowerKey.includes("box include") || lowerKey.includes("includes") || lowerKey.includes("contain")) {
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
                if (line.endsWith(":") || /^(description|features|specifications|how to use|note|highlights|dimensions|material)/i.test(line)) {
                  if (currentSection && currentSection.content.length > 0) {
                    sections.push(currentSection);
                  }
                  currentSection = { title: line.replace(/:$/, "").trim(), content: [] };
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
                  sections: sections
                }
              };
            });
          }

          const productData = {
            deo_dap_product_id: String(productId),
            product_url: productUrl,
            price: price || null,
            stock: stock || null,
            weight: weight || null,
            supplier_rating: supplierRating || null,
            images: images || [],
            description: descriptionData.html,
            description_parsed: {
              summary: descriptionData.parsed.summary || null,
              features: Array.isArray(descriptionData.parsed.features) ? descriptionData.parsed.features : [],
              specifications: (descriptionData.parsed.specifications && typeof descriptionData.parsed.specifications === 'object') ? descriptionData.parsed.specifications : {},
              package_includes: descriptionData.parsed.package_includes || null,
              sections: Array.isArray(descriptionData.parsed.sections) ? descriptionData.parsed.sections : []
            },
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

