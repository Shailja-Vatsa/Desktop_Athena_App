const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "data.json");

// Initial seed data
const initialData = {
  questions: [
    {
      id: 1,
      question: "What is the time complexity of searching in a Balanced Binary Search Tree (AVL / Red-Black Tree)?",
      options: ["O(1)", "O(log n)", "O(n)", "O(n log n)"],
      correct: 1,
      category: "Data Structures",
      marks: 2.0
    },
    {
      id: 2,
      question: "Which HTTP status code corresponds to 'Unauthorized' access?",
      options: ["400 Bad Request", "401 Unauthorized", "403 Forbidden", "404 Not Found"],
      correct: 1,
      category: "Networking",
      marks: 2.0
    },
    {
      id: 3,
      question: "In Electron architecture, which process is responsible for creating native OS windows?",
      options: ["Renderer Process", "Main Process", "Worker Thread", "Preload Bridge"],
      correct: 1,
      category: "Desktop Architecture",
      marks: 2.0
    },
    {
      id: 4,
      question: "Which data structure uses LIFO (Last In, First Out) principle?",
      options: ["Queue", "Stack", "Array", "Linked List"],
      correct: 1,
      category: "Data Structures",
      marks: 2.0
    },
    {
      id: 5,
      question: "In React, what hook is used to handle side effects in functional components?",
      options: ["useState", "useContext", "useEffect", "useReducer"],
      correct: 2,
      category: "Web Development",
      marks: 2.0
    }
  ],
  submissions: [],
  violations: [],
  snapshots: [],
  proctorLogs: [],
  tasks: ["Initial task example"]
};

// Ensure data file exists
function initDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), "utf8");
    }
  } catch (err) {
    console.error("DB Initialization error:", err);
  }
}

function readDB() {
  initDB();
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Error reading DB:", err);
    return initialData;
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("Error writing DB:", err);
    return false;
  }
}

module.exports = {
  readDB,
  writeDB,
  initDB
};
