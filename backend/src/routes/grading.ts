import { Router, Request, Response } from "express";
import db from "../db/index.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { JwtPayload, Grading } from "../types.js";

const router = Router();

// 获取所有评分（管理员看全部，普通用户看自己的）
router.get("/", authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user as JwtPayload;
  if (user.role === "admin") {
    const gradings = db.prepare("SELECT * FROM gradings").all();
    res.json(gradings);
  } else {
    // 普通用户：通过 results 表找到自己的 resultId，再查 gradings
    const rows = db.prepare(`
      SELECT g.* FROM gradings g
      INNER JOIN results r ON g.resultId = r.id
      WHERE r.userId = ?
    `).all(user.username);
    res.json(rows);
  }
});

// 获取某个结果的评分
router.get("/:resultId", authenticateToken, (req: Request, res: Response) => {
  const grading = db.prepare("SELECT * FROM gradings WHERE resultId = ?").get(req.params.resultId) as Grading | undefined;
  res.json(grading || null);
});

// 保存/更新评分
router.post("/:resultId", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const user = (req as any).user as JwtPayload;
  const { perQuestionScores, perQuestionFeedback, finalScore } = req.body;

  db.prepare(
    "INSERT OR REPLACE INTO gradings(resultId, perQuestionScores, perQuestionFeedback, finalScore, gradedBy, gradedAt) VALUES(?,?,?,?,?,?)"
  ).run(
    req.params.resultId,
    JSON.stringify(perQuestionScores || {}),
    JSON.stringify(perQuestionFeedback || {}),
    finalScore ?? 0,
    user.username,
    Date.now()
  );

  res.json({ ok: true });
});

export default router;
