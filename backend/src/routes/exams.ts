import { Router, Request, Response } from "express";
import db from "../db/index.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";

const router = Router();

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// 获取所有试卷
router.get("/", authenticateToken, (_req: Request, res: Response) => {
  const exams = db.prepare("SELECT * FROM exams ORDER BY createdAt DESC").all();
  res.json(exams);
});

// 获取单个试卷
router.get("/:id", authenticateToken, (req: Request, res: Response) => {
  const exam = db.prepare("SELECT * FROM exams WHERE id = ?").get(req.params.id);
  if (!exam) {
    res.status(404).json({ error: "试卷不存在" });
    return;
  }
  res.json(exam);
});

// 创建试卷
router.post("/", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const { name, timeLimit, questionIds, questionScores } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: "试卷名称不能为空" });
    return;
  }
  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    res.status(400).json({ error: "请至少选择一道题目" });
    return;
  }

  const id = genId();
  db.prepare(
    "INSERT INTO exams(id, name, timeLimit, questionIds, questionScores, createdAt) VALUES(?,?,?,?,?,?)"
  ).run(
    id,
    name.trim(),
    timeLimit || 30,
    JSON.stringify(questionIds),
    JSON.stringify(questionScores && typeof questionScores === "object" ? questionScores : {}),
    Date.now()
  );

  const exam = db.prepare("SELECT * FROM exams WHERE id = ?").get(id);
  res.json({ ok: true, exam });
});

// 删除试卷
router.delete("/:id", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  db.prepare("DELETE FROM exams WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
