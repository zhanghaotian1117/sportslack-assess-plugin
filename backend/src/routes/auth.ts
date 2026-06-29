import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db, { getViewablePassword, saveViewablePassword } from "../db/index.js";
import { JWT_SECRET, authenticateToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { Account, JwtPayload } from "../types.js";

const router = Router();
const ALLOW_LOCAL_AUTH = process.env.ALLOW_LOCAL_AUTH === "true" || process.env.NODE_ENV !== "production";

function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

// 登录
router.post("/login", (req: Request, res: Response) => {
  if (!ALLOW_LOCAL_AUTH) {
    res.status(403).json({ error: "线上环境请通过 Sportslack 中台登录。" });
    return;
  }

  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "用户名和密码不能为空" });
    return;
  }

  const account = db.prepare("SELECT * FROM accounts WHERE username = ?").get(username) as (Account & { sessionVersion?: number }) | undefined;
  if (!account || !bcrypt.compareSync(password, account.password)) {
    res.status(401).json({ error: "用户名或密码错误" });
    return;
  }

  // 递增 session 版本，踢掉旧登录
  const newVersion = (account.sessionVersion || 0) + 1;
  db.prepare("UPDATE accounts SET sessionVersion = ? WHERE username = ?").run(newVersion, account.username);

  const token = signToken({ username: account.username, role: account.role as "admin" | "user", sessionVersion: newVersion });
  res.json({
    token,
    user: { username: account.username, role: account.role },
  });
});

// 获取当前用户信息
router.get("/me", authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user as JwtPayload;
  res.json({
    username: user.username,
    name: user.username,
    role: user.role,
    assessRole: user.role === "admin" ? "admin" : "candidate",
    isAdmin: user.role === "admin",
  });
});

router.get("/session", authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user as JwtPayload;
  res.json({
    ok: true,
    user: {
      username: user.username,
      name: user.username,
      role: user.role,
      assessRole: user.role === "admin" ? "admin" : "candidate",
      isAdmin: user.role === "admin",
      plugins: ["assess"],
      abilities: {
        assess: user.role === "admin" ? ["view", "take", "grade", "manage"] : ["view", "take"],
      },
    },
  });
});

router.get("/password", authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user as JwtPayload;
  const password = getViewablePassword(user.username);
  if (!password) {
    res.status(404).json({ error: "当前账号没有保存可查看的密码，请先修改一次密码。" });
    return;
  }

  res.json({ password });
});

// 注册（仅管理员可用）
router.post("/register", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "用户名和密码不能为空" });
    return;
  }
  if (role !== "admin" && role !== "user") {
    res.status(400).json({ error: "角色必须是 admin 或 user" });
    return;
  }

  const existing = db.prepare("SELECT username FROM accounts WHERE username = ?").get(username);
  if (existing) {
    res.status(409).json({ error: "用户名已存在" });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO accounts(username, password, role) VALUES(?, ?, ?)").run(username, hash, role);
  saveViewablePassword(username, password);
  res.json({ ok: true, user: { username, role } });
});

// 修改密码
router.put("/password", authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user as JwtPayload;
  const { oldPassword, newPassword } = req.body;

  const account = db.prepare("SELECT * FROM accounts WHERE username = ?").get(user.username) as Account | undefined;
  if (!account || !bcrypt.compareSync(oldPassword, account.password)) {
    res.status(400).json({ error: "原密码错误" });
    return;
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE accounts SET password = ?, sessionVersion = COALESCE(sessionVersion, 0) + 1 WHERE username = ?").run(hash, user.username);
  saveViewablePassword(user.username, newPassword);
  res.json({ ok: true });
});

export default router;
