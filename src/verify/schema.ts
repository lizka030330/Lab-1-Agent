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

/** Брама: червоно, щойно є хоч один fail. unknown браму не валить, але потрапляє у звіт. */
export function isBlocked(report: VerifyReport): boolean {
  return report.results.some((r) => r.verdict === 'fail');
}
