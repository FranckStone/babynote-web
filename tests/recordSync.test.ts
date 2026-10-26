import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { startRecordSync } from "../src/lib/recordSync.ts";
import { api } from "../src/api.ts";

class FakeSocket extends EventTarget {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  failSend = false;
  readonly url: string;

  constructor(url: string) {
    super();
    this.url = url;
    FakeSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  message(data: string) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  send(data: string) {
    if (this.failSend) throw new Error("Disconnected");
    this.sent.push(data);
  }

  close() {
    // Safari 的故障场景：close() 后不派发 close 事件。
    this.readyState = 2;
  }
}

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  FakeSocket.instances = [];
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const network = { onLine: true };
  const browser = Object.assign(new EventTarget(), {
    location: { protocol: "https:", host: "babynote.test" },
    setTimeout, clearTimeout, setInterval, clearInterval,
  });
  const cleanups: (() => void)[] = [];
  const restorations: (() => void)[] = [];
  t.after(() => {
    for (const cleanup of cleanups) cleanup();
    for (const restore of restorations) restore();
  });
  for (const [key, value] of Object.entries({ window: browser, document: page, navigator: network, WebSocket: FakeSocket })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restorations.push(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const start = (reload: () => Promise<void>) => {
    const stop = startRecordSync(reload);
    cleanups.push(stop);
    return stop;
  };
  return { page, network, browser, sockets: FakeSocket.instances, start };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

test("missed WebSocket notifications are recovered by foreground polling", async (t) => {
  const { sockets, start } = setup(t);
  let serverValue = 0;
  let displayedValue = -1;
  const stop = start(async () => { displayedValue = serverValue; });
  sockets[0].open();
  sockets[0].message("pong");
  await settle();
  serverValue = 120;
  t.mock.timers.tick(30_000);
  await settle();
  assert.equal(displayedValue, 120);
  assert.equal(sockets[0].url, "wss://babynote.test/api/events");
});

test("a stuck CONNECTING socket is replaced without waiting for close", (t) => {
  const { sockets, start } = setup(t);
  const stop = start(async () => {});
  t.mock.timers.tick(10_000);
  assert.equal(sockets[0].readyState, 2);
  t.mock.timers.tick(1000);
  assert.equal(sockets.length, 2);
});

test("missing pong triggers replacement and stale socket events cannot affect it", (t) => {
  const { sockets, start } = setup(t);
  const stop = start(async () => {});
  sockets[0].open();
  assert.deepEqual(sockets[0].sent, ["ping"]);
  t.mock.timers.tick(10_000);
  t.mock.timers.tick(1000);
  const current = sockets[1];
  current.open();
  sockets[0].open();
  sockets[0].message("pong");
  sockets[0].dispatchEvent(new Event("error"));
  sockets[0].dispatchEvent(new Event("close"));
  t.mock.timers.tick(10_000);
  assert.equal(current.readyState, 2, "an old pong must not cancel the current heartbeat timeout");
  t.mock.timers.tick(1000);
  assert.equal(sockets.length, 3);
});

test("send failures and error events reconnect even without a close event", (t) => {
  const { sockets, start } = setup(t);
  const stop = start(async () => {});
  sockets[0].failSend = true;
  sockets[0].open();
  t.mock.timers.tick(1000);
  assert.equal(sockets.length, 2);
  sockets[1].dispatchEvent(new Event("error"));
  t.mock.timers.tick(2000);
  assert.equal(sockets.length, 3);
});

test("hidden pages pause and resume with a fresh read even if no socket ever opened", async (t) => {
  const { page, sockets, start } = setup(t);
  let reads = 0;
  const stop = start(async () => { reads++; });
  await settle();
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(reads, 1);
  assert.equal(sockets.length, 1);
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.equal(reads, 2);
  assert.equal(sockets.length, 2);
});

test("network recovery, pageshow and focus replace apparently open sockets and refresh", async (t) => {
  const { browser, network, sockets, start } = setup(t);
  let reads = 0;
  const stop = start(async () => { reads++; });
  await settle();
  sockets[0].open();
  sockets[0].message("pong");
  await settle();
  network.onLine = false;
  browser.dispatchEvent(new Event("offline"));
  t.mock.timers.tick(5000);
  assert.equal(sockets.length, 1);
  network.onLine = true;
  for (const event of ["online", "pageshow", "focus"]) {
    const previousReads = reads;
    browser.dispatchEvent(new Event(event));
    await settle();
    assert.equal(reads, previousReads + 1);
    const socket = sockets.at(-1)!;
    socket.open();
    socket.message("pong");
    await settle();
  }
  assert.equal(sockets.length, 4);
});

test("a rejected refresh does not stop polling", async (t) => {
  const { start } = setup(t);
  let reads = 0;
  const stop = start(async () => {
    reads++;
    if (reads === 1) throw new Error("Network unavailable");
  });
  await settle();
  t.mock.timers.tick(30_000);
  await settle();
  assert.equal(reads, 2);
});

test("notifications arriving during a read queue a fresh read without overlapping", async (t) => {
  const { sockets, start } = setup(t);
  const completions: (() => void)[] = [];
  const stop = start(() => new Promise<void>((resolve) => completions.push(resolve)));
  sockets[0].open();
  sockets[0].message("records-changed");
  sockets[0].message("records-changed");
  assert.equal(completions.length, 1);
  completions[0]();
  await settle();
  assert.equal(completions.length, 2);
  completions[1]();
  await settle();
  assert.equal(completions.length, 2);
});

test("cleanup removes timers and listeners and ignores stale events", async (t) => {
  const { browser, page, sockets, start } = setup(t);
  let reads = 0;
  const stop = start(async () => { reads++; });
  await settle();
  stop();
  for (const event of ["online", "pageshow", "focus"]) browser.dispatchEvent(new Event(event));
  page.dispatchEvent(new Event("visibilitychange"));
  sockets[0].open();
  sockets[0].message("records-changed");
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(reads, 1);
  assert.equal(sockets.length, 1);
});

test("record reads abort after 15 seconds and a subsequent read can succeed", async (t) => {
  setup(t);
  let firstSignal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(init.cache, "no-store");
    if (!firstSignal) {
      firstSignal = init.signal!;
      return new Promise<Response>((_resolve, reject) => {
        firstSignal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }
    return Response.json({ feedings: [{ amount: 120 }] });
  });
  const firstRead = api.fetchRecords();
  const rejected = assert.rejects(firstRead, { name: "AbortError" });
  t.mock.timers.tick(15_000);
  await rejected;
  assert.equal(firstSignal!.aborted, true);
  assert.deepEqual(await api.fetchRecords(), { feedings: [{ amount: 120 }] });
});
