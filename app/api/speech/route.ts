import { NextResponse } from "next/server";
import type { AssistantLanguage } from "@/lib/types";

export const runtime = "nodejs";

const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "nova";

type SpeechRequest = {
  text?: string;
  language?: AssistantLanguage;
};

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "missing-key" }, { status: 503 });
  }

  let body: SpeechRequest;
  try {
    body = (await request.json()) as SpeechRequest;
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "empty-text" }, { status: 400 });
  }

  // Keep accidental long answers from burning latency/cost. The assistant's
  // spoken copy is intentionally short; this is just a guardrail.
  const input = text.slice(0, 900);
  const language = body.language === "he" ? "Hebrew" : "English";

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input,
      response_format: "mp3",
      instructions:
        language === "Hebrew"
          ? "Speak warm, natural Hebrew. Keep it friendly and concise, like a helpful family assistant."
          : "Speak warm, natural English. Keep it friendly and concise, like a helpful family assistant.",
    }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    return NextResponse.json(
      { error: "tts-failed", message: message.slice(0, 500) },
      { status: 502 },
    );
  }

  const audio = await response.arrayBuffer();
  return new NextResponse(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
