# Лабораторна 2 — асистент із гібридним пошуком і власним MCP-сервером

**Тема:** довідник з традицій і етикету подарунків. Відповіді спираються лише на колекцію з 25 статей Вікіпедії (CC BY-SA 4.0) і цитують джерело з точністю до фрагмента.
**Репозиторій:** [https://github.com/lizka030330/Lab-1-Agent](https://github.com/lizka030330/Lab-1-Agent) (публічний; той самий, що в Лабораторній 1; `docs/lab1/` не змінювався з 05.10.2026 — останній коміт [`c29b150`](https://github.com/lizka030330/Lab-1-Agent/commit/c29b150)).
**Стан, що подається:** `main` на момент фіксації SHA викладачем.

## Числа «до» і «після»
| Показник | Без пошуку (крок 01) | З пошуком (крок 06) | Ціль |
|---|---|---|---|
| Точність, 20 запитів з відповіддю | 45% (9/20) | **95% (19/20)**, ± 9,6 п. п. | G1 ≥ 70%, G2 ≥ +20 п. п. — так |
| Правильні відмови, 5 unanswerable | 0/5 | **5/5** | G4 — так |
| Відповіді з цитатою / фантомні id | 0% / — | **100% / 0** | G3 — так |
| Медіана затримки | 1,0 с | 1,0 с | G5 ≤ 10 с — так |
| Вартість на 100 запитів за прайсом (факт) | $0.0217 ($0) | $0.0524 ($0) | G6 ≤ $0.20 — так |
| recall@5 / MRR@5 | — | 0,97 / 0,94 | — |

Повна таблиця, переходи вердиктів по кожному запиту, три розібрані помилки й перевірюваний висновок — [`eval-report.md` → «Фінальний підсумок»](eval-report.md#фінальний-підсумок-крок-10). Паралельний прогін (крок 07) **не окупився**: −24% часу стіни при ширині 4 за тих самих токенів, бо гілки стоять у черзі на ліміт одного безкоштовного ключа Gemini — [`budget.md`](budget.md#6-висновок).

## Докази по кроках
| Крок | Що | Файли | Ключові коміти | PR і CI (брама) |
|---|---|---|---|---|
| 00 | Специфікація: обсяг, набір документів із походженням і ліцензією, цілі G1–G6, критерії A1–A8 | [`spec.md`](spec.md) | [`f161b98`](https://github.com/lizka030330/Lab-1-Agent/commit/f161b98) v1, [`30fccb2`](https://github.com/lizka030330/Lab-1-Agent/commit/30fccb2) v1.1 | — |
| 01 | Корпус, еталонний набір (25 запитів, заморожений), базова лінія без пошуку | [`eval-set.md`](eval-set.md), [`golden/queries.jsonl`](golden/queries.jsonl), [`baseline.md`](baseline.md), [`baseline-run.json`](baseline-run.json), [`../../corpus/`](../../corpus) | заморозка [`3fe506f`](https://github.com/lizka030330/Lab-1-Agent/commit/3fe506f), база [`e31f153`](https://github.com/lizka030330/Lab-1-Agent/commit/e31f153) | — |
| 02 | Субагенти spec-auditor і explorer (read-only), доказ ізоляції, аудит diff | [`subagents.md`](subagents.md), [`audit/step01.diff`](audit/step01.diff), [`../../.opencode/agents/`](../../.opencode/agents), [`../../.agent-log/opencode.jsonl`](../../.agent-log/opencode.jsonl) | [`ce5160c`](https://github.com/lizka030330/Lab-1-Agent/commit/ce5160c) | — |
| 03 | Верифікатор на іншій моделі (Gemini), калібрування 80% → 90%, брама злиття, **зупинений випадок** (A4 fail) | [`verifier.md`](verifier.md), [`verify-calibration.jsonl`](verify-calibration.jsonl), [`../../src/verify/`](../../src/verify), [`../../.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | розмітка до прогону [`4cadbf4`](https://github.com/lizka030330/Lab-1-Agent/commit/4cadbf4), верифікатор [`9f56128`](https://github.com/lizka030330/Lab-1-Agent/commit/9f56128); стоп [`ebb2094`](https://github.com/lizka030330/Lab-1-Agent/commit/ebb2094) → виправлення [`3ee4575`](https://github.com/lizka030330/Lab-1-Agent/commit/3ee4575) | [PR #1](https://github.com/lizka030330/Lab-1-Agent/pull/1) · [checks](https://github.com/lizka030330/Lab-1-Agent/pull/1/checks) |
| 04 | Індексація: 468 фрагментів, правило 1200/200/150, ембедінги Ollama | [`indexing.md`](indexing.md), [`../../data/index.json`](../../data/index.json), [`../../src/rag/chunk.ts`](../../src/rag/chunk.ts) | [`f0c94a2`](https://github.com/lizka030330/Lab-1-Agent/commit/f0c94a2) | [PR #2](https://github.com/lizka030330/Lab-1-Agent/pull/2) · [checks](https://github.com/lizka030330/Lab-1-Agent/pull/2/checks) |
| 05 | Гібридний пошук (BM25 + вектор, RRF k = 60), цитування, правило відмови 0,765 | [`retrieval.md`](retrieval.md), [`search-golden.json`](search-golden.json), [`../../src/rag/`](../../src/rag) | [`e39ef99`](https://github.com/lizka030330/Lab-1-Agent/commit/e39ef99) | [PR #3](https://github.com/lizka030330/Lab-1-Agent/pull/3) · [checks](https://github.com/lizka030330/Lab-1-Agent/pull/3/checks) |
| 06 | Оцінювання: 45% → 95%, переходи, 3 помилки, межі вимірювання | [`eval-report.md`](eval-report.md), [`eval-run.json`](eval-run.json), [`traces/eval-run.png`](traces/eval-run.png), [`../../src/metrics.ts`](../../src/metrics.ts) | [`f8e5975`](https://github.com/lizka030330/Lab-1-Agent/commit/f8e5975) | [PR #4](https://github.com/lizka030330/Lab-1-Agent/pull/4) · [checks](https://github.com/lizka030330/Lab-1-Agent/pull/4/checks) |
| 07 | Граф залежностей, бюджет **до** прогону, паралельний прогін 1/2/4/8, маршрутизація моделей | [`budget.md`](budget.md), [`parallel-run.json`](parallel-run.json), [`parallel-run-noretry.json`](parallel-run-noretry.json), [`traces/parallel-before.png`](traces/parallel-before.png), [`traces/parallel-after.png`](traces/parallel-after.png), [`subagents.md`](subagents.md) (залежності) | бюджет до вимірів [`a09a785`](https://github.com/lizka030330/Lab-1-Agent/commit/a09a785) | [PR #5](https://github.com/lizka030330/Lab-1-Agent/pull/5) · [checks](https://github.com/lizka030330/Lab-1-Agent/pull/5/checks) |
| 08 | MCP-сервер за специфікацією: 2 інструменти, 4 місця безпеки, критерії M1–M5, smoke-тест Inspector | [`mcp-spec.md`](mcp-spec.md), [`../../src/mcp/`](../../src/mcp), [`../../tests/mcp.test.ts`](../../tests/mcp.test.ts), [`traces/mcp-smoke.md`](traces/mcp-smoke.md) | специфікація [`50592ed`](https://github.com/lizka030330/Lab-1-Agent/commit/50592ed) **раніше** за код [`9243b60`](https://github.com/lizka030330/Lab-1-Agent/commit/9243b60) | [PR #6](https://github.com/lizka030330/Lab-1-Agent/pull/6) · [checks](https://github.com/lizka030330/Lab-1-Agent/pull/6/checks) |
| 09 | Підключення з двох боків: OpenCode і застосунок | [`mcp-integration.md`](mcp-integration.md), [`../../opencode.json`](../../opencode.json), [`../../scripts/mcp-demo.ts`](../../scripts/mcp-demo.ts), [`traces/mcp-calls.jsonl`](traces/mcp-calls.jsonl), [`traces/mcp-opencode.txt`](traces/mcp-opencode.txt), [`traces/mcp-app.txt`](traces/mcp-app.txt) | [`3b3bb19`](https://github.com/lizka030330/Lab-1-Agent/commit/3b3bb19) | [PR #7](https://github.com/lizka030330/Lab-1-Agent/pull/7) · [checks](https://github.com/lizka030330/Lab-1-Agent/pull/7/checks) |
| 10 | Цей звіт, фінальний підсумок, зведення помилок судді | цей файл, [`eval-report.md`](eval-report.md#фінальний-підсумок-крок-10), [`verifier.md`](verifier.md) | — | PR #8 |

Журнал автономності — [`autonomy-log.md`](autonomy-log.md): по запису на кожну сесію (дата, інструмент і модель, режим дозволів, мої втручання, докази).
Зелений CI на `main`: [Actions → CI, гілка main](https://github.com/lizka030330/Lab-1-Agent/actions/workflows/ci.yml?query=branch%3Amain).

## Інструменти й моделі
| Роль | Що | Версія / ідентифікатор |
|---|---|---|
| Автор коду й документів (з моїм контролем) | Claude, чат claude.ai | Claude Opus 5.5 |
| Агент кодування, субагенти, бік 1 MCP | OpenCode | 1.18.34; модель Gemini 3.5 Flash Lite (крок 02 — також Gemini 3.8 Flash) |
| Модель відповідей | Gemini API, безкоштовний рівень, форма Chat Completions | `gemini-3.5-flash-lite` |
| Верифікатор-брама (інший провайдер, ніж автор коду) | Gemini API у GitHub Actions | `gemini-3.5-flash-lite`, рубрика v3 |
| Ембедінги | Ollama, локально | `embeddinggemma-2:270m`, 768 вимірів |
| Траси | Langfuse Cloud (ingestion API) | траси `lab2-eval-run`, `lab2-parallel-w*` |
| MCP | `@modelcontextprotocol/server` / `client`, Inspector CLI | 2.4.0, ревізія протоколу 2026-07-28 |
| Середовище | Node, TypeScript, Vitest, AI SDK | Node 24 (CI 24.22.1), TypeScript 6.0.3, Vitest 5.0.0, `ai@7.0.127` |

## Як відтворити
```
git clone https://github.com/lizka030330/Lab-1-Agent && cd Lab-1-Agent
npm install
cp .env.example .env.local        # для відповідей моделі — GEMINI_API_KEY; для індексу, пошуку й MCP ключі не потрібні
ollama pull embeddinggemma-2:270m # Ollama має бути запущена
npm test                          # 161 тест без мережі
```
- **Індексація:** `npm run index` → `data/index.json` (468 фрагментів, ≈ 30 с).
- **Пошук:** `npx tsx scripts/search.ts --explain "чим гості дякували за коровай"`; із відповіддю моделі — `npx tsx --env-file=.env.local scripts/search.ts --answer "…"`; ранги по еталонному набору — `npx tsx scripts/search.ts --golden`.
- **Оцінювання:** `npx tsx --env-file=.env.local scripts/eval-run.ts docs/lab2/golden/queries.jsonl`, підсумок без мережі — `npx tsx scripts/eval-run.ts --summary`.
- **Паралельний вимір:** `npx tsx --env-file=.env.local scripts/parallel-eval.ts 4`.
- **MCP-сервер:** `npm run mcp` (stdio, його запускає клієнт); smoke-тест без ключів — `npx @modelcontextprotocol/inspector --cli npx tsx src/mcp/server.ts --protocol-era modern --method tools/list --format json`; застосунок — `npx tsx scripts/mcp-demo.ts "запит"`; агент — OpenCode з кореня репозиторію (`opencode.json`).
- **Верифікатор локально:** `git diff main... > docs/lab2/verify-input.diff && npx tsx --env-file=.env.local scripts/verify.ts docs/lab2/verify-input.diff`.

## Що варто знати перевіряльнику
- Брама-верифікатор ставила `pass` без доказу в diff щонайменше чотири рази; кожен такий вердикт я перевіряла вручну — зведення в [`verifier.md`](verifier.md#зведення-помилок-судді).
- Перша серія паралельних вимірів (крок 07) непридатна для порівняння (429, різні токени) — збережена як доказ, чому, а не прихована.
- Пояснення помилки q-19 на кроці 05 виявилось хибним — уточнення дописане в [`retrieval.md`](retrieval.md), а не переписане мовчки.
