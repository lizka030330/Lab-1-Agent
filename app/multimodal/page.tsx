'use client';
/**
 * Сторінка мультимодального входу (Лаб. 4, крок 05). Розмір і тип перевіряються ТУТ, у браузері, тією самою
 * константою, що й на сервері: запит понад 4,5 MB платформа відкидає 413 ще до нашого коду, і тоді користувач
 * не побачив би жодного зрозумілого слова.
 */
import { useState } from 'react';

import { ALLOWED_MEDIA_TYPES, MAX_BYTES, precheck } from '@/src/multimodal/limits';

type Result = { ok: boolean; answer?: string; page?: number | null; unknown?: boolean; message?: string; voice?: { base64: string; mediaType: string } | null };

export default function MultimodalPage() {
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState('');
  const [voice, setVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const rejected = precheck(file ? { size: file.size, type: file.type } : null, question);
    if (rejected) {
      setRes({ ok: false, message: rejected.message }); // дружня відмова — БЕЗ запиту до сервера
      return;
    }
    const fd = new FormData();
    fd.set('question', question);
    if (file) fd.set('file', file);
    if (voice) fd.set('voice', '1');
    setBusy(true);
    try {
      const r = await fetch('/api/multimodal', { method: 'POST', body: fd });
      const body = (await r.json().catch(() => ({ ok: false, message: `Сервер відповів ${r.status}` }))) as Result;
      setRes(body);
    } catch {
      setRes({ ok: false, message: 'Не вдалося надіслати запит.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '3rem auto', padding: '0 1rem', display: 'grid', gap: '1rem' }}>
      <h1 style={{ margin: 0 }}>Питання до документа</h1>
      <p style={{ margin: 0, color: 'var(--muted)' }}>
        Фото сторінки або PDF (до {(MAX_BYTES / 1e6).toFixed(1)} МБ; {ALLOWED_MEDIA_TYPES.join(', ')}). Відповідь — із номером сторінки; якщо відповіді немає — «не знаю». Не завантажуйте персональні чи конфіденційні документи.
      </p>
      <form onSubmit={submit} style={{ display: 'grid', gap: '0.75rem' }}>
        <input type="file" accept={ALLOWED_MEDIA_TYPES.join(',')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ваше питання" maxLength={500} required />
        <label><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> озвучити відповідь</label>
        <button type="submit" disabled={busy}>{busy ? 'Читаю…' : 'Запитати'}</button>
      </form>
      {res && (
        <section role="status" style={{ padding: '0.75rem 1rem', border: '1px solid var(--border)', borderRadius: '0.75rem' }}>
          {res.ok ? (
            <>
              <p style={{ margin: 0 }}><b>Відповідь:</b> {res.answer}</p>
              <p style={{ margin: '0.25rem 0 0' }}><b>Сторінка:</b> {res.page ?? '—'}</p>
              {res.voice && <audio controls src={`data:${res.voice.mediaType};base64,${res.voice.base64}`} />}
            </>
          ) : (
            <p style={{ margin: 0, color: 'crimson' }}>{res.message}</p>
          )}
        </section>
      )}
    </main>
  );
}
