# Product Scrapping - Project Memory & Agent Guidelines

> **IMPORTANT**: Read this memory document thoroughly before starting any development, debugging, or execution tasks in this repository.

---

## 1. Project Overview & Architecture

This repository is an automated web scraper and management dashboard for **wukusy.app** built with Node.js, Express, Socket.IO, and Playwright.

### Key Components

- **`server.js`**: Express server & Socket.IO server. Provides REST APIs (`/api/auth/status`, `/api/files`, `/api/files/:filename/excel`, etc.) and static dashboard serving from `public/`.
- **`lib/runner.js`**: `TaskRunnerManager` class that manages background task execution (`scrape-ids`, `scrape-details`, `update-prices`, `auto-scrape`), reports progress & real-time logs via Socket.IO, and handles task cancellation gracefully.
- **`auto_scraper.js`**: Automated 1-Click multi-page scraper pipeline combining ID extraction, details scraping, and price calculation/updating sequentially across pages. Dynamically extracts start page from target URL query parameters (e.g., `?page=6` starts from page 6, defaulting to page 1 if omitted).
- **`product_id.js`**: Scrapes supplier product IDs and category links from wukusy.app.
- **`product_details.js`**: Scrapes detailed product info (Title, Keywords, Cost Price, Profit %, Final Price, Stock, Weight, Supplier Rating, Product Images, Description).
- **`update_price.js`**: Re-scrapes and updates price/stock details for existing products.
- **`index.js`**: Manual interactive Playwright session handler to capture and save session cookies into `auth.json`.
- **`auth.json`**: Saved browser storage state (cookies & origin storage) for authenticated Playwright contexts.
- **`data/`**: Storage directory where scraped JSON data files are saved and read from.
- **`public/`**: Frontend dashboard for controlling scraper tasks, monitoring real-time Socket.IO logs, and downloading Excel exports.

---

## 2. Essential Commands & Workflows

### Starting the Server
```bash
npm start
# Or specifying a custom port:
node server.js --port 8090
```

### Session Authentication setup
If scraper sessions expire or `auth.json` is missing:
```bash
node index.js
```
Follow on-screen instructions to log into wukusy.app and save the browser storage state to `auth.json`.

---

## 3. Data Flow & File Structure Rules

1. **Scraped Output Location**: All JSON data files MUST be saved inside the `data/` directory (e.g., `data/category_3_ids.json` or `data/products_details.json`).
2. **Excel Exporting**: Express API route `/api/files/:filename/excel` converts JSON datasets dynamically into `.xlsx` format using `xlsx` library.
3. **Session Re-use**: Always instantiate Playwright contexts with `fs.existsSync("auth.json") ? { storageState: "auth.json" } : {}`.

---

## 4. Coding Standards & Agent Guidelines

- **Module System**: Node.js CommonJS (`require` and `module.exports`).
- **Cancellation Signal Handling**: When creating or modifying scraper loops, ALWAYS respect the `shouldStop()` check to allow users to cancel active tasks cleanly from the UI dashboard.
- **Socket.IO Logging**: Pass `onLog(message, type)` and `onProgress(current, total, statusText, item)` callbacks in scraper functions so the frontend receives real-time updates.
- **Error Handling**: Wrap Playwright network requests in `try...catch` blocks to handle temporary DOM changes, timeouts, or selector updates gracefully without crashing the task runner.
- **Browser Context Cleanup**: Ensure browser instances and pages are closed in `finally` blocks.

---

## 5. Important Endpoints

- `GET /api/auth/status`: Checks if `auth.json` exists and returns cookie count.
- `GET /api/files`: Lists available JSON datasets in `data/` directory with item counts.
- `GET /api/files/:filename/excel`: Generates and downloads an Excel file from a JSON dataset.
- `POST /api/files/bulk-delete`: Deletes multiple selected JSON files simultaneously.
- `POST /api/files/bulk-download/json`: Bundles selected JSON files into a `.zip` archive download.
- `POST /api/files/bulk-download/excel`: Exports selected JSON datasets to `.xlsx` format bundled inside a `.zip` archive.
- `POST /api/files/bulk-download/combined-excel`: Combines selected JSON datasets into a single Excel `.xlsx` workbook with separate sheets for each file.
- `POST /api/tasks/run`: Triggers a background scraper task.
- `POST /api/tasks/stop`: Stops the currently active task runner.
