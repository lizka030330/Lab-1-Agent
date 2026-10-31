/**
 * BM25 (крок 05): пошук за словами. Своя реалізація — щоб k1 і b були видні,
 * а тести проходили без залежностей і без мережі.
 *
 * k1 = 1,2 і b = 0,75 — ті самі значення, що жорстко зашиті у функції bm25()
 * SQLite FTS5. Ми їх НЕ підбирали: це загальноприйнятий відправний пункт.
 */
export interface Bm25Options {
  readonly k1: number;
  readonly b: number;
}

export const BM25: Bm25Options = { k1: 1.2, b: 0.75 };

/**
 * Токенізація під українську. \w у JavaScript НЕ бачить кирилиці — з ним
 * індекс вийшов би порожнім. Беремо \p{L} і \p{N} з прапорцем u.
 * Стемінгу немає: «подарунки» і «подарунок» — різні терміни. Це відома межа,
 * на кроці 06 вона зʼявиться серед причин помилок. Списку стоп-слів теж немає.
 */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);
}

export interface Bm25Index {
  readonly docs: { readonly id: string; readonly length: number; readonly tf: Map<string, number> }[];
  readonly df: Map<string, number>;
  readonly avgLength: number;
  readonly options: Bm25Options;
}

export function buildBm25(input: readonly { id: string; text: string }[], options: Bm25Options = BM25): Bm25Index {
  const df = new Map<string, number>();
  const docs = input.map(({ id, text }) => {
    const terms = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return { id, length: terms.length, tf };
  });
  const avgLength = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1);
  return { docs, df, avgLength, options };
}

export function searchBm25(index: Bm25Index, query: string, topK = 20): { id: string; score: number }[] {
  const { k1, b } = index.options;
  const N = index.docs.length;
  const terms = tokenize(query);

  return (
    index.docs
      .map((d) => {
        let score = 0;
        for (const t of terms) {
          const f = d.tf.get(t);
          if (f === undefined) continue;
          const n = index.df.get(t) ?? 0;
          const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
          score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / index.avgLength)));
        }
        return { id: d.id, score };
      })
      // 0 означає «жодного слова запиту немає» — такий фрагмент у список не йде взагалі
      .filter((r) => r.score > 0)
      // другий ключ сортування — id: інакше порядок рівних балів залежить від збірки
      .sort((a, b2) => b2.score - a.score || a.id.localeCompare(b2.id))
      .slice(0, topK)
  );
}
