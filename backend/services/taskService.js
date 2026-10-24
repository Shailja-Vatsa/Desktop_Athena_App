const { readDB, writeDB } = require("../db");

function getTasks() {
  const db = readDB();
  return db.tasks || [];
}

function addTask(taskText) {
  const db = readDB();
  db.tasks = db.tasks || [];
  if (taskText && typeof taskText === "string") {
    db.tasks.push(taskText);
    writeDB(db);
  }
  return db.tasks;
}

function deleteTask(index) {
  const db = readDB();
  db.tasks = db.tasks || [];
  if (typeof index === "number" && index >= 0 && index < db.tasks.length) {
    db.tasks.splice(index, 1);
  } else {
    db.tasks.pop();
  }
  writeDB(db);
  return db.tasks;
}

module.exports = {
  getTasks,
  addTask,
  deleteTask
};
