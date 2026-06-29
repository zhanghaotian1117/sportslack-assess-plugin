import { Router, Request, Response } from "express";
import db from "../db/index.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { JwtPayload, Result } from "../types.js";

const router = Router();

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// 提交考试结果
router.post("/", authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user as JwtPayload;
  const { examId, answers } = req.body;

  if (!examId) {
    res.status(400).json({ error: "试卷ID不能为空" });
    return;
  }

  if (user.role !== "admin") {
    const firstExamApproved = db.prepare(
      "SELECT * FROM exam_approved WHERE userId = ? AND examId = ?"
    ).get(user.username, examId);
    const reexamApproved = db.prepare(
      "SELECT * FROM reexam_approved WHERE userId = ? AND examId = ?"
    ).get(user.username, examId);

    if (!firstExamApproved && !reexamApproved) {
      res.status(403).json({ error: "考试尚未通过审批，不能提交试卷" });
      return;
    }
  }

  const id = genId();
  const now = Date.now();

  db.prepare(
    "INSERT INTO results(id, examId, userId, username, answers, submittedAt) VALUES(?,?,?,?,?,?)"
  ).run(id, examId, user.username, user.username, JSON.stringify(answers || {}), now);

  // 标记为已完成
  db.prepare("INSERT OR IGNORE INTO completions(userId, examId) VALUES(?,?)").run(user.username, examId);

  // 清除补考批准记录
  db.prepare("DELETE FROM reexam_approved WHERE userId = ? AND examId = ?").run(user.username, examId);
  // 清除首次考试批准记录
  db.prepare("DELETE FROM exam_approved WHERE userId = ? AND examId = ?").run(user.username, examId);

  const result = db.prepare("SELECT * FROM results WHERE id = ?").get(id);
  res.json({ ok: true, result });
});

// 获取用户对某试卷的状态（是否可考试、是否已完成、补考状态）
router.get("/status/:examId", authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user as JwtPayload;
  const { examId } = req.params;

  // 检查补考批准
  const approved = db.prepare(
    "SELECT * FROM reexam_approved WHERE userId = ? AND examId = ?"
  ).get(user.username, examId);

  if (approved) {
    res.json({ canTake: true, status: "reexam_approved", lastResultId: null });
    return;
  }

  // 检查补考申请
  const pending = db.prepare(
    "SELECT * FROM reexam_requests WHERE userId = ? AND examId = ? AND status = 'pending'"
  ).get(user.username, examId);

  // 检查是否已完成
  const completed = db.prepare(
    "SELECT * FROM completions WHERE userId = ? AND examId = ?"
  ).get(user.username, examId);

  if (completed) {
    // 获取最近一次结果
    const lastResult = db.prepare(
      "SELECT id FROM results WHERE userId = ? AND examId = ? ORDER BY submittedAt DESC LIMIT 1"
    ).get(user.username, examId) as { id: string } | undefined;

    res.json({
      canTake: false,
      status: pending ? "reexam_pending" : "completed",
      lastResultId: lastResult?.id || null,
    });
    return;
  }

  const examApproved = db.prepare(
    "SELECT * FROM exam_approved WHERE userId = ? AND examId = ?"
  ).get(user.username, examId);
  if (examApproved) {
    res.json({ canTake: true, status: "exam_approved", lastResultId: null });
    return;
  }

  const examRequest = db.prepare(
    "SELECT status FROM exam_requests WHERE userId = ? AND examId = ? ORDER BY createdAt DESC LIMIT 1"
  ).get(user.username, examId) as { status: "pending" | "approved" | "rejected" } | undefined;

  if (examRequest?.status === "pending") {
    res.json({ canTake: false, status: "exam_pending", lastResultId: null });
    return;
  }

  if (examRequest?.status === "rejected") {
    res.json({ canTake: false, status: "exam_rejected", lastResultId: null });
    return;
  }

  res.json({ canTake: false, status: "not_requested", lastResultId: null });
});

// 获取所有结果（管理员）
router.get("/", authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user as JwtPayload;
  let results: Result[];

  if (user.role === "admin") {
    const { userId } = req.query;
    if (userId) {
      results = db.prepare("SELECT * FROM results WHERE userId = ? ORDER BY submittedAt DESC").all(userId as string) as Result[];
    } else {
      results = db.prepare("SELECT * FROM results ORDER BY submittedAt DESC").all() as Result[];
    }
  } else {
    results = db.prepare("SELECT * FROM results WHERE userId = ? ORDER BY submittedAt DESC").all(user.username) as Result[];
  }

  res.json(results);
});

// 获取单个结果
router.get("/:id", authenticateToken, (req: Request, res: Response) => {
  const result = db.prepare("SELECT * FROM results WHERE id = ?").get(req.params.id) as Result | undefined;
  if (!result) {
    res.status(404).json({ error: "结果不存在" });
    return;
  }
  res.json(result);
});

// 删除提交记录（管理员）
router.delete("/:id", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const result = db.prepare("SELECT * FROM results WHERE id = ?").get(req.params.id) as Result | undefined;
  if (!result) {
    res.status(404).json({ error: "记录不存在" });
    return;
  }

  // 删除相关数据
  db.prepare("DELETE FROM gradings WHERE resultId = ?").run(req.params.id);
  db.prepare("DELETE FROM results WHERE id = ?").run(req.params.id);
  // 恢复完成状态（删除提交后用户可重新考试）
  db.prepare("DELETE FROM completions WHERE userId = ? AND examId = ?").run(result.userId, result.examId);

  res.json({ ok: true });
});

export default router;
