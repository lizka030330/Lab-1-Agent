/**
 * Верифікатор (Лаб. 2, крок 03): чисті функції без мережі.
 * Один критерій — один окремий запит до судді (один вимір на суддю).
 * Модель передається параметром — у тестах підробка, у scripts/verify.ts адаптер з Лаб. 1.
 */
import { extractJson, type Model } from '../agent/agent-loop';
import { criterionVerdict, type CriterionVerdict, type VerifyReport } from './schema';

export interface Criterion {
  readonly id: string;
  readonly statement: string;
  readonly checkedBy: string;
}

/** Критерії приймання з таблиці розділу 6 docs/lab2/spec.md: рядки `| A1 | твердження | чим перевіряється |`. */
export function parseCriteria(specMarkdown: string): Criterion[] {
  const out: Criterion[] = [];
  for (const line of specMarkdown.split(/\r?\n/)) {
    const m = /^\|\s*(A\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (m?.[1] && m[2] && m[3]) out.push({ id: m[1], statement: m[2], checkedBy: m[3] });
  }
  return out;
}

/** Прибирає з diff блоки файлів .env* — їх не можна відправляти провайдеру. */
export function filterDiff(diff: string): string {
  const blocks = diff.split(/^(?=diff --git )/m);
  return blocks.filter((b) => !/^diff --git a\/(\S*\/)?\.env/.test(b)).join('');
}

/** Схожі на ключі рядки: якщо знайдено — diff не відправляємо зовсім. */
const SECRET = /AIza[0-9A-Za-z_-]{20,}|sk-(or-|lf-|ant-|proj-)[0-9A-Za-z_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY/;

export function findSecret(text: string): string | undefined {
  return SECRET.exec(text)?.[0].slice(0, 8);
}

export const JUDGE_SYSTEM = [
  'Ти — незалежний суддя-верифікатор. Оцінюєш ОДНУ зміну (git diff) проти ОДНОГО критерію приймання зі специфікації.',
  'Відповідай лише JSON-обʼєктом без пояснень навколо: {"id": "...", "verdict": "pass" | "fail" | "unknown", "reason": "...", "evidence": "..."}.',
  'pass — зміна виконує те, що критерій вимагає від файлів, яких вона торкається, і це видно в diff.',
  'fail — у diff видно, що критерій порушено або виконано не повністю (наприклад, код чи тест, який критерій вимагає, є, але перевіряє не все, що сказано в критерії).',
  'unknown — diff не торкається того, що вимагає критерій, або перевірити можна лише прогоном (CI, числа зі звіту). Не вгадуй: краще unknown, ніж здогадка.',
  'reason — одне-два речення українською. evidence — шлях до файлу і рядок або коротка цитата з diff; порожній рядок лише для unknown.',
  'Якщо критерій перевіряється командою (валідатором, тестом), але все, що ця команда перевіряє, повністю є в diff (наприклад, увесь файл набору), — оціни сам вміст: pass, якщо він відповідає числам і вимогам критерію, fail — якщо ні. Не став unknown лише через те, що команду не запущено.',
  'Число зараховується лише з того звіту і для тієї системи, про які каже критерій: числа базової лінії без пошуку (baseline.md) не підтверджують критерій про систему з пошуком (eval-report.md, budget.md) — це unknown. pass — лише коли число в diff справді задовольняє поріг критерію; число гірше за поріг для тієї самої системи — fail.',
  'Узгодженість: якщо у reason ти пишеш, що потрібної перевірки, коду чи тесту в diff немає, хоча diff торкається саме того файлу, про який критерій, — вердикт fail, а не unknown.',
  'baseline.md і baseline-run.json — це система БЕЗ пошуку. Для критеріїв про систему з пошуком (eval-report.md, budget.md) будь-які їхні числа — unknown, навіть якщо ці числа гірші за поріг.',
  'Не зважай на довжину чи стиль зміни, лише на те, чи виконано критерій.',
].join('\n');

export function buildPrompt(c: Criterion, diff: string): string {
  return [
    `Критерій ${c.id}: ${c.statement}`,
    `Чим перевіряється за специфікацією: ${c.checkedBy}`,
    '',
    'Зміна (git diff):',
    '```diff',
    diff,
    '```',
    '',
    `Поверни вердикт для критерію ${c.id}.`,
  ].join('\n');
}

/**
 * Питає суддю про один критерій. Невалідну відповідь перепитує рівно один раз,
 * потім кидає помилку — скрипт падає, а не приймає сміття.
 */
export async function judgeCriterion(model: Model, c: Criterion, diff: string): Promise<CriterionVerdict> {
  const prompt = buildPrompt(c, diff);
  let lastText = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text =
      attempt === 1
        ? prompt
        : `${prompt}\n\nТвоя попередня відповідь не відповідала схемі: ${lastText.slice(0, 300)}\nПоверни лише JSON за схемою.`;
    const turn = await model(JUDGE_SYSTEM, [{ role: 'user', text }], []);
    lastText = turn.text;
    const parsed = criterionVerdict.safeParse(extractJson(turn.text));
    if (parsed.success && parsed.data.id === c.id) {
      if (parsed.data.verdict !== 'unknown' && parsed.data.evidence.trim() === '') continue;
      return parsed.data;
    }
  }
  throw new Error(`суддя двічі повернув невалідний вердикт для ${c.id}: ${lastText.slice(0, 200)}`);
}

/**
 * pauseMs — пауза між критеріями. Кожен критерій надсилає весь diff, тож на безкоштовному
 * рівні Gemini (250k вхідних токенів/хв) великий diff × 8 критеріїв без паузи дає HTTP 429.
 */
export async function verifyDiff(
  model: Model,
  criteria: readonly Criterion[],
  diff: string,
  pauseMs = 0,
): Promise<VerifyReport> {
  const results: CriterionVerdict[] = [];
  for (const [i, c] of criteria.entries()) {
    if (i > 0 && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    results.push(await judgeCriterion(model, c, diff));
  }
  return { results };
}

export function reportTable(report: VerifyReport): string {
  const rows = report.results.map(
    (r) => `| ${r.id} | ${r.verdict} | ${r.reason.replace(/\|/g, '/')} | ${r.evidence.replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 160)} |`,
  );
  return ['| Критерій | Вердикт | Причина | Evidence |', '|---|---|---|---|', ...rows].join('\n');
}
