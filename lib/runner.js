const fs = require("fs");
const path = require("path");
const { scrapeProductIds } = require("../product_id");
const { scrapeProductDetails } = require("../product_details");
const { updateProductPrices } = require("../update_price");
const { autoScrapeMultiPage } = require("../auto_scraper");

const HISTORY_FILE = path.join(__dirname, "../data/task_history.json");

class TaskRunnerManager {
  constructor() {
    this.activeTask = null;
    this.taskQueue = [];
    this.taskHistory = [];
    this.isProcessingQueue = false;
    this.stopRequested = false;
    this.io = null;

    this.loadHistory();
  }

  loadHistory() {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
        this.taskHistory = JSON.parse(raw);
      } else {
        this.taskHistory = [];
      }
    } catch (e) {
      this.taskHistory = [];
    }
  }

  saveHistory() {
    try {
      const dataDir = path.dirname(HISTORY_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.taskHistory, null, 2), "utf-8");
    } catch (e) {
      console.error("Error saving task history:", e.message);
    }
  }

  setSocketIO(io) {
    this.io = io;
  }

  isTaskRunning() {
    return this.activeTask !== null;
  }

  getActiveTaskInfo() {
    return this.activeTask;
  }

  getQueueStatus() {
    return {
      activeTask: this.activeTask,
      queue: this.taskQueue,
      queueLength: this.taskQueue.length,
      history: this.taskHistory,
      isProcessing: this.isProcessingQueue,
    };
  }

  broadcastQueueState() {
    if (this.io) {
      this.io.emit("queue-updated", this.getQueueStatus());
    }
  }

  stopCurrentTask() {
    if (this.activeTask) {
      this.stopRequested = true;
      this.broadcastLog(`⏹️ Cancellation requested by user for active task...`, "warn");
      return true;
    }
    return false;
  }

  removeQueuedTask(taskId) {
    const index = this.taskQueue.findIndex((t) => t.id === taskId);
    if (index !== -1) {
      const removed = this.taskQueue.splice(index, 1)[0];
      this.broadcastLog(`🗑️ Removed queued task [${removed.type}] from queue.`, "info");
      this.broadcastQueueState();
      return true;
    }
    return false;
  }

  clearQueue() {
    const count = this.taskQueue.length;
    this.taskQueue = [];
    this.broadcastLog(`🧹 Cleared ${count} pending task(s) from queue.`, "info");
    this.broadcastQueueState();
    return count;
  }

  clearHistory() {
    const count = this.taskHistory.length;
    this.taskHistory = [];
    this.saveHistory();
    this.broadcastLog(`🧹 Cleared ${count} completed task history log(s).`, "info");
    this.broadcastQueueState();
    return count;
  }

  broadcastLog(message, type = "info") {
    const logEvent = {
      timestamp: new Date().toLocaleTimeString(),
      type, // 'info' | 'success' | 'warn' | 'error'
      message,
    };
    if (this.io) {
      this.io.emit("task-log", logEvent);
    }
    console.log(`[${logEvent.timestamp}] [${type.toUpperCase()}] ${message}`);
  }

  broadcastProgress(current, total, statusText = "", item = null) {
    const percentage =
      total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const progressEvent = {
      current,
      total,
      percentage,
      statusText,
      item,
      taskType: this.activeTask ? this.activeTask.type : null,
    };
    if (this.io) {
      this.io.emit("task-progress", progressEvent);
    }
  }

  /**
   * Enqueue a new task. Runs immediately if idle, else adds to pending queue.
   */
  async enqueueTask(taskType, payload = {}) {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const taskItem = {
      id: taskId,
      type: taskType,
      payload,
      addedAt: new Date().toISOString(),
    };

    if (this.isTaskRunning() || this.isProcessingQueue) {
      this.taskQueue.push(taskItem);
      const position = this.taskQueue.length;
      this.broadcastLog(
        `📥 Task [${taskType.toUpperCase()}] added to Queue (Position #${position})`,
        "info"
      );
      if (this.io) {
        this.io.emit("task-enqueued", {
          taskId,
          taskType,
          position,
          task: taskItem,
        });
      }
      this.broadcastQueueState();
      return { isQueued: true, position, task: taskItem };
    } else {
      this.taskQueue.push(taskItem);
      this.broadcastQueueState();
      // Trigger background processing asynchronously
      this.processQueue();
      return { isQueued: false, task: taskItem };
    }
  }

  /**
   * Process the task queue sequentially
   */
  async processQueue() {
    if (this.isProcessingQueue || this.activeTask !== null || this.taskQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    const nextTask = this.taskQueue.shift();

    try {
      await this.executeTask(nextTask);
    } catch (error) {
      console.error(`Task execution error in queue: ${error.message}`);
    } finally {
      this.isProcessingQueue = false;
      this.broadcastQueueState();

      // Automatically trigger next task in queue if available
      if (this.taskQueue.length > 0) {
        this.broadcastLog(`🔄 Moving to next task in queue (${this.taskQueue.length} remaining)...`, "info");
        setTimeout(() => this.processQueue(), 500);
      }
    }
  }

  /**
   * Internal runner to execute a single task item
   */
  async executeTask(taskItem) {
    const { id: taskId, type: taskType, payload } = taskItem;
    const startTimeMs = Date.now();
    this.stopRequested = false;
    this.activeTask = {
      id: taskId,
      type: taskType,
      payload,
      startTime: new Date().toISOString(),
    };

    if (this.io) {
      this.io.emit("task-started", this.activeTask);
    }
    this.broadcastQueueState();

    this.broadcastLog(`▶️ Started Task: [${taskType.toUpperCase()}]`, "info");
    this.broadcastProgress(0, 100, "Starting process...");

    const shouldStop = () => this.stopRequested;
    const onLog = (msg, type) => this.broadcastLog(msg, type);
    const onProgress = (curr, tot, text, item) =>
      this.broadcastProgress(curr, tot, text, item);

    try {
      let result;
      if (taskType === "scrape-ids") {
        result = await scrapeProductIds(payload, onLog, onProgress, shouldStop);
      } else if (taskType === "scrape-details") {
        result = await scrapeProductDetails(payload, onLog, onProgress, shouldStop);
      } else if (taskType === "update-prices") {
        result = await updateProductPrices(payload, onLog, onProgress, shouldStop);
      } else if (taskType === "auto-scrape") {
        result = await autoScrapeMultiPage(payload, onLog, onProgress, shouldStop);
      } else {
        throw new Error(`Unknown task type: ${taskType}`);
      }

      this.broadcastLog(`✨ Task [${taskType}] completed successfully!`, "success");
      this.broadcastProgress(100, 100, "Completed");

      // Record successful history
      this.taskHistory.unshift({
        id: taskId,
        type: taskType,
        payload,
        status: "completed",
        startTime: this.activeTask.startTime,
        endTime: new Date().toISOString(),
        durationMs: Date.now() - startTimeMs,
      });
      this.saveHistory();
      this.broadcastQueueState();

      if (this.io) {
        this.io.emit("task-completed", { taskId, result });
      }

      return result;
    } catch (error) {
      const isCancelled =
        this.stopRequested || error.message.includes("cancelled");
      const errType = isCancelled ? "warn" : "error";
      const errMsg = isCancelled
        ? `⏹️ Task [${taskType}] stopped.`
        : `❌ Task [${taskType}] failed: ${error.message}`;

      this.broadcastLog(errMsg, errType);

      // Record failed/cancelled history
      this.taskHistory.unshift({
        id: taskId,
        type: taskType,
        payload,
        status: isCancelled ? "cancelled" : "failed",
        startTime: this.activeTask.startTime,
        endTime: new Date().toISOString(),
        durationMs: Date.now() - startTimeMs,
        error: isCancelled ? "Stopped by user" : error.message,
      });
      this.saveHistory();
      this.broadcastQueueState();

      if (this.io) {
        this.io.emit("task-failed", {
          taskId,
          error: error.message,
          isCancelled,
        });
      }
    } finally {
      this.activeTask = null;
      this.stopRequested = false;
    }
  }

  // Legacy method compatibility
  async runTask(taskType, payload = {}) {
    return this.enqueueTask(taskType, payload);
  }
}

const taskRunnerManager = new TaskRunnerManager();
module.exports = taskRunnerManager;
