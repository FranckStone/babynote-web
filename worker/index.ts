import { DurableObject } from "cloudflare:workers";
import { createApp, type Bindings } from "./app";

type WorkerBindings = Bindings & {
  REALTIME: DurableObjectNamespace<RealtimeHub>;
};

export class RealtimeHub extends DurableObject<WorkerBindings> {
  constructor(ctx: DurableObjectState, env: WorkerBindings) {
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

const app = createApp<WorkerBindings>(
  (c) => c.env.REALTIME.getByName("records").fetch(c.req.raw),
  async (env) => {
    await env.REALTIME.getByName("records").fetch("https://realtime.internal/notify", { method: "POST" });
  },
);

export default app;
