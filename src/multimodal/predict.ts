/**
 * Прогноз токенів файлу (Лаб. 4, крок 05) — порівнюється з РІЗНИЦЕЮ «виклик із файлом − текстова база»,
 * а не з повним inputTokens (той включає текст промпту й інструкції).
 */
/** PDF: «Each document page is equivalent to 258 tokens». */
export const pdfTokens = (pages: number) => pages * 258;

/** Зображення: 258, якщо ОБИДВІ сторони ≤ 384 px; інакше плитки 768×768 по 258. */
export function imageTokens(w: number, h: number): number {
  if (w <= 384 && h <= 384) return 258;
  return Math.ceil(w / 768) * Math.ceil(h / 768) * 258;
}

/** Аудіо: «32 tokens per second of audio (1 minute = 1,920 tokens)». */
export const audioTokens = (seconds: number) => Math.ceil(seconds) * 32;

/** Розміри PNG з заголовка IHDR (без залежностей); для інших форматів — undefined. */
export function pngSize(b: Uint8Array): { w: number; h: number } | undefined {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return undefined;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
}

/** Кількість сторінок PDF за маркерами /Type /Page (груба, але детермінована оцінка). */
export function pdfPages(b: Uint8Array): number {
  const s = new TextDecoder('latin1').decode(b);
  return (s.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}
