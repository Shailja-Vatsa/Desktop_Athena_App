const express = require("express");
const cors = require("cors");
const examService = require("./services/examService");
const proctorService = require("./services/proctorService");
const taskService = require("./services/taskService");
const { initDB } = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Initialize DB on server start
initDB();

// 1. Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Desktop Athena Backend API",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// 2. Exam Questions Endpoint
app.get("/api/questions", (req, res) => {
  try {
    const questions = examService.getQuestions();
    res.json({ success: true, questions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Exam Submission Endpoint
app.post("/api/exam/submit", (req, res) => {
  try {
    const { candidateName, selectedAnswers } = req.body;
    const submission = examService.submitExam(candidateName, selectedAnswers);
    res.json({ success: true, submission });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Submissions List
app.get("/api/exam/submissions", (req, res) => {
  try {
    const submissions = examService.getSubmissions();
    res.json({ success: true, submissions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Log Violation Endpoint
app.post("/api/proctor/violation", (req, res) => {
  try {
    const { reason, count, metadata } = req.body;
    const violation = proctorService.logViolation(reason, count, metadata);
    res.json({ success: true, violation });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Log Snapshot Metadata Endpoint
app.post("/api/proctor/snapshot", (req, res) => {
  try {
    const { fileName, filePath } = req.body;
    const snapshot = proctorService.logSnapshot(fileName, filePath);
    res.json({ success: true, snapshot });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Proctor Audit Logs Endpoint
app.get("/api/proctor/logs", (req, res) => {
  try {
    const auditLogs = proctorService.getProctorAuditLogs();
    res.json({ success: true, auditLogs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Proctor Stats Endpoint
app.get("/api/proctor/stats", (req, res) => {
  try {
    const stats = proctorService.getProctorStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Tasks Endpoints
app.get("/api/tasks", (req, res) => {
  res.json({ success: true, tasks: taskService.getTasks() });
});

app.post("/api/tasks", (req, res) => {
  const { task } = req.body;
  const tasks = taskService.addTask(task);
  res.json({ success: true, tasks });
});

app.delete("/api/tasks/:index", (req, res) => {
  const index = parseInt(req.params.index, 10);
  const tasks = taskService.deleteTask(index);
  res.json({ success: true, tasks });
});

// Helper function to start server
function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`[Backend API] Express server running on http://localhost:${port}`);
      resolve(server);
    }).on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.warn(`[Backend API] Port ${port} in use, trying ${port + 1}...`);
        resolve(startServer(port + 1));
      } else {
        reject(err);
      }
    });
  });
}

// If run directly via node backend/server.js
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
