"use client";

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { findClosestMember, isExactMatch } from "@/lib/fuzzy";
import {
  dayClassMap,
  dayHue,
  dayOrder,
  hueAtIndex,
  makePersonColor,
  personColor,
  planDayOrder,
  progressColor,
  type PersonColor,
} from "@/lib/colors";
import type {
  AssistantLanguage,
  ChecklistItem,
  PlanDay,
  PlanItem,
  TaskDay,
  VacationState,
  VacationTask,
} from "@/lib/types";
import { useVoiceAssistant } from "@/lib/voice-assistant";
import { VoiceOrb } from "./voice-orb";

type ApiResponse = {
  state: VacationState;
  storage: "blob" | "file" | "memory";
};
type Tab = "tasks" | "mine" | "plan";
type DayFilter = "הכל" | TaskDay;

const taskDays: TaskDay[] = [...dayOrder];
const dayFilters: DayFilter[] = ["הכל", ...dayOrder];
const planDays: PlanDay[] = [...planDayOrder];

const FUZZY_THRESHOLD = 0.7;
const STORAGE_KEY = "vacation-name";

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getTaskProgress(task: VacationTask) {
  return Math.min(100, Math.round((task.assignees.length / task.needed) * 100));
}

function getChecklistProgress(items: ChecklistItem[]) {
  if (!items.length) return 0;
  return Math.round((items.filter((item) => item.done).length / items.length) * 100);
}

function formatTimeRange(start?: string, end?: string) {
  if (start && end) return `${start}–${end}`;
  if (start) return start;
  if (end) return `עד ${end}`;
  return "";
}

function getKnownNames(state: VacationState): string[] {
  const set = new Set<string>(state.members);
  for (const task of state.tasks) {
    for (const assignee of task.assignees) {
      set.add(assignee);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "he"));
}

/* ------------------------------------------------------------------ */
/* NAME → COLOR CONTEXT                                               */
/* ------------------------------------------------------------------ */

type NameColorMap = ReadonlyMap<string, PersonColor>;
const NameColorContext = createContext<NameColorMap>(new Map());

function useNameColor(name: string): PersonColor {
  const map = useContext(NameColorContext);
  return map.get(name) ?? personColor(name);
}

function buildNameColorMap(state: VacationState): NameColorMap {
  const order: string[] = [];
  const seen = new Set<string>();

  for (const task of state.tasks) {
    for (const assignee of task.assignees) {
      if (!seen.has(assignee)) {
        seen.add(assignee);
        order.push(assignee);
      }
    }
  }
  for (const member of state.members) {
    if (!seen.has(member)) {
      seen.add(member);
      order.push(member);
    }
  }

  const map = new Map<string, PersonColor>();
  order.forEach((name, index) => {
    map.set(name, makePersonColor(hueAtIndex(index)));
  });
  return map;
}

/* ------------------------------------------------------------------ */
/* CONFIRM DIALOG                                                     */
/* ------------------------------------------------------------------ */

type ConfirmRequest = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
};

function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest;
  onClose: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>{request.title}</h3>
        {request.message ? <p>{request.message}</p> : null}
        <div className="confirm-actions">
          <button className="btn ghost" onClick={onClose}>
            {request.cancelLabel ?? "ביטול"}
          </button>
          <button
            ref={confirmRef}
            className={request.destructive === false ? "btn" : "btn danger"}
            onClick={() => {
              request.onConfirm();
              onClose();
            }}
          >
            {request.confirmLabel ?? "מחיקה"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ROOT                                                               */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [state, setState] = useState<VacationState | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [bootChecked, setBootChecked] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  // Track in-flight writes so background polling doesn't clobber an
  // optimistic local update with stale server data.
  const pendingWritesRef = useRef(0);

  const loadState = useCallback(async () => {
    try {
      setError("");
      const response = await fetch("/api/state", { cache: "no-store" });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error("טעינה נכשלה");
      setState(data.state);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "שגיאה");
    }
  }, []);

  // Background refresh — keeps every device in sync. Skips while a local
  // write is in flight (to avoid overwriting an optimistic update with the
  // pre-write snapshot from the server) and stays silent on error so
  // intermittent network blips don't show angry red banners.
  const refreshState = useCallback(async () => {
    if (pendingWritesRef.current > 0) return;
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as ApiResponse;
      if (pendingWritesRef.current > 0) return;
      setState((prev) => {
        if (!prev) return data.state;
        // Only replace if the server has something newer. updatedAt is
        // refreshed on every PUT so this is a reliable monotonic clock.
        const prevAt = Date.parse(prev.updatedAt || "");
        const nextAt = Date.parse(data.state.updatedAt || "");
        if (Number.isFinite(prevAt) && Number.isFinite(nextAt) && nextAt <= prevAt) {
          return prev;
        }
        return data.state;
      });
    } catch {
      /* swallow: this is best-effort background polling */
    }
  }, []);

  useEffect(() => {
    // Intentionally NOT auto-restoring `me` from localStorage on boot —
    // this is a shared family device scenario (multiple people use the
    // same browser), so every fresh visit should land on the pick / add
    // user screen rather than silently logging you back in as whoever
    // last used the tab. We still write to localStorage in handleLogin
    // so it's available for future "last used" UX if we want it; we just
    // never *read* it to bypass the picker.
    setBootChecked(true);
    void loadState();
  }, [loadState]);

  // Poll every 5 seconds + refresh whenever the tab regains focus or
  // becomes visible again, so phones returning from background catch up
  // immediately.
  useEffect(() => {
    const POLL_MS = 5000;
    const interval = window.setInterval(() => void refreshState(), POLL_MS);
    const onFocus = () => void refreshState();
    const onVisibility = () => {
      if (!document.hidden) void refreshState();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshState]);

  const saveState = useCallback(
    async (nextState: VacationState) => {
      setState(nextState);
      pendingWritesRef.current += 1;
      try {
        const response = await fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextState),
        });
        const data = (await response.json()) as ApiResponse;
        if (!response.ok) throw new Error("השמירה נכשלה");
        setState(data.state);
        setError("");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "שגיאה");
        void loadState();
      } finally {
        pendingWritesRef.current -= 1;
      }
    },
    [loadState],
  );

  const handleLogin = useCallback(
    (name: string, ensureMember = true) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      window.localStorage.setItem(STORAGE_KEY, trimmed);
      setMe(trimmed);
      if (ensureMember && state && !state.members.includes(trimmed)) {
        void saveState({
          ...state,
          members: [...state.members, trimmed],
        });
      }
    },
    [state, saveState],
  );

  const handleLogout = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setMe(null);
  }, []);

  // Rename / delete a member from anywhere in the system. Updates every
  // reference in one shot so the data stays consistent:
  //   - state.members            (canonical list)
  //   - state.tasks[].assignees  (every signed-up reference)
  //   - state.memberPrefs[name]  (language preference)
  // Both operations also clear localStorage if the affected name happened
  // to be the last-used identity, so a stale entry can't auto-login.
  const renameMember = useCallback(
    async (oldName: string, newName: string) => {
      if (!state) return;
      const oldTrim = oldName.trim();
      const newTrim = newName.trim();
      if (!oldTrim || !newTrim || oldTrim === newTrim) return;

      const nextMembers = (() => {
        const list = state.members.map((m) => (m === oldTrim ? newTrim : m));
        return Array.from(new Set(list.filter(Boolean)));
      })();

      const nextTasks = state.tasks.map((task) => {
        if (!task.assignees.includes(oldTrim)) return task;
        const replaced = task.assignees.map((a) => (a === oldTrim ? newTrim : a));
        return { ...task, assignees: Array.from(new Set(replaced)) };
      });

      const nextPrefs = { ...(state.memberPrefs ?? {}) };
      if (nextPrefs[oldTrim]) {
        nextPrefs[newTrim] = nextPrefs[oldTrim];
        delete nextPrefs[oldTrim];
      }

      // If the user happens to be renaming the identity stored in
      // localStorage (e.g. cleaning up their own name after a typo), keep
      // localStorage in sync so a future auto-login feature wouldn't fight us.
      try {
        if (window.localStorage.getItem(STORAGE_KEY) === oldTrim) {
          window.localStorage.setItem(STORAGE_KEY, newTrim);
        }
      } catch {
        // ignore (private browsing / SSR)
      }

      await saveState({
        ...state,
        members: nextMembers,
        tasks: nextTasks,
        memberPrefs: nextPrefs,
      });
    },
    [state, saveState],
  );

  const deleteMember = useCallback(
    async (name: string) => {
      if (!state) return;
      const target = name.trim();
      if (!target) return;

      const nextMembers = state.members.filter((m) => m !== target);
      const nextTasks = state.tasks.map((task) =>
        task.assignees.includes(target)
          ? { ...task, assignees: task.assignees.filter((a) => a !== target) }
          : task,
      );
      const nextPrefs = { ...(state.memberPrefs ?? {}) };
      delete nextPrefs[target];

      try {
        if (window.localStorage.getItem(STORAGE_KEY) === target) {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // ignore
      }

      await saveState({
        ...state,
        members: nextMembers,
        tasks: nextTasks,
        memberPrefs: nextPrefs,
      });
    },
    [state, saveState],
  );

  // Default to English for any user who hasn't explicitly picked a
  // language. Once they tap the language toggle (or say "switch to
  // Hebrew") it gets persisted into memberPrefs and overrides this.
  const assistantLanguage: AssistantLanguage =
    state && me ? state.memberPrefs?.[me]?.language ?? "en" : "en";

  const setAssistantLanguage = useCallback(
    (lang: AssistantLanguage) => {
      if (!state || !me) return;
      const current = state.memberPrefs?.[me]?.language ?? "en";
      if (current === lang) return;
      void saveState({
        ...state,
        memberPrefs: {
          ...(state.memberPrefs ?? {}),
          [me]: { language: lang },
        },
      });
    },
    [me, state, saveState],
  );

  const askConfirm = useCallback((request: ConfirmRequest) => {
    setConfirm(request);
  }, []);

  const nameColorMap = useMemo(
    () => (state ? buildNameColorMap(state) : new Map<string, PersonColor>()),
    [state],
  );

  if (!bootChecked || !state) {
    return (
      <main className="shell center">
        <div className="loader" />
        {error ? <p className="error">{error}</p> : null}
      </main>
    );
  }

  if (!me) {
    return (
      <NameColorContext.Provider value={nameColorMap}>
        <LoginScreen
          state={state}
          onLogin={handleLogin}
          onRenameMember={renameMember}
          onDeleteMember={deleteMember}
          askConfirm={askConfirm}
          error={error}
        />
        {confirm ? (
          <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
        ) : null}
      </NameColorContext.Provider>
    );
  }

  return (
    <NameColorContext.Provider value={nameColorMap}>
      <MainApp
        state={state}
        me={me}
        onSave={saveState}
        onLogout={handleLogout}
        error={error}
        askConfirm={askConfirm}
        assistantLanguage={assistantLanguage}
        onSetAssistantLanguage={setAssistantLanguage}
      />
      {confirm ? (
        <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      ) : null}
    </NameColorContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* LOGIN                                                              */
/* ------------------------------------------------------------------ */

type LoginStage =
  | { kind: "browse" }
  | { kind: "new"; typed: string }
  | { kind: "exact"; typed: string; match: string }
  | { kind: "fuzzy"; typed: string; match: string }
  | { kind: "distinguish"; typed: string }
  | { kind: "rename"; original: string };

function LoginScreen({
  state,
  onLogin,
  onRenameMember,
  onDeleteMember,
  askConfirm,
  error,
}: {
  state: VacationState;
  onLogin: (name: string) => void;
  onRenameMember: (oldName: string, newName: string) => void | Promise<void>;
  onDeleteMember: (name: string) => void | Promise<void>;
  askConfirm: (request: ConfirmRequest) => void;
  error: string;
}) {
  const knownNames = useMemo(() => getKnownNames(state), [state]);
  const [stage, setStage] = useState<LoginStage>({ kind: "browse" });
  const [editMode, setEditMode] = useState(false);
  const [editError, setEditError] = useState("");

  // Exit edit mode automatically when the last member is removed — there's
  // nothing left to edit, and we want to put the user back on the happy path.
  useEffect(() => {
    if (editMode && knownNames.length === 0) {
      setEditMode(false);
      setStage({ kind: "browse" });
    }
  }, [editMode, knownNames.length]);

  function handleSubmitTyped(typed: string) {
    const value = typed.trim();
    if (!value) return;

    const match = findClosestMember(value, knownNames);

    if (match && isExactMatch(value, match.name)) {
      setStage({ kind: "exact", typed: value, match: match.name });
      return;
    }

    if (match && match.score >= FUZZY_THRESHOLD) {
      setStage({ kind: "fuzzy", typed: value, match: match.name });
      return;
    }

    onLogin(value);
  }

  function handleDistinguish(suffix: string) {
    if (stage.kind !== "distinguish") return;
    const cleaned = suffix.trim();
    if (!cleaned) return;
    onLogin(`${stage.typed} ${cleaned}`);
  }

  // Tile actions in edit mode -----------------------------------------------

  function handleTileEdit(name: string) {
    setEditError("");
    setStage({ kind: "rename", original: name });
  }

  function handleTileDelete(name: string) {
    askConfirm({
      title: "למחוק את השם?",
      message: `כל השיבוצים של "${name}" יוסרו מהמשימות.`,
      confirmLabel: "מחיקה",
      onConfirm: () => {
        void onDeleteMember(name);
        // If we were mid-rename of this exact name, get out of that stage.
        if (stage.kind === "rename" && stage.original === name) {
          setStage({ kind: "browse" });
        }
      },
    });
  }

  function handleRenameSubmit(value: string) {
    if (stage.kind !== "rename") return;
    const cleaned = value.trim();
    if (!cleaned) {
      setEditError("השם לא יכול להיות ריק");
      return;
    }
    if (cleaned === stage.original) {
      setStage({ kind: "browse" });
      setEditError("");
      return;
    }
    // Block exact duplicates against anyone else (case-insensitive).
    const duplicate = knownNames.find(
      (n) => n !== stage.original && isExactMatch(n, cleaned),
    );
    if (duplicate) {
      setEditError(`השם "${duplicate}" כבר קיים`);
      return;
    }
    void onRenameMember(stage.original, cleaned);
    setStage({ kind: "browse" });
    setEditError("");
  }

  return (
    <main className="shell login">
      <div className="login-card">
        <header className="login-head">
          <h1>וילה 2026</h1>
          <p>{editMode ? "עריכת שמות" : "מי את/ה?"}</p>
        </header>

        {knownNames.length ? (
          <div className={`member-grid${editMode ? " edit" : ""}`}>
            {knownNames.map((name) => (
              <MemberButton
                key={name}
                name={name}
                editMode={editMode}
                onLogin={onLogin}
                onEdit={handleTileEdit}
                onDelete={handleTileDelete}
              />
            ))}
          </div>
        ) : null}

        {stage.kind === "browse" ? (
          <div className="login-actions">
            {!editMode ? (
              <button
                className="link-btn"
                onClick={() => setStage({ kind: "new", typed: "" })}
              >
                + הוספת שם חדש
              </button>
            ) : null}
            {knownNames.length ? (
              <button
                className="link-btn subtle"
                onClick={() => {
                  setEditMode((prev) => !prev);
                  setEditError("");
                }}
              >
                {editMode ? "סיום עריכה" : "ערוך שמות"}
              </button>
            ) : null}
          </div>
        ) : null}

        {stage.kind === "new" ? (
          <NameForm
            initialValue={stage.typed}
            placeholder="השם שלי"
            submitLabel="המשך"
            onSubmit={handleSubmitTyped}
            onCancel={() => setStage({ kind: "browse" })}
          />
        ) : null}

        {stage.kind === "exact" ? (
          <div className="prompt">
            <p>
              <strong>{stage.match}</strong> כבר רשום/ה.
            </p>
            <div className="prompt-actions">
              <button className="btn" onClick={() => onLogin(stage.match)}>
                זה אני
              </button>
              <button
                className="btn ghost"
                onClick={() => setStage({ kind: "distinguish", typed: stage.typed })}
              >
                אני {stage.typed} אחר/ת
              </button>
            </div>
            <button
              className="link-btn"
              onClick={() => setStage({ kind: "new", typed: stage.typed })}
            >
              חזרה
            </button>
          </div>
        ) : null}

        {stage.kind === "fuzzy" ? (
          <div className="prompt">
            <p>
              התכוונת ל-<strong>{stage.match}</strong>?
            </p>
            <div className="prompt-actions">
              <button className="btn" onClick={() => onLogin(stage.match)}>
                כן
              </button>
              <button className="btn ghost" onClick={() => onLogin(stage.typed)}>
                לא, השם שלי {stage.typed}
              </button>
            </div>
            <button
              className="link-btn"
              onClick={() => setStage({ kind: "new", typed: stage.typed })}
            >
              חזרה
            </button>
          </div>
        ) : null}

        {stage.kind === "distinguish" ? (
          <div className="prompt">
            <p>
              כדי להבדיל, הוסיפי שם משפחה או כינוי קצר אחרי <strong>{stage.typed}</strong>.
            </p>
            <NameForm
              initialValue=""
              placeholder="לדוגמה: ל'"
              submitLabel="המשך"
              onSubmit={handleDistinguish}
              onCancel={() => setStage({ kind: "new", typed: stage.typed })}
            />
          </div>
        ) : null}

        {stage.kind === "rename" ? (
          <div className="prompt">
            <p>
              שינוי שם <strong>{stage.original}</strong>
            </p>
            <NameForm
              initialValue={stage.original}
              placeholder="השם החדש"
              submitLabel="שמירה"
              onSubmit={handleRenameSubmit}
              onCancel={() => {
                setStage({ kind: "browse" });
                setEditError("");
              }}
            />
            {editError ? <p className="error small">{editError}</p> : null}
            <button
              className="link-btn danger"
              onClick={() => handleTileDelete(stage.original)}
            >
              מחיקת השם
            </button>
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
      </div>
    </main>
  );
}

function NameForm({
  initialValue,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(initialValue);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(value);
  }

  return (
    <form className="name-form" onSubmit={handleSubmit}>
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
      />
      <div className="name-form-actions">
        <button type="submit" className="btn">
          {submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className="btn ghost" onClick={onCancel}>
            ביטול
          </button>
        ) : null}
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* MAIN APP                                                           */
/* ------------------------------------------------------------------ */

function MainApp({
  state,
  me,
  onSave,
  onLogout,
  error,
  askConfirm,
  assistantLanguage,
  onSetAssistantLanguage,
}: {
  state: VacationState;
  me: string;
  onSave: (next: VacationState) => Promise<void> | void;
  onLogout: () => void;
  error: string;
  askConfirm: (request: ConfirmRequest) => void;
  assistantLanguage: AssistantLanguage;
  onSetAssistantLanguage: (lang: AssistantLanguage) => void;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("tasks");
  const [dayFilter, setDayFilter] = useState<DayFilter>("הכל");
  const [planDay, setPlanDay] = useState<PlanDay>("חמישי");
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [newTaskDay, setNewTaskDay] = useState<TaskDay>("לפני");
  const [newPlanDay, setNewPlanDay] = useState<PlanDay>("חמישי");

  const activeTask = useMemo(
    () => (activeTaskId ? state.tasks.find((task) => task.id === activeTaskId) ?? null : null),
    [activeTaskId, state.tasks],
  );

  const taskSummary = useMemo(() => {
    const total = state.tasks.length;
    const filled = state.tasks.filter(
      (task) => task.assignees.length >= task.needed,
    ).length;
    const openSlots = state.tasks.reduce(
      (sum, task) => sum + Math.max(task.needed - task.assignees.length, 0),
      0,
    );
    const mine = state.tasks.filter((task) => task.assignees.includes(me)).length;
    return { total, filled, openSlots, mine };
  }, [state.tasks, me]);

  const tasksForTabsTab = useMemo(() => {
    if (dayFilter === "הכל") {
      const dayIndex = new Map<TaskDay, number>();
      dayOrder.forEach((day, index) => dayIndex.set(day, index));
      return [...state.tasks].sort((a, b) => {
        const ai = dayIndex.get(a.day) ?? 99;
        const bi = dayIndex.get(b.day) ?? 99;
        return ai - bi;
      });
    }
    return state.tasks.filter((task) => task.day === dayFilter);
  }, [state.tasks, dayFilter]);

  const myTasks = useMemo(() => {
    const dayIndex = new Map<TaskDay, number>();
    dayOrder.forEach((day, index) => dayIndex.set(day, index));
    return state.tasks
      .filter((task) => task.assignees.includes(me))
      .sort((a, b) => (dayIndex.get(a.day) ?? 99) - (dayIndex.get(b.day) ?? 99));
  }, [state.tasks, me]);

  const planForDay = useMemo(() => {
    const items = state.planItems.filter((item) => item.day === planDay);
    return [...items].sort((a, b) => {
      if (!a.startTime && !b.startTime) return 0;
      if (!a.startTime) return 1;
      if (!b.startTime) return -1;
      return a.startTime.localeCompare(b.startTime);
    });
  }, [state.planItems, planDay]);

  function updateTask(taskId: string, updater: (task: VacationTask) => VacationTask) {
    void onSave({
      ...state,
      tasks: state.tasks.map((task) => (task.id === taskId ? updater(task) : task)),
    });
  }

  function toggleSignup(task: VacationTask) {
    const signed = task.assignees.includes(me);
    if (!signed && task.assignees.length >= task.needed) return;

    updateTask(task.id, (current) => ({
      ...current,
      assignees: signed
        ? current.assignees.filter((assignee) => assignee !== me)
        : [...current.assignees, me],
    }));
  }

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    if (!title) return;

    const needed = Math.max(1, Number(form.get("needed") ?? 1));
    const notes = String(form.get("notes") ?? "").trim();

    const nextTask: VacationTask = {
      id: createId("task"),
      title,
      needed,
      day: newTaskDay,
      notes,
      assignees: [],
      checklist: [],
      completed: false,
    };

    event.currentTarget.reset();
    setShowTaskForm(false);
    setNewTaskDay("לפני");
    void onSave({ ...state, tasks: [nextTask, ...state.tasks] });
  }

  function addPlanItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    if (!title) return;

    const startTime = String(form.get("startTime") ?? "").trim();
    const endTime = String(form.get("endTime") ?? "").trim();
    const location = String(form.get("location") ?? "").trim();
    const priceRaw = String(form.get("pricePerPerson") ?? "").trim();
    const notes = String(form.get("notes") ?? "").trim();

    const item: PlanItem = {
      id: createId("plan"),
      day: newPlanDay,
      title,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      location: location || undefined,
      pricePerPerson: priceRaw ? Number(priceRaw) : undefined,
      notes: notes || undefined,
    };

    event.currentTarget.reset();
    setShowPlanForm(false);
    void onSave({ ...state, planItems: [...state.planItems, item] });
  }

  function deleteTask(taskId: string) {
    setActiveTaskId(null);
    void onSave({
      ...state,
      tasks: state.tasks.filter((task) => task.id !== taskId),
    });
  }

  function deletePlanItem(itemId: string) {
    void onSave({
      ...state,
      planItems: state.planItems.filter((item) => item.id !== itemId),
    });
  }

  function requestDeleteTask(task: VacationTask) {
    askConfirm({
      title: "למחוק את המשימה?",
      message: `"${task.title}" תיעלם לכולם.`,
      onConfirm: () => deleteTask(task.id),
    });
  }

  function requestDeletePlan(item: PlanItem) {
    askConfirm({
      title: "למחוק מהתכנית?",
      message: `"${item.title}" תיעלם מהתכנית.`,
      onConfirm: () => deletePlanItem(item.id),
    });
  }

  const voice = useVoiceAssistant({
    state,
    me,
    language: assistantLanguage,
    active: true,
    onApply: (next) => onSave(next),
    onLanguageChange: onSetAssistantLanguage,
  });

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbar-title">
          <h1>וילה 2026</h1>
          <span className="summary">
            {taskSummary.filled}/{taskSummary.total} · {taskSummary.openSlots} פתוחים
            {taskSummary.mine ? ` · אני: ${taskSummary.mine}` : ""}
          </span>
        </div>
        <WhoButton me={me} onLogout={onLogout} />
      </header>

      <nav className="tabs" aria-label="ניווט">
        {(
          [
            ["tasks", "משימות"],
            ["mine", "שלי"],
            ["plan", "תכנית"],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            className={activeTab === id ? "active" : ""}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error ? <div className="notice">{error}</div> : null}

      {activeTab === "tasks" ? (
        <section className="stack">
          <div className="chips" role="tablist">
            {dayFilters.map((day) => (
              <button
                key={day}
                className={`chip ${dayClassMap[day]} ${dayFilter === day ? "active" : ""}`}
                onClick={() => setDayFilter(day)}
              >
                {day}
              </button>
            ))}
          </div>

          {dayFilter === "הכל" ? (
            <DayGroupedTaskList
              tasks={tasksForTabsTab}
              me={me}
              onOpen={(task) => setActiveTaskId(task.id)}
              onToggleSignup={toggleSignup}
            />
          ) : tasksForTabsTab.length ? (
            <div className="task-list">
              {tasksForTabsTab.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  me={me}
                  onOpen={() => setActiveTaskId(task.id)}
                  onToggleSignup={() => toggleSignup(task)}
                />
              ))}
            </div>
          ) : (
            <div className="empty">אין משימות ביום הזה</div>
          )}

          <div className="add-block">
            <button
              className="add-toggle"
              onClick={() => setShowTaskForm((value) => !value)}
            >
              {showTaskForm ? "סגירה" : "+ משימה חדשה"}
            </button>
            {showTaskForm ? (
              <form className="add-form" onSubmit={addTask}>
                <input name="title" placeholder="כותרת" autoFocus />
                <input
                  name="needed"
                  type="number"
                  min="1"
                  defaultValue="1"
                  placeholder="כמה אנשים"
                  aria-label="כמה אנשים"
                />
                <div className="form-label">יום</div>
                <DayPicker
                  days={taskDays}
                  selected={newTaskDay}
                  onSelect={setNewTaskDay}
                />
                <textarea name="notes" placeholder="הערות" />
                <button type="submit" className="btn">
                  הוספה
                </button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}

      {activeTab === "mine" ? (
        <section className="stack">
          {myTasks.length ? (
            <DayGroupedTaskList
              tasks={myTasks}
              me={me}
              onOpen={(task) => setActiveTaskId(task.id)}
              onToggleSignup={toggleSignup}
            />
          ) : (
            <div className="empty">עדיין לא נרשמת לכלום</div>
          )}
        </section>
      ) : null}

      {activeTab === "plan" ? (
        <section className="stack">
          <div className="chips">
            {planDays.map((day) => (
              <button
                key={day}
                className={`chip ${dayClassMap[day]} ${planDay === day ? "active" : ""}`}
                onClick={() => setPlanDay(day)}
              >
                {day}
              </button>
            ))}
          </div>

          {planForDay.length ? (
            <div className="plan-list">
              {planForDay.map((item) => (
                <PlanCard
                  key={item.id}
                  item={item}
                  onRemove={() => requestDeletePlan(item)}
                />
              ))}
            </div>
          ) : (
            <div className="empty">אין עדיין תכנית ל{planDay}</div>
          )}

          <div className="add-block">
            <button
              className="add-toggle"
              onClick={() => {
                setNewPlanDay(planDay);
                setShowPlanForm((value) => !value);
              }}
            >
              {showPlanForm ? "סגירה" : `+ הוספה ל${planDay}`}
            </button>
            {showPlanForm ? (
              <form className="add-form" onSubmit={addPlanItem}>
                <input name="title" placeholder="מה התכנית" autoFocus />
                <div className="form-label">יום</div>
                <DayPicker
                  days={planDays}
                  selected={newPlanDay}
                  onSelect={setNewPlanDay}
                />
                <div className="grid-2">
                  <input
                    name="startTime"
                    type="time"
                    placeholder="התחלה"
                    aria-label="התחלה"
                  />
                  <input
                    name="endTime"
                    type="time"
                    placeholder="סיום"
                    aria-label="סיום"
                  />
                </div>
                <input name="location" placeholder="מיקום" />
                <input
                  name="pricePerPerson"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="עלות לאדם (₪)"
                />
                <textarea name="notes" placeholder="פרטים" />
                <button type="submit" className="btn">
                  הוספה
                </button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}

      {activeTask ? (
        <TaskModal
          task={activeTask}
          me={me}
          onClose={() => setActiveTaskId(null)}
          onChange={(updater) => updateTask(activeTask.id, updater)}
          onToggleSignup={() => toggleSignup(activeTask)}
          onRequestDelete={() => requestDeleteTask(activeTask)}
        />
      ) : null}

      <VoiceOrb
        status={voice.status}
        language={voice.language}
        transcript={voice.transcript}
        proposal={voice.proposal}
        errorMessage={voice.errorMessage}
        onTriggerListen={voice.triggerListen}
        onCancel={voice.cancel}
        onConfirm={voice.confirm}
        onReject={voice.reject}
        onSetLanguage={voice.setLanguage}
      />
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* DAY PICKER                                                         */
/* ------------------------------------------------------------------ */

function DayPicker<T extends string>({
  days,
  selected,
  onSelect,
}: {
  days: readonly T[];
  selected: T;
  onSelect: (day: T) => void;
}) {
  return (
    <div className="day-picker" role="radiogroup" aria-label="יום">
      {days.map((day) => {
        const cls = dayClassMap[day as keyof typeof dayClassMap] ?? "day-all";
        return (
          <button
            key={day}
            type="button"
            role="radio"
            aria-checked={selected === day}
            className={`chip ${cls} ${selected === day ? "active" : ""}`}
            onClick={() => onSelect(day)}
          >
            {day}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TASK LIST + CARDS                                                  */
/* ------------------------------------------------------------------ */

function DayGroupedTaskList({
  tasks,
  me,
  onOpen,
  onToggleSignup,
}: {
  tasks: VacationTask[];
  me: string;
  onOpen: (task: VacationTask) => void;
  onToggleSignup: (task: VacationTask) => void;
}) {
  return (
    <>
      {dayOrder.map((day) => {
        const items = tasks.filter((task) => task.day === day);
        if (!items.length) return null;
        return (
          <section
            key={day}
            className={`group ${dayClassMap[day]}`}
          >
            <h2>
              <span className="dot" />
              {day}
            </h2>
            <div className="task-list">
              {items.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  me={me}
                  onOpen={() => onOpen(task)}
                  onToggleSignup={() => onToggleSignup(task)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function ProgressBar({
  current,
  needed,
  trackClass,
}: {
  current: number;
  needed: number;
  trackClass?: string;
}) {
  const ratio = needed > 0 ? Math.min(1, current / needed) : 0;
  const percent = Math.round(ratio * 100);
  const colors = progressColor(percent);
  return (
    <div
      className={`progress-track ${trackClass ?? ""}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={needed}
      aria-valuenow={current}
    >
      <div
        className="progress-fill"
        style={{
          width: `${percent}%`,
          background: `linear-gradient(90deg, ${colors.start} 0%, ${colors.end} 100%)`,
          boxShadow: `0 0 14px -2px ${colors.glow}`,
        }}
      />
    </div>
  );
}

function TaskCard({
  task,
  me,
  onOpen,
  onToggleSignup,
}: {
  task: VacationTask;
  me: string;
  onOpen: () => void;
  onToggleSignup: () => void;
}) {
  const signed = task.assignees.includes(me);
  const isFull = task.assignees.length >= task.needed;
  const checklistProgress = getChecklistProgress(task.checklist);
  const hasNotes = task.notes.trim().length > 0;
  const dayCls = dayClassMap[task.day];

  return (
    <article
      className={`task ${dayCls} ${task.completed ? "done" : ""} ${signed ? "mine" : ""} ${isFull && !task.completed ? "full" : ""}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="task-top">
        <h3>{task.title}</h3>
        <div className="badge-row">
          {task.completed ? <span className="pill ok">הושלם</span> : null}
          {!task.completed && isFull ? <span className="pill ok">מלא</span> : null}
        </div>
      </div>

      {!task.completed ? (
        <div className="progress">
          <div className="progress-meta">
            <span>
              {task.assignees.length}/{task.needed}
            </span>
            {!isFull ? <span>חסרים {task.needed - task.assignees.length}</span> : null}
          </div>
          <ProgressBar current={task.assignees.length} needed={task.needed} />
        </div>
      ) : null}

      {task.assignees.length ? (
        <div className="chips-soft">
          {task.assignees.map((assignee) => (
            <NameChip key={assignee} name={assignee} highlight={assignee === me} />
          ))}
        </div>
      ) : null}

      <div className="task-meta">
        {task.checklist.length ? (
          <span className="meta-chip">
            רשימה {task.checklist.filter((item) => item.done).length}/
            {task.checklist.length}
          </span>
        ) : null}
        {hasNotes && !task.checklist.length ? (
          <span className="meta-chip">הערות</span>
        ) : null}
      </div>

      <button
        className={signed ? "btn ghost" : "btn"}
        disabled={!signed && isFull}
        onClick={(event) => {
          event.stopPropagation();
          onToggleSignup();
        }}
      >
        {signed ? "לבטל" : isFull ? "מלא" : "להתנדב"}
      </button>

      {task.checklist.length ? (
        <ProgressBar
          current={task.checklist.filter((item) => item.done).length}
          needed={task.checklist.length}
          trackClass="thin"
        />
      ) : null}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* TASK MODAL                                                         */
/* ------------------------------------------------------------------ */

function TaskModal({
  task,
  me,
  onClose,
  onChange,
  onToggleSignup,
  onRequestDelete,
}: {
  task: VacationTask;
  me: string;
  onClose: () => void;
  onChange: (updater: (task: VacationTask) => VacationTask) => void;
  onToggleSignup: () => void;
  onRequestDelete: () => void;
}) {
  const [notesDraft, setNotesDraft] = useState(task.notes);
  const [newItem, setNewItem] = useState("");
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    setNotesDraft(task.notes);
  }, [task.id, task.notes]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    if (notesDraft === task.notes) return;
    const timeout = window.setTimeout(() => {
      onChange((current) => ({ ...current, notes: notesDraft }));
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [notesDraft, task.notes, onChange]);

  const signed = task.assignees.includes(me);
  const isFull = task.assignees.length >= task.needed;
  const dayCls = dayClassMap[task.day];

  function toggleChecklistItem(itemId: string) {
    onChange((current) => ({
      ...current,
      checklist: current.checklist.map((item) =>
        item.id === itemId ? { ...item, done: !item.done } : item,
      ),
    }));
  }

  function removeChecklistItem(itemId: string) {
    onChange((current) => ({
      ...current,
      checklist: current.checklist.filter((item) => item.id !== itemId),
    }));
  }

  function submitNewItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = newItem.trim();
    if (!value) return;
    const item: ChecklistItem = {
      id: createId("item"),
      text: value,
      done: false,
    };
    setNewItem("");
    onChange((current) => ({
      ...current,
      checklist: [...current.checklist, item],
    }));
  }

  function toggleCompleted() {
    onChange((current) => ({ ...current, completed: !current.completed }));
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`modal ${dayCls}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-head">
          <div>
            <span className="day-tag">{task.day}</span>
            <h2 className={task.completed ? "strike" : undefined}>{task.title}</h2>
          </div>
          <button className="icon-btn lg" aria-label="סגירה" onClick={onClose}>
            ×
          </button>
        </header>

        <section className="modal-section">
          <div className="modal-actions">
            <button
              className={signed ? "btn ghost" : "btn"}
              disabled={!signed && isFull}
              onClick={onToggleSignup}
            >
              {signed ? "לבטל הרשמה" : isFull ? "מלא" : "להתנדב"}
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={task.completed}
                onChange={toggleCompleted}
              />
              <span>סומן כסיימו</span>
            </label>
          </div>

          <div className="progress">
            <div className="progress-meta">
              <span>
                {task.assignees.length}/{task.needed}
              </span>
              {!isFull ? (
                <span>חסרים {task.needed - task.assignees.length}</span>
              ) : null}
            </div>
            <ProgressBar current={task.assignees.length} needed={task.needed} />
          </div>

          {task.assignees.length ? (
            <div className="chips-soft">
              {task.assignees.map((assignee) => (
                <NameChip
                  key={assignee}
                  name={assignee}
                  highlight={assignee === me}
                />
              ))}
            </div>
          ) : (
            <p className="muted small">אין עדיין מתנדבים</p>
          )}
        </section>

        <section className="modal-section">
          <h3>הערות</h3>
          <textarea
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            placeholder="כל מי שפותח/ת רואה את ההערות"
          />
        </section>

        <section className="modal-section">
          <div className="checklist-head">
            <h3>רשימה</h3>
            {task.checklist.length ? (
              <span className="small muted">
                {task.checklist.filter((item) => item.done).length}/
                {task.checklist.length}
              </span>
            ) : null}
          </div>

          {task.checklist.length ? (
            <ul className="checklist">
              {task.checklist.map((item) => (
                <li key={item.id} className={item.done ? "done" : undefined}>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggleChecklistItem(item.id)}
                    />
                    <span>{item.text}</span>
                  </label>
                  <button
                    className="icon-btn"
                    aria-label="הסרה"
                    onClick={() => removeChecklistItem(item.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {task.checklist.length ? (
            <ProgressBar
              current={task.checklist.filter((item) => item.done).length}
              needed={task.checklist.length}
              trackClass="thin"
            />
          ) : null}

          <form className="checklist-form" onSubmit={submitNewItem}>
            <input
              value={newItem}
              onChange={(event) => setNewItem(event.target.value)}
              placeholder="פריט חדש..."
            />
            <button type="submit" className="btn">
              הוספה
            </button>
          </form>
        </section>

        <section className="modal-section subtle">
          <button className="danger-link" onClick={onRequestDelete}>
            מחק משימה
          </button>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PLAN                                                               */
/* ------------------------------------------------------------------ */

function PlanCard({ item, onRemove }: { item: PlanItem; onRemove: () => void }) {
  const time = formatTimeRange(item.startTime, item.endTime);
  const dayCls = dayClassMap[item.day];
  return (
    <article className={`plan ${dayCls}`}>
      <div className="plan-top">
        <h3>{item.title}</h3>
        <button className="icon-btn" aria-label="מחיקה" onClick={onRemove}>
          ×
        </button>
      </div>
      <div className="plan-meta">
        <span className="day-tag">{item.day}</span>
        {time ? <span>{time}</span> : null}
        {item.location ? <span>{item.location}</span> : null}
        {typeof item.pricePerPerson === "number" ? (
          <span className="price">₪{item.pricePerPerson} לאדם</span>
        ) : null}
      </div>
      {item.notes ? <p className="muted">{item.notes}</p> : null}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* HELPERS                                                            */
/* ------------------------------------------------------------------ */

function personChipStyle(color: PersonColor) {
  return {
    background: color.bg,
    borderColor: color.border,
    color: color.text,
  } as const;
}

function NameChip({
  name,
  highlight,
}: {
  name: string;
  highlight?: boolean;
}) {
  const color = useNameColor(name);
  return (
    <span
      className={highlight ? "highlight" : undefined}
      style={personChipStyle(color)}
    >
      {name}
    </span>
  );
}

function MemberButton({
  name,
  editMode = false,
  onLogin,
  onEdit,
  onDelete,
}: {
  name: string;
  editMode?: boolean;
  onLogin: (name: string) => void;
  onEdit?: (name: string) => void;
  onDelete?: (name: string) => void;
}) {
  const color = useNameColor(name);
  // In edit mode the body opens a rename form and the corner × deletes;
  // outside edit mode the whole tile is a one-tap login.
  return (
    <div className={`member-cell${editMode ? " editing" : ""}`}>
      <button
        className="member"
        style={personChipStyle(color)}
        onClick={() => (editMode ? onEdit?.(name) : onLogin(name))}
        aria-label={editMode ? `שינוי השם ${name}` : `כניסה בשם ${name}`}
      >
        {name}
      </button>
      {editMode ? (
        <button
          type="button"
          className="member-delete"
          aria-label={`מחיקת ${name}`}
          onClick={(event) => {
            // Stop bubbling so the parent .member-cell or rename trigger
            // doesn't fire alongside the delete confirmation.
            event.stopPropagation();
            onDelete?.(name);
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function WhoButton({ me, onLogout }: { me: string; onLogout: () => void }) {
  const color = useNameColor(me);
  return (
    <button className="who" style={personChipStyle(color)} onClick={onLogout}>
      <span>{me}</span>
      <small>החלפה</small>
    </button>
  );
}

// Silence unused-import warning during refactor when hue helper is unused.
void dayHue;
