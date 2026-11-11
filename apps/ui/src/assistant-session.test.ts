/**
 * The assistant's session, as the panel observes it: what a send does, how a turn's events become
 * transcript rows, what waits in the queue, what the checkpoint offers to undo, and what can be
 * asked again. The provider is a scripted `fetch`; the drawing is a small fake facade.
 */

import { describe, expect, test } from "bun:test";
import type { ProviderConfig } from "./assistant";
import { createAssistantSession, loadProvider, parseStoredProvider, STORAGE_KEY, type AssistantSession, type SessionFacade } from "./assistant-session";
import type { Envelope } from "./facade";

const PROVIDER: ProviderConfig = { baseUrl: "http://127.0.0.1:11434/v1", model: "test-model", apiKey: "" };

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

type Recorded = { url: string; body: Record<string, unknown> };

/** A fetch double: pops one scripted response per call and records the requests. */
function scriptedFetch(responses: readonly Response[]): { fetch: typeof fetch; requests: Recorded[] } {
  const queue = [...responses];
  const requests: Recorded[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    const next = queue.shift();
    if (next === undefined) throw new Error("the fetch double ran out of responses");
    return next;
  }) as typeof fetch;
  return { fetch: fn, requests };
}

/** A fetch whose replies are released by the test, one per call, in order. */
function gatedFetch(): { fetch: typeof fetch; release: (r: Response) => void; calls: () => number } {
  const gates: Array<(r: Response) => void> = [];
  let calls = 0;
  const fn = ((_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    return new Promise<Response>((resolve, reject) => {
      gates.push(resolve);
      init?.signal?.addEventListener("abort", () => {
        // A stopped request leaves no gate behind for a later release to open.
        const at = gates.indexOf(resolve);
        if (at >= 0) gates.splice(at, 1);
        reject(new Error("aborted"));
      });
    });
  }) as typeof fetch;
  return { fetch: fn, release: (r) => gates.shift()?.(r), calls: () => calls };
}

/** A reply that is only words. */
const textReply = (text: string): Response =>
  sseResponse([
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ]);

/** A reply that asks for one `run` call. */
const toolReply = (code: string): Response =>
  sseResponse([
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "run", arguments: JSON.stringify({ code }) } }] }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
    "data: [DONE]\n\n",
  ]);

const serverError = (): Response => new Response("nope", { status: 500 });

interface Fake {
  facade: SessionFacade;
  /** The code each `run` was handed. */
  ran: string[];
  /** The depth each `undoto` asked for. */
  undone: number[];
  setDepth: (d: number | null) => void;
  setUndoReply: (r: Envelope) => void;
  setSelection: (handles: string[]) => void;
}

/** A drawing whose every `run` adds one undo step, and whose `undoto` goes back to the depth. */
function fakeFacade(): Fake {
  const ran: string[] = [];
  const undone: number[] = [];
  let depth: number | null = 0;
  let undoReply: Envelope = { ok: true, result: { undone: 1 } };
  let handles: string[] = [];
  const facade: SessionFacade = {
    drawingState: () => ({ title: "Bracket", dirty: false, revision: 1, extents: null, layerCount: 1, entityCount: 3, currentLayer: "0", space: "model", units: "millimeters", undoDepth: depth }),
    selection: () => ({ count: handles.length, handles }),
    execute: (command, params) => {
      if (command === "undoto") {
        const to = (params as { depth: number }).depth;
        undone.push(to);
        if (undoReply.ok) depth = to;
        return undoReply;
      }
      ran.push(String((params as { code?: string }).code ?? ""));
      if (depth !== null) depth += 1;
      return { ok: true, result: { value: "3" } };
    },
  };
  return {
    facade,
    ran,
    undone,
    setDepth: (d) => (depth = d),
    setUndoReply: (r) => (undoReply = r),
    setSelection: (h) => (handles = h),
  };
}

function sessionWith(fetchImpl: typeof fetch, fake: Fake = fakeFacade(), onChanged: () => void = () => {}): AssistantSession {
  const session = createAssistantSession({ facade: fake.facade, onChanged, fetchImpl });
  session.setProvider(PROVIDER);
  return session;
}

/** Say `text` and wait for everything it set in motion. */
async function say(session: AssistantSession, text: string): Promise<void> {
  session.setInput(text);
  session.send();
  await session.whenIdle();
}

const kinds = (session: AssistantSession): string[] => session.entries.map((e) => e.kind);

/** Let pending promise callbacks and stream reads run until `done` holds. */
async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 0));
}

describe("send", () => {
  test("an empty draft sends nothing", () => {
    const session = sessionWith(scriptedFetch([]).fetch);
    session.setInput("   ");
    expect(session.send()).toBe("empty");
    expect(session.entries.length).toBe(0);
  });

  test("without a provider the draft stays and nothing is sent", () => {
    const session = sessionWith(scriptedFetch([]).fetch);
    session.setProvider({ baseUrl: "", model: "", apiKey: "" });
    session.setInput("draw a circle");
    expect(session.send()).toBe("unconfigured");
    expect(session.input()).toBe("draw a circle");
    expect(session.entries.length).toBe(0);
  });

  test("a text turn adds the prompt and the reply", async () => {
    const session = sessionWith(scriptedFetch([textReply("Hello")]).fetch);
    session.setInput("hi");
    expect(session.send()).toBe("sent");
    expect(session.input()).toBe("");
    await session.whenIdle();
    expect(kinds(session)).toEqual(["user", "assistant"]);
    const reply = session.entries[1];
    expect(reply?.kind === "assistant" ? reply.text : "").toBe("Hello");
    expect(session.running()).toBe(false);
    expect(session.used()).toBeGreaterThan(0);
    expect(session.title()).toBe("hi");
  });

  test("a tool turn runs the code, records the report and tells the shell", async () => {
    const fake = fakeFacade();
    let changed = 0;
    const session = sessionWith(scriptedFetch([toolReply("(+ 1 2)"), textReply("Three.")]).fetch, fake, () => changed++);
    await say(session, "add");
    expect(kinds(session)).toEqual(["user", "tool", "assistant"]);
    const tool = session.entries[1];
    if (tool?.kind !== "tool") throw new Error("the second row is not a tool row");
    expect(tool.ok).toBe(true);
    expect(tool.code).toBe("(+ 1 2)");
    expect(tool.report).not.toBe("");
    expect(fake.ran).toEqual(["(+ 1 2)"]);
    expect(changed).toBe(1);
  });

  test("the status counts the steps", async () => {
    const seen: string[] = [];
    const fake = fakeFacade();
    const holder: { session?: AssistantSession } = {};
    holder.session = sessionWith(scriptedFetch([toolReply("(+ 1 2)"), textReply("Three.")]).fetch, fake, () => seen.push(holder.session?.status() ?? ""));
    await say(holder.session, "add");
    expect(seen).toEqual(["Working, 1 step…"]);
    expect(holder.session.status()).toBe("");
  });

  test("stop ends the turn without a failure row", async () => {
    const gate = gatedFetch();
    const session = sessionWith(gate.fetch);
    session.setInput("hi");
    session.send();
    expect(session.running()).toBe(true);
    session.stop();
    await session.whenIdle();
    expect(session.running()).toBe(false);
    expect(kinds(session)).toEqual(["user"]);
  });

  test("a provider error becomes a failed row", async () => {
    const session = sessionWith(scriptedFetch([serverError()]).fetch);
    await say(session, "hi");
    const last = session.entries[session.entries.length - 1];
    expect(last?.kind).toBe("failed");
    expect(last?.kind === "failed" ? last.text : "").toContain("500");
  });

  test("toggleTool opens and closes a tool row", async () => {
    const session = sessionWith(scriptedFetch([toolReply("(+ 1 2)"), textReply("Three.")]).fetch);
    await say(session, "add");
    const open = (): boolean => {
      const tool = session.entries[1];
      return tool?.kind === "tool" && tool.open;
    };
    session.toggleTool(1);
    expect(open()).toBe(true);
    session.toggleTool(1);
    expect(open()).toBe(false);
  });

  test("clear forgets the conversation and the draft", async () => {
    const session = sessionWith(scriptedFetch([textReply("Hello")]).fetch);
    await say(session, "hi");
    session.setInput("a draft");
    session.clear();
    expect(session.entries.length).toBe(0);
    expect(session.input()).toBe("");
    expect(session.used()).toBe(0);
    expect(session.title()).toBe("New chat");
  });
});

describe("the queue", () => {
  test("a message sent while a turn runs waits in the queue", async () => {
    const gate = gatedFetch();
    const session = sessionWith(gate.fetch);
    session.setInput("first");
    session.send();
    session.setInput("second");
    expect(session.send()).toBe("queued");
    expect(session.queued.length).toBe(1);
    expect(session.input()).toBe("");
    expect(kinds(session)).toEqual(["user"]);
    session.stop();
    await session.whenIdle();
  });

  test("the queue continues by itself after a clean end", async () => {
    const gate = gatedFetch();
    const session = sessionWith(gate.fetch);
    session.setInput("first");
    session.send();
    session.setInput("second");
    session.send();
    gate.release(textReply("one"));
    await until(() => gate.calls() === 2);
    gate.release(textReply("two"));
    await session.whenIdle();
    expect(kinds(session)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(session.queued.length).toBe(0);
  });

  test("a stopped turn holds the queue, and a held message can be sent by hand", async () => {
    const gate = gatedFetch();
    const session = sessionWith(gate.fetch);
    session.setInput("first");
    session.send();
    session.setInput("second");
    session.send();
    session.stop();
    await session.whenIdle();
    expect(session.queued.length).toBe(1);
    expect(gate.calls()).toBe(1);
    expect(session.running()).toBe(false);

    session.sendQueued(0);
    expect(session.queued.length).toBe(0);
    await until(() => gate.calls() === 2);
    gate.release(textReply("ok"));
    await session.whenIdle();
    const second = session.entries[1];
    expect(second?.kind === "user" ? second.text : "").toBe("second");
  });

  test("a queued message can be dropped, and clear empties the queue", async () => {
    const gate = gatedFetch();
    const session = sessionWith(gate.fetch);
    session.setInput("first");
    session.send();
    session.setInput("second");
    session.send();
    session.setInput("third");
    session.send();
    session.unqueue(0);
    expect(session.queued.map((q) => q.text)).toEqual(["third"]);
    session.clear();
    expect(session.queued.length).toBe(0);
    await session.whenIdle();
  });
});

describe("the checkpoint", () => {
  const changing = (): Response[] => [toolReply('(cmd "circle")'), textReply("Done.")];

  test("a turn that changed the drawing leaves the changes to keep or undo", async () => {
    const session = sessionWith(scriptedFetch(changing()).fetch);
    await say(session, "draw");
    expect(session.changes()).toEqual({ depth: 0, steps: 1, labels: ['(cmd "circle")'] });
  });

  test("a turn that changed nothing leaves no bar", async () => {
    const session = sessionWith(scriptedFetch([textReply("Hi")]).fetch);
    await say(session, "hi");
    expect(session.changes()).toBeNull();
  });

  test("Undo all returns to the checkpoint and tells the shell", async () => {
    const fake = fakeFacade();
    let changed = 0;
    const session = sessionWith(scriptedFetch(changing()).fetch, fake, () => changed++);
    await say(session, "draw");
    session.undoChanges();
    expect(fake.undone).toEqual([0]);
    expect(session.changes()).toBeNull();
    expect(changed).toBe(2);
    expect(session.status()).toBe("Undid 1 change to the drawing");
  });

  test("Keep dismisses the bar and the next turn starts a new checkpoint", async () => {
    const session = sessionWith(scriptedFetch([...changing(), ...changing()]).fetch);
    await say(session, "draw");
    session.keepChanges();
    expect(session.changes()).toBeNull();
    await say(session, "again");
    expect(session.changes()).toEqual({ depth: 1, steps: 1, labels: ['(cmd "circle")'] });
  });

  test("unresolved changes accumulate across turns", async () => {
    const session = sessionWith(scriptedFetch([...changing(), ...changing()]).fetch);
    await say(session, "draw");
    await say(session, "again");
    expect(session.changes()).toEqual({ depth: 0, steps: 2, labels: ['(cmd "circle")', '(cmd "circle")'] });
  });

  test("a facade that names no depth never offers the bar", async () => {
    const fake = fakeFacade();
    fake.setDepth(null);
    const session = sessionWith(scriptedFetch(changing()).fetch, fake);
    await say(session, "draw");
    expect(session.changes()).toBeNull();
  });

  test("a checkpoint the history lost is reported, not thrown", async () => {
    const fake = fakeFacade();
    const session = sessionWith(scriptedFetch(changing()).fetch, fake);
    await say(session, "draw");
    fake.setUndoReply({ ok: false, error: "the checkpoint is gone" });
    session.undoChanges();
    expect(session.changes()).toBeNull();
    expect(session.status()).toBe("the checkpoint is gone");
  });

  test("clear forgets the changes", async () => {
    const session = sessionWith(scriptedFetch(changing()).fetch);
    await say(session, "draw");
    session.clear();
    expect(session.changes()).toBeNull();
  });
});

describe("the selection in the briefing", () => {
  const systemPromptOf = (requests: Recorded[]): string => {
    const messages = requests[0]?.body["messages"];
    const first = Array.isArray(messages) ? (messages[0] as { content?: unknown }) : {};
    return typeof first.content === "string" ? first.content : "";
  };

  test("the briefing names the selection", async () => {
    const fake = fakeFacade();
    fake.setSelection(["1A", "1B"]);
    const scripted = scriptedFetch([textReply("Hi")]);
    await say(sessionWith(scripted.fetch, fake), "hi");
    expect(systemPromptOf(scripted.requests)).toContain("2 selected");
  });

  test("a selection the reader left out is not named", async () => {
    const fake = fakeFacade();
    fake.setSelection(["1A", "1B"]);
    const scripted = scriptedFetch([textReply("Hi")]);
    const session = sessionWith(scripted.fetch, fake);
    session.setSelectionIncluded(false);
    await say(session, "hi");
    expect(systemPromptOf(scripted.requests)).not.toContain("selected");
  });
});

describe("try again", () => {
  test("a request that failed before any step can be asked again", async () => {
    const scripted = scriptedFetch([serverError(), textReply("Hello")]);
    const session = sessionWith(scripted.fetch);
    await say(session, "hi");
    expect(session.canRetry()).toBe(true);
    session.retry();
    await session.whenIdle();
    expect(kinds(session)).toEqual(["user", "assistant"]);
    const messages = scripted.requests[1]?.body["messages"] as Array<{ role: string }>;
    expect(messages.filter((m) => m.role === "user").length).toBe(1);
  });

  test("a turn that already ran a step is not repeated", async () => {
    const scripted = scriptedFetch([toolReply("(+ 1 2)"), serverError()]);
    const session = sessionWith(scripted.fetch);
    await say(session, "add");
    expect(session.entries[session.entries.length - 1]?.kind).toBe("failed");
    expect(session.canRetry()).toBe(false);
    session.retry();
    await session.whenIdle();
    expect(scripted.requests.length).toBe(2);
  });

  test("nothing to retry after a clean turn", async () => {
    const session = sessionWith(scriptedFetch([textReply("Hello")]).fetch);
    await say(session, "hi");
    expect(session.canRetry()).toBe(false);
  });
});

/** A stand-in for the browser's storage, installed for one test and taken away after it. */
function withStorage<T>(initial: Record<string, string>, body: (store: Map<string, string>) => T | Promise<T>, getItem?: (key: string) => string | null): Promise<T> {
  const store = new Map(Object.entries(initial));
  const fake = {
    getItem: getItem ?? ((key: string): string | null => store.get(key) ?? null),
    setItem: (key: string, value: string): void => void store.set(key, value),
    removeItem: (key: string): void => void store.delete(key),
  };
  Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true, writable: true });
  return Promise.resolve()
    .then(() => body(store))
    .finally(() => Reflect.deleteProperty(globalThis, "localStorage"));
}

describe("a stored setup", () => {
  const NOT_SET_UP: ProviderConfig = { baseUrl: "", model: "", apiKey: "" };
  const GOOD = { baseUrl: "https://api.example.test/v1", model: "m-1", apiKey: "sk-1" };

  test("a setup this build saved is read back", () => {
    expect(parseStoredProvider(JSON.stringify(GOOD))).toEqual(GOOD);
    expect(parseStoredProvider(JSON.stringify({ baseUrl: " http://127.0.0.1:11434/v1 ", model: " llama3.2 " }))).toEqual({ baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2", apiKey: "" });
  });

  test("anything else is not set up, and reading it never throws", () => {
    const bad: ReadonlyArray<[string, string | null]> = [
      ["nothing stored", null],
      ["an empty text", ""],
      ["not JSON", "{baseUrl:"],
      ["null", "null"],
      ["a number", "7"],
      ["a text", '"https://api.example.test/v1"'],
      ["an array", JSON.stringify([GOOD])],
      ["an empty object", "{}"],
      ["a number where the address belongs", JSON.stringify({ ...GOOD, baseUrl: 7 })],
      ["an array where the model belongs", JSON.stringify({ ...GOOD, model: ["m-1"] })],
      ["an object where the key belongs", JSON.stringify({ ...GOOD, apiKey: { toString: "x" } })],
      ["null where the key belongs", JSON.stringify({ ...GOOD, apiKey: null })],
      ["an ftp address", JSON.stringify({ ...GOOD, baseUrl: "ftp://files.example.test" })],
      ["a script address", JSON.stringify({ ...GOOD, baseUrl: "javascript:alert(1)" })],
      ["a file address", JSON.stringify({ ...GOOD, baseUrl: "file:///etc/passwd" })],
      ["an address with a name and password", JSON.stringify({ ...GOOD, baseUrl: "https://admin:hunter2@api.example.test/v1" })],
      ["an address with a line break", JSON.stringify({ ...GOOD, baseUrl: "https://api.example.test/v1\nHost: evil.test" })],
      ["a key with a line break", JSON.stringify({ ...GOOD, apiKey: "sk-1\r\nx-injected: 1" })],
      ["a model with a line break", JSON.stringify({ ...GOOD, model: "m\n1" })],
      ["no model", JSON.stringify({ ...GOOD, model: "  " })],
      ["a model past its limit", JSON.stringify({ ...GOOD, model: "m".repeat(201) })],
      ["an address past its limit", JSON.stringify({ ...GOOD, baseUrl: `https://api.example.test/${"a".repeat(2_100)}` })],
      ["5 MB of text", JSON.stringify({ ...GOOD, model: "m".repeat(5 << 20) })],
      ["5 MB that is not JSON", "x".repeat(5 << 20)],
    ];
    for (const [name, raw] of bad) expect([name, parseStoredProvider(raw)]).toEqual([name, NOT_SET_UP]);
  });

  test("markup in a stored setup stays text: it is a model name, and nothing more", () => {
    const stored = parseStoredProvider(JSON.stringify({ ...GOOD, model: "<img src=x onerror=alert(1)>" }));
    expect(stored.model).toBe("<img src=x onerror=alert(1)>");
  });

  test("a session over a bad stored setup opens as not set up", async () => {
    for (const raw of ["{oops", "null", JSON.stringify({ baseUrl: "ftp://x", model: "m", apiKey: "" }), JSON.stringify({ baseUrl: 5, model: [] })]) {
      await withStorage({ "cadcraft.assistant.provider": raw }, () => {
        const session = createAssistantSession({ facade: fakeFacade().facade, onChanged: () => {}, fetchImpl: scriptedFetch([]).fetch });
        expect(session.ready()).toBe(false);
        expect(session.provider()).toEqual(NOT_SET_UP);
        session.setInput("draw");
        expect(session.send()).toBe("unconfigured");
      });
    }
  });

  test("a storage that refuses to be read is a browser without a saved setup", async () => {
    await withStorage(
      {},
      () => expect(loadProvider()).toEqual(NOT_SET_UP),
      () => {
        throw new Error("SecurityError: the operation is insecure");
      },
    );
  });

  test("a good stored setup is ready", async () => {
    await withStorage({ "cadcraft.assistant.provider": JSON.stringify(GOOD) }, () => {
      const session = createAssistantSession({ facade: fakeFacade().facade, onChanged: () => {}, fetchImpl: scriptedFetch([]).fetch });
      expect(session.ready()).toBe(true);
      expect(session.provider()).toEqual(GOOD);
    });
  });

  test("ready is the turn's own check, not only that something is typed", () => {
    const session = sessionWith(scriptedFetch([]).fetch);
    expect(session.ready()).toBe(true);
    for (const baseUrl of ["ftp://x/v1", "https://user:pass@x.test/v1", "x.test/v1"]) {
      session.setProvider({ baseUrl, model: "m", apiKey: "" });
      session.setInput("draw");
      expect([baseUrl, session.ready(), session.send()]).toEqual([baseUrl, false, "unconfigured"]);
    }
  });
});

describe("the key", () => {
  const SECRET = "sk-secret-1";
  const withKey: ProviderConfig = { ...PROVIDER, apiKey: SECRET };
  const echo = (): Response => sseResponse([`data: ${JSON.stringify({ error: { message: `key ${SECRET} is over its quota` } })}\n\n`]);

  test("it is kept in the provider entry and nowhere else", async () => {
    await withStorage({}, async (store) => {
      const scripted = scriptedFetch([toolReply("(+ 1 2)"), textReply("Three."), echo()]);
      const session = createAssistantSession({ facade: fakeFacade().facade, onChanged: () => {}, fetchImpl: scripted.fetch });
      session.setProvider(withKey);
      await say(session, "add");
      await say(session, "again");
      expect([...store.keys()]).toEqual([STORAGE_KEY]);
      expect(JSON.parse(store.get(STORAGE_KEY) ?? "{}")).toEqual(withKey);
      // No request's address or body carries it (the header does; `assistant.test.ts` pins that).
      for (const request of scripted.requests) expect(request.url + JSON.stringify(request.body)).not.toContain(SECRET);
    });
  });

  test("a provider that quotes it back does not get it into the transcript, the status or the title", async () => {
    const seen: string[] = [];
    const holder: { session?: AssistantSession } = {};
    const scripted = scriptedFetch([toolReply("(+ 1 2)"), echo(), new Response(`denied: ${SECRET}`, { status: 403 })]);
    holder.session = createAssistantSession({ facade: fakeFacade().facade, onChanged: () => seen.push(holder.session?.status() ?? ""), fetchImpl: scripted.fetch });
    const session = holder.session;
    session.setProvider(withKey);
    await say(session, "add");
    await say(session, "again");
    const drawn = JSON.stringify(session.entries) + session.status() + session.title() + seen.join("") + JSON.stringify(session.queued) + JSON.stringify(session.changes());
    expect(drawn).not.toContain(SECRET);
    const failures = session.entries.filter((e) => e.kind === "failed").map((e) => (e.kind === "failed" ? e.text : ""));
    expect(failures).toEqual([
      "The provider reported an error. The provider said: key (your key) is over its quota.",
      "The provider refused the request (403). Check the API key in the model setup. The provider said: denied: (your key).",
    ]);
  });
});

describe("a provider that stops answering", () => {
  /** A reply that starts and then stays open; it ignores the abort, as the worst server would. */
  const stalled = (): Response =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Starting" }, finish_reason: null }] })}\n\n`));
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );

  test("the turn ends by itself after the silence limit, with what arrived and a line that says why", async () => {
    const session = createAssistantSession({ facade: fakeFacade().facade, onChanged: () => {}, fetchImpl: scriptedFetch([stalled()]).fetch, idleMs: 20 });
    session.setProvider(PROVIDER);
    await say(session, "hi");
    expect(session.running()).toBe(false);
    expect(kinds(session)).toEqual(["user", "assistant", "failed"]);
    const last = session.entries[2];
    expect(last?.kind === "failed" ? last.text : "").toBe("The provider sent nothing for 1 second, so the request was stopped. Check that the server is running, then ask again.");
    // Words had arrived, so the request is not simply asked again.
    expect(session.canRetry()).toBe(false);
  });

  test("Stop ends it at once, and the queue waits", async () => {
    const session = createAssistantSession({ facade: fakeFacade().facade, onChanged: () => {}, fetchImpl: scriptedFetch([stalled()]).fetch, idleMs: 60_000 });
    session.setProvider(PROVIDER);
    session.setInput("hi");
    session.send();
    await until(() => session.entries.length === 2);
    session.setInput("next");
    expect(session.send()).toBe("queued");
    session.stop();
    await session.whenIdle();
    expect(session.running()).toBe(false);
    expect(kinds(session)).toEqual(["user", "assistant"]);
    expect(session.queued.length).toBe(1);
  });

  test("a reply past the size limit is kept to the limit and the queue waits", async () => {
    const piece = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "word ".repeat(10_000) }, finish_reason: null }] })}\n\n`;
    const session = sessionWith(scriptedFetch([sseResponse(Array.from({ length: 10 }, () => piece))]).fetch);
    await say(session, "hi");
    expect(kinds(session)).toEqual(["user", "assistant", "failed"]);
    const reply = session.entries[1];
    expect(reply?.kind === "assistant" ? reply.text.length : 0).toBe(200_000);
    expect(session.canRetry()).toBe(false);
  });
});
