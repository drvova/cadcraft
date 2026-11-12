/**
 * Recovery copies of the open drawing, kept in this browser so a reload, a closed tab, a crashed
 * tab or a power cut does not lose unsaved work.
 *
 * After a change to an unsaved drawing the controller waits for a quiet moment, writes the drawing
 * out through the facade's own save call (DXF) and stores the bytes with a small index entry. On
 * the next start the entries no tab still owns are offered back; nothing is restored or thrown
 * away without the person saying so.
 *
 * Everything the controller touches is handed in (`AutosaveEnv`): the store, the clock, the
 * timers, the tab's id. So the whole of it runs under `bun test`, where a browser's storage does
 * not exist. `indexedDbStore`, `sessionLocks` and `attachToPage` are the browser's side.
 *
 * This is one of the few places a failure is expected: storage can be full, refused (a private
 * window) or gone mid-session. Every such failure is caught where it happens, told to the person
 * once in plain words through `report`, and never thrown into the shell. There is no retry loop:
 * the next attempt is the next change's own.
 *
 * Privacy: a copy stays in this browser profile on this device. Nothing here sends it anywhere.
 */

/** The tag of what a snapshot's bytes are: the facade's `saveBytes()` writes ASCII DXF. */
export const SNAPSHOT_FORMAT = "dxf";
/** The version of the index entry's shape; an entry of a version this build does not read is
 *  never restored (its bytes can still be saved as a file). */
export const SNAPSHOT_VERSION = 1;

const MIB = 1024 * 1024;

export const LIMITS = {
  /** No further change for this long, and the copy is written. */
  quietMs: 3_000,
  /** Never two copies closer together than this (a tab going away is the exception). */
  minIntervalMs: 15_000,
  /** Someone drawing without a pause still gets a copy this long after their first change. */
  maxWaitMs: 30_000,
  /** Writing the drawing out took longer than this last time: the next one waits for idle time
   *  (the browser's own measure of a long task). */
  longTaskMs: 50,
  /** Copies kept per document of one tab: the newest, and two to fall back on if it is damaged. */
  perDocument: 3,
  /** A drawing larger than this is refused with a message rather than filling the disk. */
  snapshotBytes: 32 * MIB,
  /** All copies together; the oldest spare copies go first, never another document's only one. */
  totalBytes: 96 * MIB,
  /** A document's name longer than this is cut in the index (the name is shown, never a path). */
  nameChars: 200,
} as const;

/** What the controller reads of the drawing; `DrawingState` of the facade fits it as it is. */
export interface DocState {
  title: string;
  revision: number;
  dirty: boolean;
}

/** One stored copy's index entry. */
export interface SnapshotMeta {
  /** `<session>/<seq>`: unique, and the same key holds the bytes. */
  id: string;
  /** The tab that wrote it. Two tabs on the same document name never share an entry. */
  session: string;
  /** The order of a tab's copies; the clock may move backwards, this does not. */
  seq: number;
  /** The document's name only. */
  name: string;
  /** When it was written, by this device's clock (shown to the person; never used for order
   *  within a tab). */
  savedAt: number;
  size: number;
  revision: number;
  format: string;
  version: number;
  /** FNV-1a of the bytes: a copy whose bytes no longer match is not restored. */
  check: number;
}

/**
 * Where the copies live. Every call may reject (storage full, refused, gone); `index()` and
 * `bytes()` return what is there unjudged, because what comes back from a disk is hostile.
 */
export interface SnapshotStore {
  index(): Promise<unknown[]>;
  byteKeys(): Promise<string[]>;
  bytes(id: string): Promise<unknown>;
  /** The entry and its bytes, both or neither. */
  put(meta: SnapshotMeta, bytes: Uint8Array): Promise<void>;
  /** Entries and bytes under these ids; an id that is not there is not an error. */
  remove(ids: readonly string[]): Promise<void>;
}

/** A store's own reason for refusing, when it can name one. */
export type StoreFailure = "unavailable" | "full";

export class StoreError extends Error {
  constructor(
    readonly failure: StoreFailure,
    detail: string,
  ) {
    super(detail);
    this.name = "StoreError";
  }
}

export interface AutosaveEnv {
  store: SnapshotStore;
  /** The wall clock, in milliseconds. It may jump either way. */
  now: () => number;
  /** A clock for measuring how long writing the drawing out took; `now` when absent. */
  elapsed?: () => number;
  /** Run `fn` once after `ms`; the returned function cancels it. */
  after: (fn: () => void, ms: number) => () => void;
  /** Run `fn` when the page is idle (with the browser's own time limit); absent: at once. */
  idle?: (fn: () => void) => void;
  /** This tab's id, new at every start of the page. */
  session: string;
  /** The tabs that are open now (their copies are theirs, not an offer). */
  liveSessions: () => Promise<ReadonlySet<string>>;
  /** The drawing as bytes, or null when it cannot be written out. */
  serialise: () => Uint8Array | null;
  /** The drawing's state now (read after a restore replaced the drawing). */
  state: () => DocState | null;
  /** Tell the person, once, in plain words. */
  report: (message: string) => void;
}

/** One document's unsaved work left by a tab that is gone: the newest copy, and older ones to
 *  fall back on. */
export interface Offer {
  /** Stable while the bar shows it: the tab and the name. */
  key: string;
  name: string;
  savedAt: number;
  size: number;
  /** False when no copy is in a format this build reads; it can still be saved as a file. */
  restorable: boolean;
  /** Newest first. */
  snapshots: readonly SnapshotMeta[];
}

/** What an action on an offer came to: the words for the person, and whether the offer is done. */
export interface ActionResult {
  ok: boolean;
  message: string;
  /** The offer no longer stands (it was restored, discarded, or its copies were unusable). */
  settled: boolean;
}

export interface CopyResult extends ActionResult {
  file: { name: string; bytes: Uint8Array } | null;
}

/** What opening the bytes answered; the facade's `Envelope` fits it. */
export type OpenReply = { ok: true } | { ok: false; error: string };

export interface Autosave {
  /** Call after anything that may have changed the drawing. Cheap: it only compares and (re)sets
   *  a timer. */
  noteChange(state: DocState | null): void;
  /** The tab may be about to go: write a copy now if one is owed, whatever the timers say. */
  flush(): void;
  /** The person saved the drawing themselves: its copies are no longer needed. */
  markSaved(): void;
  /** Unsaved changes that no stored copy holds (the last one failed, or has not run yet). */
  needsWarning(): boolean;
  /** Read what earlier tabs left. Never throws; an unreadable store is reported and yields none. */
  start(): Promise<Offer[]>;
  restore(offer: Offer, open: (name: string, bytes: Uint8Array) => OpenReply): Promise<ActionResult>;
  discard(offer: Offer): Promise<ActionResult>;
  /** The newest usable copy's bytes, to hand to the person as a file, without loading it. */
  copy(offer: Offer): Promise<CopyResult>;
  /** Everything queued has been written or has failed (the tests wait on it). */
  settled(): Promise<void>;
  /** How long writing the drawing out took last time, and how large it was; null before the first. */
  lastMeasure(): { ms: number; bytes: number } | null;
  dispose(): void;
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const two = (n: number): string => String(n).padStart(2, "0");

/**
 * A past moment as a person says it, to stand after "from": "less than a minute ago",
 * "12 minutes ago", "today at 09:05", "yesterday at 16:40", "Tuesday at 16:40",
 * "3 November at 16:40", "3 November 2025 at 16:40". A moment after `now` (the clock moved
 * back since) is given as its date, never as a time ago; one that is no date at all is
 * "an unknown time".
 */
export function timeInWords(then: number, now: number): string {
  const at = new Date(then);
  const today = new Date(now);
  if (!Number.isFinite(then) || !Number.isFinite(now) || Number.isNaN(at.getTime()) || Number.isNaN(today.getTime())) return "an unknown time";
  const clock = `${two(at.getHours())}:${two(at.getMinutes())}`;
  const date = `${at.getDate()} ${MONTHS[at.getMonth()] ?? ""}`;
  const dated = at.getFullYear() === today.getFullYear() ? `${date} at ${clock}` : `${date} ${at.getFullYear()} at ${clock}`;
  const ago = now - then;
  if (ago < 0) return ago > -MINUTE ? "less than a minute ago" : dated;
  if (ago < MINUTE) return "less than a minute ago";
  if (ago < 60 * MINUTE) {
    const minutes = Math.floor(ago / MINUTE);
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  // Calendar days apart, by local midnights (a day with a clock change is still one day).
  const midnight = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(today) - midnight(at)) / DAY);
  if (days === 0) return `today at ${clock}`;
  if (days === 1) return `yesterday at ${clock}`;
  if (days < 7) return `${DAYS[at.getDay()] ?? ""} at ${clock}`;
  return dated;
}

/** A byte count as a person reads it: "512 bytes", "48 KB", "1.2 MB". */
export function sizeInWords(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "an unknown size";
  if (bytes < 1024) return bytes === 1 ? "1 byte" : `${Math.round(bytes)} bytes`;
  if (bytes < MIB) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / MIB;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** The bar's sentence for one offer, in the three parts the bar draws (the name clips by itself). */
export function offerParts(offer: Pick<Offer, "name" | "savedAt">, now: number): { before: string; name: string; after: string } {
  return { before: "CADCraft closed with unsaved changes to ", name: offer.name.trim() === "" ? "an unnamed drawing" : offer.name, after: `, from ${timeInWords(offer.savedAt, now)}.` };
}

/** The bar's sentence for one offer. */
export function offerSentence(offer: Pick<Offer, "name" | "savedAt">, now: number): string {
  const parts = offerParts(offer, now);
  return `${parts.before}${parts.name}${parts.after}`;
}

/** What else is waiting behind the offer shown: "", "1 more drawing is waiting.", "2 more drawings are waiting." */
export function waitingWords(offers: number): string {
  const more = offers - 1;
  if (!(more >= 1)) return "";
  return more === 1 ? "1 more drawing is waiting." : `${more} more drawings are waiting.`;
}

/** Where the copies are, for the bar's second line and the Help text. */
export const PRIVACY_NOTE = "Recovery copies stay in this browser on this device.";

export const WORDS = {
  tooLarge: (name: string, size: number): string =>
    `${name} is too large for a recovery copy (${sizeInWords(size)}; the limit is ${sizeInWords(LIMITS.snapshotBytes)}). Save it to keep your changes.`,
  notWritten: (name: string): string => `A recovery copy of ${name} could not be made: the drawing could not be written out. Save it to keep your changes.`,
  storageFull: (name: string): string => `A recovery copy of ${name} could not be stored: the storage for this site is full. Save the drawing to keep your changes.`,
  storageOff: "Recovery copies are not being kept: this browser does not let this site store data (a private window can do this). Save the drawing to keep your changes.",
  storageFailed: (name: string, reason: string): string => `A recovery copy of ${name} could not be stored (${reason}). Save the drawing to keep your changes.`,
  unreadable: (reason: string): string => `Earlier recovery copies could not be read (${reason}). Nothing was changed.`,
  damagedRemoved: (count: number): string => (count === 1 ? "1 damaged recovery copy could not be used and was removed." : `${count} damaged recovery copies could not be used and were removed.`),
  restored: (name: string): string => `${name} was restored. It is unsaved: save it to keep it.`,
  restoredOlder: (name: string, when: string): string => `The latest recovery copy of ${name} was damaged, so the one from ${when} was restored. It is unsaved: save it to keep it.`,
  allDamaged: (name: string): string => `The recovery copy of ${name} is damaged and cannot be opened. It was removed.`,
  notOpened: (name: string, reason: string): string => `The recovery copy of ${name} could not be opened (${reason}). It is kept: you can still save it as a file.`,
  otherVersion: (name: string): string => `The recovery copy of ${name} was made by another version of CADCraft and cannot be restored here. You can still save it as a file.`,
  discarded: (name: string): string => `The recovery copy of ${name} was discarded.`,
  notDiscarded: (name: string, reason: string): string => `The recovery copy of ${name} could not be discarded (${reason}).`,
  copied: (file: string): string => `${file} was saved as a file. The recovery copy is still here.`,
  notRead: (name: string, reason: string): string => `The recovery copy of ${name} could not be read (${reason}).`,
} as const;

// ---------------------------------------------------------------------------------------------
// Judging what the store holds
// ---------------------------------------------------------------------------------------------

/** FNV-1a (32-bit) of the bytes. */
export function checksum(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i] ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);

/** An index entry as read from the store, or null when it is not one (a hostile or damaged row). */
export function parseMeta(value: unknown): SnapshotMeta | null {
  if (!isRecord(value)) return null;
  const { id, session, name, format } = value;
  const seq = count(value["seq"]);
  const size = count(value["size"]);
  const revision = count(value["revision"]);
  const version = count(value["version"]);
  const check = count(value["check"]);
  const savedAt = value["savedAt"];
  if (typeof id !== "string" || typeof session !== "string" || typeof name !== "string" || typeof format !== "string") return null;
  if (id === "" || session === "" || id !== `${session}/${seq}` || name.length > LIMITS.nameChars || format.length > 16) return null;
  if (seq === null || size === null || revision === null || version === null || check === null) return null;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
  if (size === 0 || size > LIMITS.snapshotBytes) return null;
  return { id, session, seq, name, savedAt, size, revision, format, version, check };
}

/** Whether this build reads the entry's bytes back into a drawing. */
export function restorable(meta: SnapshotMeta): boolean {
  return meta.format === SNAPSHOT_FORMAT && meta.version === SNAPSHOT_VERSION;
}

/** The tab an id belongs to, from the id alone (bytes that lost their entry still say whose they were). */
function sessionOf(id: string): string {
  const cut = id.lastIndexOf("/");
  return cut <= 0 ? "" : id.slice(0, cut);
}

/** The stored bytes as bytes, when they are the copy the entry describes. */
function soundBytes(meta: SnapshotMeta, value: unknown): Uint8Array | null {
  const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
  if (bytes === null || bytes.length !== meta.size || checksum(bytes) !== meta.check) return null;
  return bytes;
}

const groupKey = (meta: SnapshotMeta): string => `${meta.session}\u0000${meta.name}`;
/** Newest first: a tab's own order within the tab, the clock between tabs. */
const newestFirst = (a: SnapshotMeta, b: SnapshotMeta): number => (a.session === b.session ? b.seq - a.seq : b.savedAt - a.savedAt);

function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim() === "" ? "no reason was given" : text.trim().replace(/[.\s]+$/, "");
}

function failureOf(error: unknown): StoreFailure | null {
  if (error instanceof StoreError) return error.failure;
  const name = isRecord(error) || error instanceof Error ? String((error as { name?: unknown }).name ?? "") : "";
  if (name === "QuotaExceededError") return "full";
  if (name === "SecurityError" || name === "InvalidStateError" || name === "UnknownError") return "unavailable";
  return null;
}

// ---------------------------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------------------------

type ProblemKind = "large" | "serialise" | "full" | "unavailable" | "store" | "read" | "damaged";

interface OpenDoc {
  name: string;
  /** The revision the person last saved (or opened) at; null when the drawing was first seen
   *  already changed. */
  savedRevision: number | null;
  /** Restored from a recovery copy and not saved since: unsaved whatever the engine's flag says. */
  restored: boolean;
  /** The revision the newest stored copy holds; null when none does. */
  written: number | null;
  /** When the changes now waiting began (for `maxWaitMs`). */
  firstChangeAt: number | null;
}

export function createAutosave(env: AutosaveEnv): Autosave {
  const elapsed = env.elapsed ?? env.now;
  let doc: OpenDoc | null = null;
  let current: DocState | null = null;
  let cancelTimer: (() => void) | null = null;
  let lastWriteAt: number | null = null;
  let measure: { ms: number; bytes: number } | null = null;
  let seq = 0;
  let disposed = false;
  /** Copies of earlier tabs that a restore brought into this one, by the restored document's
   *  name: kept until the person saves, then cleared with this tab's own. */
  const adopted = new Map<string, string[]>();
  /** The kinds of failure already told; a success clears them, so a later failure is told again. */
  const told = new Set<ProblemKind>();
  let queue: Promise<void> = Promise.resolve();

  const problem = (kind: ProblemKind, message: string): void => {
    if (told.has(kind)) return;
    told.add(kind);
    // The shell's own reporter must not be able to break a save either.
    try {
      env.report(message);
    } catch {
      // Nothing more can be said: the reporter itself failed.
    }
  };

  const storeProblem = (error: unknown, name: string): void => {
    const failure = failureOf(error);
    if (failure === "full") problem("full", WORDS.storageFull(name));
    else if (failure === "unavailable") problem("unavailable", WORDS.storageOff);
    else problem("store", WORDS.storageFailed(name, reasonOf(error)));
  };

  /** One store operation after another; a failure is the operation's own to handle. */
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    queue = queue.then(work, work);
    return queue;
  };

  const unsaved = (): boolean => doc !== null && current !== null && (doc.restored || (current.dirty && current.revision !== doc.savedRevision));
  const owed = (): boolean => unsaved() && doc !== null && current !== null && doc.written !== current.revision;

  const stopTimer = (): void => {
    cancelTimer?.();
    cancelTimer = null;
  };

  const validIndex = async (): Promise<SnapshotMeta[]> => (await env.store.index()).map(parseMeta).filter((m): m is SnapshotMeta => m !== null);

  /** Store the copy, then drop what it replaces. The new copy goes in first: if it cannot, the
   *  older ones are still there. */
  const writeAndPrune = async (meta: SnapshotMeta, bytes: Uint8Array): Promise<void> => {
    const entries = await validIndex();
    const mine = entries.filter((e) => groupKey(e) === groupKey(meta)).sort(newestFirst);
    const others = entries.filter((e) => groupKey(e) !== groupKey(meta));
    const drop = mine.slice(LIMITS.perDocument - 1);
    let keptMine = mine.slice(0, LIMITS.perDocument - 1);
    const total = (): number => meta.size + keptMine.reduce((n, e) => n + e.size, 0) + others.reduce((n, e) => n + e.size, 0);
    if (total() > LIMITS.totalBytes) {
      // Spare copies go first, oldest first: never the newest copy of another document or tab.
      const newest = new Map<string, SnapshotMeta>();
      for (const e of [...others].sort(newestFirst)) if (!newest.has(groupKey(e))) newest.set(groupKey(e), e);
      const spare = others.filter((e) => newest.get(groupKey(e)) !== e).sort((a, b) => a.savedAt - b.savedAt);
      while (total() > LIMITS.totalBytes && spare.length > 0) {
        const gone = spare.shift();
        if (gone === undefined) break;
        others.splice(others.indexOf(gone), 1);
        drop.push(gone);
      }
      if (total() > LIMITS.totalBytes) {
        drop.push(...keptMine);
        keptMine = [];
      }
      if (total() > LIMITS.totalBytes) throw new StoreError("full", "the recovery copies of other drawings fill the space set aside for them");
    }
    await env.store.put(meta, bytes);
    if (drop.length > 0) await env.store.remove(drop.map((e) => e.id));
  };

  const snapshot = (): void => {
    if (disposed || doc === null || current === null || !owed()) return;
    const target = doc;
    const revision = current.revision;
    const name = target.name.slice(0, LIMITS.nameChars);
    target.firstChangeAt = null;
    lastWriteAt = env.now();
    const began = elapsed();
    let bytes: Uint8Array | null;
    try {
      bytes = env.serialise();
    } catch {
      bytes = null;
    }
    measure = { ms: Math.max(0, elapsed() - began), bytes: bytes?.length ?? 0 };
    if (bytes === null || bytes.length === 0) {
      problem("serialise", WORDS.notWritten(name));
      return;
    }
    if (bytes.length > LIMITS.snapshotBytes) {
      problem("large", WORDS.tooLarge(name, bytes.length));
      return;
    }
    const held = bytes;
    const meta: SnapshotMeta = {
      id: `${env.session}/${seq}`,
      session: env.session,
      seq,
      name,
      savedAt: env.now(),
      size: held.length,
      revision,
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      check: checksum(held),
    };
    seq += 1;
    void enqueue(async () => {
      try {
        await writeAndPrune(meta, held);
      } catch (error) {
        storeProblem(error, name);
        return;
      }
      // Saved (or replaced) while the write was on its way: `markSaved` clears it after this.
      if (doc === target && target.written !== revision) target.written = revision;
      told.clear();
    });
  };

  const run = (): void => {
    cancelTimer = null;
    // A drawing that was slow to write out last time is written when the page is idle.
    if (env.idle !== undefined && measure !== null && measure.ms > LIMITS.longTaskMs) env.idle(snapshot);
    else snapshot();
  };

  const schedule = (): void => {
    if (doc === null) return;
    stopTimer();
    const t = env.now();
    // A clock that moved back must not leave the copy waiting for a time that already was.
    if (doc.firstChangeAt === null || doc.firstChangeAt > t) doc.firstChangeAt = t;
    const last = lastWriteAt !== null && lastWriteAt <= t ? lastWriteAt : null;
    const earliest = last === null ? t : last + LIMITS.minIntervalMs;
    const due = Math.max(earliest, Math.min(t + LIMITS.quietMs, doc.firstChangeAt + LIMITS.maxWaitMs));
    cancelTimer = env.after(run, Math.max(0, due - t));
  };

  const noteChange = (state: DocState | null): void => {
    if (disposed || state === null) return;
    if (doc === null || doc.name !== state.title) {
      // Another document is in front. The one before keeps its copies: its changes were never saved.
      stopTimer();
      doc = { name: state.title, savedRevision: state.dirty ? null : state.revision, restored: false, written: null, firstChangeAt: null };
    }
    current = { title: state.title, revision: state.revision, dirty: state.dirty };
    if (owed()) schedule();
    else stopTimer();
  };

  const flush = (): void => {
    stopTimer();
    snapshot();
  };

  const markSaved = (): void => {
    if (disposed || doc === null || current === null) return;
    stopTimer();
    const target = doc;
    const name = target.name.slice(0, LIMITS.nameChars);
    target.savedRevision = current.revision;
    target.restored = false;
    target.firstChangeAt = null;
    target.written = null;
    const taken = adopted.get(target.name) ?? [];
    adopted.delete(target.name);
    void enqueue(async () => {
      try {
        const own = (await validIndex()).filter((e) => e.session === env.session && e.name === name).map((e) => e.id);
        if (own.length + taken.length > 0) await env.store.remove([...own, ...taken]);
      } catch (error) {
        // The copies outlive the save: at worst a later start offers work that is already saved.
        storeProblem(error, name);
      }
    });
  };

  const start = async (): Promise<Offer[]> => {
    let offers: Offer[] = [];
    await enqueue(async () => {
      try {
        const raw = await env.store.index();
        const keys = new Set(await env.store.byteKeys());
        const live = new Set(await env.liveSessions());
        live.add(env.session);
        const entries: SnapshotMeta[] = [];
        const damaged: string[] = [];
        for (const row of raw) {
          const meta = parseMeta(row);
          if (meta === null) {
            // A row that is not an entry: its id, when it has one, says whose it was.
            const id = isRecord(row) && typeof row["id"] === "string" ? row["id"] : "";
            if (id !== "" && !live.has(sessionOf(id))) damaged.push(id);
          } else if (!live.has(meta.session)) {
            if (keys.has(meta.id)) entries.push(meta);
            else damaged.push(meta.id); // an entry with no bytes
          }
        }
        const indexed = new Set(raw.map((row) => (isRecord(row) && typeof row["id"] === "string" ? row["id"] : "")));
        // Bytes with no entry: no name, no time, nothing to offer.
        for (const id of keys) if (!indexed.has(id) && !live.has(sessionOf(id))) damaged.push(id);
        if (damaged.length > 0) {
          await env.store.remove(damaged);
          problem("damaged", WORDS.damagedRemoved(damaged.length));
        }
        const groups = new Map<string, SnapshotMeta[]>();
        for (const meta of entries) groups.set(groupKey(meta), [...(groups.get(groupKey(meta)) ?? []), meta]);
        offers = [...groups.entries()]
          .map(([key, list]): Offer | null => {
            const snapshots = [...list].sort(newestFirst);
            const newest = snapshots[0];
            if (newest === undefined) return null;
            return { key, name: newest.name, savedAt: newest.savedAt, size: newest.size, restorable: snapshots.some(restorable), snapshots };
          })
          .filter((offer): offer is Offer => offer !== null)
          .sort((a, b) => b.savedAt - a.savedAt);
      } catch (error) {
        if (failureOf(error) === "unavailable") problem("unavailable", WORDS.storageOff);
        else problem("read", WORDS.unreadable(reasonOf(error)));
        offers = [];
      }
    });
    return offers;
  };

  /** The newest copy of the offer whose bytes are sound; `usable` narrows which entries count. */
  const load = async (offer: Offer, usable: (meta: SnapshotMeta) => boolean): Promise<{ meta: SnapshotMeta; bytes: Uint8Array; older: boolean } | null> => {
    const candidates = offer.snapshots.filter(usable);
    for (const meta of candidates) {
      const bytes = soundBytes(meta, await env.store.bytes(meta.id));
      if (bytes !== null) return { meta, bytes, older: meta !== candidates[0] };
    }
    return null;
  };

  const ids = (offer: Offer): string[] => offer.snapshots.map((s) => s.id);

  const restore = async (offer: Offer, open: (name: string, bytes: Uint8Array) => OpenReply): Promise<ActionResult> => {
    let result: ActionResult = { ok: false, message: WORDS.notRead(offer.name, "the store did not answer"), settled: false };
    await enqueue(async () => {
      try {
        if (!offer.restorable) {
          result = { ok: false, message: WORDS.otherVersion(offer.name), settled: false };
          return;
        }
        const found = await load(offer, restorable);
        if (found === null) {
          // Only the copies that were tried and found damaged go; one of another version stays.
          await env.store.remove(offer.snapshots.filter(restorable).map((s) => s.id));
          result = { ok: false, message: WORDS.allDamaged(offer.name), settled: offer.snapshots.every(restorable) };
          return;
        }
        let reply: OpenReply;
        try {
          reply = open(offer.name, found.bytes);
        } catch (error) {
          reply = { ok: false, error: reasonOf(error) };
        }
        if (!reply.ok) {
          result = { ok: false, message: WORDS.notOpened(offer.name, reasonOf(reply.error)), settled: false };
          return;
        }
        // The restored drawing is this tab's now: unsaved, and already held by the copy it came from.
        noteChange(env.state());
        if (doc !== null && current !== null) {
          doc.restored = true;
          doc.written = current.revision;
          adopted.set(doc.name, [...(adopted.get(doc.name) ?? []), ...ids(offer)]);
          stopTimer();
        }
        result = { ok: true, message: found.older ? WORDS.restoredOlder(offer.name, timeInWords(found.meta.savedAt, env.now())) : WORDS.restored(offer.name), settled: true };
      } catch (error) {
        result = { ok: false, message: WORDS.notRead(offer.name, reasonOf(error)), settled: false };
      }
    });
    return result;
  };

  const discard = async (offer: Offer): Promise<ActionResult> => {
    let result: ActionResult = { ok: false, message: WORDS.notDiscarded(offer.name, "the store did not answer"), settled: false };
    await enqueue(async () => {
      try {
        await env.store.remove(ids(offer));
        result = { ok: true, message: WORDS.discarded(offer.name), settled: true };
      } catch (error) {
        result = { ok: false, message: WORDS.notDiscarded(offer.name, reasonOf(error)), settled: false };
      }
    });
    return result;
  };

  const copy = async (offer: Offer): Promise<CopyResult> => {
    let result: CopyResult = { ok: false, message: WORDS.notRead(offer.name, "the store did not answer"), settled: false, file: null };
    await enqueue(async () => {
      try {
        // Any sound copy can be saved as a file, whatever its version: the bytes are the person's.
        const found = await load(offer, () => true);
        result =
          found === null
            ? { ok: false, message: WORDS.notRead(offer.name, "its bytes are damaged"), settled: false, file: null }
            : { ok: true, message: "", settled: false, file: { name: offer.name, bytes: found.bytes } };
      } catch (error) {
        result = { ok: false, message: WORDS.notRead(offer.name, reasonOf(error)), settled: false, file: null };
      }
    });
    return result;
  };

  return {
    noteChange,
    flush,
    markSaved,
    needsWarning: owed,
    start,
    restore,
    discard,
    copy,
    settled: () => queue,
    lastMeasure: () => measure,
    dispose: () => {
      disposed = true;
      stopTimer();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// A store in memory (the tests' store, and the shape the browser's one follows)
// ---------------------------------------------------------------------------------------------

export interface MemoryStore extends SnapshotStore {
  /** The rows themselves, for a test to damage. */
  readonly rows: Map<string, unknown>;
  readonly blobs: Map<string, unknown>;
}

export function memoryStore(): MemoryStore {
  const rows = new Map<string, unknown>();
  const blobs = new Map<string, unknown>();
  return {
    rows,
    blobs,
    index: async () => [...rows.values()],
    byteKeys: async () => [...blobs.keys()],
    bytes: async (id) => blobs.get(id) ?? null,
    put: async (meta, bytes) => {
      rows.set(meta.id, { ...meta });
      blobs.set(meta.id, bytes.slice());
    },
    remove: async (ids) => {
      for (const id of ids) {
        rows.delete(id);
        blobs.delete(id);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The browser's side
// ---------------------------------------------------------------------------------------------

export const DATABASE = "cadcraft.autosave";
const INDEX = "index";
const BYTES = "bytes";

/**
 * The copies in IndexedDB: database `cadcraft.autosave` (version 1), store `index` (the entries,
 * keyed by their `id`) and store `bytes` (a `Uint8Array` under the same id). An entry and its
 * bytes are written in one transaction. `localStorage` would not do: it holds a few megabytes of
 * text and blocks while it writes.
 *
 * The database is opened for each operation's first use and kept; when the browser closes it
 * (another tab upgrading, storage cleared) the next operation opens it again, once.
 */
export function indexedDbStore(factory: IDBFactory | undefined): SnapshotStore {
  let opened: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    if (opened !== null) return opened;
    const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
    if (factory === undefined) {
      reject(new StoreError("unavailable", "this browser has no storage for this site"));
      return promise;
    }
    opened = promise;
    const forget = (): void => {
      if (opened === promise) opened = null;
    };
    try {
      const request = factory.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(INDEX)) db.createObjectStore(INDEX, { keyPath: "id" });
        if (!db.objectStoreNames.contains(BYTES)) db.createObjectStore(BYTES);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          forget();
        };
        db.onclose = forget;
        resolve(db);
      };
      request.onerror = () => {
        forget();
        reject(request.error ?? new StoreError("unavailable", "the storage could not be opened"));
      };
      request.onblocked = () => {
        forget();
        reject(new StoreError("unavailable", "the storage is held by another tab"));
      };
    } catch (error) {
      forget();
      reject(error);
    }
    return promise;
  };

  /** One transaction: `work` issues its requests and returns the one whose result is the answer. */
  const run = async <T>(mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T> | null): Promise<T | null> => {
    const db = await open();
    const { promise, resolve, reject } = Promise.withResolvers<T | null>();
    try {
      const tx = db.transaction([INDEX, BYTES], mode);
      const request = work(tx);
      tx.oncomplete = () => resolve(request === null ? null : request.result);
      tx.onerror = () => reject(tx.error ?? request?.error ?? new Error("the storage refused the operation"));
      tx.onabort = () => reject(tx.error ?? request?.error ?? new Error("the storage stopped the operation"));
    } catch (error) {
      // The handle went stale (the browser closed it): the next operation opens a new one.
      opened = null;
      reject(error);
    }
    return promise;
  };

  return {
    index: async () => (await run<unknown[]>("readonly", (tx) => tx.objectStore(INDEX).getAll())) ?? [],
    byteKeys: async () => ((await run<IDBValidKey[]>("readonly", (tx) => tx.objectStore(BYTES).getAllKeys())) ?? []).filter((key): key is string => typeof key === "string"),
    bytes: async (id) => run<unknown>("readonly", (tx) => tx.objectStore(BYTES).get(id)),
    put: async (meta, bytes) => {
      await run("readwrite", (tx) => {
        tx.objectStore(INDEX).put(meta);
        tx.objectStore(BYTES).put(bytes, meta.id);
        return null;
      });
    },
    remove: async (ids) => {
      await run("readwrite", (tx) => {
        for (const id of ids) {
          tx.objectStore(INDEX).delete(id);
          tx.objectStore(BYTES).delete(id);
        }
        return null;
      });
    },
  };
}

const LOCK_PREFIX = "cadcraft.autosave.tab.";

/**
 * Which tabs are open, through the Web Locks API: a tab holds a lock named after its session for
 * as long as it lives, and the browser releases it when the tab closes or crashes. Without the
 * API (`locks` undefined) no tab can be told from a dead one: `live()` answers none, so another
 * open tab's copy is offered as if that tab had closed.
 */
export function sessionLocks(locks: LockManager | undefined): { hold: (session: string) => void; live: () => Promise<ReadonlySet<string>> } {
  return {
    hold: (session) => {
      if (locks === undefined) return;
      // Held until the page goes: the promise never settles.
      locks.request(`${LOCK_PREFIX}${session}`, () => new Promise<void>(() => undefined)).catch(() => undefined);
    },
    live: async () => {
      const live = new Set<string>();
      if (locks === undefined) return live;
      try {
        for (const lock of (await locks.query()).held ?? []) {
          if (lock.name?.startsWith(LOCK_PREFIX) === true) live.add(lock.name.slice(LOCK_PREFIX.length));
        }
      } catch {
        // No answer is the same as no API: nothing is known to be live.
      }
      return live;
    },
  };
}

/** A new id for this start of the page. */
export function newSession(random: { randomUUID?: () => string } | undefined, now: number): string {
  const uuid = random?.randomUUID?.();
  return uuid ?? `${now.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The page's own moments: a hidden tab and a page going away are when a tab is most likely to
 * die, so a copy is written then; and the browser's "leave this page?" question is asked only
 * while there are unsaved changes that no stored copy holds (the last copy failed, or has not
 * been written yet). A person whose work is already safe is not asked. Returns the detach.
 */
export function attachToPage(autosave: Pick<Autosave, "flush" | "needsWarning">, page: Window): () => void {
  const onVisibility = (): void => {
    if (page.document.visibilityState === "hidden") autosave.flush();
  };
  const onPageHide = (): void => autosave.flush();
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!autosave.needsWarning()) return;
    event.preventDefault();
    // Chromium before 119 asks only when this is set.
    event.returnValue = "";
  };
  page.document.addEventListener("visibilitychange", onVisibility);
  page.addEventListener("pagehide", onPageHide);
  page.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    page.document.removeEventListener("visibilitychange", onVisibility);
    page.removeEventListener("pagehide", onPageHide);
    page.removeEventListener("beforeunload", onBeforeUnload);
  };
}
