const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getQuestions: () => ipcRenderer.invoke("get-questions"),
  submitExam: (candidateName, selectedAnswers) => ipcRenderer.invoke("submit-exam", { candidateName, selectedAnswers }),
  logViolation: (reason, count, metadata) => ipcRenderer.invoke("log-violation", { reason, count, metadata }),
  getProctorStats: () => ipcRenderer.invoke("get-proctor-stats"),
  getProctorLogs: () => ipcRenderer.invoke("get-proctor-logs"),
  saveTask: (task) => ipcRenderer.invoke("save-task", task),
  deleteTask: (index) => ipcRenderer.invoke("delete-task", index),
  getTasks: () => ipcRenderer.invoke("get-tasks"),
  setFullscreen: (flag) => ipcRenderer.invoke("set-fullscreen", flag),
  setKiosk: (flag) => ipcRenderer.invoke("set-kiosk", flag),
  saveProctorSnapshot: (base64Data) => ipcRenderer.invoke("save-proctor-snapshot", base64Data),
  getApiUrl: () => ipcRenderer.invoke("get-api-url"),
  closeApp: () => ipcRenderer.invoke("close-app"),
  saveScreenSnapshot: (base64Data) => ipcRenderer.invoke("save-screen-snapshot", base64Data),
  onShowWarning: (callback) => ipcRenderer.on("show-warning", (_event, message) => callback(message)),
  setExamActive: (flag) => ipcRenderer.invoke("set-exam-active", flag),
  confirmQuit: () => ipcRenderer.send("confirm-quit"),
  onWarnBeforeQuit: (callback) => ipcRenderer.on("warn-before-quit", (_event, count) => callback(count)),
  onExamPermanentlyLocked: (callback) => ipcRenderer.on("exam-permanently-locked", (_event, msg) => callback(msg)),
  triggerUfmLockdown: () => ipcRenderer.invoke("trigger-ufm-lockdown"),
  onUfmLockdown: (callback) => ipcRenderer.on("ufm-lockdown", (_event) => callback()),
  focusWindow: () => ipcRenderer.invoke("focus-window"),
});

