"use client";

import {
  summarizeAction,
  type ResolvedAction,
  type VoiceStatus,
} from "@/lib/voice-assistant";
import type { AssistantLanguage } from "@/lib/types";

type Props = {
  status: VoiceStatus;
  language: AssistantLanguage;
  transcript: string;
  proposal: { resolved: ResolvedAction[]; speech: string } | null;
  errorMessage: string | null;
  onTriggerListen: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onSetLanguage: (lang: AssistantLanguage) => void;
};

const STATUS_LABELS: Record<
  VoiceStatus,
  { he: string; en: string }
> = {
  unsupported: { he: "הדפדפן לא תומך", en: "Browser not supported" },
  "needs-permission": {
    he: "צריך הרשאת מיקרופון — הקישי על הכדור",
    en: "Microphone permission needed — tap the orb",
  },
  off: { he: "כבוי", en: "Off" },
  idle: { he: 'מאזין ל"היי וילה"', en: 'Listening for "Hey Villa"' },
  listening: { he: "מקליט…", en: "Listening…" },
  thinking: { he: "חושב…", en: "Thinking…" },
  speaking: { he: "מדבר…", en: "Speaking…" },
  confirming: { he: "לאשר?", en: "Confirm?" },
  applying: { he: "מבצע…", en: "Applying…" },
  error: { he: "שגיאה", en: "Error" },
};

const PANEL_COPY = {
  he: {
    title: "מה שעולה לאישור",
    cancel: "לא, ביטול",
    confirm: "כן, לאשר",
    speakNow: "דברי בקול…",
  },
  en: {
    title: "Pending confirmation",
    cancel: "No, cancel",
    confirm: "Yes, confirm",
    speakNow: "Speak now…",
  },
} as const;

export function VoiceOrb(props: Props) {
  const {
    status,
    language,
    transcript,
    proposal,
    errorMessage,
    onTriggerListen,
    onCancel,
    onConfirm,
    onReject,
    onSetLanguage,
  } = props;

  const isInteractive =
    status === "idle" ||
    status === "needs-permission" ||
    status === "listening" ||
    status === "thinking" ||
    status === "speaking" ||
    status === "confirming";

  const handleOrbClick = () => {
    if (status === "needs-permission" || status === "idle") {
      onTriggerListen();
      return;
    }
    if (
      status === "listening" ||
      status === "thinking" ||
      status === "speaking" ||
      status === "confirming"
    ) {
      onCancel();
    }
  };

  const showConfirmPanel = status === "confirming" && proposal !== null;
  const showTranscript =
    status !== "off" &&
    status !== "unsupported" &&
    status !== "needs-permission" &&
    (transcript || status === "listening" || status === "thinking");

  const copy = PANEL_COPY[language];
  const statusLabel = STATUS_LABELS[status][language];

  // The orb is purely feedback while the assistant is in standby — there's
  // no manual interaction needed once voice is armed. Hide the whole dock
  // when nothing is happening, so the rest of the UI doesn't carry extra
  // chrome. It fades back in the instant the assistant wakes / responds /
  // needs the user's attention. We keep it in the DOM so opacity/transform
  // transitions render cleanly, instead of popping.
  const isAmbient = status === "idle" || status === "off";

  return (
    <div
      className={`voice-orb-dock voice-lang-${language}${
        isAmbient ? " voice-hidden" : ""
      }`}
      aria-hidden={isAmbient ? "true" : "false"}
    >
      {showConfirmPanel && proposal ? (
        <div className="voice-panel confirm-panel" role="dialog" aria-live="polite">
          <div className="voice-panel-title">{copy.title}</div>
          <ul className="voice-action-list">
            {proposal.resolved.map((action, idx) => (
              <li
                key={idx}
                className={action.type === "ambiguous" ? "ambiguous" : ""}
              >
                {summarizeAction(action, language)}
              </li>
            ))}
          </ul>
          {proposal.speech ? (
            <div className="voice-panel-speech">{proposal.speech}</div>
          ) : null}
          <div className="voice-panel-actions">
            <button className="btn ghost" onClick={onReject}>
              {copy.cancel}
            </button>
            <button className="btn voice-confirm" onClick={onConfirm}>
              {copy.confirm}
            </button>
          </div>
        </div>
      ) : null}

      {showTranscript && !showConfirmPanel ? (
        <div className="voice-panel transcript-panel" aria-live="polite">
          {transcript ? (
            <div className="voice-transcript">{transcript}</div>
          ) : (
            <div className="voice-transcript dim">{copy.speakNow}</div>
          )}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="voice-panel error-panel">{errorMessage}</div>
      ) : null}

      <div className="voice-orb-row">
        <button
          type="button"
          aria-label={
            isInteractive
              ? language === "he"
                ? "עצירה / הפעלה ידנית"
                : "Stop / manual trigger"
              : statusLabel
          }
          className={`voice-orb voice-state-${status}`}
          onClick={handleOrbClick}
        >
          <span className="orb-core" aria-hidden />
          <span className="orb-ring" aria-hidden />
          <span className="orb-halo" aria-hidden />
          <span className="orb-mic" aria-hidden>
            {status === "off" || status === "unsupported" ? (
              <MicSlashGlyph />
            ) : status === "listening" ? (
              <WaveformGlyph />
            ) : (
              <MicGlyph />
            )}
          </span>
        </button>
        <div className="voice-meta">
          <span className="voice-status-label">{statusLabel}</span>
          <div className="voice-lang-toggle" role="group" aria-label="Language">
            <button
              type="button"
              className={`voice-lang-btn ${language === "he" ? "active" : ""}`}
              onClick={() => onSetLanguage("he")}
              aria-pressed={language === "he"}
            >
              עברית
            </button>
            <button
              type="button"
              className={`voice-lang-btn ${language === "en" ? "active" : ""}`}
              onClick={() => onSetLanguage("en")}
              aria-pressed={language === "en"}
            >
              English
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
      <path
        d="M6 11a6 6 0 0012 0M12 17v4M8 21h8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MicSlashGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <rect
        x="9"
        y="3"
        width="6"
        height="12"
        rx="3"
        fill="currentColor"
        opacity="0.55"
      />
      <path
        d="M6 11a6 6 0 0012 0M12 17v4M8 21h8M4 4l16 16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WaveformGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="5" y1="9" x2="5" y2="15">
          <animate
            attributeName="y1"
            values="10;6;10"
            dur="0.9s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="y2"
            values="14;18;14"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </line>
        <line x1="9.5" y1="6" x2="9.5" y2="18">
          <animate
            attributeName="y1"
            values="7;3;7"
            dur="0.7s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="y2"
            values="17;21;17"
            dur="0.7s"
            repeatCount="indefinite"
          />
        </line>
        <line x1="14.5" y1="4" x2="14.5" y2="20">
          <animate
            attributeName="y1"
            values="5;9;5"
            dur="0.85s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="y2"
            values="19;15;19"
            dur="0.85s"
            repeatCount="indefinite"
          />
        </line>
        <line x1="19" y1="8" x2="19" y2="16">
          <animate
            attributeName="y1"
            values="9;5;9"
            dur="1s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="y2"
            values="15;19;15"
            dur="1s"
            repeatCount="indefinite"
          />
        </line>
      </g>
    </svg>
  );
}
