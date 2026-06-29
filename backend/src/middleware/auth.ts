import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import db from "../db/index.js";
import { JwtPayload } from "../types.js";

const JWT_SECRET = process.env.JWT_SECRET || "online-exam-v2-secret-key-change-in-production";
const ALLOW_LOCAL_AUTH = process.env.ALLOW_LOCAL_AUTH === "true" || process.env.NODE_ENV !== "production";

export { JWT_SECRET };

function sportslackUser(req: Request): JwtPayload | null {
  const username = req.header("x-sportslack-user");
  if (!username) return null;

  const assessRole = req.header("x-sportslack-assess-role");
  const isAdmin = req.header("x-sportslack-is-admin") === "true" || assessRole === "admin";

  return {
    username,
    role: isAdmin ? "admin" : "user",
    sessionVersion: 0,
  };
}

export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const sportslack = sportslackUser(req);
  if (sportslack) {
    (req as any).user = sportslack;
    next();
    return;
  }

  if (!ALLOW_LOCAL_AUTH) {
    res.status(401).json({ error: "未登录，请通过 Sportslack 中台访问。" });
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "未登录，请先登录" });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    // 检查 session 版本 —— 踢掉旧登录
    const account = db.prepare("SELECT sessionVersion FROM accounts WHERE username = ?").get(decoded.username) as { sessionVersion: number } | undefined;
    if (!account || account.sessionVersion !== decoded.sessionVersion) {
      res.status(401).json({ error: "账号已在其他设备登录，请重新登录" });
      return;
    }

    (req as any).user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "登录已过期，请重新登录" });
  }
}
