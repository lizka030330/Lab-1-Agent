/**
 * POST /api/multimodal (Лаб. 4, крок 05) — multipart/form-data:
 *   question   — питання (обовʼязково)
 *   file       — зображення або PDF (необовʼязково; без файлу — «текстова база» для прогнозу токенів)
 *   voice=1    — додати озвучену відповідь (generateSpeech)
 *   roundtrip  — текст для перевірки «мовлення → транскрипція» (generateSpeech → transcribe)
 * Ліміт перевіряється тут ТІЄЮ САМОЮ константою, що й у браузері (src/multimodal/limits.ts);
 * понад 4,5 MB тіла сюди не дійде нічого — платформа віддасть 413 FUNCTION_PAYLOAD_TOO_LARGE раніше.
 */
import { askAboutFile } from '@/src/multimodal/ask';
import { MAX_BYTES } from '@/src/multimodal/limits';
import { listen, speak, wordRecall } from '@/src/multimodal/speak';

export const runtime = 'nodejs';
export const maxDuration = 60;

const FORM_OVERHEAD = 64 * 1024;

export async function POST(req: Request) {
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
  const t0 = performance.now();
  try {
    const rt = form.get('roundtrip');
    if (typeof rt === 'string' && rt.trim()) {
      const text = rt.slice(0, 500);
      const tts = await speak(text);
      const stt = await listen(Buffer.from(tts.base64, 'base64'));
      return Response.json({ ok: true, mode: 'roundtrip', original: text, transcript: stt.text, recall: wordRecall(text, stt.text), tts: { mediaType: tts.mediaType, format: tts.format, bytes: tts.bytes, ms: tts.ms }, stt: { language: stt.language, durationSec: stt.durationSec, ms: stt.ms }, ms: Math.round(performance.now() - t0) });
    }

    const question = String(form.get('question') ?? '');
    const file = form.get('file');
    const bytes = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null;
    const declared = file instanceof File ? file.type : '';
    const r = await askAboutFile({ bytes, declared, question, ...(file instanceof File ? { filename: file.name } : {}) });
    if (!r.ok) return Response.json(r, { status: r.reason === 'size' ? 413 : 415 });

    const voice = form.get('voice') === '1' ? await speak(r.answer) : null;
    return Response.json({ ...r, voice, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    return Response.json({ ok: false, reason: 'model', message: e instanceof Error ? e.message.slice(0, 300) : String(e) }, { status: 502 });
  }
}
