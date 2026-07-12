import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

type Bindings = {
  DB: D1Database;
  AUTH_PASSWORD: string;
  AUTH_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// ---------- 鉴权:密码登录 + HMAC 签名 cookie ----------

const COOKIE_NAME = "babynote_session";
// 长期登录，并在每次已鉴权请求时自动续期。
// Hono 遵循浏览器规范，单次 Cookie 有效期最长 400 天；通过滑动续期实现长期登录。
const SESSION_DAYS = 400;

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function makeToken(secret: string): Promise<string> {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  return `${expiresAt}.${await hmac(secret, `${expiresAt}`)}`;
}

async function verifyToken(secret: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expiresAtText, signature] = token.split(".");
  if (!expiresAtText || !signature) return false;
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  return (await hmac(secret, expiresAtText)) === signature;
}

app.post("/api/login", async (c) => {
  const body = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string });
  if (!body.password || body.password !== c.env.AUTH_PASSWORD) {
    return c.json({ error: "密码不正确" }, 401);
  }

  setCookie(c, COOKIE_NAME, await makeToken(c.env.AUTH_SECRET), sessionCookieOptions());
  return c.json({ ok: true });
});

app.post("/api/logout", (c) => {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/login") return next();
  const isValid = await verifyToken(c.env.AUTH_SECRET, getCookie(c, COOKIE_NAME));
  if (!isValid) {
    return c.json({ error: "未登录" }, 401);
  }
  // 滑动续期：只要继续使用，就始终保持登录。
  setCookie(c, COOKIE_NAME, await makeToken(c.env.AUTH_SECRET), sessionCookieOptions());
  return next();
});

app.get("/api/me", (c) => c.json({ ok: true }));

// ---------- 记录表配置:统一的 CRUD ----------

interface TableConfig {
  table: string;
  orderBy: string;
  // JSON 字段名 → 数据库列名;顺序即插入/更新的列顺序
  columns: Record<string, string>;
  // 必填字段(创建时校验)
  required: string[];
}

const TABLES: Record<string, TableConfig> = {
  feeding: {
    table: "feeding_records",
    orderBy: "started_at",
    columns: {
      startedAt: "started_at",
      endedAt: "ended_at",
      formulaStartedAt: "formula_started_at",
      feedingType: "feeding_type",
      amountML: "amount_ml",
      note: "note",
    },
    required: ["startedAt", "feedingType"],
  },
  weight: {
    table: "weight_records",
    orderBy: "recorded_at",
    columns: { recordedAt: "recorded_at", weightKG: "weight_kg", note: "note" },
    required: ["recordedAt", "weightKG"],
  },
  medication: {
    table: "medication_records",
    orderBy: "recorded_at",
    columns: { recordedAt: "recorded_at", name: "name", dosage: "dosage", note: "note" },
    required: ["recordedAt", "name"],
  },
  checkup: {
    table: "checkup_records",
    orderBy: "recorded_at",
    columns: {
      recordedAt: "recorded_at",
      location: "location",
      summary: "summary",
      attachmentPath: "attachment_path",
      note: "note",
    },
    required: ["recordedAt"],
  },
  fetalMovement: {
    table: "fetal_movement_records",
    orderBy: "recorded_at",
    columns: {
      recordedAt: "recorded_at",
      durationMinutes: "duration_minutes",
      movementCount: "movement_count",
      note: "note",
    },
    required: ["recordedAt"],
  },
  bloodGlucose: {
    table: "blood_glucose_records",
    orderBy: "recorded_at",
    columns: { recordedAt: "recorded_at", moment: "moment", valueMMOL: "value_mmol", note: "note" },
    required: ["recordedAt", "moment", "valueMMOL"],
  },
  excretion: {
    table: "excretion_records",
    orderBy: "recorded_at",
    columns: { recordedAt: "recorded_at", type: "type", note: "note" },
    required: ["recordedAt", "type"],
  },
};

function rowToJson(config: TableConfig, row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { id: row.id };
  for (const [jsonKey, column] of Object.entries(config.columns)) {
    result[jsonKey] = row[column] === undefined ? null : row[column];
  }
  return result;
}

async function listAll(db: D1Database, config: TableConfig) {
  const { results } = await db
    .prepare(`SELECT * FROM ${config.table} ORDER BY ${config.orderBy} DESC`)
    .all();
  return results.map((row) => rowToJson(config, row as Record<string, unknown>));
}

// 全量读取:数据量小(个人记录),一次拉全,和 iOS/Android 版行为一致。
app.get("/api/records", async (c) => {
  const [feedings, weights, medications, checkups, fetalMovements, bloodGlucoses, excretions] =
    await Promise.all([
      listAll(c.env.DB, TABLES.feeding),
      listAll(c.env.DB, TABLES.weight),
      listAll(c.env.DB, TABLES.medication),
      listAll(c.env.DB, TABLES.checkup),
      listAll(c.env.DB, TABLES.fetalMovement),
      listAll(c.env.DB, TABLES.bloodGlucose),
      listAll(c.env.DB, TABLES.excretion),
    ]);

  return c.json({ feedings, weights, medications, checkups, fetalMovements, bloodGlucoses, excretions });
});

app.post("/api/:kind", async (c) => {
  const config = TABLES[c.req.param("kind")];
  if (!config) return c.json({ error: "未知记录类型" }, 404);

  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: "无效的请求体" }, 400);

  for (const field of config.required) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      return c.json({ error: `缺少字段 ${field}` }, 400);
    }
  }

  const jsonKeys = Object.keys(config.columns);
  const columns = jsonKeys.map((key) => config.columns[key]);
  const placeholders = jsonKeys.map(() => "?").join(", ");
  const values = jsonKeys.map((key) => (body[key] === undefined ? null : body[key]));

  const result = await c.env.DB
    .prepare(`INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${placeholders})`)
    .bind(...values)
    .run();

  const row = await c.env.DB
    .prepare(`SELECT * FROM ${config.table} WHERE id = ?`)
    .bind(result.meta.last_row_id)
    .first();
  return c.json(rowToJson(config, row as Record<string, unknown>), 201);
});

app.put("/api/:kind/:id", async (c) => {
  const config = TABLES[c.req.param("kind")];
  if (!config) return c.json({ error: "未知记录类型" }, 404);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "无效的 id" }, 400);

  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: "无效的请求体" }, 400);

  // 只更新请求里出现的字段
  const updates = Object.keys(config.columns).filter((key) => body[key] !== undefined);
  if (updates.length === 0) return c.json({ error: "没有要更新的字段" }, 400);

  const assignments = updates.map((key) => `${config.columns[key]} = ?`).join(", ");
  const values = updates.map((key) => body[key]);

  const result = await c.env.DB
    .prepare(`UPDATE ${config.table} SET ${assignments} WHERE id = ?`)
    .bind(...values, id)
    .run();
  if (result.meta.changes === 0) return c.json({ error: "记录不存在" }, 404);

  const row = await c.env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
  return c.json(rowToJson(config, row as Record<string, unknown>));
});

app.delete("/api/:kind/:id", async (c) => {
  const config = TABLES[c.req.param("kind")];
  if (!config) return c.json({ error: "未知记录类型" }, 404);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "无效的 id" }, 400);

  const result = await c.env.DB.prepare(`DELETE FROM ${config.table} WHERE id = ?`).bind(id).run();
  if (result.meta.changes === 0) return c.json({ error: "记录不存在" }, 404);
  return c.json({ ok: true });
});

export default app;
