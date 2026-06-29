import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, "..", "..");
const dbPath = path.join(serverDir, "exam.db");
const backupDir = path.join(serverDir, "backups");
const vaultKeyPath = path.join(serverDir, ".password-vault-key");

if (!fs.existsSync(dbPath)) {
  throw new Error(`Database file is missing: ${dbPath}. Refusing to create an empty database.`);
}

const db: SqliteDatabase = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function getVaultKey(): Buffer {
  if (process.env.PASSWORD_VAULT_KEY) {
    return crypto.createHash("sha256").update(process.env.PASSWORD_VAULT_KEY).digest();
  }

  if (!fs.existsSync(vaultKeyPath)) {
    fs.writeFileSync(vaultKeyPath, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
  }

  return Buffer.from(fs.readFileSync(vaultKeyPath, "utf8").trim(), "base64");
}

const vaultKey = getVaultKey();

function addColumnIfMissing(table: string, definition: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch {
    // The column already exists in migrated databases.
  }
}

function preventTableFromBeingEmptied(table: string, label: string): void {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS prevent_empty_${table}
    BEFORE DELETE ON ${table}
    WHEN (SELECT COUNT(*) FROM ${table}) <= 1
    BEGIN
      SELECT RAISE(ABORT, '${label} cannot be emptied');
    END;
  `);
}

function backupFileName(reason: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeReason = reason.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "backup";
  return `${stamp}_${safeReason}.db`;
}

export async function createDatabaseBackup(reason = "manual"): Promise<string> {
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, backupFileName(reason));
  await db.backup(target);
  return target;
}

export function encryptPasswordForVault(password: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", vaultKey, iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64")).join(":");
}

export function decryptPasswordFromVault(value: string): string {
  const [ivBase64, tagBase64, encryptedBase64] = value.split(":");
  if (!ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error("Invalid saved password value");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", vaultKey, Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(tagBase64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function saveViewablePassword(username: string, password: string): void {
  db.prepare(`
    INSERT INTO password_vault(username, encryptedPassword, updatedAt)
    VALUES(?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      encryptedPassword = excluded.encryptedPassword,
      updatedAt = excluded.updatedAt
  `).run(username, encryptPasswordForVault(password), Date.now());
}

export function getViewablePassword(username: string): string | null {
  const row = db.prepare("SELECT encryptedPassword FROM password_vault WHERE username = ?").get(username) as { encryptedPassword: string } | undefined;
  if (!row) return null;
  return decryptPasswordFromVault(row.encryptedPassword);
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user'))
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
  `);

  addColumnIfMissing("accounts", "sessionVersion INTEGER DEFAULT 0");
  addColumnIfMissing("questions", "textAlign TEXT DEFAULT 'left'");
  addColumnIfMissing("questions", "tags TEXT DEFAULT '[]'");
  addColumnIfMissing("questions", "options TEXT DEFAULT '[]'");
  addColumnIfMissing("questions", "answerAlign TEXT DEFAULT 'left'");
  addColumnIfMissing("questions", "explanationAlign TEXT DEFAULT 'left'");
  addColumnIfMissing("exams", "questionScores TEXT DEFAULT '{}'");

  preventTableFromBeingEmptied("accounts", "Accounts");
  preventTableFromBeingEmptied("questions", "Question bank");
  preventTableFromBeingEmptied("exams", "Exams");
  preventTableFromBeingEmptied("categories", "Categories");
  preventTableFromBeingEmptied("tags", "Tags");
}

export default db;
