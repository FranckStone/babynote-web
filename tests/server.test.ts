import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import WebSocket from "ws";

const password = "isolated-test-password";

test("standalone runtime preserves auth, seven record types, trash, sharing, WebSockets and persistence", { timeout: 30_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "babynote-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  async function start() {
    const child = spawn(process.execPath, ["dist/server.mjs"], {
      env: { ...process.env, HOST: "127.0.0.1", PORT: "0", DATABASE_PATH: join(directory, "db.sqlite"),
        AUTH_PASSWORD: password, AUTH_SECRET: "isolated-test-secret", COOKIE_SECURE: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let errors = "";
    child.stderr.on("data", (chunk) => { errors += chunk; });
    const origin = await new Promise<string>((resolve, reject) => {
      child.once("exit", (code) => reject(new Error(`Server exited ${code}: ${errors}`)));
      child.stdout.on("data", (chunk) => {
        const port = String(chunk).match(/127\.0\.0\.1:(\d+)/)?.[1];
        if (port) resolve(`http://127.0.0.1:${port}`);
      });
    });
    const stop = async () => {
      if (child.exitCode !== null) return;
      const exit = once(child, "exit");
      child.kill("SIGTERM");
      await exit;
    };
    t.after(stop);
    return { origin, stop };
  }
  const server = await start();
  let origin = server.origin;
  let cookie = "";
  const request = (path: string, method = "GET", data?: unknown, auth = cookie) => fetch(origin + path, {
    method, headers: { "content-type": "application/json", cookie: auth },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  assert.equal((await request("/healthz")).status, 200);
  assert.match(await (await request("/stats/feeding")).text(), /<html/);
  assert.equal((await request("/api/me")).status, 401);
  assert.equal((await request("/api/events")).status, 401);
  assert.equal((await request("/api/login", "POST", { password: "wrong" })).status, 401);
  const login = await request("/api/login", "POST", { password });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.match(cookie, /^babynote_session=/);
  assert.equal((await request("/api/me")).status, 200);
  const socket = new WebSocket(origin.replace("http:", "ws:") + "/api/events", { headers: { cookie } });
  await once(socket, "open");
  t.after(() => socket.terminate());
  const pong = once(socket, "message");
  socket.send("ping");
  assert.equal(String((await pong)[0]), "pong");

  const types = [
    ["feeding", "feedings", { startedAt: Date.now(), feedingType: "formula", amountML: 123.5, note: "test" }],
    ["weight", "weights", { recordedAt: Date.now(), weightKG: 6.25, note: "test" }],
    ["medication", "medications", { recordedAt: Date.now(), name: "test", dosage: "test", note: "test" }],
    ["checkup", "checkups", { recordedAt: Date.now(), location: "test", summary: "test", attachmentPath: "", note: "test" }],
    ["fetalMovement", "fetalMovements", { recordedAt: Date.now(), durationMinutes: 10, movementCount: 8, note: "test" }],
    ["bloodGlucose", "bloodGlucoses", { recordedAt: Date.now(), moment: "beforeBreakfast", valueMMOL: 4.7, note: "test" }],
    ["excretion", "excretions", { recordedAt: Date.now(), type: "pee", amount: "medium", note: "test" }],
  ] as const;
  for (const [kind, group, data] of types) {
    const notified = once(socket, "message");
    const created = await request(`/api/${kind}`, "POST", data);
    assert.equal(created.status, 201, await created.clone().text());
    const row = await created.json();
    assert.equal(String((await notified)[0]), "records-changed");
    assert.equal((await request("/api/records")).headers.get("cache-control"), "no-store");
    assert.equal((await (await request("/api/records")).json())[group][0].id, row.id);
    assert.equal((await request(`/api/${kind}/${row.id}`, "PUT", { note: "changed" })).status, 200);
    assert.equal((await request(`/api/${kind}/${row.id}`, "DELETE")).status, 200);
    assert.equal((await (await request("/api/records")).json())[group].length, 0);
    assert.equal((await (await request("/api/trash")).json()).length, 1);
    assert.equal((await request(`/api/trash/${kind}/${row.id}/restore`, "POST")).status, 200);
    assert.equal((await (await request("/api/records")).json())[group][0].note, "changed");
  }
  const keyResponse = await request("/api/share-links", "POST", { name: "read-only", permission: "read", durationDays: null });
  assert.equal(keyResponse.status, 201);
  const key = await keyResponse.json();
  const shareLogin = await request("/api/share-login", "POST", { token: key.token }, "");
  assert.equal(shareLogin.status, 200);
  const shareCookie = shareLogin.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await request("/api/records", "GET", undefined, shareCookie)).status, 200);
  assert.equal((await request("/api/feeding", "POST", types[0][2], shareCookie)).status, 403);
  assert.equal((await request("/api/share-links", "GET", undefined, shareCookie)).status, 403);
  await request(`/api/share-links/${key.id}`, "PATCH", { disabled: true });
  assert.equal((await request("/api/records", "GET", undefined, shareCookie)).status, 401);
  assert.equal((await request("/api/ai/feeding-analysis", "POST", { summary: {} })).status, 503);
  await request("/api/excretion/1", "DELETE");
  assert.equal((await request("/api/trash/excretion/1", "DELETE")).status, 200);
  socket.close();
  await once(socket, "close");
  await server.stop();
  const restarted = await start();
  origin = restarted.origin;
  const records = await (await request("/api/records")).json();
  assert.equal(records.feedings[0].amountML, 123.5);
  assert.equal(records.excretions.length, 0);
  assert.equal((await (await request("/api/share-links")).json())[0].id, key.id);
});
