/**
 * The Slab pin (`apps/ui/slab.lock.json`): which commit of the upstream repository the vendored
 * toolchain was built from, the patches laid over it, and the checksum of every artifact that
 * build produced. `scripts/build-slab.mjs` reads and writes it; this file is the checked reading
 * and the comparison, kept pure so they are tested.
 *
 * The lock is committed; the artifacts are not (`src/slab-vendor/` is git-ignored).
 */

import { isRecord } from "../json";

export interface LockArtifact {
  bytes: number;
  sha256: string;
}

export interface SlabLock {
  /** The upstream repository. */
  repo: string;
  /** The full commit hash the toolchain is built from. */
  commit: string;
  /** The patches applied over that commit, in order, by file name under `slab/patches/`. */
  patches: { file: string; sha256: string }[];
  /** What was built, in upstream's own words (`slab --version`, the pinned toolchains). */
  versions: Record<string, string>;
  /** The artifacts by their path under `src/slab-vendor/`. */
  artifacts: Record<string, LockArtifact>;
}

const COMMIT_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
/** A path under the vendor directory: plain segments, no climbing out of it. */
const PATH_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;
/** An https repository address. */
const REPO_RE = /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._/-]+$/;
const MAX_ENTRIES = 64;
const MAX_BYTES = 256 * 1024 * 1024;

/** The lock read from JSON text; an error naming what is wrong with it. */
export function parseLock(text: string): { ok: true; lock: SlabLock } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "slab.lock.json is not JSON" };
  }
  if (!isRecord(raw)) return { ok: false, error: "slab.lock.json is not an object" };
  const repo = raw["repo"];
  if (typeof repo !== "string" || !REPO_RE.test(repo)) return { ok: false, error: "slab.lock.json: `repo` is not an https repository address" };
  const commit = raw["commit"];
  if (typeof commit !== "string" || !COMMIT_RE.test(commit)) return { ok: false, error: "slab.lock.json: `commit` is not a full commit hash" };
  const patches: SlabLock["patches"] = [];
  const rawPatches = raw["patches"];
  if (rawPatches !== undefined) {
    if (!Array.isArray(rawPatches) || rawPatches.length > MAX_ENTRIES) return { ok: false, error: "slab.lock.json: `patches` is not a short list" };
    for (const entry of rawPatches) {
      if (!isRecord(entry)) return { ok: false, error: "slab.lock.json: a patch is not an object" };
      const file = entry["file"];
      const sha256 = entry["sha256"];
      if (typeof file !== "string" || !PATH_RE.test(file) || file.includes("/")) return { ok: false, error: "slab.lock.json: a patch's `file` is not a file name" };
      if (typeof sha256 !== "string" || !SHA256_RE.test(sha256)) return { ok: false, error: `slab.lock.json: the checksum of ${file} is not a sha256` };
      patches.push({ file, sha256 });
    }
  }
  const versions: Record<string, string> = {};
  const rawVersions = raw["versions"];
  if (isRecord(rawVersions)) {
    for (const [key, value] of Object.entries(rawVersions).slice(0, MAX_ENTRIES)) {
      if (typeof value === "string" && value.length <= 200) versions[key] = value;
    }
  }
  const artifacts: Record<string, LockArtifact> = {};
  const rawArtifacts = raw["artifacts"];
  if (!isRecord(rawArtifacts)) return { ok: false, error: "slab.lock.json: `artifacts` is missing" };
  const entries = Object.entries(rawArtifacts);
  if (entries.length > MAX_ENTRIES) return { ok: false, error: "slab.lock.json: too many artifacts" };
  for (const [path, entry] of entries) {
    if (!PATH_RE.test(path)) return { ok: false, error: `slab.lock.json: \`${path.slice(0, 80)}\` is not a path under the vendor directory` };
    if (!isRecord(entry)) return { ok: false, error: `slab.lock.json: ${path} is not an object` };
    const bytes = entry["bytes"];
    const sha256 = entry["sha256"];
    if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0 || bytes > MAX_BYTES) return { ok: false, error: `slab.lock.json: the size of ${path} is not a byte count` };
    if (typeof sha256 !== "string" || !SHA256_RE.test(sha256)) return { ok: false, error: `slab.lock.json: the checksum of ${path} is not a sha256` };
    artifacts[path] = { bytes, sha256 };
  }
  return { ok: true, lock: { repo, commit, patches, versions, artifacts } };
}

/** The lock as it is written: keys in a fixed order, artifacts by path, a trailing newline. */
export function formatLock(lock: SlabLock): string {
  const artifacts: Record<string, LockArtifact> = {};
  for (const path of Object.keys(lock.artifacts).sort()) {
    const entry = lock.artifacts[path];
    if (entry !== undefined) artifacts[path] = { bytes: entry.bytes, sha256: entry.sha256 };
  }
  const versions: Record<string, string> = {};
  for (const key of Object.keys(lock.versions).sort()) {
    const value = lock.versions[key];
    if (value !== undefined) versions[key] = value;
  }
  return `${JSON.stringify({ repo: lock.repo, commit: lock.commit, patches: lock.patches, versions, artifacts }, null, 2)}\n`;
}

export interface ArtifactReport {
  /** In the lock and not on disk. */
  missing: string[];
  /** On disk with other bytes than the lock's. */
  changed: string[];
  /** On disk and not in the lock. */
  extra: string[];
}

/** What is on disk against what the lock pins. */
export function compareArtifacts(lock: SlabLock, found: Readonly<Record<string, LockArtifact>>): ArtifactReport {
  const report: ArtifactReport = { missing: [], changed: [], extra: [] };
  for (const path of Object.keys(lock.artifacts).sort()) {
    const want = lock.artifacts[path];
    const have = found[path];
    if (want === undefined) continue;
    if (have === undefined) report.missing.push(path);
    else if (have.sha256 !== want.sha256 || have.bytes !== want.bytes) report.changed.push(path);
  }
  for (const path of Object.keys(found).sort()) {
    if (lock.artifacts[path] === undefined) report.extra.push(path);
  }
  return report;
}

/** Whether the artifacts on disk are exactly the lock's. */
export function matchesLock(report: ArtifactReport): boolean {
  return report.missing.length === 0 && report.changed.length === 0 && report.extra.length === 0;
}

/** The report in one line for the build's output. */
export function describeReport(report: ArtifactReport): string {
  if (matchesLock(report)) return "the artifacts match slab.lock.json";
  const parts: string[] = [];
  if (report.missing.length > 0) parts.push(`missing: ${report.missing.join(", ")}`);
  if (report.changed.length > 0) parts.push(`differ from the lock: ${report.changed.join(", ")}`);
  if (report.extra.length > 0) parts.push(`not in the lock: ${report.extra.join(", ")}`);
  return parts.join("; ");
}
