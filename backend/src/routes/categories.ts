import { Router, Request, Response } from "express";
import db from "../db/index.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";

const router = Router();

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// 获取所有类别
router.get("/", authenticateToken, (_req: Request, res: Response) => {
  const categories = db.prepare("SELECT * FROM categories").all();
  res.json(categories);
});

// 添加类别
router.post("/", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: "类别名称不能为空" });
    return;
  }
  const id = genId();
  db.prepare("INSERT INTO categories(id, name) VALUES(?, ?)").run(id, name.trim());
  res.json({ ok: true, id, name: name.trim() });
});

// 更新类别
router.put("/:id", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: "类别名称不能为空" });
    return;
  }
  db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name.trim(), req.params.id);
  res.json({ ok: true });
});

// 删除类别
router.delete("/:id", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  db.prepare("DELETE FROM categories WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
