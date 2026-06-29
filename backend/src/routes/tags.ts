import { Router, Request, Response } from "express";
import db from "../db/index.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";

const router = Router();

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// 获取所有标签
router.get("/", authenticateToken, (_req: Request, res: Response) => {
  const tags = db.prepare("SELECT * FROM tags ORDER BY name").all();
  res.json(tags);
});

// 新增标签（管理员）
router.post("/", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: "标签名不能为空" });
    return;
  }
  const existing = db.prepare("SELECT id FROM tags WHERE name = ?").get(name.trim());
  if (existing) {
    res.status(409).json({ error: "标签已存在" });
    return;
  }
  const id = genId();
  db.prepare("INSERT INTO tags(id, name) VALUES(?,?)").run(id, name.trim());
  res.json({ ok: true, id, name: name.trim() });
});

// 更新标签（管理员）
router.put("/:id", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: "标签名不能为空" });
    return;
  }
  const existing = db.prepare("SELECT id FROM tags WHERE id = ?").get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "标签不存在" });
    return;
  }
  db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(name.trim(), req.params.id);
  res.json({ ok: true });
});

// 删除标签（管理员）
router.delete("/:id", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  db.prepare("DELETE FROM tags WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
