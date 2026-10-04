// DeepSeek 喂奶趋势解读：前端提交已汇总的统计数据，这里拼提示词并把模型输出以纯文本流转发回去。
// API Key 只存在于 Worker secret(DEEPSEEK_API_KEY),不会下发到浏览器。

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-flash";
const MAX_SUMMARY_BYTES = 24_000;

const SYSTEM_PROMPT = `你是一位帮助新手父母看懂喂养记录的助手，熟悉婴儿配方奶喂养的常见规律。
你会收到按天汇总的喂奶统计(JSON),单位为 ml 和小时。

要求：
1. 只根据给出的数据说话，引用具体日期和数字；数据不足时直接说明，不要编造。
2. 用简体中文，语气平和、具体，不制造焦虑。
3. 你不是医生，不做诊断。只在数据确实出现明显异常时，提醒哪些情况需要咨询儿科医生。
4. 没有体重或月龄时，不要断言"够不够量",可以说明需要哪些信息。
5. 输出纯文本，不用 Markdown 符号(不要 #、*、表格)。严格按下面四段输出，每段标题单独一行，内容每条以"- "开头，每段 1–3 条，总字数不超过 350 字：
【总体结论】
【变化原因】
【需要留意】
【可以试试】`;

export interface AIEnv {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
}

export async function streamFeedingAnalysis(env: AIEnv, rawBody: string): Promise<Response> {
  if (!env.DEEPSEEK_API_KEY) {
    return Response.json({ error: "服务器未配置 DeepSeek API Key" }, { status: 503 });
  }
  if (new TextEncoder().encode(rawBody).length > MAX_SUMMARY_BYTES) {
    return Response.json({ error: "统计数据过大" }, { status: 413 });
  }

  let summary: unknown;
  try {
    summary = (JSON.parse(rawBody) as { summary?: unknown }).summary;
  } catch {
    return Response.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (summary == null || typeof summary !== "object") {
    return Response.json({ error: "缺少统计数据" }, { status: 400 });
  }

  const upstream = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || DEFAULT_MODEL,
      // 解读是短文本总结，关闭思考模式以加快首字返回。
      thinking: { type: "disabled" },
      temperature: 0.4,
      max_tokens: 800,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `以下是宝宝的喂奶统计数据：\n${JSON.stringify(summary)}` },
      ],
    }),
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    const status = upstream?.status ?? 502;
    const message =
      status === 401 ? "DeepSeek API Key 无效" : status === 402 ? "DeepSeek 账户余额不足" : status === 429 ? "请求太频繁，请稍后再试" : "AI 服务暂时不可用";
    return Response.json({ error: message }, { status: 502 });
  }

  // 把 OpenAI 格式的 SSE 转成只含正文的纯文本流，前端直接拼接即可。
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.trim();
        if (!data.startsWith("data:")) continue;
        const payload = data.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const content = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta
            ?.content;
          if (content) controller.enqueue(encoder.encode(content));
        } catch {
          // 忽略心跳等非 JSON 行。
        }
      }
    },
  });

  return new Response(upstream.body.pipeThrough(transform), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
