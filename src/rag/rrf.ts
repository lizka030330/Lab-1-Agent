/**
 * RRF (крок 05): зводить кілька ранжувань в одне, не порівнюючи їхніх балів.
 * score(d) = Σ 1/(k + rank_i(d)), ранги з 1, відсутній документ додає 0.
 * Cormack, Clarke, Buettcher, SIGIR '09.
 */
export const RRF_K = 60;

export function rrf(lists: readonly (readonly string[])[], k = RRF_K): { id: string; score: number }[] {
  const total = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => {
      total.set(id, (total.get(id) ?? 0) + 1 / (k + i + 1)); // i + 1 — ранг рахується з одиниці
    });
  }
  return [...total.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
