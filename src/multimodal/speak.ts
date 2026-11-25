/**
 * Вихід (Лаб. 4, крок 05): асистент відповідає ГОЛОСОМ — generateSpeech; transcribe — для перевірки round-trip.
 * Обидві функції в ai@7 НЕ експериментальні; experimental_* — застарілі аліаси.
 * Моделі — з переліку провайдера @ai-sdk/google 4.0.87: gemini-3.8-flash-tts і gemini-3.5-transcribe.
 * voice / outputFormat / language не задаю: допустимих значень курс не називає — дивлюсь, що повертає типово.
 */
import { google } from '@ai-sdk/google';
import { generateSpeech, transcribe } from 'ai';

export const TTS_MODEL = 'gemini-3.8-flash-tts';
export const STT_MODEL = 'gemini-3.5-transcribe';

export async function speak(text: string) {
  const t0 = performance.now();
  const res = await generateSpeech({ model: google.speech(TTS_MODEL), text });
  return { base64: res.audio.base64, mediaType: res.audio.mediaType, format: res.audio.format, bytes: res.audio.uint8Array.byteLength, warnings: res.warnings.length, ms: Math.round(performance.now() - t0) };
}

export async function listen(audio: Uint8Array) {
  const t0 = performance.now();
  const res = await transcribe({ model: google.transcription(STT_MODEL), audio });
  return { text: res.text, language: res.language ?? null, durationSec: res.durationInSeconds ?? null, ms: Math.round(performance.now() - t0) };
}

/** Схожість тексту для round-trip: частка слів оригіналу, що є в транскрипті (без регістру й розділових знаків). */
export function wordRecall(original: string, transcript: string): number {
  const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const src = words(original);
  const got = new Set(words(transcript));
  return src.length ? src.filter((w) => got.has(w)).length / src.length : 0;
}
