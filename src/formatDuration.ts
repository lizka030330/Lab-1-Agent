/**
 * Форматує невід’ємну скінченну тривалість: `500ms`, `1.5s`, `1m 5s`.
 * Дробові мілісекунди відкидаються; хвилини не обмежені значенням 59.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError('Duration must be a finite, non-negative number');
  }

  const milliseconds = Math.floor(ms);
  if (milliseconds < 1_000) {
    return `${milliseconds}ms`;
  }
  if (milliseconds < 60_000) {
    return `${milliseconds / 1_000}s`;
  }

  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = (milliseconds % 60_000) / 1_000;
  return `${minutes}m ${seconds}s`;
}
