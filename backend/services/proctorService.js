const { readDB, writeDB } = require("../db");

/**
 * Record security violation (copy-paste, tab switch, right click, etc.)
 */
function logViolation(reason, count, metadata = {}) {
  const db = readDB();
  db.violations = db.violations || [];
  
  const isUfm = Boolean(metadata && (metadata.isUfm || metadata.ufmLocked));
  const violationType = isUfm ? "UFM_VIOLATION" : "SECURITY_VIOLATION";

  const violationRecord = {
    id: "viol_" + Date.now(),
    timestamp: new Date().toISOString(),
    type: violationType,
    reason,
    count,
    metadata
  };

  db.violations.push(violationRecord);

  // Add to main proctor logs
  db.proctorLogs = db.proctorLogs || [];
  db.proctorLogs.push({
    timestamp: violationRecord.timestamp,
    event: violationType,
    details: isUfm ? `[UFM] Violation #${count}: ${reason}` : `Violation #${count}: ${reason}`
  });

  writeDB(db);
  return violationRecord;
}

/**
 * Record proctor snapshot metadata
 */
function logSnapshot(fileName, filePath) {
  const db = readDB();
  db.snapshots = db.snapshots || [];

  const snapshotRecord = {
    id: "snap_" + Date.now(),
    timestamp: new Date().toISOString(),
    fileName,
    filePath
  };

  db.snapshots.push(snapshotRecord);

  db.proctorLogs = db.proctorLogs || [];
  db.proctorLogs.push({
    timestamp: snapshotRecord.timestamp,
    event: "PROCTOR_SNAPSHOT_CAPTURED",
    details: `Snapshot saved as ${fileName}`
  });

  writeDB(db);
  return snapshotRecord;
}

/**
 * Get proctor audit logs and violation records
 */
function getProctorAuditLogs() {
  const db = readDB();
  return {
    violations: db.violations || [],
    snapshots: db.snapshots || [],
    logs: db.proctorLogs || []
  };
}

/**
 * Get proctor statistics dashboard summary
 */
function getProctorStats() {
  const db = readDB();
  return {
    totalQuestions: (db.questions || []).length,
    totalViolations: (db.violations || []).length,
    totalSnapshots: (db.snapshots || []).length,
    totalSubmissions: (db.submissions || []).length,
    lastActivity: db.proctorLogs && db.proctorLogs.length > 0
      ? db.proctorLogs[db.proctorLogs.length - 1].timestamp
      : null
  };
}

module.exports = {
  logViolation,
  logSnapshot,
  getProctorAuditLogs,
  getProctorStats
};
