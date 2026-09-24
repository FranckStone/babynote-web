import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { DurableObject } from "cloudflare:workers";
import { createShareToken, verifyShareToken, createShareSession, verifyShareSession, isShareKeyActive, newShareKeyId, type ShareKeyRow } from "./share";
import type { SessionInfo, ShareKey } from "../shared/types";

type Bindings = {
  DB: D1Database;
  AUTH_PASSWORD: string;
  AUTH_SECRET: string;
  REALTIME: DurableObjectNamespace<RealtimeHub>;
};

export class RealtimeHub extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    // 客户端心跳由运行时自动应答，不唤醒休眠中的 DO。
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/notify") {
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send("records-changed");
        } catch {
          // 已断开的连接会由运行时清理。
        }
      }
      return new Response(null, { status: 204 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // 客户端心跳只用于维持连接，不触发数据读取。
    if (message === "ping") socket.send("pong");
  }
}

const app = new Hono<{ Bindings: Bindings; Variables: { session: SessionInfo } }>();

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
  if (!token || !/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
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
  return c.json({ permission: "owner" } satisfies SessionInfo);
});

app.post("/api/share-login", async (c) => {
  const body = await c.req.json<{ token?: unknown }>().catch(() => null);
  c.header("Cache-Control", "no-store");
  const id = await verifyShareToken(c.env.AUTH_SECRET, body?.token);
  const key = id ? await c.env.DB.prepare("SELECT * FROM share_keys WHERE id = ?").bind(id).first<ShareKeyRow>() : null;
  if (!isShareKeyActive(key)) {
    return c.json({ error: "分享 Key 无效、已停用或已过期" }, 401);
  }
  await c.env.DB.prepare("UPDATE share_keys SET last_used_at = ? WHERE id = ?").bind(Date.now(), key.id).run();
  setCookie(c, COOKIE_NAME, await createShareSession(c.env.AUTH_SECRET, key.id), sessionCookieOptions());
  return c.json({ permission: key.permission, shareName: key.name } satisfies SessionInfo);
});

app.post("/api/logout", (c) => {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  const token = getCookie(c, COOKIE_NAME);
  if (await verifyToken(c.env.AUTH_SECRET, token)) {
    c.set("session", { permission: "owner" });
    setCookie(c, COOKIE_NAME, await makeToken(c.env.AUTH_SECRET), sessionCookieOptions());
  } else {
    const id = await verifyShareSession(c.env.AUTH_SECRET, token);
    const key = id ? await c.env.DB.prepare("SELECT * FROM share_keys WHERE id = ?").bind(id).first<ShareKeyRow>() : null;
    if (!isShareKeyActive(key)) return c.json({ error: "登录已失效，请重新登录" }, 401);
    c.set("session", { permission: key.permission, shareName: key.name });
    // Never convert a share visitor into an owner session. Check the Key on every request.
    setCookie(c, COOKIE_NAME, await createShareSession(c.env.AUTH_SECRET, key.id), sessionCookieOptions());
  }
  const permission = c.get("session").permission;
  const managesKeys = c.req.path === "/api/share-links" || c.req.path.startsWith("/api/share-links/");
  if (managesKeys && permission !== "owner") return c.json({ error: "仅密码登录的管理员可管理分享 Key" }, 403);
  if (permission === "read" && !["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    return c.json({ error: "当前分享 Key 为只读，不能修改记录" }, 403);
  }
  return next();
});

app.get("/api/me", (c) => c.json(c.get("session")));

async function shareKeyJson(secret: string, row: ShareKeyRow): Promise<ShareKey> {
  return {
    id: row.id, name: row.name, permission: row.permission,
    createdAt: row.created_at, expiresAt: row.expires_at,
    disabledAt: row.disabled_at, lastUsedAt: row.last_used_at,
    token: await createShareToken(secret, row.id),
  };
}

app.get("/api/share-links", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM share_keys ORDER BY created_at DESC, id DESC").all<ShareKeyRow>();
  return c.json(await Promise.all(results.map((row) => shareKeyJson(c.env.AUTH_SECRET, row))));
});

app.post("/api/share-links", async (c) => {
  const body = await c.req.json<{ name?: unknown; permission?: unknown; durationDays?: unknown }>().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 50 ||
      (body.permission !== "read" && body.permission !== "write") || ![null, 1, 7, 30].includes(body.durationDays as number | null)) {
    return c.json({ error: "请填写 1–50 字的名称，并选择权限和有效期" }, 400);
  }
  const now = Date.now();
  const row: ShareKeyRow = {
    id: newShareKeyId(), name: body.name.trim(), permission: body.permission as "read" | "write",
    created_at: now, expires_at: body.durationDays === null ? null : now + Number(body.durationDays) * 86400000,
    disabled_at: null, last_used_at: null,
  };
  await c.env.DB.prepare("INSERT INTO share_keys (id, name, permission, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(row.id, row.name, row.permission, row.created_at, row.expires_at).run();
  return c.json(await shareKeyJson(c.env.AUTH_SECRET, row), 201);
});

app.patch("/api/share-links/:id", async (c) => {
  const body = await c.req.json<{ disabled?: unknown }>().catch(() => null);
  if (typeof body?.disabled !== "boolean") return c.json({ error: "请选择启用或停用" }, 400);
  const id = c.req.param("id");
  const result = await c.env.DB.prepare("UPDATE share_keys SET disabled_at = ? WHERE id = ?")
    .bind(body.disabled ? Date.now() : null, id).run();
  if (!result.meta.changes) return c.json({ error: "分享 Key 不存在" }, 404);
  const row = await c.env.DB.prepare("SELECT * FROM share_keys WHERE id = ?").bind(id).first<ShareKeyRow>();
  await broadcastRecordsChanged(c.env);
  return c.json(await shareKeyJson(c.env.AUTH_SECRET, row!));
});

app.get("/api/events", async (c) => {
  const hub = c.env.REALTIME.getByName("records");
  return hub.fetch(c.req.raw);
});

async function broadcastRecordsChanged(env: Bindings): Promise<void> {
  const hub = env.REALTIME.getByName("records");
  await hub.fetch("https://realtime.internal/notify", { method: "POST" });
}

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
    columns: { recordedAt: "recorded_at", type: "type", amount: "amount", note: "note" },
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
    .prepare(`SELECT * FROM ${config.table} WHERE deleted_at IS NULL ORDER BY ${config.orderBy} DESC`)
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

app.get("/api/trash", async (c) => {
  const groups = await Promise.all(
    Object.entries(TABLES).map(async ([kind, config]) => {
      const { results } = await c.env.DB
        .prepare(`SELECT * FROM ${config.table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)
        .all();
      return results.map((rawRow) => {
        const row = rawRow as Record<string, unknown>;
        return {
          kind,
          deletedAt: Number(row.deleted_at),
          record: rowToJson(config, row),
        };
      });
    }),
  );

  return c.json(groups.flat().sort((a, b) => b.deletedAt - a.deletedAt));
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
  await broadcastRecordsChanged(c.env);
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
    .prepare(`UPDATE ${config.table} SET ${assignments} WHERE id = ? AND deleted_at IS NULL`)
    .bind(...values, id)
    .run();
  if (result.meta.changes === 0) return c.json({ error: "记录不存在" }, 404);

  const row = await c.env.DB
    .prepare(`SELECT * FROM ${config.table} WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first();
  await broadcastRecordsChanged(c.env);
  return c.json(rowToJson(config, row as Record<string, unknown>));
});

app.delete("/api/:kind/:id", async (c) => {
  const config = TABLES[c.req.param("kind")];
  if (!config) return c.json({ error: "未知记录类型" }, 404);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "无效的 id" }, 400);

  const result = await c.env.DB
    .prepare(`UPDATE ${config.table} SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .bind(Date.now(), id)
    .run();
  if (result.meta.changes === 0) return c.json({ error: "记录不存在" }, 404);
  await broadcastRecordsChanged(c.env);
  return c.json({ ok: true });
});

app.post("/api/trash/:kind/:id/restore", async (c) => {
  const config = TABLES[c.req.param("kind")];
  if (!config) return c.json({ error: "未知记录类型" }, 404);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "无效的 id" }, 400);

  const result = await c.env.DB
    .prepare(`UPDATE ${config.table} SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`)
    .bind(id)
    .run();
  if (result.meta.changes === 0) return c.json({ error: "回收站中没有这条记录" }, 404);
  await broadcastRecordsChanged(c.env);
  return c.json({ ok: true });
});

app.delete("/api/trash/:kind/:id", async (c) => {
  const config = TABLES[c.req.param("kind")];
  if (!config) return c.json({ error: "未知记录类型" }, 404);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "无效的 id" }, 400);

  const result = await c.env.DB
    .prepare(`DELETE FROM ${config.table} WHERE id = ? AND deleted_at IS NOT NULL`)
    .bind(id)
    .run();
  if (result.meta.changes === 0) return c.json({ error: "回收站中没有这条记录" }, 404);
  await broadcastRecordsChanged(c.env);
  return c.json({ ok: true });
});

export default app;
