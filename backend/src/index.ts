import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { createDatabaseBackup, initDatabase } from "./db/index.js";
import { seedAccounts } from "./db/seed.js";
import authRouter from "./routes/auth.js";
import categoriesRouter from "./routes/categories.js";
import questionsRouter from "./routes/questions.js";
import examsRouter from "./routes/exams.js";
import resultsRouter from "./routes/results.js";
import gradingRouter from "./routes/grading.js";
import reexamRouter from "./routes/reexam.js";
import examApprovalsRouter from "./routes/examApprovals.js";
import usersRouter from "./routes/users.js";
import tagsRouter from "./routes/tags.js";
import mistakesRouter from "./routes/mistakes.js";

const app = express();
const PORT = process.env.PORT || 8000;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

await createDatabaseBackup("startup_before_init");
initDatabase();
if (process.env.ALLOW_LOCAL_AUTH === "true") {
  seedAccounts();
}
await createDatabaseBackup("startup_after_init");

app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.use(async (req, res, next) => {
  if (!req.path.startsWith("/api") || !WRITE_METHODS.has(req.method)) {
    next();
    return;
  }

  try {
    const backupPath = await createDatabaseBackup(`${req.method}_${req.path}`);
    res.setHeader("X-Database-Backup", backupPath);
    next();
  } catch (err) {
    res.status(503).json({ error: "数据库备份失败，本次写入已被阻止。" });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/questions", questionsRouter);
app.use("/api/exams", examsRouter);
app.use("/api/results", resultsRouter);
app.use("/api/gradings", gradingRouter);
app.use("/api/reexam", reexamRouter);
app.use("/api/exam-approvals", examApprovalsRouter);
app.use("/api/users", usersRouter);
app.use("/api/tags", tagsRouter);
app.use("/api/mistakes", mistakesRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: Date.now() });
});

const databaseProtectionHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof Error && err.message.includes("cannot be emptied")) {
    res.status(409).json({ error: "数据库保护已启用，核心数据表不能被清空。" });
    return;
  }

  next(err);
};

app.use(databaseProtectionHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("SQLite database ready");
});
