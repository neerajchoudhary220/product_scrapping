const { scrapeProductIds } = require("../product_id");
const { scrapeProductDetails } = require("../product_details");
const { updateProductPrices } = require("../update_price");

class TaskRunnerManager {
  constructor() {
    this.activeTask = null;
    this.stopRequested = false;
    this.io = null;
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

  stopCurrentTask() {
    if (this.activeTask) {
      this.stopRequested = true;
      this.broadcastLog(`⏹️ Cancellation requested by user...`, 'warn');
      return true;
    }
    return false;
  }

  broadcastLog(message, type = 'info') {
    const logEvent = {
      timestamp: new Date().toLocaleTimeString(),
      type, // 'info' | 'success' | 'warn' | 'error'
      message
    };
    if (this.io) {
      this.io.emit('task-log', logEvent);
    }
    console.log(`[${logEvent.timestamp}] [${type.toUpperCase()}] ${message}`);
  }

  broadcastProgress(current, total, statusText = '', item = null) {
    const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const progressEvent = {
      current,
      total,
      percentage,
      statusText,
      item,
      taskType: this.activeTask ? this.activeTask.type : null
    };
    if (this.io) {
      this.io.emit('task-progress', progressEvent);
    }
  }

  async runTask(taskType, payload = {}) {
    if (this.isTaskRunning()) {
      throw new Error(`Another task (${this.activeTask.type}) is currently running!`);
    }

    this.stopRequested = false;
    const taskId = `task_${Date.now()}`;
    this.activeTask = {
      id: taskId,
      type: taskType,
      payload,
      startTime: new Date().toISOString()
    };

    if (this.io) {
      this.io.emit('task-started', this.activeTask);
    }

    this.broadcastLog(`▶️ Started Task: [${taskType.toUpperCase()}]`, 'info');
    this.broadcastProgress(0, 100, 'Starting process...');

    const shouldStop = () => this.stopRequested;
    const onLog = (msg, type) => this.broadcastLog(msg, type);
    const onProgress = (curr, tot, text, item) => this.broadcastProgress(curr, tot, text, item);

    try {
      let result;
      if (taskType === 'scrape-ids') {
        result = await scrapeProductIds(payload, onLog, onProgress, shouldStop);
      } else if (taskType === 'scrape-details') {
        result = await scrapeProductDetails(payload, onLog, onProgress, shouldStop);
      } else if (taskType === 'update-prices') {
        result = await updateProductPrices(payload, onLog, onProgress, shouldStop);
      } else {
        throw new Error(`Unknown task type: ${taskType}`);
      }

      this.broadcastLog(`✨ Task [${taskType}] completed successfully!`, 'success');
      this.broadcastProgress(100, 100, 'Completed');
      
      if (this.io) {
        this.io.emit('task-completed', { taskId, result });
      }

      return result;
    } catch (error) {
      const isCancelled = this.stopRequested || error.message.includes('cancelled');
      const errType = isCancelled ? 'warn' : 'error';
      const errMsg = isCancelled ? `⏹️ Task [${taskType}] stopped.` : `❌ Task [${taskType}] failed: ${error.message}`;

      this.broadcastLog(errMsg, errType);
      
      if (this.io) {
        this.io.emit('task-failed', { taskId, error: error.message, isCancelled });
      }
      throw error;
    } finally {
      this.activeTask = null;
      this.stopRequested = false;
    }
  }
}

const taskRunnerManager = new TaskRunnerManager();
module.exports = taskRunnerManager;
