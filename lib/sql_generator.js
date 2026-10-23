/**
 * MySQL Raw SQL Generator for Scraped Product Datasets
 * Replicates the exact column mappings, calculations, and updateOrCreate deduplication logic
 * of Laravel's ImportProductsJob (app/Jobs/ImportProductsJob.php).
 */

function escapeSql(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return isNaN(val) ? "0" : String(val);
  if (typeof val === "boolean") return val ? "1" : "0";
  return (
    "'" +
    String(val)
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "''")
      .replace(/\0/g, "\\0")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r") +
    "'"
  );
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Replicates App\Services\DescriptionParser::parse($rawText) from Laravel backend
 */
function parseDescriptionSections(rawText) {
  if (!rawText || typeof rawText !== "string") return [];
  const text = rawText.trim();
  if (!text) return [];

  const knownHeaders = [
    "Description",
    "Dimension",
    "Dimensions",
    "Key Features",
    "Features",
    "Specifications",
    "Specification",
    "Ideal For",
    "Package Includes",
    "Product Details",
    "Overview",
    "About This Item",
    "Shipping & Returns",
    "Warranty",
    "Care Instructions",
  ];

  const headersPattern = knownHeaders
    .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const pattern = new RegExp(
    `(?:^|\\r?\\n)(?=(?:(?:${headersPattern})|^[A-Za-z0-9\\s&()\\/\\-]{2,30})(?::|:-)\\s*(?:\\r?\\n|$))`,
    "im",
  );

  const splits = text.split(pattern).filter(Boolean);
  const sections = [];

  for (const part of splits) {
    const partTrimmed = part.trim();
    if (!partTrimmed) continue;

    const match = partTrimmed.match(
      /^([A-Za-z0-9\s&()\/\\-]{2,35})(?::|:-)\s*([\s\S]*)$/,
    );
    if (match) {
      const title = match[1].trim();
      let content = match[2].trim().replace(/^[-:]\s*/, "");
      if (title) {
        sections.push({
          title: title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
          content: content.trim(),
        });
        continue;
      }
    }

    if (sections.length > 0) {
      sections[sections.length - 1].content += "\n\n" + partTrimmed;
    } else {
      sections.push({
        title: "Description",
        content: partTrimmed,
      });
    }
  }

  // Clean and merge consecutive sections with identical titles
  const finalSections = [];
  for (const sec of sections) {
    const contentClean = sec.content.trim();
    if (!contentClean) continue;
    const titleClean = sec.title.trim();

    if (finalSections.length > 0) {
      const last = finalSections[finalSections.length - 1];
      if (last.title.toLowerCase() === titleClean.toLowerCase()) {
        last.content += "\n\n" + contentClean;
        continue;
      }
    }

    finalSections.push({
      title: titleClean,
      content: contentClean,
    });
  }

  if (finalSections.length === 0) {
    finalSections.push({
      title: "Description",
      content: text,
    });
  }

  return finalSections;
}

/**
 * Generate Raw SQL for a single product matching Laravel's ImportProductsJob
 */
function generateProductSql(product, categoryId = 3, supplierId = 1, options = {}) {
  if (!product || typeof product !== "object") return "";

  const title = (product.title || "").trim();
  if (!title) return "";

  const supplierProdId = String(
    product.deo_dap_product_id ||
      product.supplier_product_id ||
      product.id ||
      "",
  ).trim();
  const productUrl = String(
    product.product_url || product.supplier_product_url || "",
  ).trim();

  // Price calculations
  // Parse price strings if numeric string with ₹
  const parseNum = (v) => {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return isNaN(v) ? 0 : v;
    const cleaned = String(v).replace(/[₹,\s]/g, "").trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  const finalPrice = parseNum(
    product.final_price || product.price || product["Final Price"] || 0,
  );
  const supplierPrice = parseNum(
    product.price || product["Price"] || finalPrice,
  );
  const profitAmt = parseNum(
    product.profit_amount || product.profit_amt || product["Profit Amount"] || 0,
  );
  const shippingCharge = parseNum(
    product.shippingCharge ||
      product.shipping_charge ||
      product["Shipping Charge"] ||
      0,
  );
  const codCharge = parseNum(
    product.codCharge || product.cod_charge || product["COD Charge"] || 0,
  );
  const tax = parseNum(product.tax || product["Tax"] || 0);
  const shippingTax = parseNum(
    product.shippingTax || product.shipping_tax || product["Shipping Tax"] || 0,
  );
  const weight = product.weight ? String(product.weight).trim() : "";

  // Original Price: finalPrice + (finalPrice * 1.2) - exactly getOriginalPrice in Laravel
  const originalPrice = Number((finalPrice + finalPrice * 1.2).toFixed(2));
  let discount = 0;
  if (originalPrice > finalPrice && originalPrice > 0) {
    discount = Math.round(((originalPrice - finalPrice) / originalPrice) * 100);
  }

  // Stock extraction: handle units, stock_quantity, text like '14 units' or 'Out of stock'
  let stockQuantity = 10;
  if (product.units !== undefined && product.units !== null && !isNaN(product.units)) {
    stockQuantity = parseInt(product.units, 10);
  } else if (product.stock_quantity !== undefined && product.stock_quantity !== null && !isNaN(product.stock_quantity)) {
    stockQuantity = parseInt(product.stock_quantity, 10);
  } else {
    const stockRaw = String(product.stock || product["Stock"] || "");
    if (/out\s*of\s*stock/i.test(stockRaw) || stockRaw === "0") {
      stockQuantity = 0;
    } else {
      const stockDigits = stockRaw.replace(/\D+/g, "");
      stockQuantity = stockDigits ? parseInt(stockDigits, 10) : 10;
    }
  }
  const inStock = stockQuantity > 0 ? 1 : 0;

  // Images
  let imagesList = [];
  if (Array.isArray(product.images)) {
    imagesList = product.images.filter(Boolean);
  } else if (typeof product.images === "string") {
    imagesList = product.images
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const placeholderSvg =
    "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22600%22%20height%3D%22600%22%20viewBox%3D%220%200%20600%20600%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23f1f5f9%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20font-family%3D%22sans-serif%22%20font-size%3D%2224%22%20font-weight%3D%22bold%22%20fill%3D%22%2394a3b8%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%3ENo%20Image%3C%2Ftext%3E%3C%2Fsvg%3E";
  const primaryImage = imagesList.length > 0 ? imagesList[0] : placeholderSvg;
  const isImageBroken = imagesList.length === 0 ? 1 : 0;
  const isActive = inStock && !isImageBroken ? 1 : 0;

  // Keywords
  let keywordsList = [];
  if (Array.isArray(product.keywords)) {
    keywordsList = product.keywords.filter(Boolean);
  } else if (typeof product.keywords === "string") {
    keywordsList = product.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  }

  // Description & Collapsible Sections
  const descriptionRaw = product.description
    ? String(product.description).trim()
    : "";
  const sections = parseDescriptionSections(descriptionRaw);
  const slug = `${slugify(title)}-${Math.floor(1000 + Math.random() * 9000)}`;

  const numCategoryId = parseInt(categoryId, 10) || 3;
  const numSupplierId = parseInt(supplierId, 10) || 1;

  // Resolve options (defaults to mode = "stock_and_price")
  let mode = "stock_and_price";
  if (typeof options === "string") {
    mode = options;
  } else if (typeof options === "boolean") {
    mode = options ? "stock_and_price" : "full";
  } else if (options && typeof options === "object") {
    if (options.updateMode) {
      mode = options.updateMode;
    } else if (options.onlyUpdateStock === true && options.updatePrice === false) {
      mode = "stock_only";
    } else if (options.fullUpdate === true) {
      mode = "full";
    } else {
      mode = "stock_and_price";
    }
  }

  const findExistingSql = supplierProdId
    ? `SET @existing_id = (SELECT id FROM products WHERE (supplier_id = ${numSupplierId} AND supplier_product_id = ${escapeSql(supplierProdId)}) OR title = ${escapeSql(title)} ORDER BY (supplier_id = ${numSupplierId} AND supplier_product_id = ${escapeSql(supplierProdId)}) DESC LIMIT 1);`
    : `SET @existing_id = (SELECT id FROM products WHERE title = ${escapeSql(title)} LIMIT 1);`;

  let updateSql = "";
  if (mode === "stock_only") {
    // Only update stock, stock_quantity, is_active, last_stock_updated_at & updated_at
    updateSql = `UPDATE products SET
    stock = ${inStock},
    stock_quantity = ${stockQuantity},
    is_active = IF(${inStock} = 1, is_active, 0),
    last_stock_updated_at = NOW(),
    updated_at = NOW()
WHERE id = @existing_id;`;
  } else if (mode === "stock_and_price") {
    // Stock AND Price update: Updates stock, quantity, price, supplier_price, profit_amt, original_price, discount, charges
    // Leaves title, brand, unit, image, images, description, product_details, keywords, weight, category_id, slug UNTOUCHED!
    updateSql = `UPDATE products SET
    stock = ${inStock},
    stock_quantity = ${stockQuantity},
    is_active = IF(${inStock} = 1, is_active, 0),
    price = ${finalPrice.toFixed(2)},
    supplier_price = ${supplierPrice.toFixed(2)},
    profit_amt = ${profitAmt.toFixed(2)},
    original_price = ${originalPrice.toFixed(2)},
    discount = ${discount},
    shipping_charge = ${shippingCharge.toFixed(2)},
    cod_charge = ${codCharge.toFixed(2)},
    tax = ${tax.toFixed(2)},
    shipping_tax = ${shippingTax.toFixed(2)},
    last_stock_updated_at = NOW(),
    updated_at = NOW()
WHERE id = @existing_id;`;
  } else {
    // Full field update
    updateSql = `UPDATE products SET
    title = ${escapeSql(title)},
    brand = 'Generic',
    unit = 'Standard',
    image = ${escapeSql(primaryImage)},
    images = ${escapeSql(JSON.stringify(imagesList))},
    price = ${finalPrice.toFixed(2)},
    supplier_price = ${supplierPrice.toFixed(2)},
    profit_amt = ${profitAmt.toFixed(2)},
    original_price = ${originalPrice.toFixed(2)},
    discount = ${discount},
    stock = ${inStock},
    stock_quantity = ${stockQuantity},
    keywords = ${escapeSql(JSON.stringify(keywordsList))},
    description = ${escapeSql(descriptionRaw)},
    product_details = ${escapeSql(JSON.stringify(sections))},
    is_active = ${isActive},
    is_image_broken = ${isImageBroken},
    supplier_id = ${numSupplierId},
    supplier_product_id = ${escapeSql(supplierProdId || null)},
    supplier_product_url = ${escapeSql(productUrl || null)},
    last_stock_updated_at = NOW(),
    shipping_charge = ${shippingCharge.toFixed(2)},
    cod_charge = ${codCharge.toFixed(2)},
    tax = ${tax.toFixed(2)},
    shipping_tax = ${shippingTax.toFixed(2)},
    weight = ${escapeSql(weight || null)},
    category_id = COALESCE(category_id, ${numCategoryId}),
    updated_at = NOW()
WHERE id = @existing_id;`;
  }

  const sql = `
-- ========================================================
-- Product: ${title.slice(0, 60).replace(/--/g, "")} (Supplier ID: ${supplierProdId || "N/A"})
-- ========================================================
${findExistingSql}

${updateSql}

INSERT INTO products (
    title, slug, brand, unit, image, images, price, supplier_price, profit_amt,
    original_price, discount, stock, stock_quantity, keywords, description,
    product_details, is_active, is_image_broken, supplier_id, supplier_product_id,
    supplier_product_url, last_stock_updated_at, shipping_charge, cod_charge,
    tax, shipping_tax, weight, category_id, created_at, updated_at
)
SELECT
    ${escapeSql(title)},
    ${escapeSql(slug)},
    'Generic',
    'Standard',
    ${escapeSql(primaryImage)},
    ${escapeSql(JSON.stringify(imagesList))},
    ${finalPrice.toFixed(2)},
    ${supplierPrice.toFixed(2)},
    ${profitAmt.toFixed(2)},
    ${originalPrice.toFixed(2)},
    ${discount},
    ${inStock},
    ${stockQuantity},
    ${escapeSql(JSON.stringify(keywordsList))},
    ${escapeSql(descriptionRaw)},
    ${escapeSql(JSON.stringify(sections))},
    ${isActive},
    ${isImageBroken},
    ${numSupplierId},
    ${escapeSql(supplierProdId || null)},
    ${escapeSql(productUrl || null)},
    NOW(),
    ${shippingCharge.toFixed(2)},
    ${codCharge.toFixed(2)},
    ${tax.toFixed(2)},
    ${shippingTax.toFixed(2)},
    ${escapeSql(weight || null)},
    ${numCategoryId},
    NOW(),
    NOW()
WHERE @existing_id IS NULL;
`;
  return sql;
}

/**
 * Generate a complete, ready-to-execute MySQL dump file content from an array of products
 */
function generateSqlDump(products = [], options = {}) {
  const categoryId = parseInt(options.categoryId, 10) || 3;
  const supplierId = parseInt(options.supplierId, 10) || 1;
  const sourceFile = options.sourceFile || "scraped_data.json";

  let mode = "stock_and_price";
  if (typeof options === "string") {
    mode = options;
  } else if (options && typeof options === "object") {
    if (options.updateMode) {
      mode = options.updateMode;
    } else if (options.onlyUpdateStock === true && options.updatePrice === false) {
      mode = "stock_only";
    } else if (options.fullUpdate === true) {
      mode = "full";
    } else {
      mode = "stock_and_price";
    }
  }

  const productList = Array.isArray(products)
    ? products
    : products && typeof products === "object"
      ? [products]
      : [];

  const timestamp = new Date().toISOString();

  let modeDescription = "STOCK & PRICE UPDATE (stock, quantities, prices, original_price, discount, charges, status, timestamps)";
  if (mode === "stock_only") {
    modeDescription = "STOCK ONLY UPDATE (stock, stock_quantity, is_active, last_stock_updated_at)";
  } else if (mode === "full") {
    modeDescription = "FULL PRODUCT OVERWRITE";
  }

  let output = `-- -------------------------------------------------------------
-- DoublyShop - Raw MySQL Product Import Dump
-- Generated at: ${timestamp}
-- Source Dataset: ${sourceFile}
-- Target Category ID: ${categoryId}
-- Target Supplier ID: ${supplierId}
-- Total Records: ${productList.length}
-- Architecture: Matches Laravel ImportProductsJob & UpdateProductStockFromScrapJob
-- Existing Product Mode: ${modeDescription}
-- -------------------------------------------------------------

SET NAMES utf8mb4;
SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;
SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO';
START TRANSACTION;

`;

  let validCount = 0;
  productList.forEach((prod) => {
    const itemSql = generateProductSql(prod, categoryId, supplierId, {
      updateMode: mode,
    });
    if (itemSql.trim()) {
      output += itemSql + "\n";
      validCount++;
    }
  });

  output += `
-- -------------------------------------------------------------
-- Finalizing Transaction (${validCount} products processed)
-- -------------------------------------------------------------
COMMIT;
SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;

-- Dump completed successfully.
`;

  return output;
}

module.exports = {
  escapeSql,
  slugify,
  parseDescriptionSections,
  generateProductSql,
  generateSqlDump,
};
