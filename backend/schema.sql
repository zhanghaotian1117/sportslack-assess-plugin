CREATE TABLE IF NOT EXISTS accounts (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
  sessionVersion INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  score INTEGER DEFAULT 1,
  explanation TEXT DEFAULT '',
  categoryId TEXT DEFAULT '',
  images TEXT DEFAULT '[]',
  textAlign TEXT DEFAULT 'left',
  tags TEXT DEFAULT '[]',
  options TEXT DEFAULT '[]',
  answerAlign TEXT DEFAULT 'left',
  explanationAlign TEXT DEFAULT 'left',
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timeLimit INTEGER DEFAULT 30,
  questionIds TEXT DEFAULT '[]',
  questionScores TEXT DEFAULT '{}',
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  examId TEXT NOT NULL,
  userId TEXT NOT NULL,
  username TEXT NOT NULL,
  answers TEXT DEFAULT '{}',
  submittedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS completions (
  userId TEXT NOT NULL,
  examId TEXT NOT NULL,
  PRIMARY KEY(userId, examId)
);

CREATE TABLE IF NOT EXISTS reexam_requests (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  username TEXT NOT NULL,
  examId TEXT NOT NULL,
  examName TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reexam_approved (
  userId TEXT NOT NULL,
  examId TEXT NOT NULL,
  PRIMARY KEY(userId, examId)
);

CREATE TABLE IF NOT EXISTS exam_requests (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  username TEXT NOT NULL,
  examId TEXT NOT NULL,
  examName TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exam_approved (
  userId TEXT NOT NULL,
  examId TEXT NOT NULL,
  PRIMARY KEY(userId, examId)
);

CREATE TABLE IF NOT EXISTS gradings (
  resultId TEXT PRIMARY KEY,
  perQuestionScores TEXT DEFAULT '{}',
  perQuestionFeedback TEXT DEFAULT '{}',
  finalScore INTEGER DEFAULT 0,
  gradedBy TEXT NOT NULL,
  gradedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mistakes (
  userId TEXT NOT NULL,
  questionId TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  PRIMARY KEY(userId, questionId)
);

CREATE TABLE IF NOT EXISTS password_vault (
  username TEXT PRIMARY KEY,
  encryptedPassword TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);
