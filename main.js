const { app, BrowserWindow, ipcMain, globalShortcut, Menu, desktopCapturer, session } = require("electron");
const path = require("path");
const fs = require("fs");

// Import Backend API server and services
const { startServer } = require("./backend/server");
const examService = require("./backend/services/examService");
const proctorService = require("./backend/services/proctorService");
const taskService = require("./backend/services/taskService");

let mainWindow = null;
let backendApiUrl = "http://localhost:5000/api";

const QUIT_FILE = path.join(__dirname, "backend", "quit_strikes.json");

function getQuitAttempts() {
  try {
    if (fs.existsSync(QUIT_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUIT_FILE, "utf-8"));
      return Number(data.attempts) || 0;
    }
  } catch (e) {
    console.error("Error reading quit attempts file:", e);
  }
  return 0;
}

function setQuitAttempts(count) {
  try {
    fs.writeFileSync(QUIT_FILE, JSON.stringify({ attempts: count }, null, 2), "utf-8");
  } catch (e) {
    console.error("Error writing quit attempts file:", e);
  }
}

let quitAttempts = getQuitAttempts();
let isExamActive = false;
let isExamLockedPermanently = false;
let isUfmLocked = false;

app.whenReady().then(async () => {
  // Start backend Express REST server
  try {
    const server = await startServer(5000);
    const address = server.address();
    if (address) {
      backendApiUrl = `http://localhost:${address.port}/api`;
    }
    console.log("[Main Process] Backend API initialized at:", backendApiUrl);
  } catch (err) {
    console.error("[Main Process] Failed to launch backend API server:", err);
  }

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    titleBarStyle: "hidden",
    titleBarOverlay: false,
    trafficLightPosition: { x: -100, y: -100 },
    minimizable: true,
    maximizable: true,
    closable: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  Menu.setApplicationMenu(null);

  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        // Grant access to the first screen found.
        callback({ video: sources[0], audio: 'loopback' })
      })
      // If true, use the system picker if available.
      // Note: this is currently experimental. If the system picker
      // is available, it will be used and the media request handler
      // will not be invoked.
    },
    { useSystemPicker: true }
  );

  const forceQuit = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
    app.exit(0);
  };

  const lockExamPermanently = () => {
    isExamLockedPermanently = true;
    try {
      examService.invalidateExam("Repeated quit attempts");
    } catch (e) {
      console.error("Failed to invalidate exam in DB:", e);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("exam-permanently-locked");
    }
  };

  const handleQuitAttempt = () => {
    if (!isExamActive) {
      forceQuit();
      return;
    }

    if (isExamLockedPermanently) {
      return;
    }

    if (quitAttempts >= 3) {
      lockExamPermanently();
      return;
    }

    quitAttempts += 1;
    setQuitAttempts(quitAttempts);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("warn-before-quit", quitAttempts);
    }
  };

  mainWindow.webContents.on("before-input-event", (event, input) => {
    const isQuit = (input.code === "KeyQ" || input.key?.toLowerCase() === "q") && (input.control || input.meta);

    if (isQuit) {
      event.preventDefault();
      handleQuitAttempt();
      return;
    }

    if (isUfmLocked) {
      // Block all keyboard input except Cmd+Q
      event.preventDefault();
      return;
    }

    const isCopyPasteCut = (input.code === "KeyC" || input.code === "KeyV" || input.code === "KeyX") && (input.control || input.meta);
    if (isCopyPasteCut) {
      event.preventDefault();
      mainWindow.webContents.send("show-warning", "COPY/PASTE/CUT NOT ALLOWED");
      return;
    }

    const blocked = [
      "Escape",
      input.code === "KeyM" && (input.control || input.meta),
      input.code === "KeyH" && (input.control || input.meta),
      input.code === "KeyW" && (input.control || input.meta),
      input.key === "F4" && input.alt,
    ];

    if (blocked.some(Boolean) || input.key === "Escape" || input.code === "Escape") {
      event.preventDefault();
    }
  });

  try {
    globalShortcut.register("CommandOrControl+Q", handleQuitAttempt);
    globalShortcut.register("Command+Q", handleQuitAttempt);
    globalShortcut.register("Control+Q", handleQuitAttempt);
  } catch (e) {
    console.error("Failed to register quit global shortcuts:", e);
  }

  mainWindow.on("minimize", (e) => {
    if (mainWindow.isKiosk() || mainWindow.isFullScreen()) {
      e.preventDefault();
      mainWindow.restore();
    }
  });

  mainWindow.on("blur", () => {
    if (mainWindow.isKiosk() || mainWindow.isFullScreen() || isUfmLocked) {
      mainWindow.focus();
    }
    if (isUfmLocked) {
      proctorService.logViolation("Window focus lost during UFM lockdown", 1, { isUfm: true, ufmLocked: true });
    }
  });

  // Resilient page loading logic with retry
  const devUrl = "http://localhost:5174/";
  const distPath = path.join(__dirname, "renderer", "dist", "index.html");

  const loadWindowContent = async () => {
    if (fs.existsSync(distPath) && process.env.NODE_ENV === "production") {
      mainWindow.loadFile(distPath);
    } else {
      let loaded = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          await mainWindow.loadURL(devUrl);
          loaded = true;
          break;
        } catch (e) {
          console.log(`[Main Process] Waiting for Vite dev server at ${devUrl} (attempt ${attempt + 1}/10)...`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      if (!loaded && fs.existsSync(distPath)) {
        console.log("[Main Process] Loading production built renderer file as fallback.");
        mainWindow.loadFile(distPath);
      }
    }
  };

  loadWindowContent();
});


app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// IPC Handler: Get API URL
ipcMain.handle("get-api-url", async () => {
  return backendApiUrl;
});

// IPC Handler: Get Exam Questions
ipcMain.handle("get-questions", async () => {
  try {
    return { success: true, questions: examService.getQuestions() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC Handler: Submit Exam Answers
ipcMain.handle("submit-exam", async (event, { candidateName, selectedAnswers }) => {
  try {
    const submission = examService.submitExam(candidateName, selectedAnswers);
    return { success: true, submission };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC Handler: Set Exam Active State
ipcMain.handle("set-exam-active", async (event, flag) => {
  isExamActive = Boolean(flag);
  return isExamActive;
});

// IPC Handler: Confirm Quit (one-way send from renderer via ipcRenderer.send)
ipcMain.on("confirm-quit", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
  app.exit(0);
});

// IPC Handler: Trigger UFM Lockdown
ipcMain.handle("trigger-ufm-lockdown", async () => {
  isUfmLocked = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("ufm-lockdown");
  }
  return { success: true };
});

// IPC Handler: Focus Window
ipcMain.handle("focus-window", async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
  }
  if (isUfmLocked) {
    proctorService.logViolation("Window focus switched during UFM lockdown", 1, { isUfm: true, ufmLocked: true });
  }
  return true;
});

// IPC Handler: Log Security Violation
ipcMain.handle("log-violation", async (event, { reason, count, metadata = {} }) => {
  try {
    if (isUfmLocked) {
      metadata = { ...metadata, isUfm: true, ufmLocked: true };
    }
    const violation = proctorService.logViolation(reason, count, metadata);
    return { success: true, violation };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC Handler: Get Proctor Stats
ipcMain.handle("get-proctor-stats", async () => {
  try {
    return { success: true, stats: proctorService.getProctorStats() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC Handler: Get Proctor Audit Logs
ipcMain.handle("get-proctor-logs", async () => {
  try {
    return { success: true, auditLogs: proctorService.getProctorAuditLogs() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC Handler: Task Management
ipcMain.handle("save-task", async (event, task) => {
  try {
    const tasks = taskService.addTask(task);
    return { success: true, tasks };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("delete-task", async (event, index) => {
  try {
    const tasks = taskService.deleteTask(index);
    return { success: true, tasks };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-tasks", async () => {
  return taskService.getTasks();
});

ipcMain.handle("set-fullscreen", async (event, flag) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (flag) {
      win.setKiosk(true);
    } else {
      win.setKiosk(false);
      win.setFullScreen(false);
    }
    return win.isFullScreen() || win.isKiosk();
  }
  return false;
});

ipcMain.handle("set-kiosk", async (event, flag) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.setKiosk(flag);
    return win.isKiosk();
  }
  return false;
});

// IPC Handler: Save Proctor Snapshot & Log in Backend DB
ipcMain.handle("save-proctor-snapshot", async (event, base64Data) => {
  try {
    const snapshotsDir = path.join(__dirname, "proctor_snapshots");
    if (!fs.existsSync(snapshotsDir)) {
      fs.mkdirSync(snapshotsDir, { recursive: true });
    }
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    const fileName = `snapshot_${Date.now()}.png`;
    const filePath = path.join(snapshotsDir, fileName);
    fs.writeFileSync(filePath, buffer);

    // Also register in backend database
    proctorService.logSnapshot(fileName, filePath);

    return { success: true, filePath, fileName };
  } catch (err) {
    console.error("Failed to save snapshot:", err);
    return { success: false, error: err.message };
  }
});

// IPC Handler: Save Screen Snapshot
ipcMain.handle("save-screen-snapshot", async (event, base64Data) => {
  try {
    const snapshotsDir = path.join(__dirname, "screen_snapshots");
    if (!fs.existsSync(snapshotsDir)) {
      fs.mkdirSync(snapshotsDir, { recursive: true });
    }
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    const fileName = `screen_${Date.now()}.png`;
    const filePath = path.join(snapshotsDir, fileName);
    fs.writeFileSync(filePath, buffer);
    return { success: true, filePath, fileName };
  } catch (err) {
    console.error("Failed to save screen snapshot:", err);
    return { success: false, error: err.message };
  }
});

// IPC Handler: Close App
ipcMain.handle("close-app", () => {
  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach((w) => {
    if (!w.isDestroyed()) w.destroy();
  });
  app.exit(0);
});
