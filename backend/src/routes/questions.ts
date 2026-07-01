import { Router, Request, Response } from "express";
import { gzipSync } from "node:zlib";
import db from "../db/index.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { Question } from "../types.js";

const router = Router();

const VALID_TYPES = new Set(["true_false", "short_answer", "single_choice", "multiple_choice"]);
const ANSWER_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const GZIP_THRESHOLD_BYTES = 1024 * 64;

type ImportQuestionInput = {
  type?: string;
  question?: string;
  answer?: unknown;
  score?: unknown;
  explanation?: string;
  categoryId?: string;
  category?: string;
  categoryName?: string;
  images?: unknown;
  textAlign?: string;
  tags?: unknown;
  options?: unknown;
  answerAlign?: string;
  explanationAlign?: string;
};

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return normalizeStringArray(parsed);
    } catch {}

    return trimmed.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function ensureCategoryId(nameOrId?: string): string {
  const value = nameOrId?.trim();
  if (!value) return "";

  const existingById = db.prepare("SELECT id FROM categories WHERE id = ?").get(value) as { id: string } | undefined;
  if (existingById) return existingById.id;

  const existingByName = db.prepare("SELECT id FROM categories WHERE name = ?").get(value) as { id: string } | undefined;
  if (existingByName) return existingByName.id;

  const id = genId();
  db.prepare("INSERT INTO categories(id, name) VALUES(?, ?)").run(id, value);
  return id;
}

function ensureTags(names: string[]): string[] {
  const result: string[] = [];
  const select = db.prepare("SELECT id FROM tags WHERE name = ?");
  const insert = db.prepare("INSERT INTO tags(id, name) VALUES(?, ?)");

  for (const name of names) {
    const clean = name.trim();
    if (!clean || result.includes(clean)) continue;
    const existing = select.get(clean);
    if (!existing) insert.run(genId(), clean);
    result.push(clean);
  }

  return result;
}

function normalizeImportQuestion(raw: ImportQuestionInput, index: number) {
  const type = String(raw.type || "").trim();
  if (!VALID_TYPES.has(type)) {
    throw new Error(`第 ${index + 1} 题题型无效`);
  }

  const question = String(raw.question || "").trim();
  if (!question) {
    throw new Error(`第 ${index + 1} 题题目不能为空`);
  }

  const options = normalizeStringArray(raw.options);
  let answer = "";

  if (type === "true_false") {
    const value = String(raw.answer).trim().toLowerCase();
    if (["true", "正确", "对", "yes", "1"].includes(value)) answer = "true";
    else if (["false", "错误", "错", "no", "0"].includes(value)) answer = "false";
    else throw new Error(`第 ${index + 1} 题判断题答案必须是 true/false 或 正确/错误`);
  } else if (type === "single_choice") {
    if (options.length < 2) throw new Error(`第 ${index + 1} 题单选题至少需要 2 个选项`);
    answer = String(raw.answer || "").trim().toUpperCase();
    if (!ANSWER_LETTERS.slice(0, options.length).includes(answer)) {
      throw new Error(`第 ${index + 1} 题单选题答案必须是 A-${ANSWER_LETTERS[options.length - 1]}`);
    }
  } else if (type === "multiple_choice") {
    if (options.length < 2) throw new Error(`第 ${index + 1} 题多选题至少需要 2 个选项`);
    const answers = normalizeStringArray(raw.answer).map((item) => item.toUpperCase());
    if (answers.length === 0) throw new Error(`第 ${index + 1} 题多选题答案不能为空`);
    const validLetters = ANSWER_LETTERS.slice(0, options.length);
    const uniqueAnswers = [...new Set(answers)];
    if (uniqueAnswers.some((item) => !validLetters.includes(item))) {
      throw new Error(`第 ${index + 1} 题多选题答案必须在 A-${ANSWER_LETTERS[options.length - 1]} 范围内`);
    }
    answer = JSON.stringify(uniqueAnswers);
  } else {
    answer = String(raw.answer ?? "").trim();
    if (!answer) throw new Error(`第 ${index + 1} 题答案不能为空`);
  }

  const score = Number(raw.score ?? (type === "true_false" ? 1 : 5));
  if (!Number.isFinite(score) || score <= 0) {
    throw new Error(`第 ${index + 1} 题分值必须大于 0`);
  }

  const categoryId = ensureCategoryId(raw.categoryId || raw.categoryName || raw.category);
  const tags = ensureTags(normalizeStringArray(raw.tags));
  const images = normalizeStringArray(raw.images);

  return {
    id: genId(),
    type,
    question,
    answer,
    score,
    explanation: String(raw.explanation || ""),
    categoryId,
    images: JSON.stringify(images),
    createdAt: Date.now() + index,
    textAlign: raw.textAlign === "center" || raw.textAlign === "right" ? raw.textAlign : "left",
    tags: JSON.stringify(tags),
    options: JSON.stringify(options),
    answerAlign: raw.answerAlign === "center" || raw.answerAlign === "right" ? raw.answerAlign : "left",
    explanationAlign: raw.explanationAlign === "center" || raw.explanationAlign === "right" ? raw.explanationAlign : "left",
  };
}

function insertQuestion(item: {
  id: string;
  type: string;
  question: string;
  answer: string;
  score: number;
  explanation: string;
  categoryId: string;
  images: string;
  createdAt: number;
  textAlign: string;
  tags: string;
  options: string;
  answerAlign: string;
  explanationAlign: string;
}) {
  db.prepare(
    "INSERT INTO questions(id, type, question, answer, score, explanation, categoryId, images, createdAt, textAlign, tags, options, answerAlign, explanationAlign) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(
    item.id,
    item.type,
    item.question,
    item.answer,
    item.score,
    item.explanation,
    item.categoryId,
    item.images,
    item.createdAt,
    item.textAlign,
    item.tags,
    item.options,
    item.answerAlign,
    item.explanationAlign
  );
}

function sendJson(req: Request, res: Response, data: unknown) {
  const body = JSON.stringify(data);
  const acceptsGzip = /\bgzip\b/i.test(req.header("accept-encoding") || "");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Vary", "Accept-Encoding");

  if (acceptsGzip && Buffer.byteLength(body) >= GZIP_THRESHOLD_BYTES) {
    const compressed = gzipSync(body);
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Content-Length", String(compressed.byteLength));
    res.send(compressed);
    return;
  }

  res.send(body);
}

router.get("/", authenticateToken, (req: Request, res: Response) => {
  const questions = db.prepare("SELECT * FROM questions ORDER BY createdAt DESC").all();
  sendJson(req, res, questions);
});

router.get("/category/:categoryId", authenticateToken, (req: Request, res: Response) => {
  const questions = db.prepare("SELECT * FROM questions WHERE categoryId = ? ORDER BY createdAt DESC").all(String(req.params.categoryId));
  sendJson(req, res, questions);
});

router.post("/batch", authenticateToken, (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.json([]);
    return;
  }

  const placeholders = ids.map(() => "?").join(",");
  const questions = db.prepare(`SELECT * FROM questions WHERE id IN (${placeholders})`).all(...ids);
  sendJson(req, res, questions);
});

router.post("/import", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const input = Array.isArray(req.body) ? req.body : req.body?.questions;
  if (!Array.isArray(input) || input.length === 0) {
    res.status(400).json({ error: "请提供 questions 数组" });
    return;
  }
  if (input.length > 1000) {
    res.status(400).json({ error: "单次最多导入 1000 道题" });
    return;
  }

  try {
    const importMany = db.transaction((items: ImportQuestionInput[]) => {
      const normalized = items.map((item, index) => normalizeImportQuestion(item, index));
      for (const item of normalized) insertQuestion(item);
      return normalized;
    });

    const imported = importMany(input as ImportQuestionInput[]);
    res.json({ ok: true, imported: imported.length, questions: imported });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "导入失败" });
  }
});

router.get("/:id", authenticateToken, (req: Request, res: Response) => {
  const question = db.prepare("SELECT * FROM questions WHERE id = ?").get(String(req.params.id));
  if (!question) {
    res.status(404).json({ error: "题目不存在" });
    return;
  }

  res.json(question);
});

router.post("/", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const { type, question, answer, score, explanation, categoryId, images, textAlign, tags, options, answerAlign, explanationAlign } = req.body;
  if (!type || !question?.trim() || answer === undefined) {
    res.status(400).json({ error: "题型、题目内容和答案不能为空" });
    return;
  }

  const normalized = {
    id: genId(),
    type,
    question: question.trim(),
    answer: String(answer),
    score: score ?? (type === "true_false" ? 1 : 5),
    explanation: explanation || "",
    categoryId: categoryId || "",
    images: JSON.stringify(images || []),
    createdAt: Date.now(),
    textAlign: textAlign || "left",
    tags: JSON.stringify(tags || []),
    options: JSON.stringify(options || []),
    answerAlign: answerAlign || "left",
    explanationAlign: explanationAlign || "left",
  };

  insertQuestion(normalized);
  const created = db.prepare("SELECT * FROM questions WHERE id = ?").get(normalized.id) as Question;
  res.json({ ok: true, question: created });
});

router.put("/:id", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const id = String(req.params.id);
  const existing = db.prepare("SELECT * FROM questions WHERE id = ?").get(id) as Question | undefined;
  if (!existing) {
    res.status(404).json({ error: "题目不存在" });
    return;
  }

  const { type, question, answer, score, explanation, categoryId, images, textAlign, tags, options, answerAlign, explanationAlign } = req.body;
  db.prepare(
    "UPDATE questions SET type=?, question=?, answer=?, score=?, explanation=?, categoryId=?, images=?, textAlign=?, tags=?, options=?, answerAlign=?, explanationAlign=? WHERE id=?"
  ).run(
    type ?? existing.type,
    question?.trim() ?? existing.question,
    answer !== undefined ? String(answer) : existing.answer,
    score ?? existing.score,
    explanation ?? existing.explanation,
    categoryId ?? existing.categoryId,
    images !== undefined ? JSON.stringify(images) : existing.images,
    textAlign ?? (existing as any).textAlign ?? "left",
    tags !== undefined ? JSON.stringify(tags) : (existing as any).tags ?? "[]",
    options !== undefined ? JSON.stringify(options) : (existing as any).options ?? "[]",
    answerAlign ?? (existing as any).answerAlign ?? "left",
    explanationAlign ?? (existing as any).explanationAlign ?? "left",
    id
  );

  const updated = db.prepare("SELECT * FROM questions WHERE id = ?").get(id);
  res.json({ ok: true, question: updated });
});

router.post("/export", authenticateToken, requireAdmin, (_req: Request, res: Response) => {
  const questions = db.prepare(`
    SELECT q.*, c.name as categoryName
    FROM questions q
    LEFT JOIN categories c ON q.categoryId = c.id
    ORDER BY q.createdAt DESC
  `).all() as any[];

  const typeLabels: Record<string, string> = {
    true_false: "判断题",
    short_answer: "简答题",
    single_choice: "单选题",
    multiple_choice: "多选题",
  };
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const rows = questions.map((q, i) => {
    let answer = q.answer;
    if (q.type === "true_false") answer = q.answer === "true" ? "正确" : "错误";
    if (q.type === "multiple_choice") {
      try { answer = JSON.parse(q.answer).join(", "); } catch {}
    }

    let options = "";
    try {
      const parsedOptions: string[] = JSON.parse(q.options || "[]");
      options = parsedOptions.map((item, idx) => `<div>${ANSWER_LETTERS[idx]}. ${esc(item)}</div>`).join("");
    } catch {}

    let tags = "";
    try {
      const parsedTags: string[] = JSON.parse(q.tags || "[]");
      tags = parsedTags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join("");
    } catch {}

    return `
      <section class="question">
        <div class="meta">#${i + 1} ${typeLabels[q.type] || q.type} ${q.categoryName ? ` / ${esc(q.categoryName)}` : ""} / ${q.score} 分</div>
        <div class="body">${esc(q.question)}</div>
        ${options ? `<div class="options">${options}</div>` : ""}
        <div class="answer">答案：${esc(answer)}</div>
        ${q.explanation ? `<div class="explanation">解析：${esc(q.explanation)}</div>` : ""}
        ${tags ? `<div class="tags">${tags}</div>` : ""}
      </section>
    `;
  }).join("");

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>题库导出 ${dateStr}</title>
  <style>
    body { font-family: "Microsoft YaHei", sans-serif; background: #f7f7f7; color: #222; padding: 32px; }
    .container { max-width: 960px; margin: 0 auto; }
    .question { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 18px 22px; margin: 14px 0; }
    .meta { color: #666; font-size: 13px; margin-bottom: 10px; }
    .body { white-space: pre-wrap; line-height: 1.7; margin-bottom: 10px; }
    .options { background: #f8f8f8; padding: 10px 12px; border-radius: 6px; margin-bottom: 10px; }
    .answer { color: #047857; margin-bottom: 8px; }
    .explanation { color: #555; border-left: 3px solid #f59e0b; padding-left: 10px; }
    .tag { display: inline-block; background: #eee; border-radius: 4px; padding: 2px 8px; margin-right: 6px; font-size: 12px; }
  </style>
</head>
<body>
  <main class="container">
    <h1>题库导出</h1>
    <p>导出时间：${now.toLocaleString("zh-CN")}；共 ${questions.length} 题</p>
    ${rows}
  </main>
</body>
</html>`;

  const filename = `题库导出_${dateStr}.html`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(html);
});

router.delete("/:id", authenticateToken, requireAdmin, (req: Request, res: Response) => {
  db.prepare("DELETE FROM questions WHERE id = ?").run(String(req.params.id));
  res.json({ ok: true });
});

export default router;
