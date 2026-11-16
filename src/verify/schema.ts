import { z } from 'zod';

/** Один критерій приймання зі specs — один запис вердикту. */
export const criterionVerdict = z
  .object({
    /** Номер критерію з docs/lab2/spec.md, дослівно. */
    id: z.string().min(1),
    /** unknown — аварійний вихід: даних у наданій зміні недостатньо для судження. */
    verdict: z.enum(['pass', 'fail', 'unknown']),
    /** Чому саме так. Одне-два речення, без загальних порад. */
    reason: z.string().min(1),
    /** Файл і рядок або цитата зі зміни; порожньо лише для unknown. */
    evidence: z.string(),
  })
  .strict();

export type CriterionVerdict = z.infer<typeof criterionVerdict>;

export const verifyReport = z.object({ results: z.array(criterionVerdict).min(1) }).strict();

export type VerifyReport = z.infer<typeof verifyReport>;

/**
 * Брама харнеса (Лаб. 3, крок 02): червоно, якщо хоч один критерій НЕ pass — unknown теж блокує.
 * В автономному прогоні немає людини, яка подивилася б на unknown, тож він не має права проїхати в main.
 */
export function isBlocked(report: VerifyReport): boolean {
  return report.results.some((r) => r.verdict !== 'pass');
}

/**
 * Стара брама Лаб. 2 (CI, критерії A1–A8 і M1–M5 зі spec.md проти diff PR): блокує лише fail.
 * Лишається такою свідомо: критерії Лаб. 2 описують увесь проєкт, і для більшості PR вони чесно unknown
 * (файлів, про які критерій, у diff немає); сувора брама там блокувала б кожну зміну. Кожен pass/unknown
 * цієї брами я перевіряла вручну — docs/lab2/verifier.md. У харнес цей варіант НЕ переноситься.
 */
export function isBlockedFailOnly(report: VerifyReport): boolean {
  return report.results.some((r) => r.verdict === 'fail');
}
