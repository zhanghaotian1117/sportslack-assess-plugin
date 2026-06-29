import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import db, { getViewablePassword, saveViewablePassword } from "../db/index.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { Account } from "../types.js";

const router = Router();

// 获取所有用户（管理员，返回密码占位符）
router.get("/", authenticateToken, requireAdmin, (_req: Request, res: Response) => {
  const accounts = db.prepare("SELECT username, role, password FROM accounts ORDER BY role, username").all();
  // 用占位标记替代真实哈希
  const result = (accounts as Account[]).map((a) => ({
    username: a.username,
    role: a.role,
    hasPassword: true,
  }));
  res.json(result);
});

router.get("/:username/password", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const username = String(req.params.username);
  const account = db.prepare("SELECT username FROM accounts WHERE username = ?").get(username) as Account | undefined;
  if (!account) {
    res.status(404).json({ error: "用户不存在" });
    return;
  }

  const password = getViewablePassword(username);
  if (!password) {
    res.status(404).json({ error: "该账号没有保存可查看的密码，请先重置一次密码。" });
    return;
  }

  res.json({ password });
});

// 添加用户（管理员）
router.post("/", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const { username, password, role } = req.body;
  if (!username?.trim() || !password) {
    res.status(400).json({ error: "用户名和密码不能为空" });
    return;
  }
  if (role !== "admin" && role !== "user") {
    res.status(400).json({ error: "角色必须是 admin 或 user" });
    return;
  }

  const existing = db.prepare("SELECT username FROM accounts WHERE username = ?").get(username.trim());
  if (existing) {
    res.status(409).json({ error: "用户名已存在" });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO accounts(username, password, role) VALUES(?,?,?)").run(username.trim(), hash, role);
  saveViewablePassword(username.trim(), password);
  res.json({ ok: true, user: { username: username.trim(), role } });
});

// 修改用户（管理员）
router.put("/:username", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const { username: oldUsername } = req.params;
  const { username: newUsername, password } = req.body;

  const account = db.prepare("SELECT * FROM accounts WHERE username = ?").get(oldUsername) as Account | undefined;
  if (!account) {
    res.status(404).json({ error: "用户不存在" });
    return;
  }

  // 如果修改了用户名，检查新用户名是否冲突
  if (newUsername && newUsername !== oldUsername) {
    const existing = db.prepare("SELECT username FROM accounts WHERE username = ?").get(newUsername);
    if (existing) {
      res.status(409).json({ error: "用户名已存在" });
      return;
    }
  }

  const finalUsername = newUsername || oldUsername;

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE accounts SET username = ?, password = ?, sessionVersion = COALESCE(sessionVersion, 0) + 1 WHERE username = ?").run(finalUsername, hash, oldUsername);
    saveViewablePassword(finalUsername, password);
  } else {
    db.prepare("UPDATE accounts SET username = ? WHERE username = ?").run(finalUsername, oldUsername);
  }

  if (finalUsername !== oldUsername) {
    db.prepare("UPDATE password_vault SET username = ? WHERE username = ?").run(finalUsername, oldUsername);
  }

  // 如果用户名变更，同步更新关联表
  if (finalUsername !== oldUsername) {
    db.prepare("UPDATE results SET userId = ?, username = ? WHERE userId = ?").run(finalUsername, finalUsername, oldUsername);
    db.prepare("UPDATE completions SET userId = ? WHERE userId = ?").run(finalUsername, oldUsername);
    db.prepare("UPDATE reexam_requests SET userId = ?, username = ? WHERE userId = ?").run(finalUsername, finalUsername, oldUsername);
    db.prepare("UPDATE reexam_approved SET userId = ? WHERE userId = ?").run(finalUsername, oldUsername);
    db.prepare("UPDATE exam_requests SET userId = ?, username = ? WHERE userId = ?").run(finalUsername, finalUsername, oldUsername);
    db.prepare("UPDATE exam_approved SET userId = ? WHERE userId = ?").run(finalUsername, oldUsername);
  }

  res.json({ ok: true, user: { username: finalUsername, role: account.role } });
});

// 删除用户
router.delete("/:username", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const { username } = req.params;
  const account = db.prepare("SELECT username FROM accounts WHERE username = ?").get(username) as Account | undefined;
  if (!account) {
    res.status(404).json({ error: "用户不存在" });
    return;
  }

  db.prepare("DELETE FROM accounts WHERE username = ?").run(username);
  db.prepare("DELETE FROM completions WHERE userId = ?").run(username);
  db.prepare("DELETE FROM reexam_requests WHERE userId = ?").run(username);
  db.prepare("DELETE FROM reexam_approved WHERE userId = ?").run(username);
  db.prepare("DELETE FROM exam_requests WHERE userId = ?").run(username);
  db.prepare("DELETE FROM exam_approved WHERE userId = ?").run(username);
  db.prepare("DELETE FROM results WHERE userId = ?").run(username);
  db.prepare("DELETE FROM password_vault WHERE username = ?").run(username);

  res.json({ ok: true });
});

export default router;
