/**
 * ДРУГИЙ БІК (Лаб. 2, крок 09): застосунок викликає ті самі інструменти MCP-сервера lab2-corpus.
 * Сервер не запускається окремо: його процес породжує транспорт.
 *
 *   npx tsx scripts/mcp-demo.ts "чим гості дякували за коровай"
 *
 * Потрібна запущена Ollama (вектор запиту для search_corpus); fetch_chunk працює без неї.
 * Ключів не потрібно.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const query = process.argv[2] ?? 'чим гості дякували за коровай';

// Корінь репозиторію — від розташування цього файлу, а не від cwd. Перша версія брала відносний
// 'src/mcp/server.ts' від робочої теки й падала, коли скрипт запускали не з кореня
// (ERR_MODULE_NOT_FOUND …/docs/src/mcp/server.ts — docs/lab2/traces/mcp-app-from-docs.txt).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const client = new Client({ name: 'lab2-app', version: '1.0.0' });

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', resolve(ROOT, 'src/mcp/server.ts')],
  cwd: ROOT,
  // НЕ ...process.env: інакше серверу дісталися б усі секрети застосунку (GEMINI_API_KEY, LANGFUSE_*).
  // MCP_CLIENT_LABEL — підпис у журналі сервера: за ним видно, що виклик ЗВІДСИ.
  // OLLAMA_BASE_URL передаємо лише якщо задано: це адреса, а не секрет.
  env: {
    ...getDefaultEnvironment(),
    MCP_CLIENT_LABEL: 'lab2-app',
    ...(process.env.OLLAMA_BASE_URL ? { OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL } : {}),
  },
});

function show(title: string, result: Awaited<ReturnType<typeof client.callTool>>): void {
  console.log(`\n=== ${title}`);
  // Тип блоку перевіряємо ДО читання .text — канонічна форма з документації.
  for (const block of result.content) {
    if (block.type === 'text') console.log(block.text.length > 900 ? `${block.text.slice(0, 900)}…` : block.text);
  }
  if (result.isError) console.log('^ це ВІДМОВА сервера (isError: true), і вона очікувана');
}

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log('Інструменти сервера:');
  for (const tool of tools) console.log(`- ${tool.name} — ${tool.description}`);

  show(`search_corpus { query: "${query}", topK: 3 }`, await client.callTool({ name: 'search_corpus', arguments: { query, topK: 3 } }));
  show('fetch_chunk { id: "korovai#0005" }', await client.callTool({ name: 'fetch_chunk', arguments: { id: 'korovai#0005' } }));

  // Третій виклик навмисно за межею: доказ, що застосунок бачить відмову як результат, а не виняток.
  show('fetch_chunk { id: "korovai#9999" } — за межею індексу', await client.callTool({ name: 'fetch_chunk', arguments: { id: 'korovai#9999' } }));
} finally {
  // Без close() процес сервера лишився б живим.
  await client.close();
}
