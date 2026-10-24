const { readDB, writeDB } = require("../db");

/**
 * Get exam questions
 * Optionally omit correct answers if client shouldn't see answer keys before submission
 */
function getQuestions(includeAnswers = false) {
  const db = readDB();
  if (includeAnswers) {
    return db.questions || [];
  }
  return (db.questions || []).map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options,
    category: q.category,
    marks: q.marks
  }));
}

/**
 * Submit exam answers, compute score, and save submission record
 */
function submitExam(candidateName, selectedAnswers) {
  const db = readDB();
  const questions = db.questions || [];
  
  let score = 0;
  let totalMarks = 0;
  const breakdown = [];

  questions.forEach((q, idx) => {
    totalMarks += (q.marks || 1);
    const chosenIndex = selectedAnswers[idx];
    const isCorrect = chosenIndex === q.correct;
    if (isCorrect) {
      score += (q.marks || 1);
    }
    breakdown.push({
      questionId: q.id,
      chosenIndex,
      correctIndex: q.correct,
      isCorrect
    });
  });

  const percentage = totalMarks > 0 ? ((score / totalMarks) * 100).toFixed(1) : 0;

  const submissionRecord = {
    id: "sub_" + Date.now(),
    candidateName: candidateName || "Anonymous Candidate",
    submittedAt: new Date().toISOString(),
    score,
    totalMarks,
    percentage: parseFloat(percentage),
    answers: selectedAnswers,
    breakdown
  };

  db.submissions = db.submissions || [];
  db.submissions.push(submissionRecord);

  // Log proctor event
  db.proctorLogs = db.proctorLogs || [];
  db.proctorLogs.push({
    timestamp: new Date().toISOString(),
    event: "EXAM_SUBMITTED",
    details: `Candidate '${submissionRecord.candidateName}' submitted exam with score ${score}/${totalMarks} (${percentage}%)`
  });

  writeDB(db);
  return submissionRecord;
}

/**
 * Get all exam submissions
 */
function getSubmissions() {
  const db = readDB();
  return db.submissions || [];
}

function invalidateExam(reason = "Repeated quit attempts", candidateName = "") {
  const db = readDB();
  const invalidationRecord = {
    id: "sub_invalidated_" + Date.now(),
    candidateName: candidateName || "Candidate",
    status: "PERMANENTLY_INVALIDATED",
    reason,
    invalidatedAt: new Date().toISOString(),
    score: 0,
    totalMarks: (db.questions || []).length * 2,
    percentage: 0,
    answers: {}
  };

  db.submissions = db.submissions || [];
  db.submissions.push(invalidationRecord);

  db.proctorLogs = db.proctorLogs || [];
  db.proctorLogs.push({
    timestamp: new Date().toISOString(),
    event: "EXAM_PERMANENTLY_INVALIDATED",
    details: `Exam permanently locked: ${reason}`
  });

  writeDB(db);
  return invalidationRecord;
}

module.exports = {
  getQuestions,
  submitExam,
  getSubmissions,
  invalidateExam
};
