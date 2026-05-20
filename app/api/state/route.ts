import { head, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { seedState } from "@/lib/seed-data";
import type {
  AssistantLanguage,
  ChecklistItem,
  MemberPrefs,
  PlanItem,
  TaskDay,
  VacationState,
  VacationTask,
} from "@/lib/types";

export const runtime = "nodejs";

const DATA_PATH = "vacation-villa/state.json";

// Local dev persistence — survives `next dev` restarts when there's no
// Vercel Blob token configured. We write to a gitignored file inside the
// project so the family's state isn't wiped every time the server reloads.
// On Vercel (production / preview), the writable filesystem is /tmp only,
// so we detect that environment and stay on the in-memory fallback there.
//
// Tests can point this at an isolated path via VILLA_STATE_FILE so the
// e2e suite doesn't touch the real family data at `.data/state.json`.
const LOCAL_STATE_FILE =
  process.env.VILLA_STATE_FILE ||
  path.join(process.cwd(), ".data", "state.json");
const IS_VERCEL = Boolean(process.env.VERCEL);

let devState: VacationState | null = null;

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const VALID_DAYS: TaskDay[] = ["לפני", "חמישי", "שישי", "שבת", "ראשון"];

function migrateDay(value: unknown, fallbackPhase?: unknown): TaskDay {
  if (typeof value === "string" && (VALID_DAYS as string[]).includes(value)) {
    return value as TaskDay;
  }
  if (fallbackPhase === "לפני האירוע") return "לפני";
  if (fallbackPhase === "יום האירוע") return "חמישי";
  return "לפני";
}

function migrateChecklistItem(raw: unknown): ChecklistItem {
  const item = (raw ?? {}) as Partial<ChecklistItem>;
  return {
    id: item.id ?? createId("item"),
    text: item.text ?? "",
    done: Boolean(item.done),
  };
}

function migrateTask(raw: unknown): VacationTask {
  const task = (raw ?? {}) as Partial<VacationTask> & {
    phase?: unknown;
    status?: unknown;
  };

  return {
    id: task.id ?? createId("task"),
    title: task.title ?? "",
    needed: typeof task.needed === "number" && task.needed > 0 ? task.needed : 1,
    assignees: Array.isArray(task.assignees) ? task.assignees.filter(Boolean) : [],
    day: migrateDay(task.day, task.phase),
    notes: typeof task.notes === "string" ? task.notes : "",
    checklist: Array.isArray(task.checklist) ? task.checklist.map(migrateChecklistItem) : [],
    completed: Boolean(task.completed),
  };
}

function migratePlanItem(raw: unknown): PlanItem | null {
  const item = (raw ?? {}) as Partial<PlanItem>;
  if (!item.day || !item.title) return null;
  return {
    id: item.id ?? createId("plan"),
    day: item.day,
    title: item.title,
    startTime: item.startTime,
    endTime: item.endTime,
    location: item.location,
    pricePerPerson: typeof item.pricePerPerson === "number" ? item.pricePerPerson : undefined,
    notes: item.notes,
  };
}

function normalizeLanguage(value: unknown): AssistantLanguage {
  return value === "en" ? "en" : "he";
}

function normalizeMemberPrefs(
  raw: unknown,
): Record<string, MemberPrefs> {
  if (!raw || typeof raw !== "object") return {};
  const result: Record<string, MemberPrefs> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!name) continue;
    const prefs = (value ?? {}) as Partial<MemberPrefs>;
    result[name] = { language: normalizeLanguage(prefs.language) };
  }
  return result;
}

function normalizeState(raw: Partial<VacationState>): VacationState {
  return {
    tasks: Array.isArray(raw.tasks) ? raw.tasks.map(migrateTask) : [],
    planItems: Array.isArray(raw.planItems)
      ? (raw.planItems.map(migratePlanItem).filter(Boolean) as PlanItem[])
      : [],
    members: Array.isArray(raw.members)
      ? Array.from(new Set(raw.members.filter((value): value is string => Boolean(value))))
      : [],
    memberPrefs: normalizeMemberPrefs(raw.memberPrefs),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

async function readBlobState() {
  // We deliberately do NOT use `list()` here because `list()` is eventually
  // consistent on Vercel Blob — for a few seconds after a write, list can
  // still return the previous URL, which means a sibling device polling
  // immediately after a teammate's update would see stale data.
  //
  // Since we always write the same pathname with addRandomSuffix: false +
  // cacheControlMaxAge: 0, the URL is stable and the CDN won't serve stale
  // bytes. `head()` returns metadata for that exact pathname (strongly
  // consistent against the latest write).
  let blobUrl: string | null = null;
  try {
    const meta = await head(DATA_PATH);
    blobUrl = meta.url;
  } catch (err) {
    // 404 = blob doesn't exist yet (first read after store creation).
    if ((err as { status?: number })?.status === 404) {
      return seedState;
    }
    throw err;
  }

  const response = await fetch(blobUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to read vacation state");
  }

  const data = (await response.json()) as Partial<VacationState>;
  return normalizeState(data);
}

async function writeBlobState(state: VacationState) {
  await put(DATA_PATH, JSON.stringify(state, null, 2), {
    access: "public",
    allowOverwrite: true,
    // Stable URL: every write replaces the same blob, so readers always
    // hit the most-recent content and there's no propagation race.
    addRandomSuffix: false,
    // Zero CDN TTL: the blob URL is the same forever but its body changes
    // on every write. We can't let the CDN cache it.
    cacheControlMaxAge: 0,
    contentType: "application/json",
  });
}

async function readLocalFileState(): Promise<VacationState> {
  try {
    const raw = await fs.readFile(LOCAL_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<VacationState>;
    return normalizeState(parsed);
  } catch (err) {
    // First run, or file was deleted/corrupted — fall back to seed.
    // ENOENT is the expected case; surface anything else.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn("[state] local file read failed, using seed:", err);
    }
    return seedState;
  }
}

async function writeLocalFileState(state: VacationState): Promise<void> {
  // Write atomically: write to a tmp file in the same directory, then rename.
  // This prevents truncation if the dev server is killed mid-write.
  await fs.mkdir(path.dirname(LOCAL_STATE_FILE), { recursive: true });
  const tmp = `${LOCAL_STATE_FILE}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, LOCAL_STATE_FILE);
}

function hasBlobToken() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

// Three-tier storage strategy:
//   1. Vercel Blob — production / wherever BLOB_READ_WRITE_TOKEN is set.
//   2. Local JSON file — local `next dev` (no blob token, not on Vercel).
//      Survives server restarts, gitignored.
//   3. In-memory — last-resort fallback (no blob token AND running on
//      Vercel, where the FS is read-only outside /tmp). Resets per cold start.
type StorageKind = "blob" | "file" | "memory";

function storageKind(): StorageKind {
  if (hasBlobToken()) return "blob";
  if (IS_VERCEL) return "memory";
  return "file";
}

async function loadState(kind: StorageKind): Promise<VacationState> {
  if (kind === "blob") return readBlobState();
  if (kind === "file") return readLocalFileState();
  // memory
  if (!devState) devState = seedState;
  return devState;
}

async function persistState(
  kind: StorageKind,
  state: VacationState,
): Promise<void> {
  if (kind === "blob") {
    await writeBlobState(state);
    return;
  }
  if (kind === "file") {
    await writeLocalFileState(state);
    return;
  }
  devState = state;
}

export async function GET() {
  const kind = storageKind();
  try {
    const state = await loadState(kind);
    return NextResponse.json({ state, storage: kind });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const kind = storageKind();
  try {
    const incoming = (await request.json()) as Partial<VacationState>;
    const nextState = normalizeState({ ...incoming, updatedAt: new Date().toISOString() });
    await persistState(kind, nextState);
    return NextResponse.json({ state: nextState, storage: kind });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
