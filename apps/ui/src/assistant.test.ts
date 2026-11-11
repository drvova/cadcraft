import { describe, expect, test } from "bun:test";
import {
  activityLine,
  apiErrorText,
  atEnd,
  clampPanelWidth,
  parseBlocks,
  checkRunArgs,
  MAX_ROUNDS,
  noteOf,
  oneShot,
  parseInline,
  parseToolArgs,
  relativeTime,
  splitFences,
  listModels,
  modelsEndpoint,
  presetFor,
  providerEndpoint,
  providerReady,
  reportText,
  runOne,
  runToolDefinition,
  runTurn,
  StreamAssembler,
  systemPrompt,
  trimToBudget,
  wireMessages,
  type AssistantEvent,
  type Briefing,
  type ChatMessage,
  type ProviderConfig,
} from "./assistant";

const PROVIDER: ProviderConfig = { baseUrl: "http://127.0.0.1:11434/v1", model: "test-model", apiKey: "" };

const BRIEFING: Briefing = { app: "CADCraft 0.13.0", drawing: "Bracket", units: "millimeters", objects: 46, selection: 0, extents: [-0.5, -0.5, 18, 7.5] };

/** An SSE body from whole `data:` lines. */
function sseResponse(lines: readonly string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const line of lines) controller.enqueue(enc.encode(line));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A fetch double: pops one scripted response per call and records the requests. */
function scriptedFetch(responses: readonly Response[]): { fetch: typeof fetch; requests: Array<{ url: string; body: Record<string, unknown> }> } {
  const queue = [...responses];
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    const next = queue.shift();
    if (next === undefined) throw new Error("the fetch double ran out of responses");
    return next;
  }) as typeof fetch;
  return { fetch: fn, requests };
}

/** A tool-call SSE stream: the arguments arrive fragmented across chunks, as real servers do. */
function toolCallStream(): Response {
  const call = (index: number, delta: Record<string, unknown>) =>
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index, ...delta }] }, finish_reason: null }] })}\n\n`;
  return sseResponse([
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
    call(0, { id: "call_a", function: { name: "run", arguments: '{"co' } }),
    call(0, { function: { arguments: 'de":"(cmd \\"circle\\"' } }),
    call(0, { function: { arguments: ' )"}' } }),
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
    "data: [DONE]\n\n",
  ]);
}

function textStream(text: string): Response {
  return sseResponse([
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text.slice(0, 3) }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text.slice(3) }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ]);
}

describe("the provider", () => {
  test("the endpoint appends /chat/completions once", () => {
    expect(providerEndpoint("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(providerEndpoint("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(providerEndpoint("https://x/v1/chat/completions")).toBe("https://x/v1/chat/completions");
  });

  test("readiness names what is missing", () => {
    expect(providerReady({ baseUrl: "", model: "m", apiKey: "" })).toContain("base URL");
    expect(providerReady({ baseUrl: "ftp://x", model: "m", apiKey: "" })).toBe('The base URL must start with http:// or https://, not "ftp://x".');
    expect(providerReady({ baseUrl: "http://x", model: "", apiKey: "" })).toContain("model name");
    expect(providerReady(PROVIDER)).toBeNull();
  });
});

describe("setting a provider up", () => {
  const signal = new AbortController().signal;
  const fetchOf = (response: Response | Error): { fetch: typeof fetch; seen: Array<{ url: string; auth: string | null }> } => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
      if (response instanceof Error) throw response;
      return response;
    }) as typeof fetch;
    return { fetch: fn, seen };
  };

  test("a base URL names its preset; an unknown one is Other", () => {
    expect(presetFor("https://api.openai.com/v1/")?.id).toBe("openai");
    expect(presetFor("http://127.0.0.1:11434/v1")?.id).toBe("ollama");
    expect(presetFor("https://example.test/v1")?.id).toBe("custom");
    expect(presetFor("")?.id).toBe("custom");
  });

  test("the model list lives beside the chat route", () => {
    expect(modelsEndpoint("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434/v1/models");
    expect(modelsEndpoint("https://x.test/v1/chat/completions")).toBe("https://x.test/v1/models");
  });

  test("the check lists the server's models and sends the key when there is one", async () => {
    const ok = fetchOf(new Response(JSON.stringify({ data: [{ id: "llama3.2" }, { id: "qwen2.5" }, { nope: 1 }] }), { status: 200 }));
    expect(await listModels({ ...PROVIDER, apiKey: "k" }, signal, ok.fetch)).toEqual(["llama3.2", "qwen2.5"]);
    expect(ok.seen).toEqual([{ url: "http://127.0.0.1:11434/v1/models", auth: "Bearer k" }]);
    const bare = fetchOf(new Response(JSON.stringify({ models: [{ name: "a" }, "b"] }), { status: 200 }));
    expect(await listModels({ ...PROVIDER, model: "" }, signal, bare.fetch)).toEqual(["a", "b"]);
    expect(bare.seen[0]?.auth).toBeNull();
  });

  test("a refusal, an unreachable server and a strange answer each say so", async () => {
    const refused = fetchOf(new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }));
    await expect(listModels(PROVIDER, signal, refused.fetch)).rejects.toThrow("The provider refused the request (401). Check the API key in the model setup. The provider said: bad key.");
    const down = fetchOf(new TypeError("Failed to fetch"));
    await expect(listModels(PROVIDER, signal, down.fetch)).rejects.toThrow("The provider at http://127.0.0.1:11434/v1/models could not be reached. Check that the server is running and accepts requests from this page.");
    const odd = fetchOf(new Response("<html>", { status: 200 }));
    await expect(listModels(PROVIDER, signal, odd.fetch)).rejects.toThrow("The provider answered, but not with a model list. Type the model's name and save.");
    await expect(listModels({ baseUrl: "", model: "", apiKey: "" }, signal, odd.fetch)).rejects.toThrow("base URL");
  });
});

describe("the tool surface", () => {
  test("exactly one tool, in the chat envelope", () => {
    const d = runToolDefinition() as { type: string; function: { name: string; description: string; parameters: unknown } };
    expect(d.type).toBe("function");
    expect(d.function.name).toBe("run");
    expect(d.function.description).toContain("AutoLISP");
    const params = d.function.parameters as { properties: Record<string, unknown> };
    expect(Object.keys(params.properties)).toEqual(["code", "values"]);
  });

  test("the system prompt carries the briefing and the one-tool rule", () => {
    const p = systemPrompt(BRIEFING);
    expect(p).toContain("CADCraft 0.13.0");
    expect(p).toContain("Bracket");
    expect(p).toContain("millimeters");
    expect(p).toContain("Objects in the active space: 46");
    expect(p).toContain("- Extents: (-0.500, -0.500) to (18.000, 7.500)");
    expect(p).toContain("You have exactly one tool, `run`");
    expect(p).toContain("This is the browser build: there is no filesystem");
    expect(p).not.toContain("; 0 selected");
  });

  test("a selection is named; a blank briefing still reads", () => {
    expect(systemPrompt({ ...BRIEFING, selection: 3 })).toContain("46; 3 selected");
    const blank = systemPrompt({ app: "", drawing: "", units: "", objects: 0, selection: 0, extents: null });
    expect(blank).toContain("an unsaved drawing");
    expect(blank).toContain("Units: unknown");
  });
});

describe("the report text", () => {
  test("the manual passes through whole", () => {
    expect(reportText({ manual: "THE MANUAL" })).toBe("THE MANUAL");
  });

  test("error, output, value and kept are all stated", () => {
    const t = reportText({ error: "boom", output: ["a", "b"], value: "3", kept: ["HELPER"] });
    expect(t).toBe("error: boom\na\nb\n=> 3\nkept: HELPER\n");
  });

  test("nil values are not restated; empty output says so", () => {
    expect(reportText({ value: "nil" })).toBe("(the code ran and returned nil)\n");
  });

  test("refused and broken definitions are named, images listed", () => {
    const t = reportText({ refused: ["CAR"], broken: [{ name: "X", error: "why" }], images: ["/tmp/a.png"] });
    expect(t).toContain("refused: CAR would replace a built-in function");
    expect(t).toContain("kept definition `X` did not load: why");
    expect(t).toContain("rendered /tmp/a.png");
  });

  test("noteOf prefers a message, then counts, then the JSON; a report string gives its first line", () => {
    expect(noteOf("circle drawn\n=> T\n")).toBe("circle drawn");
    expect(noteOf({ message: "one line\nsecond" })).toBe("one line");
    expect(noteOf({ count: [1, 2, 3] })).toBe("count: 3");
    expect(noteOf({ total: 7 })).toBe("total: 7");
    expect(noteOf({ z: 1 })).toContain('"z":1');
  });
});

describe("the wire shape", () => {
  test("a tool-call turn carries null content and JSON-string arguments", () => {
    const w = wireMessages([{ role: "assistant", toolCalls: [{ id: "c1", name: "run", args: { code: "1" } }] }]) as Array<Record<string, unknown>>;
    expect(w[0]?.["content"]).toBeNull();
    const calls = w[0]?.["tool_calls"] as Array<{ function: { arguments: string } }>;
    expect(calls[0]?.function.arguments).toBe('{"code":"1"}');
  });

  test("a tool result carries its call id and name", () => {
    const w = wireMessages([{ role: "tool", content: "ok", toolCallId: "c1", toolName: "run" }]) as Array<Record<string, unknown>>;
    expect(w[0]).toEqual({ role: "tool", content: "ok", tool_call_id: "c1", name: "run" });
  });

  test("an attached picture travels in the vision shape, named in the text", () => {
    const w = wireMessages([
      { role: "user", content: "trace this", images: [{ name: "wing.png", dataUrl: "data:image/png;base64,AAAA" }] },
    ]) as Array<Record<string, unknown>>;
    const content = w[0]?.["content"] as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: "text", text: "trace this\n\n[attached picture: wing.png]" });
    expect(content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
  });

  test("no pictures means plain string content, unchanged", () => {
    const w = wireMessages([{ role: "user", content: "hi" }]) as Array<Record<string, unknown>>;
    expect(w[0]?.["content"]).toBe("hi");
  });
});

describe("parseInline", () => {
  test("plain text is one run", () => {
    expect(parseInline("hello there")).toEqual([{ kind: "text", text: "hello there" }]);
  });

  test("bold and code runs are split out", () => {
    expect(parseInline("a **b** c `d` e")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " c " },
      { kind: "code", text: "d" },
      { kind: "text", text: " e" },
    ]);
  });

  test("a marker that never closes stays literal", () => {
    expect(parseInline("a **b")).toEqual([{ kind: "text", text: "a **b" }]);
    expect(parseInline("a `b")).toEqual([{ kind: "text", text: "a `b" }]);
  });

  test("code wins over bold inside it", () => {
    expect(parseInline("`a **b**`")).toEqual([{ kind: "code", text: "a **b**" }]);
  });

  test("newlines survive inside a run", () => {
    expect(parseInline("one\ntwo **x**")).toEqual([
      { kind: "text", text: "one\ntwo " },
      { kind: "bold", text: "x" },
    ]);
  });

  test("empty text is one empty run", () => {
    expect(parseInline("")).toEqual([{ kind: "text", text: "" }]);
  });
});

describe("trimToBudget", () => {
  const turn = (i: number, size: number): ChatMessage[] => [
    { role: "user", content: `q${i}` },
    { role: "assistant", content: "x".repeat(size) },
  ];

  test("the newest turn always goes, however large", () => {
    const messages = [...turn(1, 10), ...turn(2, 100_000)];
    expect(trimToBudget(messages, 50)).toEqual(messages.slice(2));
  });

  test("old turns are dropped whole — never a call without its result", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "q1" },
      { role: "assistant", toolCalls: [{ id: "c", name: "run", args: {} }] },
      { role: "tool", content: "r".repeat(200), toolCallId: "c", toolName: "run" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "answer" },
    ];
    const out = trimToBudget(messages, 60);
    expect(out[0]).toEqual({ role: "user", content: "q2" });
    expect(out).toHaveLength(2);
  });
});

describe("the stream assembler", () => {
  test("tool-call fragments join by index", () => {
    const a = new StreamAssembler();
    a.feed(JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "ru", arguments: '{"co' } }] } }] }));
    a.feed(JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "n", arguments: 'de":"x"}' } }] } }] }));
    a.feed(JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }));
    const r = a.finishReply();
    expect(r.toolCalls).toEqual([{ id: "c1", name: "run", args: { code: "x" } }]);
    expect(r.finish).toBe("tool_calls");
  });

  test("text deltas pass through", () => {
    const a = new StreamAssembler();
    expect(a.feed(JSON.stringify({ choices: [{ delta: { content: "he" } }] }))).toBe("he");
    expect(a.feed(JSON.stringify({ choices: [{ delta: { content: "llo" } }] }))).toBe("llo");
    expect(a.finishReply().text).toBe("hello");
  });

  test("an error payload throws; a non-JSON line throws", () => {
    expect(() => new StreamAssembler().feed(JSON.stringify({ error: { message: "nope" } }))).toThrow("nope");
    expect(() => new StreamAssembler().feed("<html>")).toThrow("The provider's reply could not be read. The base URL may not point to an OpenAI-compatible server.");
    expect(() => oneShot("<html>", () => {})).toThrow("The provider's reply could not be read. The base URL may not point to an OpenAI-compatible server.");
  });

  test("a call without a name is refused at the end, not mid-stream", () => {
    const a = new StreamAssembler();
    a.feed(JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c", function: { arguments: "{}" } }] } }] }));
    expect(() => a.finishReply()).toThrow("The model asked to run code, but its request could not be read. Ask again, or try another model.");
  });

  test("parseToolArgs: empty is {}, malformed throws", () => {
    expect(parseToolArgs("  ")).toEqual({});
    expect(parseToolArgs('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseToolArgs("{oops")).toThrow("The model asked to run code, but its request could not be read. Ask again, or try another model.");
  });

  test("a one-shot (non-streamed) reply is read as one object", () => {
    const seen: string[] = [];
    const r = oneShot(JSON.stringify({ choices: [{ message: { content: "hi", tool_calls: [{ id: "c", function: { name: "run", arguments: '{"code":"1"}' } }] }, finish_reason: "tool_calls" }] }), (t) => seen.push(t));
    expect(r.text).toBe("hi");
    expect(r.toolCalls[0]?.args).toEqual({ code: "1" });
    expect(seen).toEqual(["hi"]);
  });
});

describe("runOne", () => {
  const execute = (code: string): { ok: true; result: unknown } => ({ ok: true, result: { value: code } });

  test("the run tool reaches the executor", () => {
    const r = runOne(execute, { id: "c", name: "run", args: { code: "(+ 1 2)" } });
    expect(r).toEqual({ ok: true, result: { value: "(+ 1 2)" } });
  });

  test("another tool name is refused in one line", () => {
    const r = runOne(execute, { id: "c", name: "execute", args: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("there is one tool, `run`");
  });

  test("a failing executor becomes the error, not a throw", () => {
    const r = runOne(() => ({ ok: false, error: "no drawing open" }), { id: "c", name: "run", args: { code: "1" } });
    expect(r).toEqual({ ok: false, error: "no drawing open" });
  });

  test("checkRunArgs accepts the documented shapes and refuses the others", () => {
    expect(checkRunArgs(null)).toEqual({ code: "", values: null });
    expect(checkRunArgs({ code: "x" })).toEqual({ code: "x", values: null });
    expect(checkRunArgs({ code: "x", values: { a: "t", n: 3 } })).toEqual({ code: "x", values: { a: "t", n: "3" } });
    expect(typeof checkRunArgs([1, 2])).toBe("string");
    expect(typeof checkRunArgs({ code: 3 })).toBe("string");
    expect(typeof checkRunArgs({ values: "x" })).toBe("string");
  });
});

describe("runTurn", () => {
  const collect = (): { events: AssistantEvent[]; onEvent: (e: AssistantEvent) => void } => {
    const events: AssistantEvent[] = [];
    return { events, onEvent: (e) => events.push(e) };
  };

  test("a full turn: tool call, run, report back, then the answer", async () => {
    const { fetch, requests } = scriptedFetch([toolCallStream(), textStream("Drew a circle: 1 object, r=5.")]);
    const { events, onEvent } = collect();
    const conversation: ChatMessage[] = [{ role: "user", content: "draw a circle" }];
    const ran: string[] = [];
    await runTurn({
      provider: PROVIDER,
      briefing: BRIEFING,
      conversation,
      execute: (code) => {
        ran.push(code);
        return { ok: true, result: { value: "T", output: ["circle drawn"] } };
      },
      onEvent,
      signal: new AbortController().signal,
      fetchImpl: fetch,
    });
    expect(ran).toEqual(['(cmd "circle" )']);
    expect(events.map((e) => e.type)).toEqual(["call", "result", "text", "text", "done"]);
    const result = events[1];
    expect(result?.type).toBe("result");
    if (result?.type === "result") {
      expect(result.ok).toBe(true);
      expect(result.note).toBe("circle drawn");
    }
    // Two requests: the second one carries the tool result with its call id.
    expect(requests).toHaveLength(2);
    const second = requests[1]?.body["messages"] as Array<Record<string, unknown>>;
    const tool = second.find((m) => m["role"] === "tool");
    expect(tool?.["tool_call_id"]).toBe("call_a");
    expect(String(tool?.["content"])).toContain("circle drawn");
    // The conversation ends with the model's answer.
    expect(conversation[conversation.length - 1]).toEqual({ role: "assistant", content: "Drew a circle: 1 object, r=5." });
  });

  test("a failed run goes back as an error message and the turn still finishes", async () => {
    const { fetch } = scriptedFetch([toolCallStream(), textStream("I could not draw it.")]);
    const { events, onEvent } = collect();
    await runTurn({
      provider: PROVIDER,
      briefing: BRIEFING,
      conversation: [],
      execute: () => ({ ok: false, error: "no drawing open" }),
      onEvent,
      signal: new AbortController().signal,
      fetchImpl: fetch,
    });
    const result = events.find((e) => e.type === "result");
    expect(result?.type).toBe("result");
    if (result?.type === "result") expect(result.ok).toBe(false);
    expect(events[events.length - 1]?.type).toBe("done");
  });

  test("an unconfigured provider fails before any request", async () => {
    const { fetch, requests } = scriptedFetch([]);
    const { events, onEvent } = collect();
    await runTurn({ provider: { baseUrl: "", model: "", apiKey: "" }, briefing: BRIEFING, conversation: [], execute: () => ({ ok: true, result: {} }), onEvent, signal: new AbortController().signal, fetchImpl: fetch });
    expect(events[0]?.type).toBe("failed");
    expect(requests).toHaveLength(0);
  });

  test("a provider error is a failure with its message", async () => {
    const { fetch } = scriptedFetch([new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401, headers: { "content-type": "application/json" } })]);
    const { events, onEvent } = collect();
    await runTurn({ provider: PROVIDER, briefing: BRIEFING, conversation: [], execute: () => ({ ok: true, result: {} }), onEvent, signal: new AbortController().signal, fetchImpl: fetch });
    const failed = events.find((e) => e.type === "failed");
    expect(failed?.type).toBe("failed");
    if (failed?.type === "failed") expect(failed.error).toContain("bad key");
    expect(apiErrorText(401, '{"error":{"message":"bad key"}}')).toBe("The provider refused the request (401). Check the API key in the model setup. The provider said: bad key.");
  });

  test("each status says what happened and the way out, and keeps the provider's own message", () => {
    expect(apiErrorText(403, "")).toBe("The provider refused the request (403). Check the API key in the model setup.");
    expect(apiErrorText(404, '{"error":{"message":"The model `x` does not exist."}}')).toBe(
      "The provider did not find what was asked for (404). The base URL or the model name may be wrong. The provider said: The model `x` does not exist.",
    );
    expect(apiErrorText(429, "")).toBe("The provider is limiting requests (429). Wait a moment, then ask again.");
    expect(apiErrorText(503, "nope")).toBe("The provider is having trouble (503). Ask again in a moment. The provider said: nope.");
    expect(apiErrorText(400, "")).toBe("The provider answered with an error (400).");
    // An error inside an answer that arrived (a stream's error payload) has no status worth naming.
    expect(apiErrorText(200, '{"error":{"message":"overloaded"}}')).toBe("The provider reported an error. The provider said: overloaded.");
  });

  test("a model that only calls tools forever is stopped at MAX_ROUNDS", async () => {
    const { fetch } = scriptedFetch(Array.from({ length: MAX_ROUNDS }, () => toolCallStream()));
    const { events, onEvent } = collect();
    await runTurn({
      provider: PROVIDER,
      briefing: BRIEFING,
      conversation: [],
      execute: () => ({ ok: true, result: { value: "T" } }),
      onEvent,
      signal: new AbortController().signal,
      fetchImpl: fetch,
    });
    const failed = events[events.length - 1];
    expect(failed?.type).toBe("failed");
    if (failed?.type === "failed") expect(failed.error).toBe(`The assistant ran code ${MAX_ROUNDS} times in a row without answering, so it was stopped. Ask it to continue, or say what to do differently.`);
  });

  test("an abort mid-stream ends the turn as stopped", async () => {
    const controller = new AbortController();
    const { fetch } = scriptedFetch([
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`));
            controller.abort();
            c.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    ]);
    const { events, onEvent } = collect();
    await runTurn({ provider: PROVIDER, briefing: BRIEFING, conversation: [], execute: () => ({ ok: true, result: {} }), onEvent, signal: controller.signal, fetchImpl: fetch });
    expect(events[events.length - 1]).toEqual({ type: "done", reason: "stopped" });
  });
});

describe("activityLine", () => {
  test("one line is itself, trimmed", () => {
    expect(activityLine("  (cmd \"circle\")  ")).toBe("(cmd \"circle\")");
  });
  test("more lines are counted, blank ones aside", () => {
    expect(activityLine(["(setq r 5)", "", '(cmd "circle")', "  (inspect)", ""].join("\n"))).toBe("(setq r 5)  +2");
  });
  test("empty code asks for the manual", () => {
    expect(activityLine("")).toBe("Read the manual");
    expect(activityLine(["", "  ", ""].join("\n"))).toBe("Read the manual");
  });
});

describe("parseBlocks", () => {
  test("paragraphs are divided by blank lines and keep their own line breaks", () => {
    expect(parseBlocks(["one", "two", "", "three"].join("\n"))).toEqual([
      { kind: "para", text: "one\ntwo" },
      { kind: "para", text: "three" },
    ]);
  });
  test("headings carry their level and lose the marks", () => {
    expect(parseBlocks(["## Fixes implemented ##", "body"].join("\n"))).toEqual([
      { kind: "heading", level: 2, text: "Fixes implemented" },
      { kind: "para", text: "body" },
    ]);
    expect(parseBlocks("#hashtag")).toEqual([{ kind: "para", text: "#hashtag" }]);
  });
  test("bullets and numbers become lists, and a change of kind starts a new one", () => {
    expect(parseBlocks(["- a", "* b", "1. c", "2) d"].join("\n"))).toEqual([
      { kind: "list", ordered: false, items: ["a", "b"] },
      { kind: "list", ordered: true, items: ["c", "d"] },
    ]);
  });
  test("an indented line continues its item; a flush line ends the list", () => {
    expect(parseBlocks(["- first", "  and more", "after"].join("\n"))).toEqual([
      { kind: "list", ordered: false, items: ["first and more"] },
      { kind: "para", text: "after" },
    ]);
  });
  test("emphasis marks and negative numbers are not bullets", () => {
    expect(parseBlocks("**bold** start")).toEqual([{ kind: "para", text: "**bold** start" }]);
    expect(parseBlocks("-5 mm offset")).toEqual([{ kind: "para", text: "-5 mm offset" }]);
    expect(parseBlocks("")).toEqual([]);
  });
});

describe("clampPanelWidth", () => {
  test("a width inside the limits is kept, rounded", () => {
    expect(clampPanelWidth(400.4, 1600)).toBe(400);
  });
  test("the panel's own limits hold", () => {
    expect(clampPanelWidth(100, 1600)).toBe(280);
    expect(clampPanelWidth(5000, 4000)).toBe(720);
  });
  test("the drawing keeps its room in a small window", () => {
    expect(clampPanelWidth(600, 800)).toBe(480);
    expect(clampPanelWidth(600, 300)).toBe(280);
  });
  test("a value that is not a number is the initial width", () => {
    expect(clampPanelWidth(Number.NaN, 1600)).toBe(340);
  });
});

describe("atEnd", () => {
  test("within the slack counts as the end", () => {
    expect(atEnd(1000, 776, 200)).toBe(true);
    expect(atEnd(1000, 775, 200)).toBe(false);
  });
  test("a transcript with nothing to scroll is at its end", () => {
    expect(atEnd(200, 0, 200)).toBe(true);
  });
});

describe("relativeTime", () => {
  const t0 = 1_000_000_000_000;
  test("the transcript's own words", () => {
    expect(relativeTime(t0, t0 + 5_000)).toBe("Just now");
    expect(relativeTime(t0, t0 + 44_000)).toBe("Just now");
    expect(relativeTime(t0, t0 + 60_000)).toBe("1m ago");
    expect(relativeTime(t0, t0 + 3 * 60_000)).toBe("3m ago");
    expect(relativeTime(t0, t0 + 2 * 3_600_000)).toBe("2h ago");
    expect(relativeTime(t0, t0 + 50 * 3_600_000)).toBe("2d ago");
  });
  test("a clock that went backwards still reads Just now", () => {
    expect(relativeTime(t0, t0 - 5_000)).toBe("Just now");
  });
});

describe("splitFences", () => {
  test("prose, a fence, prose", () => {
    expect(splitFences("before\n```py\nprint(1)\n```\nafter")).toEqual([
      { kind: "text", text: "before\n" },
      { kind: "code", text: "print(1)" },
      { kind: "text", text: "after" },
    ]);
  });
  test("no fence is one text run", () => {
    expect(splitFences("plain")).toEqual([{ kind: "text", text: "plain" }]);
  });
  test("an unclosed fence still reads", () => {
    expect(splitFences("x\n```\nDraw(1)")).toEqual([
      { kind: "text", text: "x\n" },
      { kind: "code", text: "Draw(1)" },
    ]);
  });
  test("a bare fence with no language keeps its first line", () => {
    expect(splitFences("```\na\nb\n```")).toEqual([{ kind: "code", text: "a\nb" }]);
  });
});
