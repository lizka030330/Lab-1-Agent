/**
 * POST /api/multimodal (Лаб. 4, крок 05) — multipart/form-data:
 *   question   — питання (обовʼязково)
 *   file       — зображення або PDF (необовʼязково; без файлу — «текстова база» для прогнозу токенів)
 *   voice=1    — додати озвучену відповідь (generateSpeech)
 *   roundtrip  — текст для перевірки «мовлення → транскрипція» (generateSpeech → transcribe)
 * Ліміт перевіряється тут ТІЄЮ САМОЮ константою, що й у браузері (src/multimodal/limits.ts);
 * понад 4,5 MB тіла сюди не дійде нічого — платформа віддасть 413 FUNCTION_PAYLOAD_TOO_LARGE раніше.
 */
import { after } from 'next/server';

import { recordUsage, type Feature } from '@/src/budget';
import { guard } from '@/src/guard';
import { askAboutFile } from '@/src/multimodal/ask';
import { MAX_BYTES } from '@/src/multimodal/limits';
import { listen, speak, wordRecall } from '@/src/multimodal/speak';
import { langfuseSpanProcessor } from '@/src/otel/langfuse';
import { newTaskId, withTaskSpan } from '@/src/telemetry';

export const runtime = 'nodejs';
export const maxDuration = 60;

const FORM_OVERHEAD = 64 * 1024;

export async function POST(req: Request) {
  after(async () => {
    await langfuseSpanProcessor.forceFlush(); // процес функції завершується з відповіддю — спани треба дослати
  });
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_BYTES + FORM_OVERHEAD) {
    return Response.json({ ok: false, reason: 'size', message: `Запит ${(len / 1e6).toFixed(1)} МБ — більше за ліміт ${(MAX_BYTES / 1e6).toFixed(1)} МБ (перевірка на сервері).` }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, reason: 'form', message: 'Очікую multipart/form-data.' }, { status: 400 });
  }
  // Крок 06: брама ДО будь-якого виклику моделі. TTS/STT — окремі лічильники: їхня квота (10 RPM / 100 RPD) найвужча.
  const rtField = form.get('roundtrip');
  const isRoundtrip = typeof rtField === 'string' && rtField.trim() !== '';
  const features: Feature[] = isRoundtrip ? ['tts', 'stt'] : form.get('voice') === '1' ? ['vision', 'tts'] : ['vision'];
  const gate = await guard(features);
  if (!gate.ok) return gate.response;
  const taskId = newTaskId('mm');
  return withTaskSpan('lab4-multimodal', taskId, (traceId) => handle(form, gate.store, taskId, traceId));
}

async function handle(form: FormData, store: Parameters<typeof recordUsage>[0], taskId: string, traceId: string | null): Promise<Response> {
  const ids = { task_id: taskId, trace_id: traceId };
  const t0 = performance.now();
  try {
    const rt = form.get('roundtrip');
    if (typeof rt === 'string' && rt.trim()) {
      const text = rt.slice(0, 500);
      const tts = await speak(text, taskId);
      const stt = await listen(Buffer.from(tts.base64, 'base64'), taskId);
      return Response.json({ ok: true, ...ids, mode: 'roundtrip', original: text, transcript: stt.text, recall: wordRecall(text, stt.text), tts: { mediaType: tts.mediaType, format: tts.format, bytes: tts.bytes, ms: tts.ms }, stt: { language: stt.language, durationSec: stt.durationSec, ms: stt.ms }, ms: Math.round(performance.now() - t0) });
    }

    const question = String(form.get('question') ?? '');
    const file = form.get('file');
    const bytes = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null;
    const declared = file instanceof File ? file.type : '';
    const r = await askAboutFile({ bytes, declared, question, taskId, ...(file instanceof File ? { filename: file.name } : {}) });
    if (!r.ok) return Response.json({ ...r, ...ids }, { status: r.reason === 'size' ? 413 : 415 });
    // TTS/STT не звітують LanguageModelUsage — рахуються окремими лічильниками запитів (admit), не токенами
    await recordUsage(store, { inputTokens: r.inputTokens, outputTokens: r.outputTokens }).catch(() => undefined);

    const voice = form.get('voice') === '1' ? await speak(r.answer, taskId) : null;
    return Response.json({ ...r, ...ids, voice, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    return Response.json({ ok: false, ...ids, reason: 'model', message: e instanceof Error ? e.message.slice(0, 300) : String(e) }, { status: 502 });
  }
}
