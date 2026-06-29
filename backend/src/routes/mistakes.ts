import { Router, Request, Response } from "express";
import db from "../db/index.js";
import { authenticateToken } from "../middleware/auth.js";

const router = Router();

// 获取用户所有错题
router.get("/", authenticateToken, (req: Request, res: Response) => {
  const userId = (req as any).user.username;
  const rows = db.prepare(
    `SELECT m.*, q.id, q.type, q.question, q.answer, q.score, q.explanation, q.categoryId, q.options
     FROM mistakes m
     JOIN questions q ON m.questionId = q.id
     WHERE m.userId = ?
     ORDER BY m.createdAt DESC`
  ).all(userId);
  res.json(rows);
});

// 记录错题（模拟考试提交时调用）
router.post("/", authenticateToken, (req: Request, res: Response) => {
  const userId = (req as any).user.username;
  const { questionIds } = req.body;
  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    res.json({ ok: true });
    return;
  }
  const now = Date.now();
  const stmt = db.prepare("INSERT OR REPLACE INTO mistakes(userId, questionId, createdAt) VALUES(?,?,?)");
  const tx = db.transaction(() => {
    for (const qid of questionIds) {
      stmt.run(userId, qid, now);
    }
  });
  tx();
  res.json({ ok: true });
});

// 移除单道错题（修正后删除）
router.delete("/:questionId", authenticateToken, (req: Request, res: Response) => {
  const userId = (req as any).user.username;
  db.prepare("DELETE FROM mistakes WHERE userId = ? AND questionId = ?").run(userId, req.params.questionId);
  res.json({ ok: true });
});

export default router;
