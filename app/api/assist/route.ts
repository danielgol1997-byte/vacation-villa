import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { findClosestMember } from "@/lib/fuzzy";
import type {
  AssistantLanguage,
  ChecklistItem,
  PlanDay,
  PlanItem,
  TaskDay,
  VacationState,
  VacationTask,
} from "@/lib/types";
import { z } from "zod";

export const runtime = "nodejs";

/* ------------------------------------------------------------------ */
/* SCHEMAS                                                            */
/* ------------------------------------------------------------------ */

const TASK_DAYS = ["לפני", "חמישי", "שישי", "שבת", "ראשון"] as const;
const PLAN_DAYS = ["חמישי", "שישי", "שבת", "ראשון"] as const;

const ACTION_TYPES = [
  "signup",
  "unsignup",
  "createTask",
  "deleteTask",
  "markCompleted",
  "addChecklistItems",
  "toggleChecklistItem",
  "removeChecklistItem",
  "appendNotes",
  "setNotes",
  "addPlanItem",
  "deletePlanItem",
  // Edits to existing tasks (in addition to signup/unsignup which only act
  // on the current speaker). These are critical for "move X to Friday",
  // "add Hadassah to X", "rename X to Y", etc.
  "changeTaskDay",
  "addAssignee",
  "removeAssignee",
  "editTaskTitle",
  "setTaskNeeded",
  // Assistant-level settings (mirrors the orb's HE/EN toggle).
  "setLanguage",
  // Read-only answers. These NEVER require confirmation and must not mutate
  // state — the client just speaks the answer and returns to wake-word mode.
  "answer",
] as const;

// Flat action shape — required by OpenAI structured outputs (no `oneOf`).
// The system prompt instructs the model which fields to populate per type.
// Resolver below validates per-type field presence.
const FlatActionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  taskQuery: z
    .string()
    .describe(
      'Hebrew text fragment identifying an existing task. Required for signup, unsignup, deleteTask, markCompleted, addChecklistItems, toggleChecklistItem, appendNotes. Use "" otherwise.',
    ),
  title: z
    .string()
    .describe(
      'Hebrew title for createTask or addPlanItem. Translate from English when the user spoke English. Use "" otherwise.',
    ),
  day: z
    .enum([...TASK_DAYS, ""] as const)
    .describe(
      'Hebrew day enum for createTask (any of "לפני","חמישי","שישי","שבת","ראשון") or addPlanItem (any of "חמישי","שישי","שבת","ראשון"). Use "" otherwise.',
    ),
  needed: z
    .number()
    .int()
    .min(0)
    .max(20)
    .describe("People needed for createTask. Use 0 for other action types."),
  notes: z
    .string()
    .describe(
      'Hebrew notes for createTask, appendNotes, or addPlanItem. Use "" otherwise.',
    ),
  assignMe: z
    .boolean()
    .describe(
      "true if user wants to sign up to the new task immediately (createTask only). false otherwise.",
    ),
  items: z
    .array(z.string())
    .describe(
      'Hebrew checklist items for addChecklistItems. Use empty array [] otherwise.',
    ),
  itemQuery: z
    .string()
    .describe(
      'Hebrew text identifying which checklist item (toggleChecklistItem only). Use "" otherwise.',
    ),
  done: z
    .boolean()
    .describe(
      "true/false for markCompleted (completed) and toggleChecklistItem (done). Ignored for other types.",
    ),
  startTime: z
    .string()
    .describe('HH:MM start time for addPlanItem, or "" if none.'),
  endTime: z
    .string()
    .describe('HH:MM end time for addPlanItem, or "" if none.'),
  location: z
    .string()
    .describe('Hebrew location for addPlanItem, or "" if none.'),
  pricePerPerson: z
    .number()
    .int()
    .min(0)
    .describe("Price per person for addPlanItem, or 0 if none."),
  planQuery: z
    .string()
    .describe(
      'Hebrew text identifying the plan item to delete (deletePlanItem only). Use "" otherwise.',
    ),
  memberQuery: z
    .string()
    .describe(
      'Name of a family member (Hebrew or English — server fuzzy-matches against the members list) for addAssignee or removeAssignee. Use "" otherwise.',
    ),
  newTitle: z
    .string()
    .describe(
      'New Hebrew title for editTaskTitle. Use "" for other action types.',
    ),
  targetLanguage: z
    .enum(["he", "en", ""] as const)
    .describe(
      'Language code for setLanguage ("he" for Hebrew, "en" for English). Use "" for other action types.',
    ),
  answer: z
    .string()
    .describe(
      'A concise answer for read-only information requests (answer only). Use "" otherwise. Must be in the user\'s preferred spoken language.',
    ),
});

type FlatAction = z.infer<typeof FlatActionSchema>;

const ProposalSchema = z.object({
  speech: z
    .string()
    .describe(
      "A short sentence (under 20 words) spoken back to the user. MUST be in the user's preferred language (Hebrew or English). Conversational, friendly.",
    ),
  needsClarification: z
    .boolean()
    .describe(
      "true when you cannot confidently interpret the request — set actions to [] and ask for clarification in speech.",
    ),
  actions: z
    .array(FlatActionSchema)
    .describe(
      "List of actions to propose (max 5). Empty when needsClarification is true.",
    ),
});

export type AssistAction = FlatAction;
export type AssistProposal = z.infer<typeof ProposalSchema>;

/* ------------------------------------------------------------------ */
/* RESOLVERS                                                          */
/* ------------------------------------------------------------------ */

export type ResolvedAction =
  | { type: "signup"; taskId: string; taskTitle: string }
  | { type: "unsignup"; taskId: string; taskTitle: string }
  | {
      type: "createTask";
      title: string;
      day: TaskDay;
      needed: number;
      notes: string;
      assignMe: boolean;
      assignees: string[];
    }
  | { type: "deleteTask"; taskId: string; taskTitle: string }
  | {
      type: "markCompleted";
      taskId: string;
      taskTitle: string;
      completed: boolean;
    }
  | {
      type: "addChecklistItems";
      taskId: string;
      taskTitle: string;
      items: string[];
    }
  | {
      type: "toggleChecklistItem";
      taskId: string;
      taskTitle: string;
      itemId: string;
      itemText: string;
      done: boolean;
    }
  | {
      type: "appendNotes";
      taskId: string;
      taskTitle: string;
      notes: string;
    }
  | {
      type: "addPlanItem";
      day: TaskDay;
      title: string;
      startTime?: string;
      endTime?: string;
      location?: string;
      pricePerPerson?: number;
      notes?: string;
    }
  | {
      type: "deletePlanItem";
      planId: string;
      planTitle: string;
    }
  | {
      type: "changeTaskDay";
      taskId: string;
      taskTitle: string;
      day: TaskDay;
    }
  | {
      type: "addAssignee";
      taskId: string;
      taskTitle: string;
      member: string;
    }
  | {
      type: "removeAssignee";
      taskId: string;
      taskTitle: string;
      member: string;
    }
  | {
      type: "editTaskTitle";
      taskId: string;
      oldTitle: string;
      newTitle: string;
    }
  | {
      type: "setTaskNeeded";
      taskId: string;
      taskTitle: string;
      needed: number;
    }
  | {
      type: "removeChecklistItem";
      taskId: string;
      taskTitle: string;
      itemId: string;
      itemText: string;
    }
  | {
      type: "setNotes";
      taskId: string;
      taskTitle: string;
      notes: string;
    }
  | {
      type: "setLanguage";
      language: AssistantLanguage;
    }
  | {
      type: "answer";
      text: string;
    }
  | { type: "ambiguous"; reason: string };

function summarizeTasks(tasks: VacationTask[]): string {
  return tasks
    .map((task) => {
      const aliases = taskSearchTerms(task.title).filter((term) => term !== task.title);
      const aliasText = aliases.length ? ` | aliases: ${aliases.join(", ")}` : "";
      return `${task.id} | ${task.day} | ${task.title}${aliasText} | חתום: ${task.assignees.join(", ") || "אף אחד"} (${task.assignees.length}/${task.needed})`;
    })
    .join("\n");
}

async function loadLatestState(request: Request, fallback: VacationState) {
  try {
    const response = await fetch(new URL("/api/state", request.url), {
      cache: "no-store",
    });
    if (!response.ok) return fallback;
    const data = (await response.json()) as { state?: VacationState };
    return data.state ?? fallback;
  } catch {
    return fallback;
  }
}

function summarizePlan(items: PlanItem[]): string {
  return items
    .map(
      (item) =>
        `${item.id} | ${item.day} | ${item.title}${item.startTime ? ` @ ${item.startTime}` : ""}`,
    )
    .join("\n");
}

function taskSearchTerms(title: string): string[] {
  const terms = new Set([title]);
  const lower = title.trim().toLocaleLowerCase();

  // Persisted data is mostly Hebrew, but users may refer back to a just-created
  // "test" task by its English label. Treat common Hebrew/English test words
  // as aliases so "create task test" -> "assign test to X" still resolves.
  if (lower === "בדיקה" || lower === "טסט") terms.add("test");
  if (lower === "test") {
    terms.add("בדיקה");
    terms.add("טסט");
  }

  return Array.from(terms);
}

function resolveTask(query: string, tasks: VacationTask[]): VacationTask | null {
  if (!tasks.length) return null;
  const searchable = tasks.flatMap((task) =>
    taskSearchTerms(task.title).map((term) => ({ task, term })),
  );
  const match = findClosestMember(
    query,
    searchable.map((item) => item.term),
  );
  if (!match) return null;
  if (match.score < 0.45) return null;
  return searchable.find((item) => item.term === match.name)?.task ?? null;
}

function resolvePlan(query: string, items: PlanItem[]): PlanItem | null {
  if (!items.length) return null;
  const titles = items.map((i) => i.title);
  const match = findClosestMember(query, titles);
  if (!match) return null;
  if (match.score < 0.45) return null;
  return items.find((i) => i.title === match.name) ?? null;
}

// The voice assistant can assign tasks to people who have NEVER logged in
// (e.g. names that only appear in the seed data as `task.assignees`).
// `state.members` is only populated on login, so on its own it's an
// incomplete pool. We expand it to the union of everyone the system has
// ever seen: logged-in members + assignees on any task + the speaker
// themself. This makes `addAssignee` / `removeAssignee` actually work
// before everyone in the family has signed in once.
function knownMembersOf(state: VacationState, me: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (name: string) => {
    const trimmed = name?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  for (const member of state.members) push(member);
  for (const task of state.tasks) for (const a of task.assignees) push(a);
  if (me) push(me);
  return out;
}

const MEMBER_ALIASES: Record<string, string[]> = {
  "דניאל": ["daniel"],
  "איתמר": ["itamar", "ittamar"],
  "מיכל": ["michal"],
  "מיכאל": ["michael"],
  "הדסה": ["hadassah", "hadasa"],
  "מורדי": ["mordi", "mordy", "mordechai"],
  "מרלי": ["marli", "marly", "marley"],
  "תהילה": ["tehila", "tehilla"],
  "שירה": ["shira"],
  "נחמה": ["nechama"],
  "אמא": ["ima", "mom", "mother"],
};

function resolveMember(query: string, knownMembers: string[]) {
  const match = findClosestMember(query, knownMembers);
  if (match && match.score >= 0.55) return match.name;

  const normalized = query.toLocaleLowerCase();
  for (const member of knownMembers) {
    const aliases = MEMBER_ALIASES[member] ?? [];
    if (
      normalized.includes(member.toLocaleLowerCase()) ||
      aliases.some((alias) => normalized.includes(alias))
    ) {
      return member;
    }
  }

  return null;
}

function resolveChecklistItem(
  query: string,
  items: ChecklistItem[],
): ChecklistItem | null {
  if (!items.length) return null;
  const titles = items.map((i) => i.text);
  const match = findClosestMember(query, titles);
  if (!match) return null;
  if (match.score < 0.45) return null;
  return items.find((i) => i.text === match.name) ?? null;
}

function ambiguousReason(
  language: AssistantLanguage,
  he: string,
  en: string,
): { type: "ambiguous"; reason: string } {
  return { type: "ambiguous", reason: language === "en" ? en : he };
}

function resolveAction(
  action: AssistAction,
  state: VacationState,
  language: AssistantLanguage,
  me: string,
): ResolvedAction {
  const knownMembers = knownMembersOf(state, me);
  switch (action.type) {
    case "signup": {
      if (!action.taskQuery)
        return ambiguousReason(language, "חסר זיהוי משימה.", "Missing task reference.");
      const task = resolveTask(action.taskQuery, state.tasks);
      if (!task)
        return ambiguousReason(
          language,
          `לא מצאתי משימה שמתאימה ל-"${action.taskQuery}".`,
          `I couldn't find a task matching "${action.taskQuery}".`,
        );
      return { type: "signup", taskId: task.id, taskTitle: task.title };
    }
    case "unsignup": {
      if (!action.taskQuery)
        return ambiguousReason(language, "חסר זיהוי משימה.", "Missing task reference.");
      const task = resolveTask(action.taskQuery, state.tasks);
      if (!task)
        return ambiguousReason(
          language,
          `לא מצאתי משימה שמתאימה ל-"${action.taskQuery}".`,
          `I couldn't find a task matching "${action.taskQuery}".`,
        );
      return { type: "unsignup", taskId: task.id, taskTitle: task.title };
    }
    case "createTask": {
      const day = (TASK_DAYS as readonly string[]).includes(action.day)
        ? (action.day as TaskDay)
        : "לפני";
      const needed = action.needed > 0 ? action.needed : 1;
      return {
        type: "createTask",
        title: action.title,
        day,
        needed,
        notes: action.notes,
        assignMe: action.assignMe,
        assignees: [],
      };
    }
    case "deleteTask": {
      if (!action.taskQuery)
        return ambiguousReason(language, "חסר זיהוי משימה.", "Missing task reference.");
      const task = resolveTask(action.taskQuery, state.tasks);
      if (!task)
        return ambiguousReason(
          language,
          `לא מצאתי משימה למחיקה שמתאימה ל-"${action.taskQuery}".`,
          `I couldn't find a task to delete matching "${action.taskQuery}".`,
        );
      return { type: "deleteTask", taskId: task.id, taskTitle: task.title };
    }
    case "markCompleted": {
      if (!action.taskQuery)
        return ambiguousReason(language, "חסר זיהוי משימה.", "Missing task reference.");
      const task = resolveTask(action.taskQuery, state.tasks);
      if (!task)
        return ambiguousReason(
          language,
          `לא מצאתי משימה לסימון שמתאימה ל-"${action.taskQuery}".`,
          `I couldn't find a task to mark matching "${action.taskQuery}".`,
        );
      return {
        type: "markCompleted",
        taskId: task.id,
        taskTitle: task.title,
        completed: action.done,
      };
    }
    case "addChecklistItems": {
      if (!action.taskQuery || !action.items.length)
        return ambiguousReason(
          language,
          "חסרים פריטים או משימה להוספה.",
          "Missing items or task to add to.",
        );
      const task = resolveTask(action.taskQuery, state.tasks);
      if (!task)
        return ambiguousReason(
          language,
          `לא מצאתי משימה להוספה לרשימה שמתאימה ל-"${action.taskQuery}".`,
          `I couldn't find a task to add items to matching "${action.taskQuery}".`,
        );
      return {
        type: "addChecklistItems",
        taskId: task.id,
        taskTitle: task.title,
        items: action.items,
      };
    }
    case "toggleChecklistItem": {
      if (!action.taskQuery || !action.itemQuery)
        return ambiguousReason(
          language,
          "חסר זיהוי משימה או פריט.",
          "Missing task or item reference.",
        );
      const task = resolveTask(action.taskQuery, state.tasks);
      if (!task)
        return ambiguousReason(
          language,
          `לא מצאתי משימה שמתאימה ל-"${action.taskQuery}".`,
          `I couldn't find a task matching "${action.taskQuery}".`,
        );
      const item = resolveChecklistItem(action.itemQuery, task.checklist);
      if (!item)
        return ambiguousReason(
          language,
          `לא מצאתי פריט ברשימה שמתאים ל-"${action.itemQuery}".`,
          `I couldn't find a checklist item matching "${action.itemQuery}".`,
        );
      return {
        type: "toggleChecklistItem",
        taskId: task.id,
        taskTitle: task.title,
        itemId: item.id,
        itemText: item.text,
        done: action.done,
      };
    }
    case "appendNotes": {
      if (!action.taskQuery || !action.notes)
        return ambiguousReason(
          language,
          "חסרה הערה או משימה.",
          "Missing note or task reference.",
        );
      const task = resolveTask(action.taskQuery, state.tasks);
      if (!task)
        return ambiguousReason(
          language,
          `לא מצאתי משימה שמתאימה ל-"${action.taskQuery}".`,
          `I couldn't find a task matching "${action.taskQuery}".`,
        );
      return {
        type: "appendNotes",
        taskId: task.id,
        taskTitle: task.title,
        notes: action.notes,
      };
    }
    case "addPlanItem": {
      if (!action.title)
        return ambiguousReason(language, "חסרה כותרת לתכנית.", "Missing plan title.");
      const planDay = (PLAN_DAYS as readonly string[]).includes(action.day)
        ? (action.day as (typeof PLAN_DAYS)[number])
        : "חמישי";
      return {
        type: "addPlanItem",
        day: planDay,
        title: action.title,
        startTime: action.startTime || undefined,
        endTime: action.endTime || undefined,
        location: action.location || undefined,
        pricePerPerson: action.pricePerPerson > 0 ? action.pricePerPerson : undefined,
        notes: action.notes || undefined,
      };
    }
    case "deletePlanItem": {
      if (!action.planQuery)
        return ambiguousReason(language, "חסר זיהוי פריט.", "Missing plan reference.");
      const item = resolvePlan(action.planQuery, state.planItems);
      if (!item)
        return ambiguousReason(
          language,
          `לא מצאתי פריט בתכנית שמתאים ל-"${action.planQuery}".`,
          `I couldn't find a plan item matching "${action.planQuery}".`,
        );
      return {
        type: "deletePlanItem",
        planId: item.id,
        planTitle: item.title,
      };
    }
    case "changeTaskDay": {
      if (!action.taskQuery)
        return ambiguousReason(language, "חסר זיהוי משימה.", "Missing task reference.");
      const task = resolveTask(action.taskQuery, state.tasks);
      if (!task)
        return ambiguousReason(
          language,
          `לא מצאתי משימה שמתאימה ל-"${action.taskQuery}".`,
          `I couldn't find a task matching "${action.taskQuery}".`,
        );
      if (!(TASK_DAYS as readonly string[]).includes(action.day))
        return ambiguousReason(
          language,
          "חסר יום יעד תקין למשימה.",
          "Missing a valid target day for the task.",
        );
      return {
        type: "changeTaskDay",
        taskId: task.id,
        taskTitle: task.title,
        day: action.day as TaskDay,
      };
    }
    case "addAssignee": {
      if (!action.taskQuery)
        return ambiguousReason(language, "חסר זיהוי משימה.", "Missing task reference.");
      const task = resolveTask(action.taskQuery, state.tasks);
      if (!task)
        return ambiguousReason(
          language,
          `לא מצאתי משימה שמתאימה ל-"${action.taskQuery}".`,
          `I couldn't find a task matching "${action.taskQuery}".`,
        );
      if (!action.memberQuery)
        return ambiguousReason(language, "חסר שם של חבר משפחה.", "Missing a family member name.");
      // Match against the expanded pool — anyone we've ever seen, not just
      // logged-in users. Otherwise pre-existing seed assignees (Hadassah,
      // Mordechai, etc.) can never be picked because they're not in
      // `state.members` until they personally log in.
      const member = resolveMember(action.memberQuery, knownMembers);
      if (!member)
        return ambiguousReason(
          language,
          `לא מצאתי בן משפחה שמתאים ל-"${action.memberQuery}".`,
          `I couldn't find a family member matching "${action.memberQuery}".`,
        );
      return {
        type: "addAssignee",
        taskId: task.id,
        taskTitle: task.title,
        member,
      };
    }
    case "removeAssignee": {
      if (!action.taskQuery)
        return ambiguousReason(language, "חסר זיהוי משימה.", "Missing task reference.");
      const task = resolveTask(action.taskQuery, state.tasks);
      if (!task)
        return ambiguousReason(
          language,
          `לא מצאתי משימה שמתאימה ל-"${action.taskQuery}".`,
          `I couldn't find a task matching "${action.taskQuery}".`,
        );
      if (!action.memberQuery)
        return ambiguousReason(language, "חסר שם של חבר משפחה.", "Missing a family member name.");
      // Prefer matching against the task's current assignees first — that's
      // the most natural interpretation of "remove X from this task".
      const fromAssignees = resolveMember(action.memberQuery, task.assignees);
      const member = fromAssignees ?? resolveMember(action.memberQuery, knownMembers);
      if (!member)
        return ambiguousReason(
          language,
          `לא מצאתי בן משפחה שמתאים ל-"${action.memberQuery}".`,
          `I couldn't find a family member matching "${action.memberQuery}".`,
        );
      return {
        type: "removeAssignee",
        taskId: task.id,
        taskTitle: task.title,
        member,
      };
    }
    case "editTaskTitle": {
      if (!action.taskQuery)
        return ambiguousReason(language, "חסר זיהוי משימה.", "Missing task reference.");
      const task = resolveTask(action.taskQuery, state.tasks);
      if (!task)
        return ambiguousReason(
          language,
          `לא מצאתי משימה שמתאימה ל-"${action.taskQuery}".`,
          `I couldn't find a task matching "${action.taskQuery}".`,
        );
      const newTitle = action.newTitle.trim();
      if (!newTitle)
        return ambiguousReason(language, "חסר שם חדש למשימה.", "Missing a new title.");
      return {
        type: "editTaskTitle",
        taskId: task.id,
        oldTitle: task.title,
        newTitle,
      };
    }
    case "setTaskNeeded": {
      if (!action.taskQuery)
        return ambiguousReason(language, "חסר זיהוי משימה.", "Missing task reference.");
      const task = resolveTask(action.taskQuery, state.tasks);
      if (!task)
        return ambiguousReason(
          language,
          `לא מצאתי משימה שמתאימה ל-"${action.taskQuery}".`,
          `I couldn't find a task matching "${action.taskQuery}".`,
        );
      if (action.needed <= 0)
        return ambiguousReason(
          language,
          "כמה אנשים צריך?",
          "How many people are needed?",
        );
      return {
        type: "setTaskNeeded",
        taskId: task.id,
        taskTitle: task.title,
        needed: action.needed,
      };
    }
    case "removeChecklistItem": {
      if (!action.taskQuery || !action.itemQuery)
        return ambiguousReason(
          language,
          "חסר זיהוי משימה או פריט.",
          "Missing task or item reference.",
        );
      const task = resolveTask(action.taskQuery, state.tasks);
      if (!task)
        return ambiguousReason(
          language,
          `לא מצאתי משימה שמתאימה ל-"${action.taskQuery}".`,
          `I couldn't find a task matching "${action.taskQuery}".`,
        );
      const item = resolveChecklistItem(action.itemQuery, task.checklist);
      if (!item)
        return ambiguousReason(
          language,
          `לא מצאתי פריט ברשימה שמתאים ל-"${action.itemQuery}".`,
          `I couldn't find a checklist item matching "${action.itemQuery}".`,
        );
      return {
        type: "removeChecklistItem",
        taskId: task.id,
        taskTitle: task.title,
        itemId: item.id,
        itemText: item.text,
      };
    }
    case "setNotes": {
      if (!action.taskQuery)
        return ambiguousReason(language, "חסר זיהוי משימה.", "Missing task reference.");
      const task = resolveTask(action.taskQuery, state.tasks);
      if (!task)
        return ambiguousReason(
          language,
          `לא מצאתי משימה שמתאימה ל-"${action.taskQuery}".`,
          `I couldn't find a task matching "${action.taskQuery}".`,
        );
      // Empty string is allowed — that's the "clear notes" case.
      return {
        type: "setNotes",
        taskId: task.id,
        taskTitle: task.title,
        notes: action.notes ?? "",
      };
    }
    case "setLanguage": {
      const lang = action.targetLanguage;
      if (lang !== "he" && lang !== "en")
        return ambiguousReason(
          language,
          "באיזו שפה תרצי? עברית או אנגלית?",
          "Which language? Hebrew or English?",
        );
      return { type: "setLanguage", language: lang };
    }
    case "answer": {
      const text = action.answer.trim();
      if (!text) {
        return ambiguousReason(
          language,
          "לא מצאתי תשובה ברורה. מה תרצי לדעת?",
          "I could not find a clear answer. What would you like to know?",
        );
      }
      return { type: "answer", text };
    }
  }
}

function resolveActions(
  actions: AssistAction[],
  state: VacationState,
  language: AssistantLanguage,
  me: string,
  command: string,
): ResolvedAction[] {
  const resolved: ResolvedAction[] = [];
  const virtualTasks: VacationTask[] = [...state.tasks];
  const createdByVirtualId = new Map<string, Extract<ResolvedAction, { type: "createTask" }>>();
  const knownMembers = knownMembersOf(state, me);

  for (const action of actions) {
    if (action.type === "addAssignee" && action.taskQuery) {
      const task = resolveTask(action.taskQuery, virtualTasks);
      if (task?.id.startsWith("__created:")) {
        if (!action.memberQuery) {
          resolved.push(
            ambiguousReason(language, "חסר שם של חבר משפחה.", "Missing a family member name."),
          );
          continue;
        }
        const member = resolveMember(action.memberQuery, knownMembers);
        if (!member) {
          resolved.push(
            ambiguousReason(
              language,
              `לא מצאתי בן משפחה שמתאים ל-"${action.memberQuery}".`,
              `I couldn't find a family member matching "${action.memberQuery}".`,
            ),
          );
          continue;
        }
        const createAction = createdByVirtualId.get(task.id);
        if (createAction && !createAction.assignees.includes(member)) {
          createAction.assignees.push(member);
        }
        continue;
      }
    }

    const next = resolveAction(action, { ...state, tasks: virtualTasks }, language, me);
    resolved.push(next);

    if (next.type === "createTask") {
      const virtualId = `__created:${resolved.length}`;
      createdByVirtualId.set(virtualId, next);
      virtualTasks.unshift({
        id: virtualId,
        title: next.title,
        needed: Math.max(next.needed, next.assignees.length || (next.assignMe ? 1 : 0), 1),
        assignees: [
          ...(next.assignMe ? [me] : []),
          ...next.assignees,
        ].filter(Boolean),
        day: next.day,
        notes: next.notes,
        checklist: [],
        completed: false,
      });
    }
  }

  // Model fallback: sometimes it says "create X and assign Itamar" in speech
  // but returns only createTask. Make that deterministic by extracting a known
  // member from the original command whenever assignment intent is present.
  if (/\b(assign|add|give)\b/i.test(command) || /תשבצי?|תוסיף|תוסיפי|שבץ/u.test(command)) {
    const member = resolveMember(command, knownMembers);
    if (member) {
      for (const action of resolved) {
        if (action.type === "createTask" && !action.assignMe && !action.assignees.includes(member)) {
          action.assignees.push(member);
        }
      }
    }
  }

  return resolved;
}

/* ------------------------------------------------------------------ */
/* SYSTEM PROMPT                                                      */
/* ------------------------------------------------------------------ */

function buildSystemPrompt(language: AssistantLanguage, me: string): string {
  const spokenLanguageName = language === "en" ? "English" : "Hebrew";

  return `You are the voice assistant for "Villa 2026", a Hebrew family-vacation app where one extended family signs up for prep tasks before a weekend in a villa in northern Israel.

The current user is "${me || "unknown"}" and their preferred spoken language is ${spokenLanguageName}.

# YOUR JOB
Translate a single spoken request into a list of structured actions on the app state. You only PROPOSE — the client confirms and applies.

Exception: if the user asks a read-only information question ("what am I signed up for?", "who is doing BBQ?", "what is still open?", "what is planned for Friday?"), return exactly one action of type:"answer". That answer is spoken immediately and must NOT ask for confirmation.

# THE GOLDEN RULE: DATA STAYS HEBREW
Every value you write into a data field — \`taskQuery\`, \`title\`, \`items\`, \`notes\`, \`itemQuery\`, \`planQuery\`, \`location\`, \`newTitle\` — MUST be in natural Hebrew. \`memberQuery\` may stay in the user's language (the server fuzzy-matches it against the members list).
Even when the user speaks English, you translate their words to concise Hebrew before placing them in any of these fields. The existing data is all Hebrew and matching depends on it.
Exception: if the user explicitly names a task with a literal label in quotes or wording like "called X" / "named X" and X is not meaningful vacation content, preserve that literal label rather than translating it. For example, "create a task called test" may use title:"test"; if an existing task is already titled "בדיקה", use taskQuery:"בדיקה" when the user later says "test".

Examples of correct translation:
- User (en): "Add me to the shopping list" → type:"signup", taskQuery:"רשימת קניות" (matches an existing Hebrew title).
- User (en): "Create a task: bring sunscreen, 1 person, Friday" → type:"createTask", title:"להביא קרם הגנה", day:"שישי", needed:1.
- User (en): "Add bread and milk to the supermarket list" → type:"addChecklistItems", taskQuery:"רשימת קניות לסופר", items:["לחם","חלב"].
- User (he): "תוסיפי אותי לקייטרינג" → type:"signup", taskQuery:"קייטרינג".

For proper nouns (places, brands), transliterate naturally to Hebrew letters or keep them as-is.

# THE SECOND RULE: SPEAK THE USER'S LANGUAGE
The \`speech\` field is what the assistant SAYS BACK aloud. It MUST be in ${spokenLanguageName}.
- User speaks Hebrew → speech in Hebrew.
- User speaks English → speech in English.
- The data underneath is still Hebrew; speech describes the action in the user's language.

# THIRD RULE: SPEECH IS SHORT; MUTATIONS END IN A CONFIRMATION QUESTION
\`speech\` is what gets read aloud. Keep it under 12 words. State the GENERAL IDEA only — never list each individual action. End with a short confirm prompt like "נכון?" / "OK?" / "confirm?". The user already SEES the detailed actions on screen; the voice just needs the gist.

For type:"answer" only, \`speech\` should be the same as \`answer\`, must answer the question directly, and must NOT include "confirm?", "OK?", "נכון?", or any confirmation wording.

Good speech examples:
- (he) "להוסיף אותך לקייטרינג ולקנייה בסופר, נכון?"
- (he) "להעביר את המנגל לשבת, נכון?"
- (en) "Sign you up for catering, OK?"
- (en) "Move the BBQ to Saturday, confirm?"

Bad speech (DO NOT do this — too long, lists each step):
- ❌ "I will add you to catering. Then I will add bread to the shopping list. Then I will sign you up for cleanup. Confirm?"

# FLAT ACTION SCHEMA
Every action is one object with these fields. Populate ONLY the fields relevant to the chosen \`type\`. For unused fields use these defaults: empty string "" for strings, empty array [] for items, 0 for numbers, false for booleans.

Per-type field guide (all unlisted fields must use their default):
- type:"signup"               → taskQuery (signs up the CURRENT user)
- type:"unsignup"             → taskQuery (unsigns the CURRENT user)
- type:"createTask"           → title, day, needed (>=1), notes (optional), assignMe (optional)
- type:"deleteTask"           → taskQuery
- type:"markCompleted"        → taskQuery, done (true = mark completed, false = reopen)
- type:"addChecklistItems"    → taskQuery, items (non-empty)
- type:"toggleChecklistItem"  → taskQuery, itemQuery, done
- type:"removeChecklistItem"  → taskQuery, itemQuery
- type:"appendNotes"          → taskQuery, notes (APPENDS to existing notes — use for "add a note saying X")
- type:"setNotes"             → taskQuery, notes (REPLACES the entire notes field — use for "change the notes to X" or "clear the notes" with notes="")
- type:"addPlanItem"          → title, day, startTime (optional "HH:MM"), endTime (optional "HH:MM"), location (optional), pricePerPerson (optional, integer ≥ 0), notes (optional)
- type:"deletePlanItem"       → planQuery
- type:"changeTaskDay"        → taskQuery, day (the NEW day)
- type:"addAssignee"          → taskQuery, memberQuery (the OTHER person — for the current speaker, use signup instead)
- type:"removeAssignee"       → taskQuery, memberQuery (the OTHER person — for the current speaker, use unsignup)
- type:"editTaskTitle"        → taskQuery, newTitle (the new Hebrew title)
- type:"setTaskNeeded"        → taskQuery, needed (>=1)
- type:"setLanguage"          → targetLanguage ("he" or "en") — for "switch to English", "תעבירי לעברית"
- type:"answer"               → answer (read-only info question only; no confirmation)

# MATCHING TASKS BY VOICE
- Don't invent tasks. The taskQuery must point at an existing Hebrew title (server fuzzy-matches it).
- Use distinctive Hebrew keywords rather than the full long title — e.g. "קייטרינג", "מנגל סלטים", "סופר".
- If the request is ambiguous between multiple tasks → needsClarification:true, actions:[], explain in speech.

# DAYS
Valid task days: לפני (pre-trip), חמישי (Thursday), שישי (Friday), שבת (Saturday), ראשון (Sunday).
Valid plan-item days: חמישי, שישי, שבת, ראשון.
Default day for new tasks when unspecified: "לפני".
Map English day names: Thursday → "חמישי", Friday → "שישי", Saturday/Shabbat → "שבת", Sunday → "ראשון".
"Pre-trip", "before the trip", "before we go" → "לפני".

# INTENT MAPPING
- "Sign me up", "add me", "I'll do it", "תרשמי אותי", "אני אקח" → signup.
- "Take me off", "unsign me", "תורידי אותי", "תבטלי" → unsignup.
- "Add a task", "create task", "תוסיפי משימה" → createTask.
- "Create a task/card X and assign Hadassah to it" → two actions in this order: createTask for X, then addAssignee with taskQuery equal to X and memberQuery="Hadassah"/"הדסה". The server will merge them into one created card with the assignee.
- "Delete task", "remove task", "תמחקי" → deleteTask.
- "Mark done", "completed", "סיימתי" → markCompleted with done:true.
- "Reopen", "not done" → markCompleted with done:false.
- "Add to the list of X" + items → addChecklistItems on X.
- "Check off X from the Y list", "סמני את X" → toggleChecklistItem with done:true.
- "Uncheck X" → toggleChecklistItem with done:false.
- "Add a note to X", "תוסיפי הערה" → appendNotes.
- "Add to the plan", "תוסיפי לתכנית" → addPlanItem.
- "Remove from the plan", "תמחקי מהתכנית" → deletePlanItem.
- "Move X to Friday", "תעבירי את X לשישי", "X is on Saturday now" → changeTaskDay.
- "Add Hadassah to X", "תוסיפי את הדסה ל-X" → addAssignee with memberQuery="הדסה". If the speaker means themselves, use signup instead.
- "Remove Daniel from X", "תורידי את דניאל מ-X" → removeAssignee. For the speaker themselves, use unsignup.
- "Rename X to Y", "תשני את השם של X ל-Y", "Call it Y instead" → editTaskTitle.
- "X needs 4 people", "צריך עוד 2 ל-X" → setTaskNeeded with the new total count.
- "Remove bread from the shopping list", "תמחקי את הלחם מהרשימה" → removeChecklistItem.
- "Replace the notes with X", "Change the notes to X", "Clear the notes" → setNotes (notes="" to clear).
- "Add a note saying X" → appendNotes (does NOT overwrite existing notes).
- "Switch to English", "Speak English", "תעבירי לאנגלית", "תדברי עברית" → setLanguage with targetLanguage="en" or "he" as appropriate.
- "What am I signed up for?", "מה שלי?", "What still needs volunteers?", "Who is doing BBQ?", "What's planned for Friday?" → answer. Use the provided task/plan context; do NOT create actions and do NOT require confirmation.

# READ-ONLY ANSWERS
Use type:"answer" for questions that only ask for information:
- What tasks am I signed up for / what is mine?
- Who is assigned to a specific task?
- Which tasks still need people?
- What is on the plan for a given day?
- Is a specific task full / done / open?

For answer:
- actions must contain exactly one object with type:"answer"
- answer must be concise and in ${spokenLanguageName}
- speech should equal the answer or be an even shorter version
- needsClarification must be false unless the question is too vague to answer
- NEVER end an answer with a confirmation question

# WHEN TO ASK FOR CLARIFICATION (needsClarification: true)
- Request doesn't match any known action type.
- The taskQuery would be too generic (user said "add me" without naming any task).
- User mentioned multiple competing tasks.
In those cases set actions: [] and use speech to ask a short specific question in ${spokenLanguageName}.

# CONSTANTS
- Max 5 actions per request — enough for "create a card and assign people", but keep focused.
- Speech under 12 words for mutation proposals; read-only answers may be up to 30 words and must not ask for confirmation.
- ${spokenLanguageName} for speech is non-negotiable.
- Hebrew for every data field that lands on a card is non-negotiable.`;
}

/* ------------------------------------------------------------------ */
/* ROUTE                                                              */
/* ------------------------------------------------------------------ */

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error: "missing-key",
        message:
          "חסר OPENAI_API_KEY בסביבת השרת. הוסיפי אותו ל-.env.local כדי להפעיל את העוזרת.",
      },
      { status: 503 },
    );
  }

  let body: {
    command?: string;
    state?: VacationState;
    me?: string;
    language?: AssistantLanguage;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  const command = (body.command ?? "").trim();
  const state = body.state;
  const me = (body.me ?? "").trim();
  const language: AssistantLanguage = body.language === "en" ? "en" : "he";

  if (!command) {
    return NextResponse.json({ error: "empty-command" }, { status: 400 });
  }
  if (!state) {
    return NextResponse.json({ error: "missing-state" }, { status: 400 });
  }

  try {
    const latestState = await loadLatestState(request, state);
    // Hand the model the full known-name pool, not just logged-in members.
    // The fuzzy matcher on the server uses the same expanded pool, so this
    // keeps the two ends consistent: anyone the AI sees in this list IS a
    // valid `memberQuery` value, and the resolver will find them.
    const knownMembers = knownMembersOf(latestState, me);

    const userContext = [
      `Current user: ${me || "unknown"} (preferred language: ${language === "en" ? "English" : "Hebrew"}).`,
      "",
      `Family members (canonical names — use these when picking memberQuery): ${knownMembers.join(", ") || "(none yet)"}`,
      "",
      "Existing tasks (id | day | Hebrew title | signed-up):",
      summarizeTasks(latestState.tasks),
      "",
      "Existing plan items (id | day | title):",
      summarizePlan(latestState.planItems),
      "",
      `User said: "${command}"`,
    ].join("\n");

    const result = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: ProposalSchema,
      system: buildSystemPrompt(language, me),
      prompt: userContext,
      temperature: 0.15,
    });

    const proposal = result.object;
    const resolved = resolveActions(proposal.actions, latestState, language, me, command);

    const hasAmbiguous = resolved.some((r) => r.type === "ambiguous");
    return NextResponse.json({
      ok: true,
      transcript: command,
      proposal,
      resolved,
      needsClarification: proposal.needsClarification || hasAmbiguous,
      language,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "ai-failed",
        message:
          error instanceof Error ? error.message : "Unknown error from OpenAI.",
      },
      { status: 502 },
    );
  }
}
