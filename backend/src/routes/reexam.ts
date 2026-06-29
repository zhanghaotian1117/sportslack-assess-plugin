import { Router, Request, Response } from "express";
import db from "../db/index.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { JwtPayload } from "../types.js";

const router = Router();

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// 获取补考申请列表
router.get("/", authenticateToken, requireAdmin, (_req: Request, res: Response) => {
  const requests = db.prepare("SELECT * FROM reexam_requests ORDER BY createdAt DESC").all();
  res.json(requests);
});

// 提交补考申请（用户）
router.post("/", authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user as JwtPayload;
  const { examId, examName } = req.body;

  const existing = db.prepare(
    "SELECT id FROM reexam_requests WHERE userId = ? AND examId = ? AND status = ?"
  ).get(user.username, examId, "pending");

  if (existing) {
    res.status(409).json({ error: "已有待审批的补考申请" });
    return;
  }

  const id = genId();
  db.prepare(
    "INSERT INTO reexam_requests(id, userId, username, examId, examName, status, createdAt) VALUES(?,?,?,?,?,?,?)"
  ).run(id, user.username, user.username, examId, examName, "pending", Date.now());

  res.json({ ok: true, id });
});

// 获取用户补考状态
router.get("/status/:examId", authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user as JwtPayload;

  const approved = db.prepare("SELECT * FROM reexam_approved WHERE userId = ? AND examId = ?").get(user.username, req.params.examId);
  if (approved) {
    res.json({ status: "approved" });
    return;
  }

  const pending = db.prepare(
    "SELECT * FROM reexam_requests WHERE userId = ? AND examId = ? AND status = 'pending'"
  ).get(user.username, req.params.examId);
  if (pending) {
    res.json({ status: "pending" });
    return;
  }

  const completed = db.prepare("SELECT * FROM completions WHERE userId = ? AND examId = ?").get(user.username, req.params.examId);
  res.json({ status: completed ? "completed" : "none" });
});

// 批准补考
router.put("/:id/approve", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const request = db.prepare("SELECT * FROM reexam_requests WHERE id = ?").get(req.params.id) as any;
  if (!request) {
    res.status(404).json({ error: "申请不存在" });
    return;
  }

  db.prepare("UPDATE reexam_requests SET status = 'approved' WHERE id = ?").run(req.params.id);
  db.prepare("INSERT OR IGNORE INTO reexam_approved(userId, examId) VALUES(?,?)").run(request.userId, request.examId);
  db.prepare("DELETE FROM completions WHERE userId = ? AND examId = ?").run(request.userId, request.examId);

  res.json({ ok: true });
});

// 拒绝补考
router.put("/:id/reject", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  db.prepare("UPDATE reexam_requests SET status = 'rejected' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
