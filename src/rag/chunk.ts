/**
 * ФРАГМЕНТАЦІЯ (крок 04). Чиста функція: без мережі, без файлової системи.
 *
 * Правило (docs/lab2/indexing.md): межі за заголовками — у корпусі це заголовки
 * Вікіпедії «== Розділ ==» (Markdown «#» теж розпізнається); задовгий розділ
 * добиваємо за абзацами й реченнями, короткі огризки приклеюємо до попереднього;
 * розділ із самого заголовка (без тексту) приклеюємо до наступного.
 * Числа виведено з розмірів розділів і абзаців корпусу: медіана розділу 694 симв.,
 * медіана абзацу 193 симв.
 *
 * Інваріант, від якого залежить цитування на кроці 05:
 *   chunk.text === normalize(raw).slice(chunk.start, chunk.end)
 */
export interface ChunkRule {
  /** Цільовий максимум фрагмента в символах. */
  readonly maxChars: number;
  /** Коротший фрагмент приклеюємо до попереднього. */
  readonly minChars: number;
  /** Перекриття сусідніх фрагментів у символах. */
  readonly overlapChars: number;
}

/** Варіант А: типовий розділ (694) — один фрагмент; мінімум ≈ медіана абзацу; перекриття ≈ короткий абзац. */
export const RULE: ChunkRule = { maxChars: 1200, minChars: 200, overlapChars: 150 };

export interface Chunk {
  /** gift#0007 — стабільний: залежить лише від id документа і порядку. */
  readonly id: string;
  readonly docId: string;
  /** Шлях заголовків: «Традиції › Україна». Порожній, якщо заголовків немає. */
  readonly heading: string;
  /** 0-based зсув у НОРМАЛІЗОВАНОМУ тексті документа. */
  readonly start: number;
  /** Виключно: text === normalized.slice(start, end). */
  readonly end: number;
  readonly text: string;
}

/** Нормалізація — частина індексу. Змінили її — перебудуйте індекс. */
export function normalize(raw: string): string {
  return raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
}

interface Span {
  start: number;
  end: number;
}

/** Рівень і текст заголовка: Markdown «## X» або Вікіпедія «== X ==» (== — рівень 1). */
export function parseHeading(line: string): { level: number; title: string } | null {
  const md = /^(#{1,6})\s+(.+)$/.exec(line);
  if (md?.[1] && md[2]) return { level: md[1].length, title: md[2].trim() };
  const wiki = /^(={2,6})\s*(.+?)\s*\1\s*$/.exec(line);
  if (wiki?.[1] && wiki[2]) return { level: wiki[1].length - 1, title: wiki[2].trim() };
  return null;
}

/** Розділи між рядками-заголовками. Заголовок лишається ВСЕРЕДИНІ розділу. */
function sections(text: string): { heading: string; span: Span }[] {
  const out: { heading: string; span: Span }[] = [];
  const path: string[] = [];
  let current = { heading: '', start: 0 };
  let offset = 0;
  for (const line of text.split('\n')) {
    const h = parseHeading(line);
    if (h) {
      if (offset > current.start) out.push({ heading: current.heading, span: { start: current.start, end: offset } });
      path.length = h.level - 1;
      path[h.level - 1] = h.title;
      current = { heading: path.filter(Boolean).join(' › '), start: offset };
    }
    offset += line.length + 1; // +1 — це '\n'
  }
  out.push({ heading: current.heading, span: { start: current.start, end: text.length } });
  return foldHeadingOnly(
    text,
    out.filter((s) => text.slice(s.span.start, s.span.end).trim() !== ''),
  );
}

/**
 * Розділ, у якому немає нічого, крім рядка заголовка (API Вікіпедії викидає списки й
 * шаблони, і від «== Примітки ==» лишається сам заголовок), приклеюємо до наступного
 * розділу — або до попереднього, якщо він останній. Межі суміжні, тож інваріант зсувів
 * не порушується.
 */
function foldHeadingOnly(text: string, list: { heading: string; span: Span }[]): { heading: string; span: Span }[] {
  const isHeadingOnly = (s: Span): boolean => {
    const body = text.slice(s.start, s.end).split('\n').slice(1).join('\n');
    return parseHeading(text.slice(s.start, s.end).split('\n')[0] ?? '') !== null && body.trim() === '';
  };
  const out: { heading: string; span: Span }[] = [];
  let carry: number | null = null; // початок порожніх заголовків, що чекають на наступний розділ
  for (const s of list) {
    if (isHeadingOnly(s.span)) {
      carry ??= s.span.start;
      continue;
    }
    out.push(carry === null ? s : { heading: s.heading, span: { start: carry, end: s.span.end } });
    carry = null;
  }
  if (carry !== null) {
    const last = out[out.length - 1];
    if (last) out[out.length - 1] = { heading: last.heading, span: { start: last.span.start, end: text.length } };
    else out.push({ heading: '', span: { start: carry, end: text.length } });
  }
  return out;
}

/**
 * Остання межа у вікні — але лише в його другій половині: інакше розділ на
 * 1200 символів різався б після першого ж абзацу на 40 символів.
 */
function lastBoundary(window: string, re: RegExp): number | null {
  let found: number | null = null;
  for (const m of window.matchAll(re)) found = (m.index ?? 0) + m[0].length;
  return found !== null && found > window.length / 2 ? found : null;
}

function split(text: string, span: Span, rule: ChunkRule): Span[] {
  const pieces: Span[] = [];
  let start = span.start;
  while (span.end - start > rule.maxChars) {
    const window = text.slice(start, start + rule.maxChars);
    const cut =
      lastBoundary(window, /\n+/g) ?? // 1. межа абзацу (у Вікіпедії абзац — один рядок)
      lastBoundary(window, /[.!?…»]\s/g) ?? // 2. кінець речення
      lastBoundary(window, /\s/g) ?? // 3. хоч пробіл
      rule.maxChars; // 4. різати всередині слова
    const end = start + cut;
    pieces.push({ start, end });
    // перекриття: відступаємо назад і виходимо на межу слова
    const back = Math.max(end - rule.overlapChars, start + 1);
    const ws = text.slice(back, end).search(/\s/);
    start = ws > 0 ? back + ws + 1 : back;
  }
  pieces.push({ start, end: span.end });
  return pieces;
}

export function chunkDocument(docId: string, raw: string, rule: ChunkRule = RULE): Chunk[] {
  const text = normalize(raw);
  const parts: { heading: string; span: Span }[] = [];
  for (const section of sections(text)) {
    for (const span of split(text, section.span, rule)) parts.push({ heading: section.heading, span });
  }

  // огризки коротші за minChars приклеюємо до попереднього фрагмента того ж розділу
  const merged: { heading: string; span: Span }[] = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    const short = part.span.end - part.span.start < rule.minChars;
    const fits = prev !== undefined && part.span.end - prev.span.start <= rule.maxChars + rule.overlapChars;
    if (prev !== undefined && short && fits && prev.heading === part.heading) {
      merged[merged.length - 1] = { heading: prev.heading, span: { start: prev.span.start, end: part.span.end } };
    } else {
      merged.push(part);
    }
  }

  return merged.map((part, i) => ({
    id: `${docId}#${String(i).padStart(4, '0')}`,
    docId,
    heading: part.heading,
    start: part.span.start,
    end: part.span.end,
    text: text.slice(part.span.start, part.span.end),
  }));
}
