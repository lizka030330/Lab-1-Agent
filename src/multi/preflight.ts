/**
 * Перевірка верифікатора ДО першого платного виклику Gemini (Лаб. 4, крок 04).
 * 25.11.2026 16:56 чотири прогони впали з ECONNREFUSED 127.0.0.1:11434 уже ПІСЛЯ гілок і зводу —
 * Ollama була вимкнена, а токени Gemini витрачено. Тепер падаємо до них.
 */
export async function assertJudgeUp(baseUrl: string, model: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/api/tags`);
  } catch (e) {
    throw new Error(`верифікатор недоступний: Ollama на ${baseUrl} не відповідає (${e instanceof Error ? e.message : String(e)}). Запустіть Ollama — Gemini ще не викликано.`);
  }
  if (!res.ok) throw new Error(`верифікатор недоступний: ${baseUrl}/api/tags → HTTP ${res.status}`);
  const tags = (await res.json()) as { models?: { name: string }[] };
  if (!tags.models?.some((m) => m.name === model || m.name === `${model}:latest`)) {
    throw new Error(`у Ollama немає моделі ${model} (є: ${tags.models?.map((m) => m.name).join(', ') || '—'})`);
  }
}
