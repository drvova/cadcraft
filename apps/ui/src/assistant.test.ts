import { describe, expect, spyOn, test } from "bun:test";
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
  failedNote,
  listModels,
  reachedNote,
  saveBlocker,
  withoutKey,
  MAX_CALL_ARGS_CHARS,
  MAX_CALLS_PER_REPLY,
  MAX_LISTED_MODELS,
  MAX_MODEL_LIST_CHARS,
  MAX_REPLY_CHARS,
  MAX_STREAM_CHARS,
  modelIds,
  PROVIDER_LIMITS,
  providerFault,
  redact,
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
  focusIsOurs,
  followAfterScroll,
  growReply,
  listProviderModels,
  MAX_MESSAGE_CHARS,
  MAX_REQUEST_CHARS,
  replyBlocks,
  type ReplyParse,
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
    await expect(listModels(PROVIDER, signal, refused.fetch)).rejects.toThrow("The provider refused the request (401). Check the API key above. The provider said: bad key.");
    const down = fetchOf(new TypeError("Failed to fetch"));
    await expect(listModels(PROVIDER, signal, down.fetch)).rejects.toThrow("The provider at http://127.0.0.1:11434/v1/models could not be reached. Check that the server is running and accepts requests from this page.");
    const odd = fetchOf(new Response("<html>", { status: 200 }));
    await expect(listModels(PROVIDER, signal, odd.fetch)).rejects.toThrow("The provider answered, but not with a model list. Type the model's name and save.");
    await expect(listModels({ baseUrl: "", model: "", apiKey: "" }, signal, odd.fetch)).rejects.toThrow("base URL");
  });

  test("each way a check ends is its own state", async () => {
    const stateOf = async (provider: ProviderConfig, fetchImpl: typeof fetch): Promise<string> => {
      try {
        return reachedNote(await listModels(provider, signal, fetchImpl), provider.model).state;
      } catch (e) {
        return failedNote(e).state;
      }
    };
    expect(await stateOf(PROVIDER, fetchOf(new Response(JSON.stringify({ data: [{ id: "a" }] }), { status: 200 })).fetch)).toBe("reached");
    expect(await stateOf(PROVIDER, fetchOf(new Response(JSON.stringify({ data: [] }), { status: 200 })).fetch)).toBe("no-list");
    expect(await stateOf(PROVIDER, fetchOf(new Response("<html>", { status: 200 })).fetch)).toBe("no-list");
    expect(await stateOf(PROVIDER, fetchOf(new Response("", { status: 401 })).fetch)).toBe("refused");
    expect(await stateOf(PROVIDER, fetchOf(new Response("", { status: 403 })).fetch)).toBe("refused");
    expect(await stateOf(PROVIDER, fetchOf(new Response("", { status: 500 })).fetch)).toBe("failed");
    expect(await stateOf(PROVIDER, fetchOf(new TypeError("Failed to fetch")).fetch)).toBe("unreachable");
    expect(await stateOf({ ...PROVIDER, baseUrl: "ftp://x" }, fetchOf(new Response("", { status: 200 })).fetch)).toBe("invalid");
  });

  test("the note after a check counts the models and says whether the typed one is listed", () => {
    expect(reachedNote(["a", "b"], "a").text).toBe("Connected. 2 models, including a.");
    expect(reachedNote(["a"], "").text).toBe("Connected. 1 model.");
    expect(reachedNote(["a", "b"], "c").text).toBe("Connected. 2 models, but not c. Pick one from the list, or keep the name you typed.");
    expect(reachedNote([], "c")).toEqual({ state: "no-list", text: "Connected. The provider lists no models. Type the model's name." });
    expect(failedNote(new Error("the socket closed"))).toEqual({ state: "failed", text: "The socket closed" });
  });

  test("a provider that quotes the key back does not get it shown", async () => {
    expect(withoutKey("Incorrect API key provided: sk-secret-1.", " sk-secret-1 ")).toBe("Incorrect API key provided: (your key).");
    expect(withoutKey("no key here", "")).toBe("no key here");
    const echo = fetchOf(new Response(JSON.stringify({ error: { message: "Incorrect API key provided: sk-secret-1" } }), { status: 401 }));
    const note = await listModels({ ...PROVIDER, apiKey: "sk-secret-1" }, signal, echo.fetch).then(
      () => "",
      (e: unknown) => failedNote(e).text,
    );
    expect(note).toContain("(your key)");
    expect(note).not.toContain("sk-secret-1");
  });

  test("a setup is saved only when it can work, and the reason is said", () => {
    expect(saveBlocker({ baseUrl: "", model: "", apiKey: "" }, false, 0)).toBe("To save, choose a provider or type a base URL.");
    expect(saveBlocker({ baseUrl: "ftp://x/v1", model: "m", apiKey: "" }, false, 0)).toBe("To save, start the base URL with http:// or https://.");
    expect(saveBlocker({ baseUrl: "https://x/v1", model: "m", apiKey: " " }, true, 0)).toBe("To save, add the API key this provider needs.");
    expect(saveBlocker({ baseUrl: "https://x/v1", model: "", apiKey: "k" }, true, 0)).toBe("To save, type a model name.");
    expect(saveBlocker({ baseUrl: "https://x/v1", model: "", apiKey: "" }, false, 4)).toBe("To save, pick a model from the list or type its name.");
    expect(saveBlocker({ baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2", apiKey: "" }, false, 0)).toBeNull();
    expect(saveBlocker({ baseUrl: "https://x/v1", model: "m", apiKey: "k" }, true, 0)).toBeNull();
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

describe("followAfterScroll", () => {
  test("a reply that grew under a following transcript does not stop the following", () => {
    // The view was brought to 800 and has not moved; 400px of reply arrived since.
    expect(followAfterScroll(true, 800, 800, 1400, 200)).toBe(true);
    // Being brought to the new end is a move down.
    expect(followAfterScroll(true, 800, 1200, 1400, 200)).toBe(true);
  });
  test("any move up is the reader's, even inside the slack, and stops it", () => {
    expect(followAfterScroll(true, 800, 790, 1000, 200)).toBe(false);
    expect(followAfterScroll(true, 800, 300, 1000, 200)).toBe(false);
  });
  test("a reader who scrolled away is left alone while the reply grows, and followed again at the end", () => {
    expect(followAfterScroll(false, 300, 300, 5000, 200)).toBe(false);
    expect(followAfterScroll(false, 300, 600, 5000, 200)).toBe(false);
    expect(followAfterScroll(false, 300, 4790, 5000, 200)).toBe(true);
  });
  test("a transcript that got shorter settles at its end and goes on following", () => {
    expect(followAfterScroll(true, 800, 500, 700, 200)).toBe(true);
  });
});

describe("focusIsOurs", () => {
  const panel = document.createElement("aside");
  const inside = panel.appendChild(document.createElement("button"));
  const outside = document.createElement("input");
  const body = document.createElement("body");
  test("a focus inside the panel, or nowhere, is the panel's to move", () => {
    expect(focusIsOurs(panel, inside, body)).toBe(true);
    expect(focusIsOurs(panel, body, body)).toBe(true);
    expect(focusIsOurs(panel, null, body)).toBe(true);
  });
  test("a focus the person put elsewhere is left where it is", () => {
    expect(focusIsOurs(panel, outside, body)).toBe(false);
  });
});

describe("growReply", () => {
  const REPLY = [
    "## Result",
    "",
    "The drawing holds **3 objects**.",
    "A second line of the same paragraph.",
    "",
    "- one line, 10 mm",
    "  with a continuation",
    "- one circle",
    "",
    "1. first",
    "2. second",
    "```lisp",
    "(cmd \"circle\")",
    "",
    "(cmd \"describe\")",
    "```",
    "After the code, `inline ``` ticks` and more.",
    "",
    "```",
    "an open fence",
    "",
    "to the end",
  ].join("\n");

  /** Feed `text` in pieces of `size` and return every parse on the way. */
  const grow = (text: string, size: number): ReplyParse[] => {
    const steps: ReplyParse[] = [];
    let parse: ReplyParse | undefined;
    for (let end = size; end < text.length + size; end += size) {
      parse = growReply(parse, text.slice(0, end));
      steps.push(parse);
    }
    return steps;
  };

  test("however a reply is cut into fragments, its blocks are those of the whole reply", () => {
    for (const size of [1, 2, 3, 7, 16, 50, 1000]) {
      const steps = grow(REPLY, size);
      steps.forEach((step, i) => {
        const upTo = REPLY.slice(0, Math.min(REPLY.length, (i + 1) * size));
        expect([...step.settled, ...step.tail]).toEqual(replyBlocks(upTo));
      });
    }
  });

  test("a settled block is the same object from then on, and so is a tail block that did not change", () => {
    const steps = grow(REPLY, 5);
    for (let i = 1; i < steps.length; i++) {
      const before = steps[i - 1]?.settled ?? [];
      before.forEach((block, at) => expect(steps[i]?.settled[at]).toBe(block));
    }
    const first = growReply(undefined, "## Result\n\n- one\n- two");
    const next = growReply(first, "## Result\n\n- one\n- two\n\nA new paragraph");
    expect(first.settled).toHaveLength(1);
    // The list settled as the blank line arrived; the heading before it is the object it was.
    expect(next.settled[0]).toBe(first.settled[0]);
    const tail = growReply(undefined, "# Title\nfirst line");
    const more = growReply(tail, "# Title\nfirst line and more");
    expect(more.tail[0]).toBe(tail.tail[0]);
    expect(more.tail[1]).not.toBe(tail.tail[1]);
  });

  test("what is read again is the last block, not the reply: a 200,000-character reply keeps a short rest", () => {
    const paragraph = "A paragraph of a long reply, with `code` and **bold** in it, long enough to wrap in the panel.\n\n";
    const whole = paragraph.repeat(Math.ceil(200_000 / paragraph.length)).slice(0, 200_000);
    let parse: ReplyParse | undefined;
    let longestRest = 0;
    for (let end = 200; end <= whole.length; end += 200) {
      parse = growReply(parse, whole.slice(0, end));
      longestRest = Math.max(longestRest, parse.rest.length);
    }
    expect(longestRest).toBeLessThan(paragraph.length + 200);
    expect(parse?.settledChars ?? 0).toBeGreaterThan(200_000 - paragraph.length - 200);
    expect([...(parse?.settled ?? []), ...(parse?.tail ?? [])]).toEqual(replyBlocks(whole));
  });

  test("a text that is not the last one with more after it is parsed from its start", () => {
    const first = growReply(undefined, "one\n\ntwo");
    expect(growReply(first, "another reply")).toEqual({ settled: [], tail: [{ kind: "para", text: "another reply" }], settledChars: 0, rest: "another reply" });
    expect(growReply(first, "one\n\ntwo")).toBe(first);
    expect(growReply(undefined, "")).toEqual({ settled: [], tail: [], settledChars: 0, rest: "" });
  });
});

describe("the longest message", () => {
  test("is half of what one request may carry", () => {
    expect(MAX_MESSAGE_CHARS).toBe(MAX_REQUEST_CHARS / 2);
    expect(Number.isInteger(MAX_MESSAGE_CHARS)).toBe(true);
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

describe("a setup that can be sent", () => {
  test("the address, the key and the model are each judged, in the sheet's order", () => {
    const ok = { baseUrl: "https://x.test/v1", model: "m", apiKey: "sk-1" };
    expect(providerFault(ok)).toBeNull();
    expect(providerFault({ ...ok, baseUrl: " " })).toBe("no-url");
    expect(providerFault({ ...ok, baseUrl: `https://x.test/${"a".repeat(PROVIDER_LIMITS.baseUrl)}` })).toBe("long-url");
    expect(providerFault({ ...ok, baseUrl: "ftp://x.test/v1" })).toBe("scheme");
    expect(providerFault({ ...ok, baseUrl: "javascript:alert(1)" })).toBe("scheme");
    expect(providerFault({ ...ok, baseUrl: "https://user:pass@x.test/v1" })).toBe("credentials");
    expect(providerFault({ ...ok, baseUrl: "https://user@x.test/v1" })).toBe("credentials");
    expect(providerFault({ ...ok, baseUrl: "https://x.test/v1/users/a@b" })).toBeNull();
    expect(providerFault({ ...ok, apiKey: "k".repeat(PROVIDER_LIMITS.apiKey + 1) })).toBe("long-key");
    expect(providerFault({ ...ok, apiKey: "sk-1\nx-injected: 1" })).toBe("odd-key");
    expect(providerFault({ ...ok, apiKey: "sk 1" })).toBe("odd-key");
    expect(providerFault({ ...ok, apiKey: "" })).toBeNull();
    expect(providerFault({ ...ok, model: "" })).toBe("no-model");
    expect(providerFault({ ...ok, model: "m".repeat(PROVIDER_LIMITS.model + 1) })).toBe("long-model");
  });

  test("the turn's message never quotes a name and password, and clips a long address", () => {
    expect(providerReady({ baseUrl: "https://user:hunter2@x.test/v1", model: "m", apiKey: "" })).toBe("The base URL must not carry a user name or a password. Put the key in the API key field.");
    const long = providerReady({ baseUrl: `ftp://${"a".repeat(500)}`, model: "m", apiKey: "" }) ?? "";
    expect(long.length).toBeLessThan(200);
    expect(providerReady({ baseUrl: "https://x.test/v1", model: "m", apiKey: "a b" })).toBe("The API key has a space, a line break or another character a key cannot hold. Paste it again.");
  });

  test("the sheet says each of them as a reason Save is off", () => {
    expect(saveBlocker({ baseUrl: "https://user:pass@x.test/v1", model: "m", apiKey: "" }, false, 0)).toBe("To save, take the user name and password out of the base URL. The key goes in the API key field.");
    expect(saveBlocker({ baseUrl: `https://x.test/${"a".repeat(3000)}`, model: "m", apiKey: "" }, false, 0)).toBe("To save, shorten the base URL to 2048 characters or fewer.");
    expect(saveBlocker({ baseUrl: "https://x.test/v1", model: "m", apiKey: "sk\n1" }, true, 0)).toBe("To save, paste the API key again: it has a space, a line break or another character a key cannot hold.");
    expect(saveBlocker({ baseUrl: "https://x.test/v1", model: "m", apiKey: "k".repeat(5000) }, true, 0)).toBe("To save, shorten the API key to 4096 characters or fewer.");
    expect(saveBlocker({ baseUrl: "https://x.test/v1", model: "m".repeat(201), apiKey: "k" }, true, 0)).toBe("To save, shorten the model name to 200 characters or fewer.");
  });

  test("the setup sheet says where the key is in its own words", () => {
    expect(apiErrorText(401, "", "sheet")).toBe("The provider refused the request (401). Check the API key above.");
    expect(apiErrorText(403, "", "sheet")).toBe("The provider refused the request (403). Check the API key above.");
    expect(apiErrorText(401, "")).toBe("The provider refused the request (401). Check the API key in the model setup.");
    // Every other status reads the same in both places.
    for (const status of [404, 429, 500, 400, 200]) expect(apiErrorText(status, "x", "sheet")).toBe(apiErrorText(status, "x"));
  });
});

describe("the key never reaches a message", () => {
  const SECRET = "sk-secret-1";
  const PASSWORD = "hunter2";
  const leaky: ProviderConfig = { ...PROVIDER, apiKey: SECRET };
  const WITH_CREDENTIALS = `Request cannot be constructed from a URL that includes credentials: https://admin:${PASSWORD}@127.0.0.1:11434/v1/chat/completions?key=${SECRET}`;

  /** Every way a provider can answer with the key in its words (a Response is read once, so each call makes its own). */
  const answers: ReadonlyArray<[string, () => Response | Error]> = [
    ["an error body in JSON", () => new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${SECRET}` } }), { status: 401 })],
    ["an error body that is not JSON", () => new Response(`<html>bad token ${SECRET} at https://admin:${PASSWORD}@proxy.test/</html>`, { status: 502 })],
    ["an error inside a streamed 200", () => sseResponse([`data: ${JSON.stringify({ error: { message: `key ${SECRET} is over its quota` } })}\n\n`])],
    ["an error inside a one-shot 200", () => new Response(JSON.stringify({ error: { message: `key ${SECRET} is over its quota` } }), { status: 200, headers: { "content-type": "application/json" } })],
    ["an error that is not an object", () => sseResponse([`data: ${JSON.stringify({ error: `denied for Bearer ${SECRET}` })}\n\n`])],
    ["a network error that names the address", () => new TypeError(WITH_CREDENTIALS)],
    ["a network error that is only the key", () => new Error(SECRET)],
  ];

  const fetchOf = (answer: Response | Error): typeof fetch =>
    (async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    }) as unknown as typeof fetch;

  const turnFailure = async (provider: ProviderConfig, answer: Response | Error): Promise<string> => {
    const events: AssistantEvent[] = [];
    await runTurn({ provider, briefing: BRIEFING, conversation: [{ role: "user", content: "hi" }], execute: () => ({ ok: true, result: {} }), onEvent: (e) => events.push(e), signal: new AbortController().signal, fetchImpl: fetchOf(answer) });
    const failed = events.find((e) => e.type === "failed");
    // The whole event list is what the transcript and the status line are drawn from.
    expect(JSON.stringify(events)).not.toContain(SECRET);
    return failed?.type === "failed" ? failed.error : "";
  };

  test("redact takes out the key and any name and password in an address", () => {
    const withLogin: ProviderConfig = { baseUrl: `https://admin:${PASSWORD}@x.test/v1`, model: "m", apiKey: SECRET };
    expect(redact(`401 for ${SECRET} at https://admin:${PASSWORD}@x.test/v1/models`, withLogin)).toBe("401 for (your key) at https://x.test/v1/models");
    expect(redact(`the password ${PASSWORD} was refused`, withLogin)).toBe("the password (your password) was refused");
    expect(redact("see http://other:secret@proxy.test/a and mail a@b.test", PROVIDER)).toBe("see http://proxy.test/a and mail a@b.test");
    expect(redact("nothing to hide", PROVIDER)).toBe("nothing to hide");
  });

  test("a turn's failure never holds the key, whichever way the provider answers", async () => {
    for (const [name, answer] of answers) {
      const error = await turnFailure(leaky, answer());
      expect(`${name}: ${error}`).not.toBe(`${name}: `);
      expect(error).not.toContain(SECRET);
      expect(error).not.toContain(PASSWORD);
    }
    expect(await turnFailure(leaky, new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${SECRET}` } }), { status: 401 }))).toBe(
      "The provider refused the request (401). Check the API key in the model setup. The provider said: Incorrect API key provided: (your key).",
    );
    expect(await turnFailure(leaky, sseResponse([`data: ${JSON.stringify({ error: { message: `key ${SECRET} is over its quota` } })}\n\n`]))).toBe(
      "The provider reported an error. The provider said: key (your key) is over its quota.",
    );
  });

  test("the connection check's note never holds the key either", async () => {
    const signal = new AbortController().signal;
    for (const [name, answer] of answers) {
      const note = await listModels(leaky, signal, fetchOf(answer())).then(
        () => "",
        (e: unknown) => failedNote(e).text,
      );
      expect(`${name}: ${note}`).not.toBe(`${name}: `);
      expect(note).not.toContain(SECRET);
      expect(note).not.toContain(PASSWORD);
    }
  });

  test("an address with a name and password in it is refused before any request, without quoting them", async () => {
    const withLogin: ProviderConfig = { baseUrl: `https://admin:${PASSWORD}@x.test/v1`, model: "m", apiKey: SECRET };
    let asked = 0;
    const counting = (async () => {
      asked += 1;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const events: AssistantEvent[] = [];
    await runTurn({ provider: withLogin, briefing: BRIEFING, conversation: [], execute: () => ({ ok: true, result: {} }), onEvent: (e) => events.push(e), signal: new AbortController().signal, fetchImpl: counting });
    const note = await listModels(withLogin, new AbortController().signal, counting).then(
      () => "",
      (e: unknown) => failedNote(e).text,
    );
    expect(asked).toBe(0);
    expect(JSON.stringify(events) + note).not.toContain(PASSWORD);
    expect(note).toBe("The base URL must not carry a user name or a password. Put the key in the API key field.");
    // A scheme the turn quotes back is quoted without them.
    const quoted: AssistantEvent[] = [];
    await runTurn({ provider: { ...withLogin, baseUrl: `ftp://admin:${PASSWORD}@x.test` }, briefing: BRIEFING, conversation: [], execute: () => ({ ok: true, result: {} }), onEvent: (e) => quoted.push(e), signal: new AbortController().signal, fetchImpl: counting });
    expect(quoted[0]).toEqual({ type: "failed", error: 'The base URL must start with http:// or https://, not "ftp://x.test".' });
  });

  test("the key travels in the authorization header and nowhere else, and nothing is logged", async () => {
    const logs = [spyOn(console, "log"), spyOn(console, "info"), spyOn(console, "warn"), spyOn(console, "error"), spyOn(console, "debug")].map((spy) => spy.mockImplementation(() => undefined));
    const seen: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    const replies = [toolCallStream(), new Response(JSON.stringify({ error: { message: `no: ${SECRET}` } }), { status: 500 }), new Response(JSON.stringify({ data: [{ id: "a" }, { id: `model-${SECRET}` }] }), { status: 200 })];
    const recording = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), body: String(init?.body ?? ""), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      return replies.shift() ?? new Response("", { status: 500 });
    }) as typeof fetch;
    const events: AssistantEvent[] = [];
    const conversation: ChatMessage[] = [{ role: "user", content: "draw" }];
    await runTurn({ provider: leaky, briefing: BRIEFING, conversation, execute: () => ({ ok: true, result: { value: "T" } }), onEvent: (e) => events.push(e), signal: new AbortController().signal, fetchImpl: recording });
    const ids = await listModels(leaky, new AbortController().signal, recording);
    expect(seen).toHaveLength(3);
    for (const request of seen) {
      expect(request.url).not.toContain(SECRET);
      expect(request.body).not.toContain(SECRET);
      expect(request.headers["authorization"]).toBe(`Bearer ${SECRET}`);
    }
    // A model name that holds the key is not offered.
    expect(ids).toEqual(["a"]);
    expect(JSON.stringify(events) + JSON.stringify(conversation)).not.toContain(SECRET);
    for (const spy of logs) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
      spy.mockRestore();
    }
  });
});

describe("a hostile provider", () => {
  /** A body that enqueues `chunks` and then stays open, as a server that stops answering does. */
  const openStream = (chunks: readonly string[], contentType = "text/event-stream"): Response =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
        },
      }),
      { status: 200, headers: { "content-type": contentType } },
    );
  const content = (text: string): string => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`;
  const call = (index: number, args: string): string =>
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index, id: `c${index}`, function: { name: "run", arguments: args } }] }, finish_reason: null }] })}\n\n`;
  const DONE = "data: [DONE]\n\n";

  const turn = async (response: Response | (() => Promise<Response>), options: { idleMs?: number; controller?: AbortController } = {}): Promise<{ events: AssistantEvent[]; ran: string[]; conversation: ChatMessage[] }> => {
    const events: AssistantEvent[] = [];
    const ran: string[] = [];
    const conversation: ChatMessage[] = [{ role: "user", content: "hi" }];
    const fetchImpl = (typeof response === "function" ? response : async () => response) as unknown as typeof fetch;
    await runTurn({
      provider: PROVIDER,
      briefing: BRIEFING,
      conversation,
      execute: (code) => {
        ran.push(code);
        return { ok: true, result: { value: "T" } };
      },
      onEvent: (e) => events.push(e),
      signal: (options.controller ?? new AbortController()).signal,
      fetchImpl,
      ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }),
    });
    return { events, ran, conversation };
  };
  const failure = (events: readonly AssistantEvent[]): string => {
    const last = events[events.length - 1];
    return last?.type === "failed" ? last.error : `(ended with ${last?.type ?? "nothing"})`;
  };
  const shown = (events: readonly AssistantEvent[]): number => events.reduce((n, e) => n + (e.type === "text" ? e.text.length : 0), 0);

  test("a model list is capped, and only names a model field could hold are kept", () => {
    const rows: unknown[] = [{ id: "<b>bold</b><img src=x onerror=alert(1)>" }, { id: "line\nbreak" }, { id: "tab\there" }, { id: "x".repeat(2_000) }, 7, null, [], { id: 3 }, { id: "  padded  " }, { id: "twice" }, { id: "twice" }, { name: "by-name" }, "bare"];
    for (let i = 0; i < 5_000; i++) rows.push({ id: `model-${i}` });
    const ids = modelIds(rows);
    expect(ids).toHaveLength(MAX_LISTED_MODELS);
    // Markup is kept as the text it is: the sheet draws text, never HTML.
    expect(ids.slice(0, 5)).toEqual(["<b>bold</b><img src=x onerror=alert(1)>", "padded", "twice", "by-name", "bare"]);
    expect(ids.every((id) => id.length <= PROVIDER_LIMITS.model && !/[\n\t]/.test(id))).toBe(true);
    expect(modelIds([{ id: "y".repeat(PROVIDER_LIMITS.model) }])).toHaveLength(1);
  });

  test("the connection check reads a 5,000-row list as its first 200 names", async () => {
    const rows = Array.from({ length: 5_000 }, (_, i) => ({ id: `model-${i}` }));
    const ids = await listModels(PROVIDER, new AbortController().signal, (async () => new Response(JSON.stringify({ data: rows }))) as unknown as typeof fetch);
    expect(ids).toHaveLength(MAX_LISTED_MODELS);
    expect(reachedNote(ids, "").text).toBe("Connected. 200 models.");
  });

  test("a list longer than what is kept is counted, and the note says the first 200 of how many", async () => {
    const rows: unknown[] = Array.from({ length: 1_340 }, (_, i) => ({ id: `model-${i}` }));
    // Rows that are not names, and a name listed twice, are not counted.
    rows.push({ id: "model-3" }, { id: 7 }, { id: "bad\nname" });
    const listing = await listProviderModels(PROVIDER, new AbortController().signal, (async () => new Response(JSON.stringify({ data: rows }))) as unknown as typeof fetch);
    expect(listing.ids).toHaveLength(MAX_LISTED_MODELS);
    expect(listing.total).toBe(1_340);
    expect(reachedNote(listing.ids, "", listing.total).text).toBe("Connected. The first 200 of 1,340 models.");
    expect(reachedNote(listing.ids, "model-7", listing.total).text).toBe("Connected. The first 200 of 1,340 models, including model-7.");
    // A name past the first 200 may well be served: it is not said to be missing from the provider.
    expect(reachedNote(listing.ids, "model-900", listing.total)).toEqual({
      state: "reached",
      text: "Connected. The first 200 of 1,340 models; model-900 is not among them. Pick one from the list, or keep the name you typed.",
    });
  });

  test("a list that fits is its own count, and a name that held the key is not counted", async () => {
    const short = await listProviderModels(PROVIDER, new AbortController().signal, (async () => new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }))) as unknown as typeof fetch);
    expect(short).toEqual({ ids: ["a", "b"], total: 2 });
    expect(reachedNote(short.ids, "a", short.total).text).toBe("Connected. 2 models, including a.");
    const leaky = await listProviderModels({ ...PROVIDER, apiKey: "sk-secret-9" }, new AbortController().signal, (async () => new Response(JSON.stringify({ data: [{ id: "a" }, { id: "echo-sk-secret-9" }] }))) as unknown as typeof fetch);
    expect(leaky).toEqual({ ids: ["a"], total: 1 });
  });

  test("a model list too large to read says so, and the check does not read on", async () => {
    let pulled = 0;
    const megabyte = new TextEncoder().encode("a".repeat(1_000_000));
    const endless = new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          pulled += 1;
          c.enqueue(megabyte);
        },
      }),
      { status: 200 },
    );
    await expect(listModels(PROVIDER, new AbortController().signal, (async () => endless) as unknown as typeof fetch)).rejects.toThrow("The provider's model list is too large to read. Type the model's name and save.");
    expect(pulled * 1_000_000).toBeLessThan(MAX_MODEL_LIST_CHARS + 3_000_000);
  });

  test("a connection check that gets no answer ends by itself", async () => {
    const never = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const note = await listModels(PROVIDER, new AbortController().signal, never, 20).then(
      () => null,
      (e: unknown) => failedNote(e),
    );
    expect(note).toEqual({ state: "unreachable", text: "The provider sent nothing for 1 second, so the request was stopped. Check that the server is running, then ask again." });
    const stalled = await listModels(PROVIDER, new AbortController().signal, (async () => openStream(['{"data":['], "application/json")) as unknown as typeof fetch, 20).then(
      () => null,
      (e: unknown) => failedNote(e).state,
    );
    expect(stalled).toBe("unreachable");
  });

  test("a 2 MB streamed reply is kept to its first 200,000 characters, with a line that says so", async () => {
    const piece = "word ".repeat(2_000);
    const { events, conversation } = await turn(openStream(Array.from({ length: 200 }, () => content(piece))));
    expect(shown(events)).toBe(MAX_REPLY_CHARS);
    expect(failure(events)).toBe("The reply passed 200,000 characters and was stopped there. Ask for a shorter answer.");
    const kept = conversation[conversation.length - 1];
    expect(kept?.role).toBe("assistant");
    expect(kept?.content?.length).toBe(MAX_REPLY_CHARS);
  });

  test("a reply cut at the limit runs none of the code that came with it", async () => {
    const { events, ran } = await turn(sseResponse([call(0, '{"code":"(erase-all)"}'), content("x".repeat(MAX_REPLY_CHARS + 1)), DONE]));
    expect(ran).toEqual([]);
    expect(failure(events)).toContain("was stopped there");
    const whole = oneShot(JSON.stringify({ choices: [{ message: { content: "x".repeat(MAX_REPLY_CHARS + 10), tool_calls: [{ id: "c", function: { name: "run", arguments: "{}" } }] } }] }), () => {});
    expect(whole).toEqual({ text: "x".repeat(MAX_REPLY_CHARS), toolCalls: [], finish: "length", clipped: true });
  });

  test("a reply of exactly the limit is not cut", async () => {
    const { events } = await turn(sseResponse([content("x".repeat(MAX_REPLY_CHARS)), DONE]));
    expect(events[events.length - 1]).toEqual({ type: "done", reason: "stop" });
  });

  test("500 tool calls in one reply run nothing", async () => {
    const { events, ran } = await turn(sseResponse([...Array.from({ length: 500 }, (_, i) => call(i, '{"code":"(+ 1 2)"}')), DONE]));
    expect(ran).toEqual([]);
    expect(failure(events)).toBe("The model asked to run code more than 32 times in one reply, so none of it was run. Ask for the work in smaller steps.");
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, function: { name: "run", arguments: "{}" } }));
    expect(() => oneShot(JSON.stringify({ choices: [{ message: { tool_calls: many } }] }), () => {})).toThrow("more than 32 times");
  });

  test("as many calls as the limit allows still run", async () => {
    const calls = Array.from({ length: MAX_CALLS_PER_REPLY }, (_, i) => call(i, '{"code":"(+ 1 2)"}'));
    const fetchImpl = scriptedFetch([sseResponse([...calls, DONE]), textStream("Done, 32 steps.")]).fetch;
    const { events, ran } = await turn(() => fetchImpl("", {}));
    expect(ran).toHaveLength(MAX_CALLS_PER_REPLY);
    expect(events[events.length - 1]?.type).toBe("done");
  });

  test("a tool call with 1 MB of arguments is not run", async () => {
    const fragments = [call(0, '{"code":"'), ...Array.from({ length: 100 }, () => call(0, "x".repeat(10_000))), call(0, '"}')];
    const { events, ran } = await turn(sseResponse([...fragments, DONE]));
    expect(ran).toEqual([]);
    expect(failure(events)).toBe("The model sent more than 100,000 characters of code in one request, so it was not run. Ask for the work in smaller steps.");
    const big = JSON.stringify({ choices: [{ message: { tool_calls: [{ id: "c", function: { name: "run", arguments: JSON.stringify({ code: "x".repeat(MAX_CALL_ARGS_CHARS) }) } }] } }] });
    expect(() => oneShot(big, () => {})).toThrow("100,000 characters of code");
    // A name no tool has is a call that cannot be read, not a name to quote back.
    const a = new StreamAssembler();
    expect(() => a.feed(JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "r".repeat(65) } }] } }] }))).toThrow("its request could not be read");
  });

  test("a stream that stops answering ends the turn after the silence limit", async () => {
    const { events } = await turn(openStream([content("partial")]), { idleMs: 20 });
    expect(events[0]).toEqual({ type: "text", text: "partial" });
    expect(failure(events)).toBe("The provider sent nothing for 1 second, so the request was stopped. Check that the server is running, then ask again.");
  });

  test("a request that is never answered ends the same way, and its fetch is told to stop", async () => {
    let aborted = false;
    const never = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      init?.signal?.addEventListener("abort", () => (aborted = true));
      return new Promise<Response>(() => undefined);
    };
    const { events } = await turn(never as unknown as () => Promise<Response>, { idleMs: 20 });
    expect(failure(events)).toContain("sent nothing for 1 second");
    expect(aborted).toBe(true);
  });

  test("Stop ends a stream that would never end, even one that ignores the abort", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const { events } = await turn(openStream([content("partial")]), { controller, idleMs: 60_000 });
    expect(events[events.length - 1]).toEqual({ type: "done", reason: "stopped" });
  });

  test("a stream that keeps arriving is not taken for silence", async () => {
    let sent = 0;
    const dripping = new Response(
      new ReadableStream<Uint8Array>({
        async pull(c) {
          await new Promise((r) => setTimeout(r, 15));
          sent += 1;
          c.enqueue(new TextEncoder().encode(sent < 6 ? content("a") : DONE));
          if (sent >= 6) c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
    const { events } = await turn(dripping, { idleMs: 40 });
    expect(shown(events)).toBe(5);
    expect(events[events.length - 1]?.type).toBe("done");
  });

  test("a 200 answered with HTML is said plainly, at any size", async () => {
    const page = await turn(new Response("<html><body>It works</body></html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(failure(page.events)).toBe("The provider's reply could not be read. The base URL may not point to an OpenAI-compatible server.");
    const huge = await turn(new Response(`<html>${"a".repeat(MAX_STREAM_CHARS + 10)}</html>`, { status: 200, headers: { "content-type": "text/html" } }));
    expect(failure(huge.events)).toBe("The provider sent more than can be read, so the request was stopped. The base URL may not point to an OpenAI-compatible server.");
    const asStream = await turn(sseResponse(["data: <html><body>It works</body></html>\n\n"]));
    expect(failure(asStream.events)).toBe("The provider's reply could not be read. The base URL may not point to an OpenAI-compatible server.");
  });

  test("a stream of something else is stopped at the size limit", async () => {
    const junk = "j".repeat(1_000_000);
    const { events } = await turn(openStream(Array.from({ length: 6 }, () => junk)));
    expect(failure(events)).toBe("The provider sent more than can be read, so the request was stopped. The base URL may not point to an OpenAI-compatible server.");
  });

  test("a long error body is shown clipped", async () => {
    const { events } = await turn(new Response(JSON.stringify({ error: { message: "e".repeat(50_000) } }), { status: 500 }));
    expect(failure(events).length).toBeLessThan(600);
    const raw = await turn(new Response("e".repeat(3_000_000), { status: 500 }));
    expect(failure(raw.events).length).toBeLessThan(600);
  });
});
