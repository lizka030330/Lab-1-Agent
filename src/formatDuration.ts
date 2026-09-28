/**
 * Форматує мілісекунди як HH:MM:SS, відкидаючи неповні секунди.
 * Години можуть перевищувати 23. Значення має бути скінченним і невід’ємним.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError('Duration must be a finite, non-negative number');
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}
