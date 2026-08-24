const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const taskRunnerManager = require("./lib/runner");

// Parse PORT from process.env or command-line args (e.g. --port 8090 or -p 8090)
function getPort() {
  if (process.env.PORT) return parseInt(process.env.PORT, 10);
  const args = process.argv.slice(2);
  const portIdx = args.findIndex(arg => arg === '--port' || arg === '-p');
  if (portIdx !== -1 && args[portIdx + 1]) {
    const parsed = parseInt(args[portIdx + 1], 10);
    if (!isNaN(parsed)) return parsed;
  }
  return 3000;
}

const PORT = getPort();
const WORKSPACE_DIR = __dirname;
const DATA_DIR = path.join(WORKSPACE_DIR, "data");
const AUTH_FILE = path.join(WORKSPACE_DIR, "auth.json");

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function resolveFilePath(filename) {
  const base = path.basename(filename);
  const dataPath = path.join(DATA_DIR, base);
  if (fs.existsSync(dataPath)) return dataPath;
  const rootPath = path.join(WORKSPACE_DIR, base);
  if (fs.existsSync(rootPath)) return rootPath;
  return dataPath; // Default target is inside data/
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Pass io to task runner
taskRunnerManager.setSocketIO(io);

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// =====================================
// REST API ENDPOINTS
// =====================================

// Check Auth File Status
app.get("/api/auth/status", (req, res) => {
  const exists = fs.existsSync(AUTH_FILE);
  let sessionData = null;
  if (exists) {
    try {
      const content = fs.readFileSync(AUTH_FILE, "utf8");
      sessionData = JSON.parse(content);
    } catch (e) {}
  }
  res.json({
    hasAuth: exists,
    cookiesCount: sessionData?.cookies?.length || 0,
    originsCount: sessionData?.origins?.length || 0
  });
});

// List all JSON files in data directory & root
app.get("/api/files", (req, res) => {
  try {
    const fileMap = new Map();

    const scanDir = (dirPath) => {
      if (!fs.existsSync(dirPath)) return;
      const files = fs.readdirSync(dirPath);
      files.forEach((file) => {
        if (!file.endsWith(".json") || file === "package.json" || file === "package-lock.json") return;
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return;

        let itemCount = 0;
        let isArray = false;
        try {
          const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
          if (Array.isArray(content)) {
            isArray = true;
            itemCount = content.length;
          } else if (typeof content === "object" && content !== null) {
            itemCount = Object.keys(content).length;
          }
        } catch (err) {}

        fileMap.set(file, {
          name: file,
          path: filePath,
          size: stat.size,
          mtime: stat.mtime,
          itemCount,
          isArray
        });
      });
    };

    scanDir(DATA_DIR);
    scanDir(WORKSPACE_DIR);

    res.json({ files: Array.from(fileMap.values()) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Read specific JSON file content
app.get("/api/files/:filename", (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = resolveFilePath(filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    const content = fs.readFileSync(filePath, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      return res.json({ name: filename, raw: content, invalidJson: true });
    }

    res.json({ name: filename, data: parsed, raw: content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save or Create JSON file inside data/ directory
app.post("/api/files/:filename", (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(DATA_DIR, filename);
    const { content } = req.body;

    if (content === undefined) {
      return res.status(400).json({ error: "Content is required" });
    }

    let stringData;
    if (typeof content === "string") {
      // Validate JSON formatting
      JSON.parse(content);
      stringData = content;
    } else {
      stringData = JSON.stringify(content, null, 2);
    }

    fs.writeFileSync(filePath, stringData, "utf8");
    res.json({ success: true, filename, size: stringData.length });
  } catch (error) {
    res.status(400).json({ error: `Invalid JSON or write error: ${error.message}` });
  }
});

// Delete JSON file
app.delete("/api/files/:filename", (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    if (filename === "auth.json" || filename === "package.json" || filename === "package-lock.json") {
      return res.status(403).json({ error: "Protected system files cannot be deleted" });
    }

    const filePath = resolveFilePath(filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.json({ success: true, filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Current System & Runner Status
app.get("/api/status", (req, res) => {
  res.json({
    isRunning: taskRunnerManager.isTaskRunning(),
    activeTask: taskRunnerManager.getActiveTaskInfo(),
    authFileExists: fs.existsSync(AUTH_FILE)
  });
});

// =====================================
// SOCKET.IO REALTIME HANDLERS
// =====================================

io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Send current status on client connection
  socket.emit("status-update", {
    isRunning: taskRunnerManager.isTaskRunning(),
    activeTask: taskRunnerManager.getActiveTaskInfo()
  });

  // Start Task event handler
  socket.on("start-task", async (data) => {
    const { taskType, payload } = data;
    try {
      await taskRunnerManager.runTask(taskType, payload);
    } catch (error) {
      console.error(`Socket task trigger error: ${error.message}`);
    }
  });

  // Stop Task event handler
  socket.on("stop-task", () => {
    const stopped = taskRunnerManager.stopCurrentTask();
    socket.emit("task-stop-ack", { stopped });
  });

  socket.on("disconnect", () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// Start listening
server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 ScrapeHub Dashboard running at http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
