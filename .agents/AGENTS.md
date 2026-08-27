# Agent Guidelines & Memory

Before starting any task in this codebase, please review the project memory document:
- [MEMORY.md](file:///home/neeraj/Public/node/scrapping/product_scrapping/MEMORY.md)

## Workspace Rules
1. **Module Syntax**: Use CommonJS (`require`/`module.exports`).
2. **Data Directory**: Always store generated/scraped datasets inside `data/`.
3. **Session Check**: Verify `auth.json` state before initiating Playwright tasks.
4. **Task Runner Integration**: Pass `onLog`, `onProgress`, and `shouldStop` callbacks when running scraping subroutines via `lib/runner.js`.
