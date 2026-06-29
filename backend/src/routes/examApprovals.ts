import { Router, Request, Response } from "express";
import db from "../db/index.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { ExamRequest, JwtPayload } from "../types.js";

const router = Router();

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// 获取考试申请列表
router.get("/", authenticateToken, requireAdmin, (_req: Request, res: Response) => {
  const requests = db.prepare("SELECT * FROM exam_requests ORDER BY createdAt DESC").all();
  res.json(requests);
});

// 考生提交首次考试申请
router.post("/", authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user as JwtPayload;
  const { examId, examName } = req.body;

  if (!examId || !examName) {
    res.status(400).json({ error: "试卷信息不能为空" });
    return;
  }

  const completed = db.prepare(
    "SELECT * FROM completions WHERE userId = ? AND examId = ?"
  ).get(user.username, examId);
  if (completed) {
    res.status(409).json({ error: "该试卷已完成，如需再次考试请申请补考" });
    return;
  }

  const approved = db.prepare(
    "SELECT * FROM exam_approved WHERE userId = ? AND examId = ?"
  ).get(user.username, examId);
  if (approved) {
    res.status(409).json({ error: "考试申请已通过，可以开始考试" });
    return;
  }

  const pending = db.prepare(
    "SELECT id FROM exam_requests WHERE userId = ? AND examId = ? AND status = 'pending'"
  ).get(user.username, examId);
  if (pending) {
    res.status(409).json({ error: "已有待审批的考试申请" });
    return;
  }

  const id = genId();
  db.prepare(
    "INSERT INTO exam_requests(id, userId, username, examId, examName, status, createdAt) VALUES(?,?,?,?,?,?,?)"
  ).run(id, user.username, user.username, examId, examName, "pending", Date.now());

  res.json({ ok: true, id });
});

// 管理员确认考试申请
router.put("/:id/approve", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const request = db.prepare("SELECT * FROM exam_requests WHERE id = ?").get(req.params.id) as ExamRequest | undefined;
  if (!request) {
    res.status(404).json({ error: "申请不存在" });
    return;
  }

  db.prepare("UPDATE exam_requests SET status = 'approved' WHERE id = ?").run(req.params.id);
  db.prepare("INSERT OR IGNORE INTO exam_approved(userId, examId) VALUES(?,?)").run(request.userId, request.examId);
  res.json({ ok: true });
});

// 管理员拒绝考试申请
router.put("/:id/reject", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const request = db.prepare("SELECT * FROM exam_requests WHERE id = ?").get(req.params.id) as ExamRequest | undefined;
  if (!request) {
    res.status(404).json({ error: "申请不存在" });
    return;
  }

  db.prepare("UPDATE exam_requests SET status = 'rejected' WHERE id = ?").run(req.params.id);
  db.prepare("DELETE FROM exam_approved WHERE userId = ? AND examId = ?").run(request.userId, request.examId);
  res.json({ ok: true });
});

export default router;
