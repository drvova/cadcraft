/**
 * Recovery copies, as the person depends on them: a copy is written after a quiet moment and no
 * more often than the limits say; what an earlier tab left is offered and nothing is restored or
 * dropped unasked; and every hostile case (damaged rows, damaged bytes, another version, a
 * drawing too large, a clock that moves back, two tabs on one name, storage that goes away) ends
 * in plain words, never in a throw. The store, the clock and the timers are handed in, so none
 * of this needs a browser; the IndexedDB store itself is checked in the browser.
 */

import { describe, expect, test } from "bun:test";
import {
  attachToPage,
  checksum,
  createAutosave,
  LIMITS,
  memoryStore,
  newSession,
  offerSentence,
  parseMeta,
  sessionLocks,
  sizeInWords,
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  StoreError,
  timeInWords,
  waitingWords,
  WORDS,
  type Autosave,
  type DocState,
  type MemoryStore,
  type SnapshotMeta,
  type SnapshotStore,
} from "./autosave";
import { recoveredFileName } from "./files";

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const read = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** A tab: its controller over a shared store, with a clock and timers the test moves by hand. */
function tab(options: { store?: SnapshotStore; session?: string; live?: () => string[]; idle?: boolean; clock?: { now: number } } = {}) {
  const store = options.store ?? memoryStore();
  const clock = options.clock ?? { now: 1_000_000 };
  const timers: { at: number; fn: () => void }[] = [];
  const reports: string[] = [];
  const idled: (() => void)[] = [];
  let drawing = "0\nEOF\n";
  let state: DocState | null = { title: "Plan", revision: 0, dirty: false };
  let serialiseMs = 0;
  let fail = false;
  let ticks = 0;
  const autosave: Autosave = createAutosave({
    store,
    now: () => clock.now,
    elapsed: () => ticks,
    after: (fn, ms) => {
      const timer = { at: clock.now + ms, fn };
      timers.push(timer);
      return () => {
        const i = timers.indexOf(timer);
        if (i >= 0) timers.splice(i, 1);
      };
    },
    ...(options.idle === true ? { idle: (fn: () => void) => void idled.push(fn) } : {}),
    session: options.session ?? "tab-a",
    liveSessions: async () => new Set(options.live?.() ?? []),
    serialise: () => {
      ticks += serialiseMs;
      if (fail) throw new Error("the writer failed");
      return drawing === "" ? null : text(drawing);
    },
    state: () => state,
    report: (message) => void reports.push(message),
  });
  return {
    autosave,
    store,
    clock,
    reports,
    idled,
    timers,
    /** The person edits: the drawing's bytes change and the revision moves. */
    edit(content: string): void {
      drawing = content;
      state = { title: state?.title ?? "Plan", revision: (state?.revision ?? 0) + 1, dirty: true };
      autosave.noteChange(state);
    },
    /** Another document comes to the front, clean. */
    open(title: string, content: string): void {
      drawing = content;
      state = { title, revision: 0, dirty: false };
      autosave.noteChange(state);
    },
    setSerialise(ms: number, failing = false): void {
      serialiseMs = ms;
      fail = failing;
    },
    /** Move the clock and run every timer that came due. */
    async advance(ms: number): Promise<void> {
      clock.now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at <= clock.now && timers.includes(timer)) {
          timers.splice(timers.indexOf(timer), 1);
          timer.fn();
        }
      }
      await autosave.settled();
    },
    /** What the engine's open would do: take the bytes as the drawing in front. */
    opener: (name: string, bytes: Uint8Array) => {
      drawing = read(bytes);
      state = { title: name, revision: 0, dirty: false };
      return { ok: true } as const;
    },
    drawing: () => drawing,
  };
}

const metas = (store: SnapshotStore): Promise<SnapshotMeta[]> => store.index().then((rows) => rows.map(parseMeta).filter((m): m is SnapshotMeta => m !== null));

/** A store row and its bytes as a tab that is gone would have left them. */
function leave(store: MemoryStore, over: Partial<SnapshotMeta> & { content?: string } = {}): SnapshotMeta {
  const bytes = text(over.content ?? "0\nSECTION\n0\nEOF\n");
  const session = over.session ?? "gone";
  const seq = over.seq ?? 0;
  const meta: SnapshotMeta = {
    id: `${session}/${seq}`,
    session,
    seq,
    name: "Plan",
    savedAt: 900_000,
    size: bytes.length,
    revision: 4,
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    check: checksum(bytes),
    ...Object.fromEntries(Object.entries(over).filter(([key]) => key !== "content")),
  };
  store.rows.set(meta.id, meta);
  store.blobs.set(meta.id, bytes);
  return meta;
}

describe("when a copy is written", () => {
  test("after a quiet moment, once, with the drawing's bytes and an index entry", async () => {
    const t = tab();
    t.edit("line 1");
    await t.advance(LIMITS.quietMs - 1);
    expect(await metas(t.store)).toHaveLength(0);
    await t.advance(1);
    const [meta] = await metas(t.store);
    expect(meta).toMatchObject({ id: "tab-a/0", session: "tab-a", name: "Plan", revision: 1, format: "dxf", version: 1, size: 6, savedAt: 1_003_000 });
    expect(read((await t.store.bytes("tab-a/0")) as Uint8Array)).toBe("line 1");
    expect(t.reports).toEqual([]);
  });

  test("each further change starts the quiet moment again", async () => {
    const t = tab();
    t.edit("a");
    await t.advance(2_000);
    t.edit("ab");
    await t.advance(2_000);
    expect(await metas(t.store)).toHaveLength(0);
    await t.advance(1_000);
    expect((await metas(t.store)).map((m) => m.revision)).toEqual([2]);
  });

  test("a clean drawing, and a revision that already has its copy, write nothing", async () => {
    const t = tab();
    t.autosave.noteChange({ title: "Plan", revision: 0, dirty: false });
    await t.advance(60_000);
    expect(await metas(t.store)).toHaveLength(0);
    t.edit("a");
    await t.advance(LIMITS.quietMs);
    t.autosave.noteChange({ title: "Plan", revision: 1, dirty: true });
    expect(t.timers).toHaveLength(0);
    t.autosave.flush();
    await t.autosave.settled();
    expect(await metas(t.store)).toHaveLength(1);
  });

  test("never two copies closer than the least interval", async () => {
    const t = tab();
    t.edit("a");
    await t.advance(LIMITS.quietMs);
    t.edit("ab");
    await t.advance(LIMITS.quietMs);
    expect((await metas(t.store)).map((m) => m.revision)).toEqual([1]);
    await t.advance(LIMITS.minIntervalMs - LIMITS.quietMs);
    expect((await metas(t.store)).map((m) => m.revision).sort()).toEqual([1, 2]);
  });

  test("someone drawing without a pause still gets a copy", async () => {
    const t = tab();
    for (let i = 0; i < 40; i++) {
      t.edit(`step ${i}`);
      await t.advance(1_000);
    }
    const written = (await metas(t.store)).map((m) => m.savedAt - 1_000_000);
    expect(written.length).toBeGreaterThanOrEqual(1);
    expect(Math.min(...written)).toBeLessThanOrEqual(LIMITS.maxWaitMs);
  });

  test("a tab going away writes at once, whatever the timers say", async () => {
    const t = tab();
    t.edit("a");
    await t.advance(LIMITS.quietMs);
    t.edit("ab");
    t.autosave.flush();
    await t.autosave.settled();
    expect((await metas(t.store)).map((m) => m.revision).sort()).toEqual([1, 2]);
    expect(t.timers).toHaveLength(0);
  });

  test("a drawing that was slow to write out waits for idle time the next time", async () => {
    const t = tab({ idle: true });
    t.setSerialise(LIMITS.longTaskMs + 1);
    t.edit("a");
    await t.advance(LIMITS.quietMs);
    expect(t.idled).toHaveLength(0);
    expect(t.autosave.lastMeasure()).toEqual({ ms: LIMITS.longTaskMs + 1, bytes: 1 });
    t.edit("ab");
    await t.advance(LIMITS.minIntervalMs);
    expect(t.idled).toHaveLength(1);
    expect((await metas(t.store)).map((m) => m.revision)).toEqual([1]);
    t.idled[0]?.();
    await t.autosave.settled();
    expect((await metas(t.store)).map((m) => m.revision).sort()).toEqual([1, 2]);
  });

  test("three copies a document, the oldest dropped", async () => {
    const t = tab();
    for (let i = 0; i < 5; i++) {
      t.edit(`v${i}`);
      await t.advance(LIMITS.minIntervalMs);
    }
    expect((await metas(t.store)).map((m) => m.revision).sort()).toEqual([3, 4, 5]);
    expect((await t.store.byteKeys()).sort()).toEqual(["tab-a/2", "tab-a/3", "tab-a/4"]);
  });

  test("all copies together stay under the cap: spare copies go, never another drawing's only one", async () => {
    const store = memoryStore();
    const big = LIMITS.snapshotBytes - 1;
    // Three drawings of other tabs, 31 MiB or so each in the index (the sizes are what is counted).
    leave(store, { session: "x", seq: 0, name: "X", size: big, savedAt: 10 });
    leave(store, { session: "x", seq: 1, name: "X", size: big, savedAt: 20 });
    leave(store, { session: "y", seq: 0, name: "Y", size: big, savedAt: 5 });
    const t = tab({ store, live: () => ["x", "y"] });
    t.edit("mine");
    await t.advance(LIMITS.quietMs);
    // X's spare copy went; X's newest and Y's only copy stayed; mine is in.
    expect((await metas(store)).map((m) => m.id).sort()).toEqual(["tab-a/0", "x/1", "y/0"]);
    // Room for this tab's new copy (10 bytes) only without its older one (4 bytes).
    leave(store, { session: "z", seq: 0, name: "Z", size: big - 8, savedAt: 30 });
    t.edit("mine again");
    await t.advance(LIMITS.minIntervalMs);
    // Nothing spare is left to drop but this tab's own older copy.
    expect((await metas(store)).map((m) => m.id).sort()).toEqual(["tab-a/1", "x/1", "y/0", "z/0"]);
    leave(store, { session: "w", seq: 0, name: "W", size: big, savedAt: 40 });
    t.edit("no room");
    await t.advance(LIMITS.minIntervalMs);
    // No room without destroying another drawing's only copy: refused, and said.
    expect((await metas(store)).map((m) => m.id).sort()).toEqual(["tab-a/1", "w/0", "x/1", "y/0", "z/0"]);
    expect(t.reports).toEqual([WORDS.storageFull("Plan")]);
    expect(t.autosave.needsWarning()).toBe(true);
  });
});

describe("saving, and the leave-this-page question", () => {
  test("an explicit save clears the document's copies and stops the pending one", async () => {
    const t = tab();
    t.edit("a");
    await t.advance(LIMITS.quietMs);
    t.edit("ab");
    t.autosave.markSaved();
    await t.advance(60_000);
    expect(await metas(t.store)).toHaveLength(0);
    expect(await t.store.byteKeys()).toEqual([]);
    expect(t.autosave.needsWarning()).toBe(false);
    // The engine's flag stays set after a download; the saved revision is what counts.
    t.autosave.noteChange({ title: "Plan", revision: 2, dirty: true });
    expect(t.timers).toHaveLength(0);
    t.edit("abc");
    await t.advance(LIMITS.minIntervalMs);
    expect((await metas(t.store)).map((m) => m.revision)).toEqual([3]);
  });

  test("the question is asked only while unsaved work has no copy", async () => {
    const t = tab();
    expect(t.autosave.needsWarning()).toBe(false);
    t.edit("a");
    expect(t.autosave.needsWarning()).toBe(true);
    await t.advance(LIMITS.quietMs);
    expect(t.autosave.needsWarning()).toBe(false);
    t.edit("ab");
    expect(t.autosave.needsWarning()).toBe(true);
    t.autosave.markSaved();
    expect(t.autosave.needsWarning()).toBe(false);
  });

  test("the page's moments: hidden and pagehide write, beforeunload asks only when owed", async () => {
    const t = tab();
    const detach = attachToPage(t.autosave, window);
    const ask = (): boolean => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(ask()).toBe(false);
    t.edit("a");
    expect(ask()).toBe(true);
    window.dispatchEvent(new Event("pagehide"));
    await t.autosave.settled();
    expect((await metas(t.store)).map((m) => m.revision)).toEqual([1]);
    expect(ask()).toBe(false);
    detach();
    t.edit("ab");
    window.dispatchEvent(new Event("pagehide"));
    await t.autosave.settled();
    expect(await metas(t.store)).toHaveLength(1);
    expect(ask()).toBe(false);
  });

  test("another document in front keeps the earlier one's copies", async () => {
    const t = tab();
    t.edit("plan work");
    t.autosave.flush();
    t.open("Section", "clean");
    await t.advance(60_000);
    expect((await metas(t.store)).map((m) => m.name)).toEqual(["Plan"]);
    t.edit("section work");
    await t.advance(LIMITS.minIntervalMs);
    expect((await metas(t.store)).map((m) => m.name).sort()).toEqual(["Plan", "Section"]);
    t.autosave.markSaved();
    await t.autosave.settled();
    expect((await metas(t.store)).map((m) => m.name)).toEqual(["Plan"]);
  });
});

describe("what an earlier tab left", () => {
  test("is offered, newest copy first, and stays until the person decides", async () => {
    const store = memoryStore();
    leave(store, { seq: 0, savedAt: 100, content: "old" });
    leave(store, { seq: 1, savedAt: 200, content: "new" });
    leave(store, { session: "gone-2", name: "Section", savedAt: 300 });
    const t = tab({ store });
    const offers = await t.autosave.start();
    expect(offers.map((o) => [o.name, o.savedAt, o.snapshots.length, o.restorable])).toEqual([
      ["Section", 300, 1, true],
      ["Plan", 200, 2, true],
    ]);
    expect(store.rows.size).toBe(3);
    expect(t.reports).toEqual([]);
  });

  test("restore opens the newest copy, marks the drawing unsaved and keeps the copy until a save", async () => {
    const store = memoryStore();
    leave(store, { seq: 0, savedAt: 100, content: "old" });
    leave(store, { seq: 1, savedAt: 200, content: "new" });
    const t = tab({ store });
    const [offer] = await t.autosave.start();
    if (offer === undefined) throw new Error("no offer");
    const result = await t.autosave.restore(offer, t.opener);
    expect(result).toEqual({ ok: true, message: WORDS.restored("Plan"), settled: true });
    expect(t.drawing()).toBe("new");
    // Kept, and not written a second time: the copy it came from already holds it.
    await t.advance(60_000);
    expect([...store.rows.keys()].sort()).toEqual(["gone/0", "gone/1"]);
    expect(t.autosave.needsWarning()).toBe(false);
    // Not saved yet: a tab that dies now is offered the same copies again.
    expect((await tab({ store, session: "tab-c" }).autosave.start()).map((o) => o.name)).toEqual(["Plan"]);
    // A change to the restored drawing is copied like any other, though the engine calls it clean.
    t.edit("new and more");
    await t.advance(LIMITS.quietMs);
    expect([...store.rows.keys()].sort()).toEqual(["gone/0", "gone/1", "tab-a/0"]);
    t.autosave.markSaved();
    await t.autosave.settled();
    expect(store.rows.size).toBe(0);
    expect(store.blobs.size).toBe(0);
  });

  test("a restore the engine refuses keeps the copy and says why", async () => {
    const store = memoryStore();
    leave(store);
    const t = tab({ store });
    const [offer] = await t.autosave.start();
    if (offer === undefined) throw new Error("no offer");
    const refused = await t.autosave.restore(offer, () => ({ ok: false, error: "not a DXF file." }));
    expect(refused).toEqual({ ok: false, message: WORDS.notOpened("Plan", "not a DXF file"), settled: false });
    const thrown = await t.autosave.restore(offer, () => {
      throw new Error("trap");
    });
    expect(thrown.message).toBe(WORDS.notOpened("Plan", "trap"));
    expect(store.rows.size).toBe(1);
  });

  test("discard removes the offer's copies and nothing else; save a copy removes nothing", async () => {
    const store = memoryStore();
    leave(store, { seq: 0, content: "plan" });
    leave(store, { session: "gone-2", name: "Section" });
    const t = tab({ store });
    const offers = await t.autosave.start();
    const plan = offers.find((o) => o.name === "Plan");
    if (plan === undefined) throw new Error("no offer");
    const copied = await t.autosave.copy(plan);
    expect(copied.ok).toBe(true);
    expect(read(copied.file?.bytes ?? new Uint8Array())).toBe("plan");
    expect(store.rows.size).toBe(2);
    expect(await t.autosave.discard(plan)).toEqual({ ok: true, message: WORDS.discarded("Plan"), settled: true });
    expect([...store.rows.keys()]).toEqual(["gone-2/0"]);
    expect([...store.blobs.keys()]).toEqual(["gone-2/0"]);
    expect((await tab({ store, session: "tab-c" }).autosave.start()).map((o) => o.name)).toEqual(["Section"]);
  });
});

describe("hostile cases", () => {
  test("truncated bytes: the copy before it is restored, and the words say so", async () => {
    const store = memoryStore();
    leave(store, { seq: 0, savedAt: Date.UTC(2026, 10, 12, 9, 0), content: "earlier and whole" });
    const newest = leave(store, { seq: 1, savedAt: Date.UTC(2026, 10, 12, 9, 5), content: "later and whole" });
    store.blobs.set(newest.id, text("later"));
    const t = tab({ store, clock: { now: Date.UTC(2026, 10, 12, 9, 10) } });
    const [offer] = await t.autosave.start();
    if (offer === undefined) throw new Error("no offer");
    const result = await t.autosave.restore(offer, t.opener);
    expect(result.ok).toBe(true);
    expect(result.message).toBe(WORDS.restoredOlder("Plan", "10 minutes ago"));
    expect(t.drawing()).toBe("earlier and whole");
  });

  test("bytes of the right length and the wrong content are not restored", async () => {
    const store = memoryStore();
    const meta = leave(store, { content: "abcdef" });
    store.blobs.set(meta.id, text("abcdeX"));
    const t = tab({ store });
    const [offer] = await t.autosave.start();
    if (offer === undefined) throw new Error("no offer");
    let opened = 0;
    const result = await t.autosave.restore(offer, () => ((opened += 1), { ok: true }));
    expect(result).toEqual({ ok: false, message: WORDS.allDamaged("Plan"), settled: true });
    expect(opened).toBe(0);
    expect(store.rows.size).toBe(0);
    expect((await t.autosave.copy(offer)).file).toBeNull();
  });

  test("bytes that are not bytes at all", async () => {
    const store = memoryStore();
    const meta = leave(store);
    store.blobs.set(meta.id, { length: meta.size });
    const t = tab({ store });
    const [offer] = await t.autosave.start();
    if (offer === undefined) throw new Error("no offer");
    expect((await t.autosave.restore(offer, t.opener)).message).toBe(WORDS.allDamaged("Plan"));
  });

  test("a wrong format tag, and an older or newer version: offered, never restored, still saved as a file", async () => {
    for (const over of [{ format: "dwg" }, { version: 0 }, { version: SNAPSHOT_VERSION + 1 }]) {
      const store = memoryStore();
      leave(store, { ...over, content: "theirs" });
      const t = tab({ store });
      const [offer] = await t.autosave.start();
      if (offer === undefined) throw new Error("no offer");
      expect(offer.restorable).toBe(false);
      let opened = 0;
      const result = await t.autosave.restore(offer, () => ((opened += 1), { ok: true }));
      expect(result).toEqual({ ok: false, message: WORDS.otherVersion("Plan"), settled: false });
      expect(opened).toBe(0);
      expect(store.rows.size).toBe(1);
      expect(read((await t.autosave.copy(offer)).file?.bytes ?? new Uint8Array())).toBe("theirs");
    }
  });

  test("a copy of this version behind one of another version is the one restored", async () => {
    const store = memoryStore();
    leave(store, { seq: 0, content: "readable" });
    leave(store, { seq: 1, version: SNAPSHOT_VERSION + 1, content: "from the future" });
    const t = tab({ store });
    const [offer] = await t.autosave.start();
    if (offer === undefined) throw new Error("no offer");
    expect(offer.restorable).toBe(true);
    expect((await t.autosave.restore(offer, t.opener)).ok).toBe(true);
    expect(t.drawing()).toBe("readable");
  });

  test("an index entry with no bytes, bytes with no entry, and rows that are not entries: removed, and said once", async () => {
    const store = memoryStore();
    const whole = leave(store, { session: "gone", seq: 0 });
    const noBytes = leave(store, { session: "gone", seq: 1 });
    store.blobs.delete(noBytes.id);
    store.blobs.set("gone/7", text("orphan"));
    store.rows.set("gone/8", { id: "gone/8", session: "gone", seq: 8, name: 42 });
    store.rows.set("junk", "not a record");
    store.rows.set("gone/9", { ...whole, id: "gone/9", seq: 9, size: Number.NaN });
    store.rows.set("gone/10", { ...whole, id: "gone/10", seq: 10, size: LIMITS.snapshotBytes + 1 });
    store.rows.set("gone/11", { ...whole, id: "gone/11", seq: 11, savedAt: Number.POSITIVE_INFINITY });
    store.rows.set("gone/12", { ...whole, id: "gone/12", seq: 12, name: "n".repeat(LIMITS.nameChars + 1) });
    store.rows.set("gone/13", { ...whole, id: "elsewhere/13", seq: 13 });
    const t = tab({ store });
    const offers = await t.autosave.start();
    expect(offers.map((o) => o.snapshots.map((s) => s.id))).toEqual([["gone/0"]]);
    expect([...store.blobs.keys()]).toEqual(["gone/0"]);
    // "junk" has no id to remove it by, and the row filed under gone/13 names another id.
    expect([...store.rows.keys()].sort()).toEqual(["gone/0", "gone/13", "junk"]);
    expect(t.reports).toEqual([WORDS.damagedRemoved(8)]);
  });

  test("a 50 MB drawing is refused with words, stores nothing, and is said once", async () => {
    const t = tab();
    const huge = new Uint8Array(50 * 1024 * 1024);
    const autosave = createAutosave({
      store: t.store,
      now: () => 0,
      after: () => () => undefined,
      session: "big",
      liveSessions: async () => new Set(),
      serialise: () => huge,
      state: () => null,
      report: (message) => void t.reports.push(message),
    });
    autosave.noteChange({ title: "Site", revision: 1, dirty: true });
    autosave.flush();
    autosave.noteChange({ title: "Site", revision: 2, dirty: true });
    autosave.flush();
    await autosave.settled();
    expect(t.reports).toEqual(["Site is too large for a recovery copy (50 MB; the limit is 32 MB). Save it to keep your changes."]);
    expect(await t.store.byteKeys()).toEqual([]);
    expect(autosave.needsWarning()).toBe(true);
  });

  test("a drawing that cannot be written out: said once, nothing stored, the next change tries again", async () => {
    const t = tab();
    t.setSerialise(0, true);
    t.edit("a");
    await t.advance(LIMITS.quietMs);
    t.edit("ab");
    await t.advance(LIMITS.minIntervalMs);
    expect(t.reports).toEqual([WORDS.notWritten("Plan")]);
    expect(await metas(t.store)).toHaveLength(0);
    expect(t.autosave.needsWarning()).toBe(true);
    t.setSerialise(0, false);
    t.edit("abc");
    await t.advance(LIMITS.minIntervalMs);
    expect((await metas(t.store)).map((m) => m.revision)).toEqual([3]);
    t.edit("");
    await t.advance(LIMITS.minIntervalMs);
    expect(t.reports).toEqual([WORDS.notWritten("Plan"), WORDS.notWritten("Plan")]);
  });

  test("the clock moving backwards: copies keep their order and the next one is not left waiting", async () => {
    const t = tab();
    t.edit("first");
    await t.advance(LIMITS.quietMs);
    // The clock goes back a day.
    t.clock.now -= 24 * 60 * 60 * 1000;
    t.edit("second");
    expect(t.timers).toHaveLength(1);
    await t.advance(LIMITS.quietMs);
    const written = await metas(t.store);
    expect(written.map((m) => m.revision).sort()).toEqual([1, 2]);
    const later = written.find((m) => m.revision === 2);
    const earlier = written.find((m) => m.revision === 1);
    expect((later?.savedAt ?? 0) < (earlier?.savedAt ?? 0)).toBe(true);
    // A later tab is offered the copy written last, not the one with the latest clock time.
    const [offer] = await tab({ store: t.store, session: "tab-c" }).autosave.start();
    expect(offer?.snapshots.map((s) => s.revision)).toEqual([2, 1]);
    // And the sentence never counts a time that has not come as time ago.
    expect(timeInWords(new Date(2026, 10, 12, 16, 40).getTime(), new Date(2026, 10, 11, 9, 0).getTime())).toBe("12 November at 16:40");
  });

  test("two tabs on the same document name never touch each other's copies", async () => {
    const store = memoryStore();
    const a = tab({ store, session: "tab-a", live: () => ["tab-b"] });
    const b = tab({ store, session: "tab-b", live: () => ["tab-a"] });
    for (let i = 0; i < 4; i++) {
      a.edit(`a${i}`);
      b.edit(`b${i}`);
      await a.advance(LIMITS.minIntervalMs);
      await b.advance(LIMITS.minIntervalMs);
    }
    const count = async (session: string): Promise<number> => (await metas(store)).filter((m) => m.session === session).length;
    expect([await count("tab-a"), await count("tab-b")]).toEqual([3, 3]);
    // A save in one tab clears that tab's copies only.
    a.autosave.markSaved();
    await a.autosave.settled();
    expect([await count("tab-a"), await count("tab-b")]).toEqual([0, 3]);
    // A third tab starting while tab B lives is not offered tab B's work, and removes none of it.
    const c = tab({ store, session: "tab-c", live: () => ["tab-b"] });
    expect(await c.autosave.start()).toEqual([]);
    expect(await count("tab-b")).toBe(3);
    // Tab B is gone: now its newest copy is the offer.
    const [offer] = await tab({ store, session: "tab-d" }).autosave.start();
    expect(offer?.name).toBe("Plan");
    expect(read((await store.bytes(offer?.snapshots[0]?.id ?? "")) as Uint8Array)).toBe("b3");
  });

  test("a tab never offers its own copies to itself", async () => {
    const t = tab();
    t.edit("a");
    await t.advance(LIMITS.quietMs);
    expect(await t.autosave.start()).toEqual([]);
    expect(await metas(t.store)).toHaveLength(1);
  });

  test("storage going away mid-session: said once, nothing thrown, the question comes back, and a return is used", async () => {
    const inner = memoryStore();
    let gone = false;
    const guard = <T>(work: () => Promise<T>): Promise<T> => (gone ? Promise.reject(new DOMException("The database connection is closing.", "InvalidStateError")) : work());
    const store: SnapshotStore = {
      index: () => guard(() => inner.index()),
      byteKeys: () => guard(() => inner.byteKeys()),
      bytes: (id) => guard(() => inner.bytes(id)),
      put: (meta, bytes) => guard(() => inner.put(meta, bytes)),
      remove: (ids) => guard(() => inner.remove(ids)),
    };
    const t = tab({ store });
    t.edit("a");
    await t.advance(LIMITS.quietMs);
    expect(t.autosave.needsWarning()).toBe(false);
    gone = true;
    t.edit("ab");
    await t.advance(LIMITS.minIntervalMs);
    t.edit("abc");
    await t.advance(LIMITS.minIntervalMs);
    t.autosave.markSaved();
    await t.autosave.settled();
    expect(t.reports).toEqual([WORDS.storageOff]);
    t.edit("abcd");
    expect(t.autosave.needsWarning()).toBe(true);
    expect(await t.autosave.start()).toEqual([]);
    gone = false;
    await t.advance(LIMITS.minIntervalMs);
    expect((await metas(inner)).some((m) => m.revision === 4)).toBe(true);
    expect(t.autosave.needsWarning()).toBe(false);
    // Told again only after a success in between.
    gone = true;
    t.edit("abcde");
    await t.advance(LIMITS.minIntervalMs);
    expect(t.reports).toEqual([WORDS.storageOff, WORDS.storageOff]);
  });

  test("storage that is full, refused from the start, or failing for its own reason: each in its own words", async () => {
    const failing = (error: unknown): SnapshotStore => ({
      index: async () => [],
      byteKeys: async () => [],
      bytes: async () => null,
      put: () => Promise.reject(error),
      remove: async () => undefined,
    });
    const full = tab({ store: failing(new DOMException("quota", "QuotaExceededError")) });
    full.edit("a");
    await full.advance(LIMITS.quietMs);
    expect(full.reports).toEqual([WORDS.storageFull("Plan")]);
    const odd = tab({ store: failing(new Error("disk error.")) });
    odd.edit("a");
    await odd.advance(LIMITS.quietMs);
    expect(odd.reports).toEqual([WORDS.storageFailed("Plan", "disk error")]);
    const denied: SnapshotStore = { ...failing(new StoreError("unavailable", "no storage")), index: () => Promise.reject(new StoreError("unavailable", "no storage")) };
    const priv = tab({ store: denied });
    expect(await priv.autosave.start()).toEqual([]);
    priv.edit("a");
    await priv.advance(LIMITS.quietMs);
    expect(priv.reports).toEqual([WORDS.storageOff]);
    const unreadable: SnapshotStore = { ...failing(null), index: () => Promise.reject(new Error("corrupt")) };
    const bad = tab({ store: unreadable });
    expect(await bad.autosave.start()).toEqual([]);
    expect(bad.reports).toEqual([WORDS.unreadable("corrupt")]);
  });

  test("a reporter that throws does not break a save, and a disposed controller does nothing", async () => {
    const store = memoryStore();
    const autosave = createAutosave({
      store,
      now: () => 0,
      after: () => () => undefined,
      session: "s",
      liveSessions: async () => new Set(),
      serialise: () => null,
      state: () => null,
      report: () => {
        throw new Error("the shell is gone");
      },
    });
    autosave.noteChange({ title: "Plan", revision: 1, dirty: true });
    expect(() => autosave.flush()).not.toThrow();
    autosave.dispose();
    autosave.noteChange({ title: "Plan", revision: 2, dirty: true });
    autosave.flush();
    autosave.markSaved();
    await autosave.settled();
    expect(store.rows.size).toBe(0);
  });

  test("a document name of any length is cut in the index, never refused", async () => {
    const t = tab();
    t.open("n".repeat(1000), "x");
    t.edit("y");
    await t.advance(LIMITS.quietMs);
    expect((await metas(t.store)).map((m) => m.name.length)).toEqual([LIMITS.nameChars]);
    t.autosave.markSaved();
    await t.autosave.settled();
    expect(await metas(t.store)).toHaveLength(0);
  });
});

describe("the words", () => {
  const at = (day: number, hour: number, minute: number, month = 10, year = 2026): number => new Date(year, month, day, hour, minute).getTime();
  const now = at(12, 17, 0); // Thursday 12 November 2026, 17:00

  test("a time as a person says it", () => {
    expect(timeInWords(now - 20_000, now)).toBe("less than a minute ago");
    expect(timeInWords(now - 60_000, now)).toBe("1 minute ago");
    expect(timeInWords(at(12, 16, 48), now)).toBe("12 minutes ago");
    expect(timeInWords(at(12, 16, 1), now)).toBe("59 minutes ago");
    expect(timeInWords(at(12, 16, 0), now)).toBe("today at 16:00");
    expect(timeInWords(at(12, 9, 5), now)).toBe("today at 09:05");
    expect(timeInWords(at(11, 16, 40), now)).toBe("yesterday at 16:40");
    expect(timeInWords(at(11, 23, 30), at(12, 0, 45))).toBe("yesterday at 23:30");
    expect(timeInWords(at(11, 23, 30), at(12, 0, 10))).toBe("40 minutes ago");
    expect(timeInWords(at(10, 16, 40), now)).toBe("Tuesday at 16:40");
    expect(timeInWords(at(6, 8, 0), now)).toBe("Friday at 08:00");
    expect(timeInWords(at(5, 8, 0), now)).toBe("5 November at 08:00");
    expect(timeInWords(at(3, 16, 40, 10, 2025), now)).toBe("3 November 2025 at 16:40");
  });

  test("a time that cannot be counted is never invented", () => {
    expect(timeInWords(now + 20_000, now)).toBe("less than a minute ago");
    expect(timeInWords(at(13, 8, 0), now)).toBe("13 November at 08:00");
    expect(timeInWords(Number.NaN, now)).toBe("an unknown time");
    expect(timeInWords(8.64e15 + 1, now)).toBe("an unknown time");
    expect(timeInWords(now, Number.POSITIVE_INFINITY)).toBe("an unknown time");
  });

  test("sizes", () => {
    expect(sizeInWords(1)).toBe("1 byte");
    expect(sizeInWords(512)).toBe("512 bytes");
    expect(sizeInWords(48_769)).toBe("48 KB");
    expect(sizeInWords(1_258_291)).toBe("1.2 MB");
    expect(sizeInWords(50 * 1024 * 1024)).toBe("50 MB");
    expect(sizeInWords(-1)).toBe("an unknown size");
  });

  test("the bar's sentence names the drawing and the time, with no path and no exclamation", () => {
    expect(offerSentence({ name: "Bracket", savedAt: at(12, 16, 48) }, now)).toBe("CADCraft closed with unsaved changes to Bracket, from 12 minutes ago.");
    expect(offerSentence({ name: "apartment.dxf", savedAt: at(11, 16, 40) }, now)).toBe("CADCraft closed with unsaved changes to apartment.dxf, from yesterday at 16:40.");
    expect(offerSentence({ name: "  ", savedAt: at(12, 16, 48) }, now)).toBe("CADCraft closed with unsaved changes to an unnamed drawing, from 12 minutes ago.");
    expect(waitingWords(1)).toBe("");
    expect(waitingWords(2)).toBe("1 more drawing is waiting.");
    expect(waitingWords(4)).toBe("3 more drawings are waiting.");
    const said = [...Object.values(WORDS).map((w) => (typeof w === "string" ? w : (w as (...a: never[]) => string)(...(["Plan", "reason"] as never[])))), offerSentence({ name: "Plan", savedAt: now }, now)];
    for (const line of said) {
      expect(line.includes("!")).toBe(false);
      expect(line.endsWith(".")).toBe(true);
    }
  });

  test("a recovery copy saved as a file never takes the drawing's own file name", () => {
    expect(recoveredFileName("Bracket")).toBe("Bracket (recovered).dxf");
    expect(recoveredFileName("apartment.dxf")).toBe("apartment (recovered).dxf");
    expect(recoveredFileName("a/b:c")).toBe("a_b_c (recovered).dxf");
    expect(recoveredFileName("")).toBe("Drawing (recovered).dxf");
  });
});

describe("the browser's side, where it can be checked without one", () => {
  test("parseMeta takes an entry and refuses everything else", () => {
    const good = { id: "s/3", session: "s", seq: 3, name: "Plan", savedAt: 5, size: 10, revision: 2, format: "dxf", version: 1, check: 7 };
    expect(parseMeta(good)).toEqual(good);
    for (const bad of [null, 3, "x", [], {}, { ...good, id: "s/4" }, { ...good, session: "" }, { ...good, size: 0 }, { ...good, size: -1 }, { ...good, size: 1.5 }, { ...good, revision: "2" }, { ...good, check: null }, { ...good, version: -1 }, { ...good, format: "x".repeat(17) }]) {
      expect(parseMeta(bad)).toBeNull();
    }
  });

  test("a new session id each start, with or without the platform's generator", () => {
    expect(newSession({ randomUUID: () => "uuid-1" }, 5)).toBe("uuid-1");
    const a = newSession(undefined, 5);
    expect(a).not.toBe(newSession(undefined, 5));
    expect(a.includes("/")).toBe(false);
  });

  test("live tabs are the ones holding their lock; no lock API means none is known", async () => {
    expect([...(await sessionLocks(undefined).live())]).toEqual([]);
    sessionLocks(undefined).hold("s");
    const requested: string[] = [];
    const locks = {
      request: (name: string) => (requested.push(name), new Promise(() => undefined)),
      query: async () => ({ held: [{ name: "cadcraft.autosave.tab.tab-b" }, { name: "something.else" }, {}] }),
    } as unknown as LockManager;
    const held = sessionLocks(locks);
    held.hold("tab-a");
    expect(requested).toEqual(["cadcraft.autosave.tab.tab-a"]);
    expect([...(await held.live())]).toEqual(["tab-b"]);
    const broken = { request: () => Promise.reject(new Error("no")), query: () => Promise.reject(new Error("no")) } as unknown as LockManager;
    sessionLocks(broken).hold("x");
    expect([...(await sessionLocks(broken).live())]).toEqual([]);
  });
});
