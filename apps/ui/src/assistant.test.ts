import { describe, expect, test } from "bun:test";
import {
  apiErrorText,
  checkRunArgs,
  MAX_ROUNDS,
  noteOf,
  oneShot,
  parseToolArgs,
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
    expect(providerReady({ baseUrl: "ftp://x", model: "m", apiKey: "" })).toContain("http://");
    expect(providerReady({ baseUrl: "http://x", model: "", apiKey: "" })).toContain("model name");
    expect(providerReady(PROVIDER)).toBeNull();
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
    expect(() => new StreamAssembler().feed("<html>")).toThrow("not JSON");
  });

  test("a call without a name is refused at the end, not mid-stream", () => {
    const a = new StreamAssembler();
    a.feed(JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c", function: { arguments: "{}" } }] } }] }));
    expect(() => a.finishReply()).toThrow("without naming it");
  });

  test("parseToolArgs: empty is {}, malformed throws", () => {
    expect(parseToolArgs("  ")).toEqual({});
    expect(parseToolArgs('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseToolArgs("{oops")).toThrow("not JSON");
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
    expect(apiErrorText(401, '{"error":{"message":"bad key"}}')).toBe("the provider answered 401: bad key");
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
    if (failed?.type === "failed") expect(failed.error).toContain("without answering");
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
