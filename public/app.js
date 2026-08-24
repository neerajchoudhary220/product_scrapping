/**
 * ScrapeHub Pro Studio - Main Application Logic
 */

document.addEventListener("DOMContentLoaded", () => {
  // Initialize Socket.io Connection
  const socket = io();

  // State Variables
  let currentActiveTab = "tab-dashboard";
  let activeJsonFileName = null;
  let activeJsonRawData = null;
  let activeJsonParsedData = null;
  let currentJsonViewMode = "tree"; // 'tree' or 'raw'
  let logCount = 0;
  let activeLogFilter = "all";
  let autoScrollLogs = true;

  // DOM Element References
  const connectionBadge = document.getElementById("connection-badge");
  const connectionText = document.getElementById("connection-text");
  const taskBadge = document.getElementById("task-badge");
  const taskText = document.getElementById("task-text");
  const btnGlobalStop = document.getElementById("btn-global-stop");

  const progressBanner = document.getElementById("progress-banner");
  const progressTaskName = document.getElementById("progress-task-name");
  const progressItemId = document.getElementById("progress-item-id");
  const progressCounter = document.getElementById("progress-counter");
  const progressPercentText = document.getElementById("progress-percent-text");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const progressStatusText = document.getElementById("progress-status-text");

  const terminalOutput = document.getElementById("terminal-output");
  const badgeLogCount = document.getElementById("badge-log-count");
  const toastContainer = document.getElementById("toast-container");

  // ==========================================================================
  // SOCKET.IO EVENT HANDLERS
  // ==========================================================================

  socket.on("connect", () => {
    connectionBadge.className = "status-badge badge-connected";
    connectionText.textContent = "Connected";
    showToast("info", "Server Connected", "Real-time socket channel established.");
    fetchAuthStatus();
    fetchFiles();
  });

  socket.on("disconnect", () => {
    connectionBadge.className = "status-badge badge-disconnected";
    connectionText.textContent = "Disconnected";
    showToast("warn", "Connection Lost", "Attempting to reconnect to server...");
  });

  socket.on("status-update", (status) => {
    updateRunnerStatusUI(status.isRunning, status.activeTask);
  });

  socket.on("task-started", (task) => {
    updateRunnerStatusUI(true, task);
    const names = {
      "scrape-ids": "Extract Product IDs Engine",
      "scrape-details": "Extract Product Details Engine",
      "update-prices": "Price Updater Engine"
    };
    progressTaskName.textContent = names[task.type] || "Running Process...";
    progressBanner.style.display = "flex";
    showToast("info", "Task Started", `Process [${task.type}] has been launched.`);
  });

  socket.on("task-log", (log) => {
    appendLogLine(log);
  });

  socket.on("task-progress", (prog) => {
    const { current, total, percentage, statusText, item } = prog;
    progressBanner.style.display = "flex";
    progressCounter.textContent = `${current} / ${total}`;
    progressPercentText.textContent = `${percentage}%`;
    progressBarFill.style.width = `${percentage}%`;
    progressStatusText.textContent = statusText || "Processing...";
    if (item) {
      progressItemId.textContent = `ID: ${item}`;
      progressItemId.style.display = "inline-block";
    } else {
      progressItemId.style.display = "none";
    }
  });

  socket.on("task-completed", (res) => {
    updateRunnerStatusUI(false);
    progressBanner.style.display = "none";
    showToast("success", "Task Finished 🎉", `Completed successfully! Output file saved.`);
    fetchFiles();
  });

  socket.on("task-failed", (res) => {
    updateRunnerStatusUI(false);
    progressBanner.style.display = "none";
    const msg = res.isCancelled ? "Task cancelled by user." : res.error;
    showToast(res.isCancelled ? "warn" : "error", res.isCancelled ? "Stopped" : "Task Failed", msg);
    fetchFiles();
  });

  function updateRunnerStatusUI(isRunning, activeTask = null) {
    if (isRunning) {
      taskBadge.className = "status-badge badge-running";
      taskText.textContent = activeTask ? `Running (${activeTask.type})` : "Running";
      btnGlobalStop.style.display = "inline-flex";
    } else {
      taskBadge.className = "status-badge badge-idle";
      taskText.textContent = "Idle";
      btnGlobalStop.style.display = "none";
    }
  }

  // ==========================================================================
  // NAVIGATION TABS
  // ==========================================================================

  const navItems = document.querySelectorAll(".nav-item");
  const tabPanes = document.querySelectorAll(".tab-pane");
  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");

  const tabMeta = {
    "tab-dashboard": { title: "Dashboard Overview", subtitle: "Real-time control & scraping manager" },
    "tab-scrape-ids": { title: "Scrape Product IDs", subtitle: "Extract product IDs from category URLs" },
    "tab-scrape-details": { title: "Scrape Product Details", subtitle: "Extract price, stock, weight, rating & description" },
    "tab-update-price": { title: "Price Calculation & Updater", subtitle: "Calculate cart total & apply profit margin" },
    "tab-json-studio": { title: "JSON Studio & Data Viewer", subtitle: "Inspect, edit, search and download JSON datasets" },
    "tab-terminal": { title: "Live Process Console", subtitle: "Real-time terminal execution log output" }
  };

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const targetTab = item.getAttribute("data-tab");
      switchTab(targetTab);
    });
  });

  function switchTab(tabId) {
    currentActiveTab = tabId;
    navItems.forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
    });
    tabPanes.forEach((pane) => {
      pane.classList.toggle("active", pane.id === tabId);
    });

    if (tabMeta[tabId]) {
      pageTitle.textContent = tabMeta[tabId].title;
      pageSubtitle.textContent = tabMeta[tabId].subtitle;
    }

    if (tabId === "tab-json-studio") {
      fetchFiles();
    }
  }

  // Handle Quick Launcher Buttons on Dashboard
  document.querySelectorAll(".launcher-card").forEach((card) => {
    card.addEventListener("click", () => {
      const launchType = card.getAttribute("data-launch");
      if (launchType === "ids") switchTab("tab-scrape-ids");
      if (launchType === "details") switchTab("tab-scrape-details");
      if (launchType === "prices") switchTab("tab-update-price");
    });
  });

  // Global Stop Button
  btnGlobalStop.addEventListener("click", () => {
    socket.emit("stop-task");
    showToast("warn", "Stopping...", "Sent cancellation request to server.");
  });

  // ==========================================================================
  // API FETCH & STATS UPDATE
  // ==========================================================================

  async function fetchAuthStatus() {
    try {
      const res = await fetch("/api/auth/status");
      const data = await res.json();
      const sessionStatusText = document.getElementById("session-status-text");
      const statAuthState = document.getElementById("stat-auth-state");
      
      if (data.hasAuth) {
        sessionStatusText.textContent = `Valid Session (${data.cookiesCount} cookies)`;
        sessionStatusText.style.color = "var(--color-emerald)";
        statAuthState.textContent = "Saved & Ready";
      } else {
        sessionStatusText.textContent = "No auth.json Session!";
        sessionStatusText.style.color = "var(--color-gold)";
        statAuthState.textContent = "Missing auth.json";
      }
    } catch (e) {}
  }

  async function fetchFiles() {
    try {
      const res = await fetch("/api/files");
      const data = await res.json();
      renderDashboardFilesTable(data.files || []);
      renderJsonSidebarFiles(data.files || []);
      updateDashboardStats(data.files || []);
      populateSelectOptions(data.files || []);
    } catch (e) {
      console.error("Failed to fetch files:", e);
    }
  }

  function updateDashboardStats(files) {
    document.getElementById("stat-json-files").textContent = files.length;
    let totalIds = 0;
    let totalProducts = 0;

    files.forEach((f) => {
      if (f.name.startsWith("product_") || f.name.includes("ids")) {
        totalIds += f.itemCount || 0;
      }
      if (f.name.startsWith("products-data_") || f.name.includes("data")) {
        totalProducts += f.itemCount || 0;
      }
    });

    document.getElementById("stat-total-ids").textContent = totalIds;
    document.getElementById("stat-total-products").textContent = totalProducts;
  }

  function renderDashboardFilesTable(files) {
    const tbody = document.querySelector("#dashboard-files-table tbody");
    if (!files.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center">No JSON files found in project.</td></tr>`;
      return;
    }

    tbody.innerHTML = files.map((f) => {
      const sizeKB = (f.size / 1024).toFixed(1) + " KB";
      const mtime = new Date(f.mtime).toLocaleString();
      const isProtected = f.name === "auth.json";

      return `
        <tr>
          <td><strong style="color: var(--color-cyan)"><i class="fa-solid fa-file-code"></i> ${f.name}</strong></td>
          <td>${sizeKB}</td>
          <td><span class="badge-item-count">${f.itemCount} items</span></td>
          <td style="font-size: 11px; color: var(--text-dim);">${mtime}</td>
          <td>
            <div class="action-btn-group">
              <button class="btn btn-secondary btn-sm btn-open-json" data-filename="${f.name}">
                <i class="fa-solid fa-eye"></i> View
              </button>
              ${isProtected 
                ? `<span class="badge-item-count text-gold" style="font-size: 11px;"><i class="fa-solid fa-lock"></i> Read Only</span>`
                : `<button class="btn btn-danger btn-sm btn-delete-file-table" data-filename="${f.name}" title="Delete file">
                    <i class="fa-solid fa-trash-can"></i>
                   </button>`
              }
            </div>
          </td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll(".btn-open-json").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fn = btn.getAttribute("data-filename");
        switchTab("tab-json-studio");
        loadJsonFile(fn);
      });
    });

    tbody.querySelectorAll(".btn-delete-file-table").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const fn = btn.getAttribute("data-filename");
        deleteJsonFile(fn);
      });
    });
  }

  function populateSelectOptions(files) {
    const detailsSelect = document.getElementById("details-input-file");
    const priceSelect = document.getElementById("price-input-file");

    const jsonNames = files.map((f) => f.name);

    if (jsonNames.length > 0) {
      detailsSelect.innerHTML = jsonNames.map(f => `<option value="${f}">${f}</option>`).join("");
      priceSelect.innerHTML = jsonNames.map(f => `<option value="${f}">${f}</option>`).join("");

      // Select logical defaults if exist
      if (jsonNames.includes("product_1.json")) detailsSelect.value = "product_1.json";
      if (jsonNames.includes("products-data_1.json")) priceSelect.value = "products-data_1.json";
    }
  }

  document.getElementById("btn-refresh-dashboard-files").addEventListener("click", fetchFiles);

  // ==========================================================================
  // ENGINE FORMS SUBMISSION
  // ==========================================================================

  // Preset chip handlers
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.getElementById("ids-link").value = chip.getAttribute("data-url");
    });
  });

  document.querySelectorAll(".chip-percent").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.getElementById("price-profit-margin").value = chip.getAttribute("data-val");
    });
  });

  // Scrape IDs Form
  document.getElementById("form-scrape-ids").addEventListener("submit", (e) => {
    e.preventDefault();
    const link = document.getElementById("ids-link").value.trim();
    const outputFile = document.getElementById("ids-output-file").value.trim();
    const headless = document.getElementById("ids-headless").checked;

    socket.emit("start-task", {
      taskType: "scrape-ids",
      payload: { link, outputFile, headless }
    });
  });

  // Scrape Details Form
  document.getElementById("form-scrape-details").addEventListener("submit", (e) => {
    e.preventDefault();
    const inputFile = document.getElementById("details-input-file").value;
    const outputFile = document.getElementById("details-output-file").value.trim();
    const headless = document.getElementById("details-headless").checked;

    socket.emit("start-task", {
      taskType: "scrape-details",
      payload: { inputFile, outputFile, headless }
    });
  });

  // Update Price Form
  document.getElementById("form-update-price").addEventListener("submit", (e) => {
    e.preventDefault();
    const inputFile = document.getElementById("price-input-file").value;
    const profitPercentage = Number(document.getElementById("price-profit-margin").value);
    const categoryUrl = document.getElementById("price-category-url").value.trim();
    const headless = document.getElementById("price-headless").checked;

    socket.emit("start-task", {
      taskType: "update-prices",
      payload: { inputFile, profitPercentage, categoryUrl, headless }
    });
  });

  // ==========================================================================
  // JSON STUDIO & VIEWER
  // ==========================================================================

  const jsonSidebarFileList = document.getElementById("json-sidebar-file-list");
  const jsonActiveFilename = document.getElementById("json-active-filename");
  const jsonItemCount = document.getElementById("json-item-count");
  const jsonTreeView = document.getElementById("json-tree-view");
  const jsonRawView = document.getElementById("json-raw-view");
  const jsonTextarea = document.getElementById("json-textarea");
  const jsonValidityStatus = document.getElementById("json-validity-status");
  const jsonSearchInput = document.getElementById("json-search-input");

  const btnViewModeTree = document.getElementById("view-mode-tree");
  const btnViewModeRaw = document.getElementById("view-mode-raw");

  const btnDeleteJson = document.getElementById("btn-delete-json");

  function renderJsonSidebarFiles(files) {
    if (!files.length) {
      jsonSidebarFileList.innerHTML = `<li class="placeholder-text">No JSON files</li>`;
      return;
    }

    jsonSidebarFileList.innerHTML = files.map((f) => {
      const activeClass = f.name === activeJsonFileName ? "active" : "";
      const isProtected = f.name === "auth.json";

      return `
        <li class="file-item ${activeClass}" data-filename="${f.name}">
          <span><i class="fa-solid fa-file-code"></i> ${f.name}</span>
          <div class="file-item-right">
            <span class="file-size">${f.itemCount || 0} items</span>
            ${isProtected 
              ? `<i class="fa-solid fa-lock text-gold" title="Read Only (auth.json)"></i>`
              : `<button class="btn-sidebar-delete" data-filename="${f.name}" title="Delete ${f.name}"><i class="fa-solid fa-trash-can"></i></button>`
            }
          </div>
        </li>
      `;
    }).join("");

    jsonSidebarFileList.querySelectorAll(".file-item").forEach((item) => {
      item.addEventListener("click", () => {
        const fn = item.getAttribute("data-filename");
        loadJsonFile(fn);
      });
    });

    jsonSidebarFileList.querySelectorAll(".btn-sidebar-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const fn = btn.getAttribute("data-filename");
        deleteJsonFile(fn);
      });
    });
  }

  document.getElementById("btn-refresh-json-list").addEventListener("click", fetchFiles);

  async function loadJsonFile(filename) {
    activeJsonFileName = filename;
    jsonActiveFilename.textContent = filename;
    renderJsonSidebarFiles(getCurrentlyKnownFiles());

    // Protected file handling (e.g. auth.json)
    const isProtected = filename === "auth.json";
    if (btnDeleteJson) {
      btnDeleteJson.style.display = isProtected ? "none" : "inline-flex";
    }

    try {
      const res = await fetch(`/api/files/${encodeURIComponent(filename)}`);
      const fileRes = await res.json();

      activeJsonRawData = fileRes.raw || "";
      activeJsonParsedData = fileRes.data !== undefined ? fileRes.data : null;

      jsonTextarea.value = activeJsonRawData;
      
      let items = 0;
      if (Array.isArray(activeJsonParsedData)) items = activeJsonParsedData.length;
      else if (activeJsonParsedData && typeof activeJsonParsedData === "object") items = Object.keys(activeJsonParsedData).length;
      jsonItemCount.textContent = `${items} items`;

      if (isProtected) {
        jsonValidityStatus.innerHTML = `<i class="fa-solid fa-lock text-gold"></i> Protected Auth Session File (Read-Only)`;
      } else {
        jsonValidityStatus.innerHTML = `<i class="fa-solid fa-circle-check text-emerald"></i> Valid JSON`;
      }

      renderCurrentJsonView();
    } catch (e) {
      showToast("error", "Error Loading File", e.message);
    }
  }

  async function deleteJsonFile(filename) {
    if (filename === "auth.json" || filename === "package.json" || filename === "package-lock.json") {
      showToast("warn", "Protected File", "auth.json is protected and cannot be deleted.");
      return;
    }

    if (!confirm(`Are you sure you want to delete "${filename}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/files/${encodeURIComponent(filename)}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", "File Deleted", `File "${filename}" deleted successfully.`);
        if (activeJsonFileName === filename) {
          activeJsonFileName = null;
          jsonActiveFilename.textContent = "No File Selected";
          jsonItemCount.textContent = "0 items";
          jsonTreeView.innerHTML = `<div class="placeholder-text">Select a JSON file from the left sidebar to view content</div>`;
          jsonTextarea.value = "";
          if (btnDeleteJson) btnDeleteJson.style.display = "none";
        }
        fetchFiles();
      } else {
        throw new Error(data.error || "Deletion failed");
      }
    } catch (err) {
      showToast("error", "Delete Failed", err.message);
    }
  }

  if (btnDeleteJson) {
    btnDeleteJson.addEventListener("click", () => {
      if (activeJsonFileName) {
        deleteJsonFile(activeJsonFileName);
      }
    });
  }

  function getCurrentlyKnownFiles() {
    const items = [];
    jsonSidebarFileList.querySelectorAll(".file-item").forEach((el) => {
      items.push({ name: el.getAttribute("data-filename") });
    });
    return items;
  }

  // Toggle View Modes
  btnViewModeTree.addEventListener("click", () => {
    currentJsonViewMode = "tree";
    btnViewModeTree.classList.add("active");
    btnViewModeRaw.classList.remove("active");
    jsonTreeView.style.display = "block";
    jsonRawView.style.display = "none";
    renderCurrentJsonView();
  });

  btnViewModeRaw.addEventListener("click", () => {
    currentJsonViewMode = "raw";
    btnViewModeRaw.classList.add("active");
    btnViewModeTree.classList.remove("active");
    jsonRawView.style.display = "flex";
    jsonTreeView.style.display = "none";
  });

  // Validate Raw Textarea Input in real time
  jsonTextarea.addEventListener("input", () => {
    try {
      activeJsonParsedData = JSON.parse(jsonTextarea.value);
      jsonValidityStatus.innerHTML = `<i class="fa-solid fa-circle-check text-emerald"></i> Valid JSON`;
    } catch (err) {
      jsonValidityStatus.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-gold"></i> Invalid JSON Syntax`;
    }
  });

  function renderCurrentJsonView() {
    if (activeJsonParsedData === null && !activeJsonRawData) {
      jsonTreeView.innerHTML = `<div class="placeholder-text">Select a JSON file from the left sidebar to view content</div>`;
      return;
    }

    if (activeJsonParsedData !== null) {
      jsonTreeView.innerHTML = "";
      jsonTreeView.appendChild(buildTreeDom(activeJsonParsedData, "root"));
    } else {
      jsonTreeView.innerHTML = `<div class="placeholder-text">Invalid JSON structure. Switch to Raw Code view to fix.</div>`;
    }
  }

  // Interactive Tree View DOM Builder
  function buildTreeDom(data, keyName = "") {
    const container = document.createElement("div");
    container.className = "tree-node";

    if (typeof data === "object" && data !== null) {
      const isArray = Array.isArray(data);
      const keys = Object.keys(data);

      const header = document.createElement("div");
      header.className = "tree-header";

      const toggle = document.createElement("span");
      toggle.className = "tree-toggle";
      toggle.innerHTML = `<i class="fa-solid fa-caret-down"></i>`;
      
      const keySpan = document.createElement("span");
      keySpan.className = "tree-key";
      keySpan.textContent = keyName ? `${keyName}: ` : "";

      const metaSpan = document.createElement("span");
      metaSpan.className = "tree-null";
      metaSpan.textContent = isArray ? `Array(${keys.length}) [` : `Object {`;

      header.appendChild(toggle);
      header.appendChild(keySpan);
      header.appendChild(metaSpan);
      container.appendChild(header);

      const childrenContainer = document.createElement("div");
      childrenContainer.className = "tree-children";

      keys.forEach((key) => {
        childrenContainer.appendChild(buildTreeDom(data[key], key));
      });

      const closingSpan = document.createElement("div");
      closingSpan.className = "tree-null";
      closingSpan.textContent = isArray ? `]` : `}`;
      childrenContainer.appendChild(closingSpan);

      container.appendChild(childrenContainer);

      // Expand/Collapse toggle logic
      let expanded = true;
      toggle.addEventListener("click", () => {
        expanded = !expanded;
        childrenContainer.style.display = expanded ? "block" : "none";
        toggle.innerHTML = expanded ? `<i class="fa-solid fa-caret-down"></i>` : `<i class="fa-solid fa-caret-right"></i>`;
        metaSpan.textContent = expanded 
          ? (isArray ? `Array(${keys.length}) [` : `Object {`)
          : (isArray ? `Array(${keys.length}) [...]` : `Object { ... }`);
      });

    } else {
      // Primitive values
      const line = document.createElement("div");
      line.className = "tree-primitive";

      const keySpan = document.createElement("span");
      keySpan.className = "tree-key";
      keySpan.textContent = `${keyName}: `;

      const valSpan = document.createElement("span");
      if (typeof data === "string") {
        valSpan.className = "tree-string";
        valSpan.textContent = `"${data}"`;
      } else if (typeof data === "number") {
        valSpan.className = "tree-number";
        valSpan.textContent = data;
      } else if (typeof data === "boolean") {
        valSpan.className = "tree-boolean";
        valSpan.textContent = data;
      } else {
        valSpan.className = "tree-null";
        valSpan.textContent = "null";
      }

      line.appendChild(keySpan);
      line.appendChild(valSpan);
      container.appendChild(line);
    }

    return container;
  }

  // Save Changes
  document.getElementById("btn-save-json").addEventListener("click", async () => {
    if (!activeJsonFileName) {
      showToast("warn", "No File Selected", "Please select a file to save.");
      return;
    }

    const content = jsonTextarea.value;
    try {
      JSON.parse(content); // Validate before saving
    } catch (e) {
      showToast("error", "Syntax Error", "Cannot save invalid JSON code.");
      return;
    }

    try {
      const res = await fetch(`/api/files/${encodeURIComponent(activeJsonFileName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      const data = await res.json();

      if (data.success) {
        showToast("success", "Saved!", `File ${activeJsonFileName} saved successfully.`);
        fetchFiles();
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      showToast("error", "Save Failed", err.message);
    }
  });

  // Copy JSON
  document.getElementById("btn-copy-json").addEventListener("click", () => {
    if (!jsonTextarea.value) return;
    navigator.clipboard.writeText(jsonTextarea.value);
    showToast("info", "Copied", "JSON content copied to clipboard!");
  });

  // Download JSON
  document.getElementById("btn-download-json").addEventListener("click", () => {
    if (!activeJsonFileName || !jsonTextarea.value) return;
    const blob = new Blob([jsonTextarea.value], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = activeJsonFileName;
    a.click();
    URL.revokeObjectURL(url);
    showToast("success", "Downloading", `Downloading ${activeJsonFileName}`);
  });

  // Search in Tree View
  jsonSearchInput.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (!query) {
      renderCurrentJsonView();
      return;
    }

    const nodes = jsonTreeView.querySelectorAll(".tree-primitive, .tree-header");
    nodes.forEach((node) => {
      const text = node.textContent.toLowerCase();
      if (text.includes(query)) {
        node.style.background = "rgba(6, 182, 212, 0.2)";
      } else {
        node.style.background = "transparent";
      }
    });
  });

  // ==========================================================================
  // LIVE CONSOLE TERMINAL LOGS
  // ==========================================================================

  function appendLogLine(log) {
    logCount++;
    badgeLogCount.textContent = logCount;

    const line = document.createElement("div");
    line.className = `log-line ${log.type || "info"}`;
    line.setAttribute("data-type", log.type || "info");

    line.innerHTML = `
      <span class="timestamp">[${log.timestamp || new Date().toLocaleTimeString()}]</span>
      <span class="log-msg">${escapeHtml(log.message)}</span>
    `;

    if (activeLogFilter !== "all" && log.type !== activeLogFilter) {
      line.style.display = "none";
    }

    terminalOutput.appendChild(line);

    if (autoScrollLogs) {
      terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }
  }

  // Terminal Action Controls
  document.getElementById("btn-clear-logs").addEventListener("click", () => {
    terminalOutput.innerHTML = "";
    logCount = 0;
    badgeLogCount.textContent = 0;
  });

  document.getElementById("btn-copy-logs").addEventListener("click", () => {
    const text = Array.from(terminalOutput.querySelectorAll(".log-line"))
      .map(line => line.innerText)
      .join("\n");
    navigator.clipboard.writeText(text);
    showToast("info", "Copied", "Console logs copied to clipboard!");
  });

  document.getElementById("chk-auto-scroll").addEventListener("change", (e) => {
    autoScrollLogs = e.target.checked;
  });

  // Filter Buttons
  document.querySelectorAll(".btn-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-filter").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeLogFilter = btn.getAttribute("data-filter");

      const lines = terminalOutput.querySelectorAll(".log-line");
      lines.forEach((line) => {
        const type = line.getAttribute("data-type");
        if (activeLogFilter === "all" || type === activeLogFilter) {
          line.style.display = "flex";
        } else {
          line.style.display = "none";
        }
      });
    });
  });

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ==========================================================================
  // TOAST NOTIFICATIONS
  // ==========================================================================

  function showToast(type = "info", title, message) {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    const icons = {
      success: '<i class="fa-solid fa-circle-check toast-icon"></i>',
      error: '<i class="fa-solid fa-circle-xmark toast-icon"></i>',
      warn: '<i class="fa-solid fa-triangle-exclamation toast-icon"></i>',
      info: '<i class="fa-solid fa-circle-info toast-icon"></i>'
    };

    toast.innerHTML = `
      ${icons[type] || icons.info}
      <div class="toast-content">
        <span class="toast-title">${escapeHtml(title)}</span>
        <span class="toast-msg">${escapeHtml(message)}</span>
      </div>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(100%)";
      toast.style.transition = "all 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Initial Load Call
  fetchFiles();
  fetchAuthStatus();
});
