/**
 * МЕЖІ мультимодального входу (Лаб. 4, крок 05) — ОДИН файл для браузера й сервера, щоб константа була та сама.
 * Без імпортів Node: цей модуль бандлиться в клієнтський компонент.
 *
 * Ліміт СВІДОМО нижчий за 4,5 MB тіла функції Vercel Hobby (понад — 413 FUNCTION_PAYLOAD_TOO_LARGE ще до нашого коду).
 * Файл іде як multipart/form-data — байти без base64, тому стеля ≈ розмір файлу + кілька КБ полів форми.
 * Запас до 4,5 MB лишено на поля форми й на випадок, якщо колись перейдемо на JSON із base64 (+≈1/3: 3 MB → 4 MB).
 */
export const MAX_BYTES = 3_000_000;
export const MAX_QUESTION_CHARS = 500;

/** Білий список — з переліку MIME, які приймає Gemini для зображень, плюс PDF. Усе інше — відмова ДО моделі. */
export const ALLOWED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'] as const;
export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

export const isAllowed = (t: string): t is AllowedMediaType => (ALLOWED_MEDIA_TYPES as readonly string[]).includes(t);

export type Rejection = { ok: false; reason: 'mediaType' | 'size' | 'mismatch' | 'question'; message: string };

/** Перевірка, ОДНАКОВА в браузері й на сервері. Повертає дружню відмову або null. */
export function precheck(file: { size: number; type: string } | null, question: string): Rejection | null {
  if (question.trim().length === 0 || question.length > MAX_QUESTION_CHARS) {
    return { ok: false, reason: 'question', message: `Питання має бути від 1 до ${MAX_QUESTION_CHARS} символів.` };
  }
  if (!file) return null; // текстова база: той самий промпт без файлу
  if (!isAllowed(file.type)) {
    return { ok: false, reason: 'mediaType', message: `Тип «${file.type || 'невідомий'}» не підтримується. Можна: PNG, JPEG, WEBP, HEIC/HEIF або PDF.` };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, reason: 'size', message: `Файл ${(file.size / 1e6).toFixed(1)} МБ — більше за ліміт ${(MAX_BYTES / 1e6).toFixed(1)} МБ. Стисніть зображення або розбийте PDF.` };
  }
  return null;
}
