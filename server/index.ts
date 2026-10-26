import { serve, upgradeWebSocket, type HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createApp, type Bindings } from "../worker/app";
import { SQLiteDatabase } from "./database";

const root = fileURLToPath(new URL("./", import.meta.url));
const databasePath = resolve(process.env.DATABASE_PATH || "data/babynote.sqlite");
const password = process.env.AUTH_PASSWORD;
const secret = process.env.AUTH_SECRET;
if (!password || !secret) throw new Error("AUTH_PASSWORD and AUTH_SECRET must be set");
mkdirSync(dirname(databasePath), { recursive: true });
const db = new SQLiteDatabase(databasePath);
db.migrate(resolve(root, "migrations"));
const bindings: Bindings = {
  DB: db,
  AUTH_PASSWORD: password,
  AUTH_SECRET: secret,
  COOKIE_SECURE: process.env.COOKIE_SECURE !== "false",
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
};
const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const app = createApp<Bindings & HttpBindings>(
  upgradeWebSocket(() => ({
    onMessage(event, socket) {
      if (event.data === "ping") socket.send("pong");
    },
  })),
  async () => {
    for (const socket of sockets.clients) {
      if (socket.readyState === socket.OPEN) socket.send("records-changed");
    }
  },
);
app.get("/healthz", (c) => {
  db.connection.prepare("SELECT 1").get();
  return c.json({ ok: true });
});
app.all("/api/*", (c) => c.json({ error: "接口不存在" }, 404));
app.use("*", serveStatic({ root: resolve(root, "client") }));
app.get("*", serveStatic({ path: resolve(root, "client/index.html") }));

const server = serve({
  fetch: (request, http) => app.fetch(request, Object.assign(http, bindings)),
  hostname: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3000),
  websocket: { server: sockets },
}, (info) => console.log(`BabyNote listening on ${info.address}:${info.port}`));

const shutdown = () => {
  for (const socket of sockets.clients) socket.close(1001, "Server shutting down");
  sockets.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
