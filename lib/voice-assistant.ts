"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AssistantLanguage,
  ChecklistItem,
  PlanItem,
  TaskDay,
  VacationState,
  VacationTask,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* TYPES                                                              */
/* ------------------------------------------------------------------ */

export type VoiceStatus =
  | "unsupported"
  | "needs-permission"
  | "off"
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "confirming"
  | "applying"
  | "error";

type ResolvedAction =
  | { type: "signup"; taskId: string; taskTitle: string }
  | { type: "unsignup"; taskId: string; taskTitle: string }
  | {
      type: "createTask";
      title: string;
      day: TaskDay;
      needed: number;
      notes: string;
      assignMe: boolean;
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

type Proposal = {
  speech: string;
  needsClarification: boolean;
  actions: unknown[];
};

type AssistOkResponse = {
  ok: true;
  transcript: string;
  proposal: Proposal;
  resolved: ResolvedAction[];
  needsClarification: boolean;
  language: AssistantLanguage;
};

type AssistErrorResponse = {
  error: string;
  message?: string;
};

/* ------------------------------------------------------------------ */
/* LANGUAGE-SPECIFIC CONSTANTS                                        */
/* ------------------------------------------------------------------ */

// IMPORTANT: JavaScript's `\b` only treats [A-Za-z0-9_] as word characters,
// so Hebrew letters NEVER produce a word boundary. We have to assert
// boundaries using non-Hebrew lookbehind/lookahead instead. Without this,
// patterns like /\bכן\b/ would never match the user saying "כן".
const HE = "\u05D0-\u05EA"; // Hebrew letters Aleph..Tav (includes finals)

// Wake-word patterns per language. Includes common Hebrew mistranscriptions
// of "villa" (וילה / ווילה / ויילה etc.) and the various "hey" variants.
const WAKE_PATTERNS_HE: RegExp[] = [
  // "Hey Villa" — accepts הי / היי / אי + flexible "villa" spelling
  new RegExp(`ה[יי]+\\s*ו+י+ל+ה`),
  new RegExp(`אי+\\s*ו+י+ל+ה`),
  new RegExp(`אוקי+\\s*ו+י+ל+ה`),
  // Standalone "villa" with Hebrew-aware word boundaries
  new RegExp(`(?<![${HE}])ו+י+ל+ה(?![${HE}])`),
  // English fallback (sometimes Hebrew STT emits Latin "villa")
  /\bvilla(h?)\b/i,
  /\bhey\s+villa\b/i,
];

const WAKE_PATTERNS_EN: RegExp[] = [
  /\bhey\s+villa\b/i,
  /\bhi\s+villa\b/i,
  /\bok(ay)?\s+villa\b/i,
  /\bvilla\b/i,
];

const YES_PATTERNS_HE: RegExp[] = [
  // Each pattern uses Hebrew-aware non-letter boundaries on both sides so
  // it matches the standalone affirmation but not when it's a prefix of
  // another Hebrew word.
  new RegExp(`(?<![${HE}])כן(?![${HE}])`),
  new RegExp(`(?<![${HE}])אישור(?![${HE}])`),
  new RegExp(`(?<![${HE}])מאשר[תי]?(?![${HE}])`),
  new RegExp(`(?<![${HE}])בסדר(?![${HE}])`),
  new RegExp(`(?<![${HE}])טוב(?![${HE}])`),
  new RegExp(`(?<![${HE}])נכון(?![${HE}])`),
  new RegExp(`(?<![${HE}])אוקיי?(?![${HE}])`),
  new RegExp(`(?<![${HE}])כמובן(?![${HE}])`),
  new RegExp(`(?<![${HE}])בטח(?![${HE}])`),
  new RegExp(`(?<![${HE}])בוודאי(?![${HE}])`),
  new RegExp(`(?<![${HE}])יאללה(?![${HE}])`),
];

const YES_PATTERNS_EN = [
  /\byes\b/i,
  /\byeah\b/i,
  /\byep\b/i,
  /\bok(ay)?\b/i,
  /\bsure\b/i,
  /\bdo\s+it\b/i,
  /\bconfirm(ed)?\b/i,
  /\bgo\s+ahead\b/i,
];

const NO_PATTERNS_HE: RegExp[] = [
  new RegExp(`(?<![${HE}])לא(?![${HE}])`),
  new RegExp(`(?<![${HE}])ביטול(?![${HE}])`),
  new RegExp(`(?<![${HE}])תבטלי?(?![${HE}])`),
  new RegExp(`(?<![${HE}])עזוב(?![${HE}])`),
  new RegExp(`(?<![${HE}])עזבי(?![${HE}])`),
];

const NO_PATTERNS_EN = [
  /\bno\b/i,
  /\bnope\b/i,
  /\bcancel\b/i,
  /\bnever\s+mind\b/i,
  /\bstop\b/i,
];

// How long to wait after the latest speech event before committing the
// captured command. Keep this generous — people often pause mid-thought
// while phrasing a request.
const SILENCE_TIMEOUT_MS = 2800;
const LISTENING_MAX_MS = 14000;
const CONFIRM_MAX_MS = 18000;
const RECOGNITION_WATCHDOG_MS = 1200;
const MIC_PERMISSION_KEY = "villa-mic-permission-granted";

const PROMPTS = {
  he: {
    prompt: "כן?",
    confirmSuffix: "לאשר?",
    applied: "מעולה, נעשה.",
    canceled: "בסדר, ביטלתי.",
    timeout: "ביטלתי כי לא קיבלתי תשובה.",
    didntUnderstand: "לא הבנתי בדיוק. תוכלי לחזור על הבקשה?",
    error: "השרת לא הצליח להבין. בואו ננסה שוב.",
    permissionDenied:
      "האפליקציה לא קיבלה הרשאת מיקרופון. תאשרי אותה בדפדפן כדי להפעיל את העוזרת.",
  },
  en: {
    prompt: "Yes?",
    confirmSuffix: "Confirm?",
    applied: "Done.",
    canceled: "Okay, canceled.",
    timeout: "Canceled because I didn't hear a reply.",
    didntUnderstand: "I didn't catch that. Could you say it again?",
    error: "The server couldn't process that. Let's try again.",
    permissionDenied:
      "The app doesn't have microphone permission. Allow it in your browser to enable the assistant.",
  },
} as const;

function langConfig(lang: AssistantLanguage) {
  return {
    bcp47: lang === "en" ? "en-US" : "he-IL",
    wakePatterns: lang === "en" ? WAKE_PATTERNS_EN : WAKE_PATTERNS_HE,
    yesPatterns: lang === "en" ? YES_PATTERNS_EN : YES_PATTERNS_HE,
    noPatterns: lang === "en" ? NO_PATTERNS_EN : NO_PATTERNS_HE,
    prompts: PROMPTS[lang],
  };
}

/* ------------------------------------------------------------------ */
/* BROWSER SPEECH SHIMS                                               */
/* ------------------------------------------------------------------ */

type MinimalRecognitionEvent = {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
  resultIndex: number;
};

type MinimalRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: MinimalRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getRecognitionCtor(): (new () => MinimalRecognition) | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: new () => MinimalRecognition;
    webkitSpeechRecognition?: new () => MinimalRecognition;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

function hasSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// Voice selection — the browser default voice is usually the worst possible
// option (robotic, low sample rate). Modern OSes ship with much better
// neural/cloud voices and we pick one explicitly here.
//
// Preferences are listed by descending quality. The first available match
// wins. Names checked here are real shipping voices on macOS, iOS, Chrome,
// and Windows as of 2025. Cloud-backed voices (`localService: false`) are
// generally newer/better, so we use that as a tiebreaker.
const VOICE_PREFS: Record<"he" | "en", { exact: string[]; contains: string[] }> =
  {
    he: {
      // Apple ships "Carmit" — clear, natural Hebrew. Chrome on desktop
      // typically has "Google עברית" available. Stam-IL is the legacy
      // Google name. Asaf is a male Hebrew voice on some platforms.
      exact: ["Carmit", "Carmit (Hebrew (Israel))", "Stam-IL", "Asaf"],
      contains: ["google he", "google עברית", "hebrew", "he-il", "carmit"],
    },
    en: {
      // Samantha / Karen are Apple's premium voices. Google's neural
      // voices (Wavenet) are far better than the OS robotic default.
      exact: [
        "Samantha",
        "Karen",
        "Moira",
        "Tessa",
        "Allison",
        "Ava (Premium)",
        "Evan (Enhanced)",
        "Google US English",
        "Google UK English Female",
      ],
      contains: [
        "google us english",
        "google uk english",
        "samantha",
        "karen",
        "siri female",
        "siri male",
        "neural",
      ],
    },
  };

let cachedVoicesByLang: Partial<Record<"he" | "en", SpeechSynthesisVoice | null>> =
  {};
let sharedTtsAudio: HTMLAudioElement | null = null;
let audioUnlocked = false;

function pickVoice(langKey: "he" | "en"): SpeechSynthesisVoice | null {
  if (cachedVoicesByLang[langKey] !== undefined)
    return cachedVoicesByLang[langKey] ?? null;
  if (!hasSpeechSynthesis()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;
  const prefs = VOICE_PREFS[langKey];
  const langPrefix = langKey === "en" ? "en" : "he";
  const candidates = voices.filter((v) =>
    v.lang.toLowerCase().startsWith(langPrefix),
  );
  // Exact name match first
  for (const exact of prefs.exact) {
    const found = candidates.find((v) => v.name === exact);
    if (found) {
      cachedVoicesByLang[langKey] = found;
      return found;
    }
  }
  // Substring match (case-insensitive)
  for (const sub of prefs.contains) {
    const found = candidates.find((v) =>
      v.name.toLowerCase().includes(sub) ||
      v.voiceURI?.toLowerCase().includes(sub),
    );
    if (found) {
      cachedVoicesByLang[langKey] = found;
      return found;
    }
  }
  // Prefer cloud-backed voices when no preferred name matches —
  // localService=false voices are usually higher quality.
  const cloud = candidates.find((v) => !v.localService);
  if (cloud) {
    cachedVoicesByLang[langKey] = cloud;
    return cloud;
  }
  // Fall back to the first voice in the right language at all.
  const fallback = candidates[0] ?? null;
  cachedVoicesByLang[langKey] = fallback;
  return fallback;
}

// Voices are populated asynchronously in some browsers (Chrome). We invalidate
// the cache once when voices first become available so subsequent picks see
// the full list.
if (typeof window !== "undefined" && hasSpeechSynthesis()) {
  const synth = window.speechSynthesis;
  if ("onvoiceschanged" in synth) {
    const handler = () => {
      cachedVoicesByLang = {};
    };
    synth.addEventListener?.("voiceschanged", handler);
    // Some browsers use the property assignment style instead of addEventListener
    synth.onvoiceschanged = handler;
  }
}

function getSharedTtsAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!sharedTtsAudio) {
    sharedTtsAudio = new Audio();
    sharedTtsAudio.preload = "auto";
    sharedTtsAudio.setAttribute("playsinline", "true");
  }
  return sharedTtsAudio;
}

export function unlockVoiceAudio(): void {
  const ctx = getAudioContext();
  if (ctx?.state === "suspended") {
    void ctx.resume().catch(() => {});
  }

  const audio = getSharedTtsAudio();
  if (!audio || audioUnlocked) return;

  // Mobile Safari/Chrome only allow later programmatic playback if a media
  // element has been touched from a real user gesture. Login is a gesture,
  // so prime the exact audio element we will reuse for TTS responses.
  const previousMuted = audio.muted;
  audio.muted = true;
  audio.src =
    "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
  void audio
    .play()
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = previousMuted;
      audioUnlocked = true;
    })
    .catch(() => {
      audio.muted = previousMuted;
    });

  if (hasSpeechSynthesis()) {
    try {
      // Also prime speechSynthesis as a fallback for browsers that still
      // block HTMLAudio later. This utterance is silent/near-empty.
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(" ");
      utterance.volume = 0;
      window.speechSynthesis.speak(utterance);
    } catch {
      // ignore
    }
  }
}

async function speakWithOpenAiAudio(
  text: string,
  lang: string,
): Promise<boolean> {
  const audio = getSharedTtsAudio();
  if (!audio || !text) return false;

  try {
    const response = await fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        language: lang.toLowerCase().startsWith("he") ? "he" : "en",
      }),
    });
    if (!response.ok) return false;

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        audio.onended = null;
        audio.onerror = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        audio.onended = null;
        audio.onerror = null;
        URL.revokeObjectURL(url);
        reject(new Error("Audio playback failed"));
      };
      const timeout = window.setTimeout(finish, Math.min(12000, Math.max(2500, text.length * 120)));

      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      audio.onended = finish;
      audio.onerror = fail;
      audio.src = url;
      audio.play().catch(fail);
    });
    return true;
  } catch {
    return false;
  }
}

async function speakWithBrowserVoice(text: string, lang: string): Promise<void> {
  return new Promise((resolve) => {
    if (!hasSpeechSynthesis() || !text) {
      resolve();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve();
      };
      // iOS/Safari sometimes never fires onend/onerror after cancel/speak
      // races. Never let TTS hold the whole assistant in "speaking".
      const timeout = window.setTimeout(
        finish,
        Math.min(8000, Math.max(1800, text.length * 90)),
      );
      utt.lang = lang;
      const langKey: "he" | "en" = lang.toLowerCase().startsWith("en")
        ? "en"
        : "he";
      const voice = pickVoice(langKey);
      if (voice) utt.voice = voice;
      // Slightly slower + a touch lower pitch sound less robotic than the
      // default settings on most TTS engines.
      utt.rate = 0.98;
      utt.pitch = 1.0;
      utt.volume = 1.0;
      utt.onend = finish;
      utt.onerror = finish;
      window.speechSynthesis.speak(utt);
    } catch {
      resolve();
    }
  });
}

async function speak(text: string, lang: string): Promise<void> {
  if (!text) return;
  // Prefer high-quality server-generated TTS. If mobile autoplay policy,
  // OpenAI, or the network says no, fall back to browser speechSynthesis so
  // the assistant still responds.
  const played = await speakWithOpenAiAudio(text, lang);
  if (!played) await speakWithBrowserVoice(text, lang);
}

// Singleton AudioContext — creating and tearing one down per chime was
// producing audible startup/shutdown clicks on some systems.
let sharedAudioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedAudioCtx) return sharedAudioCtx;
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  try {
    sharedAudioCtx = new Ctx();
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

function chime(
  kind: "wake" | "confirm" | "applied" | "error" | "thinking" | "cancel",
): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);

    const tones: Record<typeof kind, [number, number, number]> = {
      wake: [660, 880, 0.16],
      confirm: [520, 660, 0.14],
      applied: [880, 1100, 0.22],
      error: [220, 180, 0.25],
      // A gentle two-tone "hmm…" for the thinking state — soft, lower
      // pitch, doesn't compete with the user's voice or interrupt flow.
      thinking: [440, 380, 0.22],
      // A short low descent for cancellation — clearly different from
      // the rising "applied" tone so the user knows which path fired.
      cancel: [520, 360, 0.18],
    };
    const [f1, f2, dur] = tones[kind];
    // Tiny lookahead so the envelope is fully scheduled before the
    // oscillator starts. Without this, the very first sample can leak
    // through at full amplitude and produce a click.
    const start = ctx.currentTime + 0.02;
    const attack = 0.025;
    const release = 0.05;
    const peak = 0.11;

    o.type = "sine";
    o.frequency.setValueAtTime(f1, start);
    o.frequency.linearRampToValueAtTime(f2, start + dur * 0.5);

    // Exponential ramps avoid the discontinuity clicks that linear ramps
    // to/from zero produce. We can't hit exact zero with an exponential
    // ramp, so we approach a small epsilon and finish with a tiny linear
    // ramp to silence.
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + attack);
    g.gain.setValueAtTime(peak, start + dur - release);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    g.gain.linearRampToValueAtTime(0, start + dur + 0.01);

    o.start(start);
    o.stop(start + dur + 0.05);
    o.onended = () => {
      try { o.disconnect(); } catch { /* ignore */ }
      try { g.disconnect(); } catch { /* ignore */ }
    };
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* HELPERS                                                            */
/* ------------------------------------------------------------------ */

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function findWakeIndex(
  text: string,
  patterns: RegExp[],
): { index: number; matchEnd: number } | null {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m && m.index !== undefined) {
      return { index: m.index, matchEnd: m.index + m[0].length };
    }
  }
  return null;
}

function rememberMicPermissionGranted(): void {
  try {
    window.localStorage.setItem(MIC_PERMISSION_KEY, "1");
  } catch {
    // Private browsing / storage-disabled environments are fine. The
    // browser-level permission grant still belongs to this origin.
  }
}

function clearRememberedMicPermission(): void {
  try {
    window.localStorage.removeItem(MIC_PERMISSION_KEY);
  } catch {
    // ignore
  }
}

async function getMicrophonePermissionState(): Promise<
  PermissionState | "unsupported"
> {
  if (typeof navigator === "undefined" || !("permissions" in navigator)) {
    return "unsupported";
  }
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return status.state;
  } catch {
    return "unsupported";
  }
}

function summarizeAction(
  action: ResolvedAction,
  lang: AssistantLanguage,
): string {
  if (lang === "en") {
    switch (action.type) {
      case "signup":
        return `Sign up for "${action.taskTitle}"`;
      case "unsignup":
        return `Remove yourself from "${action.taskTitle}"`;
      case "createTask":
        return `Create task "${action.title}" on ${action.day}${
          action.needed > 1 ? `, ${action.needed} people` : ""
        }`;
      case "deleteTask":
        return `Delete task "${action.taskTitle}"`;
      case "markCompleted":
        return action.completed
          ? `Mark "${action.taskTitle}" as done`
          : `Reopen "${action.taskTitle}"`;
      case "addChecklistItems":
        return `Add to "${action.taskTitle}": ${action.items.join(", ")}`;
      case "toggleChecklistItem":
        return action.done
          ? `Check off "${action.itemText}" in "${action.taskTitle}"`
          : `Uncheck "${action.itemText}" in "${action.taskTitle}"`;
      case "appendNotes":
        return `Add a note to "${action.taskTitle}"`;
      case "addPlanItem":
        return `Add to ${action.day} plan: "${action.title}"`;
      case "deletePlanItem":
        return `Remove from plan: "${action.planTitle}"`;
      case "changeTaskDay":
        return `Move "${action.taskTitle}" to ${action.day}`;
      case "addAssignee":
        return `Add ${action.member} to "${action.taskTitle}"`;
      case "removeAssignee":
        return `Remove ${action.member} from "${action.taskTitle}"`;
      case "editTaskTitle":
        return `Rename "${action.oldTitle}" → "${action.newTitle}"`;
      case "setTaskNeeded":
        return `Set "${action.taskTitle}" to need ${action.needed} ${action.needed === 1 ? "person" : "people"}`;
      case "removeChecklistItem":
        return `Remove "${action.itemText}" from "${action.taskTitle}"`;
      case "setNotes":
        return action.notes.trim()
          ? `Replace notes on "${action.taskTitle}"`
          : `Clear notes on "${action.taskTitle}"`;
      case "setLanguage":
        return action.language === "en"
          ? "Switch assistant to English"
          : "Switch assistant to Hebrew";
      case "answer":
        return action.text;
      case "ambiguous":
        return action.reason;
    }
  }
  switch (action.type) {
    case "signup":
      return `להירשם למשימה "${action.taskTitle}"`;
    case "unsignup":
      return `לבטל הרשמה למשימה "${action.taskTitle}"`;
    case "createTask":
      return `להוסיף משימה חדשה "${action.title}" ביום ${action.day}${
        action.needed > 1 ? `, ${action.needed} אנשים` : ""
      }`;
    case "deleteTask":
      return `למחוק את המשימה "${action.taskTitle}"`;
    case "markCompleted":
      return action.completed
        ? `לסמן את "${action.taskTitle}" כהושלמה`
        : `להחזיר את "${action.taskTitle}" כפעילה`;
    case "addChecklistItems":
      return `להוסיף ל"${action.taskTitle}" את הפריטים: ${action.items.join(", ")}`;
    case "toggleChecklistItem":
      return action.done
        ? `לסמן את "${action.itemText}" כבוצע ב"${action.taskTitle}"`
        : `לבטל סימון של "${action.itemText}" ב"${action.taskTitle}"`;
    case "appendNotes":
      return `להוסיף הערה ל"${action.taskTitle}"`;
    case "addPlanItem":
      return `להוסיף לתכנית של ${action.day}: "${action.title}"`;
    case "deletePlanItem":
      return `למחוק מהתכנית: "${action.planTitle}"`;
    case "changeTaskDay":
      return `להעביר את "${action.taskTitle}" ליום ${action.day}`;
    case "addAssignee":
      return `להוסיף את ${action.member} ל"${action.taskTitle}"`;
    case "removeAssignee":
      return `להוריד את ${action.member} מ"${action.taskTitle}"`;
    case "editTaskTitle":
      return `לשנות את שם "${action.oldTitle}" ל"${action.newTitle}"`;
    case "setTaskNeeded":
      return `לקבוע ש"${action.taskTitle}" צריך ${action.needed} אנשים`;
    case "removeChecklistItem":
      return `להסיר "${action.itemText}" מ"${action.taskTitle}"`;
    case "setNotes":
      return action.notes.trim()
        ? `לעדכן את ההערות של "${action.taskTitle}"`
        : `לנקות את ההערות של "${action.taskTitle}"`;
    case "setLanguage":
      return action.language === "en"
        ? "להחליף את העוזרת לאנגלית"
        : "להחליף את העוזרת לעברית";
    case "answer":
      return action.text;
    case "ambiguous":
      return action.reason;
  }
}

function generateChecklistId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------------------------------------------ */
/* APPLY ACTIONS                                                      */
/* ------------------------------------------------------------------ */

function applyActions(
  state: VacationState,
  actions: ResolvedAction[],
  me: string,
): VacationState {
  let tasks = state.tasks;
  let planItems = state.planItems;
  let memberPrefs = state.memberPrefs;
  let members = state.members;

  // Adding an assignee should also promote that name into the canonical
  // members list (if it isn't there already), so the person gets a stable
  // color slot and shows up consistently across the UI and future voice
  // commands. The pre-seeded assignees from the spreadsheet flow through
  // this path naturally the first time the AI references them.
  const ensureMember = (name: string) => {
    const trimmed = name?.trim();
    if (!trimmed) return;
    if (members.includes(trimmed)) return;
    members = [...members, trimmed];
  };

  for (const action of actions) {
    switch (action.type) {
      case "signup":
        tasks = tasks.map((t) =>
          t.id === action.taskId && !t.assignees.includes(me)
            ? t.assignees.length < t.needed
              ? { ...t, assignees: [...t.assignees, me] }
              : t
            : t,
        );
        break;
      case "unsignup":
        tasks = tasks.map((t) =>
          t.id === action.taskId
            ? { ...t, assignees: t.assignees.filter((a) => a !== me) }
            : t,
        );
        break;
      case "createTask": {
        const newTask: VacationTask = {
          id: generateChecklistId("task"),
          title: action.title,
          needed: action.needed,
          day: action.day,
          notes: action.notes,
          assignees: action.assignMe ? [me] : [],
          checklist: [],
          completed: false,
        };
        tasks = [newTask, ...tasks];
        break;
      }
      case "deleteTask":
        tasks = tasks.filter((t) => t.id !== action.taskId);
        break;
      case "markCompleted":
        tasks = tasks.map((t) =>
          t.id === action.taskId ? { ...t, completed: action.completed } : t,
        );
        break;
      case "addChecklistItems": {
        const newItems: ChecklistItem[] = action.items.map((text) => ({
          id: generateChecklistId("item"),
          text,
          done: false,
        }));
        tasks = tasks.map((t) =>
          t.id === action.taskId
            ? { ...t, checklist: [...t.checklist, ...newItems] }
            : t,
        );
        break;
      }
      case "toggleChecklistItem":
        tasks = tasks.map((t) =>
          t.id === action.taskId
            ? {
                ...t,
                checklist: t.checklist.map((item) =>
                  item.id === action.itemId
                    ? { ...item, done: action.done }
                    : item,
                ),
              }
            : t,
        );
        break;
      case "appendNotes":
        tasks = tasks.map((t) =>
          t.id === action.taskId
            ? {
                ...t,
                notes: t.notes
                  ? `${t.notes}\n${action.notes}`
                  : action.notes,
              }
            : t,
        );
        break;
      case "addPlanItem": {
        const planDay = action.day === "לפני" ? "חמישי" : action.day;
        const item: PlanItem = {
          id: generateChecklistId("plan"),
          day: planDay as PlanItem["day"],
          title: action.title,
          startTime: action.startTime,
          endTime: action.endTime,
          location: action.location,
          pricePerPerson: action.pricePerPerson,
          notes: action.notes,
        };
        planItems = [...planItems, item];
        break;
      }
      case "deletePlanItem":
        planItems = planItems.filter((p) => p.id !== action.planId);
        break;
      case "changeTaskDay":
        tasks = tasks.map((t) =>
          t.id === action.taskId ? { ...t, day: action.day } : t,
        );
        break;
      case "addAssignee":
        ensureMember(action.member);
        tasks = tasks.map((t) => {
          if (t.id !== action.taskId) return t;
          if (t.assignees.includes(action.member)) return t;
          // Auto-expand `needed` if necessary so the new assignee fits and
          // the progress bar doesn't read >100%.
          const nextAssignees = [...t.assignees, action.member];
          const nextNeeded = Math.max(t.needed, nextAssignees.length);
          return { ...t, assignees: nextAssignees, needed: nextNeeded };
        });
        break;
      case "removeAssignee":
        tasks = tasks.map((t) =>
          t.id === action.taskId
            ? { ...t, assignees: t.assignees.filter((a) => a !== action.member) }
            : t,
        );
        break;
      case "editTaskTitle":
        tasks = tasks.map((t) =>
          t.id === action.taskId ? { ...t, title: action.newTitle } : t,
        );
        break;
      case "setTaskNeeded":
        tasks = tasks.map((t) =>
          t.id === action.taskId ? { ...t, needed: action.needed } : t,
        );
        break;
      case "removeChecklistItem":
        tasks = tasks.map((t) =>
          t.id === action.taskId
            ? { ...t, checklist: t.checklist.filter((i) => i.id !== action.itemId) }
            : t,
        );
        break;
      case "setNotes":
        tasks = tasks.map((t) =>
          t.id === action.taskId ? { ...t, notes: action.notes } : t,
        );
        break;
      case "setLanguage": {
        // Same shape the page-level `setAssistantLanguage` produces — keeps
        // `memberPrefs[me].language` as the single source of truth, so the
        // language toggle in the orb and a voice "switch to English"
        // command both end up at the exact same place.
        if (!me) break;
        const existing = memberPrefs?.[me]?.language;
        if (existing === action.language) break;
        memberPrefs = {
          ...(memberPrefs ?? {}),
          [me]: { language: action.language },
        };
        break;
      }
      case "answer":
        break;
      case "ambiguous":
        break;
    }
  }

  return { ...state, tasks, planItems, memberPrefs, members };
}

/* ------------------------------------------------------------------ */
/* MAIN HOOK                                                          */
/* ------------------------------------------------------------------ */

export type VoiceAssistantApi = {
  status: VoiceStatus;
  language: AssistantLanguage;
  setLanguage: (lang: AssistantLanguage) => void;
  triggerListen: () => void;
  cancel: () => void;
  confirm: () => void;
  reject: () => void;
  transcript: string;
  proposal: { resolved: ResolvedAction[]; speech: string } | null;
  errorMessage: string | null;
};

export function useVoiceAssistant({
  state,
  me,
  language,
  onApply,
  onLanguageChange,
  active,
}: {
  state: VacationState;
  me: string;
  language: AssistantLanguage;
  onApply: (next: VacationState) => Promise<void> | void;
  onLanguageChange?: (lang: AssistantLanguage) => void;
  // When false (e.g. before login), the assistant stays off.
  active: boolean;
}): VoiceAssistantApi {
  const ctorRef = useRef<(new () => MinimalRecognition) | null>(null);
  const recognitionRef = useRef<MinimalRecognition | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const listeningTimerRef = useRef<number | null>(null);
  const confirmTimerRef = useRef<number | null>(null);

  const statusRef = useRef<VoiceStatus>("off");
  // `interimRef` holds the accumulated FINAL transcripts (what the
  // recognizer has fully committed to). `provisionalRef` holds the latest
  // INTERIM transcript — the live, still-evolving guess. We keep both so
  // we can submit something sensible even when the recognizer ends a
  // session without ever upgrading an interim to a final (which happens
  // surprisingly often in Chrome's continuous mode).
  const interimRef = useRef<string>("");
  const provisionalRef = useRef<string>("");
  // Ref-based indirection so utility callbacks (e.g. setStatusSafe) and
  // async flows (handleWake, onend) can restart recognition without
  // creating circular `useCallback` dependencies. Populated below once
  // `startBackgroundRecognition` is defined.
  const startBgRecRef = useRef<() => void>(() => {});
  const pendingProposalRef = useRef<{
    resolved: ResolvedAction[];
    speech: string;
  } | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const stateRef = useRef(state);
  stateRef.current = state;
  const meRef = useRef(me);
  meRef.current = me;
  const languageRef = useRef<AssistantLanguage>(language);
  languageRef.current = language;
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  const [status, setStatus] = useState<VoiceStatus>("off");
  const [transcript, setTranscript] = useState("");
  const [proposal, setProposal] = useState<{
    resolved: ResolvedAction[];
    speech: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const setStatusSafe = useCallback((next: VoiceStatus) => {
    const prev = statusRef.current;
    statusRef.current = next;
    setStatus(next);

    const prevListens =
      prev === "idle" || prev === "listening" || prev === "confirming";
    const nextListens =
      next === "idle" || next === "listening" || next === "confirming";

    // When leaving any listening-capable state for a state where WE are
    // making sound (thinking/speaking/applying) or have stopped entirely,
    // tear down the mic so the recognizer can't hear our own TTS.
    if (prevListens && !nextListens && recognitionRef.current) {
      try {
        const rec = recognitionRef.current;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    // Whenever we're in a state that needs an open mic, make sure the
    // recognition session is up. We check `!recognitionRef.current` so this
    // is idempotent — it doesn't disturb an already-running session, but it
    // does revive one that was torn down by the silence timer, by an
    // upstream stopRecognition call, or by Chrome ending the session.
    if (nextListens) {
      if (activeRef.current && ctorRef.current && !recognitionRef.current) {
        // Defer to the next macrotask so the caller can finish whatever
        // synchronous teardown it was doing before we try to start.
        window.setTimeout(() => {
          if (
            activeRef.current &&
            !recognitionRef.current &&
            (statusRef.current === "idle" ||
              statusRef.current === "listening" ||
              statusRef.current === "confirming")
          ) {
            startBgRecRef.current();
          }
        }, 80);
      }
    }
  }, []);

  // Detect browser capability once.
  useEffect(() => {
    const ctor = getRecognitionCtor();
    ctorRef.current = ctor;
    if (!ctor) {
      setStatusSafe("unsupported");
    }
  }, [setStatusSafe]);

  const clearTimers = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (listeningTimerRef.current !== null) {
      window.clearTimeout(listeningTimerRef.current);
      listeningTimerRef.current = null;
    }
    if (confirmTimerRef.current !== null) {
      window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, []);

  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.stop();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
  }, []);

  const callAssistAPI = useCallback(
    async (command: string): Promise<void> => {
      const lang = languageRef.current;
      const prompts = PROMPTS[lang];
      const bcp47 = lang === "en" ? "en-US" : "he-IL";

      setStatusSafe("thinking");
      // Audible "thinking" cue — a soft tone so the user knows we heard
      // them and are working on it, rather than going silent until the AI
      // response arrives.
      chime("thinking");
      try {
        const response = await fetch("/api/assist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command,
            state: stateRef.current,
            me: meRef.current,
            language: lang,
          }),
        });
        const data = (await response.json()) as
          | AssistOkResponse
          | AssistErrorResponse;

        if (!response.ok || !("ok" in data) || !data.ok) {
          const message =
            "message" in data && data.message ? data.message : prompts.error;
          setErrorMessage(message);
          setStatusSafe("error");
          chime("error");
          await speak(message, bcp47);
          setStatusSafe(activeRef.current ? "idle" : "off");
          return;
        }

        if (data.needsClarification || data.resolved.length === 0) {
          const message = data.proposal.speech || prompts.didntUnderstand;
          setStatusSafe("speaking");
          await speak(message, bcp47);
          setStatusSafe(activeRef.current ? "idle" : "off");
          return;
        }

        const ambiguous = data.resolved.find((r) => r.type === "ambiguous");
        if (ambiguous && ambiguous.type === "ambiguous") {
          setStatusSafe("speaking");
          await speak(ambiguous.reason, bcp47);
          setStatusSafe(activeRef.current ? "idle" : "off");
          return;
        }

        const readOnlyAnswer =
          data.resolved.length === 1 && data.resolved[0]?.type === "answer"
            ? data.resolved[0]
            : null;
        if (readOnlyAnswer?.type === "answer") {
          const answer = readOnlyAnswer.text.trim() || data.proposal.speech;
          setProposal(null);
          pendingProposalRef.current = null;
          setStatusSafe("speaking");
          await speak(answer, bcp47);
          setTranscript(answer);
          setStatusSafe(activeRef.current ? "idle" : "off");
          return;
        }

        pendingProposalRef.current = {
          resolved: data.resolved,
          speech: data.proposal.speech,
        };
        setProposal(pendingProposalRef.current);

        // Keep the spoken prompt SHORT — the AI's `speech` field is already
        // a one-liner summary that ends with a confirmation question. The
        // user already sees the detailed action list on screen, so don't
        // re-read each step aloud. Only append the confirm suffix if the
        // AI forgot to phrase it as a question.
        const aiSpeech = (data.proposal.speech || "").trim();
        const endsAsQuestion =
          /[?？]$/u.test(aiSpeech) ||
          /(נכון|לאשר|מאשר|מאשרת|אישור|בסדר)\??$/u.test(aiSpeech) ||
          /(confirm|ok|okay|right|yes\?)\s*\??$/i.test(aiSpeech);
        const speechText = endsAsQuestion
          ? aiSpeech
          : `${aiSpeech} ${prompts.confirmSuffix}`;

        chime("confirm");
        setStatusSafe("speaking");
        await speak(speechText, bcp47);
        setStatusSafe("confirming");

        confirmTimerRef.current = window.setTimeout(async () => {
          if (statusRef.current === "confirming") {
            pendingProposalRef.current = null;
            setProposal(null);
            // Mute mic during the timeout TTS by transitioning through
            // "speaking" first.
            setStatusSafe("speaking");
            await speak(prompts.timeout, bcp47);
            setStatusSafe(activeRef.current ? "idle" : "off");
          }
        }, CONFIRM_MAX_MS);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Error");
        setStatusSafe("error");
        chime("error");
        window.setTimeout(
          () => {
            if (statusRef.current === "error") {
              setStatusSafe(activeRef.current ? "idle" : "off");
            }
          },
          1500,
        );
      }
    },
    [setStatusSafe],
  );

  const applyProposal = useCallback(async () => {
    const pending = pendingProposalRef.current;
    if (!pending) return;
    pendingProposalRef.current = null;
    setProposal(null);
    clearTimers();
    setStatusSafe("applying");
    // Acknowledge the "yes" audibly and pause briefly so the interaction
    // doesn't feel like a teleport — the user just spoke; we should give
    // them a beat to register the acknowledgment before we report back.
    chime("applied");
    await new Promise((resolve) => window.setTimeout(resolve, 450));

    const lang = languageRef.current;
    const prompts = PROMPTS[lang];
    const bcp47 = lang === "en" ? "en-US" : "he-IL";
    try {
      const next = applyActions(
        stateRef.current,
        pending.resolved,
        meRef.current,
      );
      await onApplyRef.current(next);
      await speak(prompts.applied, bcp47);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Error");
    }
    setStatusSafe(activeRef.current ? "idle" : "off");
  }, [clearTimers, setStatusSafe]);

  const rejectProposal = useCallback(async () => {
    pendingProposalRef.current = null;
    setProposal(null);
    clearTimers();
    // Transition through "speaking" so the mic is muted while our TTS
    // plays — otherwise the cancellation phrase would echo back into the
    // confirmation matcher.
    setStatusSafe("speaking");
    // Same brief acknowledgement beat as on confirmation — "ok, got the
    // no" before the spoken cancellation lands.
    chime("cancel");
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    const lang = languageRef.current;
    const prompts = PROMPTS[lang];
    const bcp47 = lang === "en" ? "en-US" : "he-IL";
    await speak(prompts.canceled, bcp47);
    setStatusSafe(activeRef.current ? "idle" : "off");
  }, [clearTimers, setStatusSafe]);

  const handleFinalCommand = useCallback(
    (text: string) => {
      const cleaned = text.trim();
      if (!cleaned) {
        setStatusSafe(activeRef.current ? "idle" : "off");
        return;
      }
      setTranscript(cleaned);
      void callAssistAPI(cleaned);
    },
    [callAssistAPI, setStatusSafe],
  );

  // Combines accumulated finals with the latest interim guess. This is the
  // value we submit when the listening phase ends — whether by silence
  // timeout, max-listen safety, or the recognizer terminating early.
  const drainPendingText = useCallback((): string => {
    const text = (interimRef.current + " " + provisionalRef.current)
      .replace(/\s+/g, " ")
      .trim();
    interimRef.current = "";
    provisionalRef.current = "";
    return text;
  }, []);

  const armSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null)
      window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = window.setTimeout(() => {
      const text = drainPendingText();
      stopRecognition();
      clearTimers();
      if (text) handleFinalCommand(text);
      else setStatusSafe(activeRef.current ? "idle" : "off");
    }, SILENCE_TIMEOUT_MS);
  }, [clearTimers, drainPendingText, handleFinalCommand, setStatusSafe, stopRecognition]);

  const armListeningMaxTimer = useCallback(() => {
    if (listeningTimerRef.current !== null) {
      window.clearTimeout(listeningTimerRef.current);
    }
    listeningTimerRef.current = window.setTimeout(() => {
      const text = drainPendingText();
      stopRecognition();
      clearTimers();
      if (text) handleFinalCommand(text);
      else setStatusSafe(activeRef.current ? "idle" : "off");
    }, LISTENING_MAX_MS);
  }, [clearTimers, drainPendingText, handleFinalCommand, setStatusSafe, stopRecognition]);

  /* -------------------- Recognition setup -------------------- */

  // Called when the wake word is detected. Acknowledges the user audibly,
  // then either submits the rest of the utterance immediately (same-breath
  // command) or transitions into command-listening with a freshly-started
  // recognition session.
  //
  // We transition through "speaking" while the "Yes?" prompt plays so that
  // `setStatusSafe` keeps the mic muted — otherwise the TTS would echo
  // back as a phantom command.
  const handleWake = useCallback(
    async (rest: string) => {
      const lang = languageRef.current;
      const cfg = langConfig(lang);

      clearTimers();
      interimRef.current = "";
      provisionalRef.current = "";
      setTranscript("");
      chime("wake");

      // Same-breath command: "Hey Villa, sign me up for catering".
      const trimmedRest = rest.trim();
      if (trimmedRest.length > 0) {
        handleFinalCommand(trimmedRest);
        return;
      }

      // Mute the mic via the "speaking" state, then play the prompt.
      setStatusSafe("speaking");
      await speak(cfg.prompts.prompt, cfg.bcp47);

      // The user (or another flow — cancel button, etc.) may have changed
      // state while we were speaking. Only proceed if we're still in the
      // "speaking" state we set above.
      if (statusRef.current !== "speaking") return;

      // Enter listening; setStatusSafe will start a fresh recognition.
      setStatusSafe("listening");

      // Safety net: if the user never says anything, return to idle. We
      // still drain the buffers in case partial speech was captured.
      armListeningMaxTimer();
    },
    [armListeningMaxTimer, clearTimers, handleFinalCommand, setStatusSafe],
  );

  const startBackgroundRecognition = useCallback(() => {
    void (async () => {
      const Ctor = ctorRef.current;
      if (!Ctor || !activeRef.current) return;

      // Permission itself is controlled by the browser and persisted per
      // HTTPS origin. This preflight keeps us from hammering start() when the
      // user has explicitly denied access, while still letting a prior grant
      // start silently on future visits/devices that support persistent grants.
      const permission = await getMicrophonePermissionState();
      if (permission === "denied") {
        clearRememberedMicPermission();
        setErrorMessage(langConfig(languageRef.current).prompts.permissionDenied);
        setStatusSafe("needs-permission");
        stopRecognition();
        return;
      }

      stopRecognition();
      const lang = languageRef.current;
      const cfg = langConfig(lang);
      const rec = new Ctor();
    rec.lang = cfg.bcp47;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onaudiostart = () => {
      rememberMicPermissionGranted();
    };

    rec.onresult = (event) => {
      rememberMicPermissionGranted();
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) finalText += t;
        else interimText += t;
      }
      const current = statusRef.current;

      if (current === "idle") {
        // Detect wake on FINAL first so we can capture any "rest" the
        // user spoke in the same breath (e.g. "Hey Villa, sign me up").
        if (finalText) {
          const wake = findWakeIndex(finalText, cfg.wakePatterns);
          if (wake) {
            const rest = finalText.slice(wake.matchEnd).trim();
            void handleWake(rest);
            return;
          }
        }
        // Also detect on INTERIM for fast response — Hebrew finals can take
        // a long time to commit. We only trust the rest from a final, so
        // for interim wake we treat it as "wake-only" and start a fresh
        // listening session for whatever the user says next.
        if (interimText) {
          const wake = findWakeIndex(interimText, cfg.wakePatterns);
          if (wake) {
            void handleWake("");
            return;
          }
        }
        return;
      }

      if (current === "listening") {
        // Accumulate finals into `interimRef` and remember the latest
        // provisional interim separately. Both contribute to what we
        // display and to what we submit if the recognizer terminates
        // before producing a fresh final.
        //
        // We arm the silence-commit timer on EVERY speech event, including
        // pure-interim ones. This is safe now because no TTS is playing
        // during the listening phase (we stop recognition during the
        // "Yes?" prompt), so the mic is only hearing the user.
        if (finalText) {
          interimRef.current = (interimRef.current + " " + finalText)
            .replace(/\s+/g, " ")
            .trim();
          provisionalRef.current = "";
        }
        if (interimText) {
          provisionalRef.current = interimText.trim();
        }
        const display = (interimRef.current + " " + provisionalRef.current)
          .replace(/\s+/g, " ")
          .trim();
        if (display) {
          setTranscript(display);
          armSilenceTimer();
        }
        return;
      }

      if (current === "confirming") {
        const text = finalText + " " + interimText;
        if (matchesAny(text, cfg.yesPatterns)) {
          stopRecognition();
          void applyProposal();
        } else if (matchesAny(text, cfg.noPatterns)) {
          stopRecognition();
          void rejectProposal();
        }
      }
    };

    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        clearRememberedMicPermission();
        setErrorMessage(cfg.prompts.permissionDenied);
        setStatusSafe("needs-permission");
        stopRecognition();
      }
    };

    rec.onend = () => {
      recognitionRef.current = null;

      // If we were mid-listening and have a live interim guess, promote
      // it into the accumulated buffer so a partial utterance isn't lost
      // when Chrome's continuous mode ends a session unexpectedly.
      if (statusRef.current === "listening" && provisionalRef.current) {
        interimRef.current = (interimRef.current + " " + provisionalRef.current)
          .replace(/\s+/g, " ")
          .trim();
        provisionalRef.current = "";
      }

      // Mobile browsers often end SpeechRecognition after one utterance
      // without another result event after the user pauses. If we already
      // have buffered text when that happens, arm the normal silence
      // commit timer now so the command cannot sit on screen forever as
      // "listening".
      if (statusRef.current === "listening" && interimRef.current.trim()) {
        armSilenceTimer();
      }

      // Chrome's continuous mode is notoriously flaky — it ends sessions
      // randomly even when continuous=true. We ALWAYS restart in any
      // active listening-capable state, and never commit partial text
      // here. The silence timer is the sole authority on when a command
      // is complete (so a long natural pause commits, but a mid-utterance
      // recognizer hiccup does not lose the user's words).
      if (
        activeRef.current &&
        (statusRef.current === "idle" ||
          statusRef.current === "listening" ||
          statusRef.current === "confirming")
      ) {
        // Restart promptly — the gap is when the user's speech is lost.
        window.setTimeout(() => {
          if (
            activeRef.current &&
            !recognitionRef.current &&
            (statusRef.current === "idle" ||
              statusRef.current === "listening" ||
              statusRef.current === "confirming")
          ) {
            startBgRecRef.current();
          }
        }, 120);
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
    } catch {
      // Already started; ignore.
    }
    })();
  }, [
    applyProposal,
    armSilenceTimer,
    handleFinalCommand,
    handleWake,
    rejectProposal,
    setStatusSafe,
    stopRecognition,
  ]);

  // Keep the ref in sync so async callers (handleWake, onend) always reach
  // the latest closure.
  startBgRecRef.current = startBackgroundRecognition;

  /* -------------------- Lifecycle: auto-arm when active -------------------- */

  useEffect(() => {
    if (!active) {
      clearTimers();
      stopRecognition();
      setStatusSafe("off");
      return;
    }
    if (!ctorRef.current) {
      setStatusSafe("unsupported");
      return;
    }
    setErrorMessage(null);
    setStatusSafe("idle");
    startBackgroundRecognition();
    return () => {
      clearTimers();
      stopRecognition();
    };
  }, [active, clearTimers, setStatusSafe, startBackgroundRecognition, stopRecognition]);

  // Restart recognition when language changes (so STT lang updates).
  useEffect(() => {
    if (!active || !ctorRef.current) return;
    if (statusRef.current === "off" || statusRef.current === "needs-permission")
      return;
    // Restart with new language settings.
    stopRecognition();
    setStatusSafe("idle");
    startBackgroundRecognition();
  }, [active, language, setStatusSafe, startBackgroundRecognition, stopRecognition]);

  // Foolproof re-arm watchdog. SpeechRecognition is fragile on mobile:
  // it can end without firing an error, or `start()` can be ignored after
  // TTS/permission transitions. This lightweight heartbeat guarantees
  // that any active listening-capable state always has a live recognizer
  // again shortly after it disappears.
  useEffect(() => {
    if (!active || !ctorRef.current) return;
    const id = window.setInterval(() => {
      if (!activeRef.current || recognitionRef.current) return;
      if (
        statusRef.current === "idle" ||
        statusRef.current === "listening" ||
        statusRef.current === "confirming"
      ) {
        startBgRecRef.current();
      }
    }, RECOGNITION_WATCHDOG_MS);
    return () => window.clearInterval(id);
  }, [active]);

  /* -------------------- Public API -------------------- */

  const triggerListen = useCallback(() => {
    if (!activeRef.current) return;
    if (statusRef.current === "needs-permission") {
      // Try again to start (gesture-driven re-permission).
      setErrorMessage(null);
      setStatusSafe("idle");
      startBackgroundRecognition();
      return;
    }
    if (statusRef.current !== "idle") return;
    interimRef.current = "";
    provisionalRef.current = "";
    setTranscript("");
    setStatusSafe("listening");
    chime("wake");
    armListeningMaxTimer();
  }, [
    armListeningMaxTimer,
    setStatusSafe,
    startBackgroundRecognition,
  ]);

  const cancel = useCallback(() => {
    pendingProposalRef.current = null;
    setProposal(null);
    interimRef.current = "";
    provisionalRef.current = "";
    setTranscript("");
    clearTimers();
    stopRecognition();
    if (activeRef.current) {
      setStatusSafe("idle");
      startBackgroundRecognition();
    } else {
      setStatusSafe("off");
    }
  }, [clearTimers, setStatusSafe, startBackgroundRecognition, stopRecognition]);

  const confirmExternal = useCallback(() => {
    if (pendingProposalRef.current) void applyProposal();
  }, [applyProposal]);

  const rejectExternal = useCallback(() => {
    if (pendingProposalRef.current) void rejectProposal();
  }, [rejectProposal]);

  const setLanguage = useCallback(
    (lang: AssistantLanguage) => {
      if (onLanguageChange) onLanguageChange(lang);
    },
    [onLanguageChange],
  );

  return useMemo(
    () => ({
      status,
      language,
      setLanguage,
      triggerListen,
      cancel,
      confirm: confirmExternal,
      reject: rejectExternal,
      transcript,
      proposal,
      errorMessage,
    }),
    [
      status,
      language,
      setLanguage,
      triggerListen,
      cancel,
      confirmExternal,
      rejectExternal,
      transcript,
      proposal,
      errorMessage,
    ],
  );
}

export { summarizeAction };
export type { ResolvedAction };
