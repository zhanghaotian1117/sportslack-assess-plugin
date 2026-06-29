import bcrypt from "bcryptjs";
import type { Statement } from "better-sqlite3";
import db from "./index.js";

export function seedAccounts(): void {
  const count = db.prepare("SELECT COUNT(*) as c FROM accounts").get() as { c: number };
  if (count.c > 0) return;

  const hash = bcrypt.hashSync("123456", 10);
  const insert = db.prepare("INSERT INTO accounts(username, password, role) VALUES(?, ?, ?)");

  const seedMany = insertMany(insert);
  seedMany(1, 4, "admin", hash);
  seedMany(1, 20, "user", hash);

  console.log(`Seeded accounts: admin1-4, user1-20 (password: 123456)`);
}

function insertMany(insert: Statement<[string, string, string]>) {
  return (start: number, end: number, prefix: string, hash: string) => {
    for (let i = start; i <= end; i++) {
      insert.run(`${prefix}${i}`, hash, prefix);
    }
  };
}
