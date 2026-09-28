import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [source = 'unknown', result = 'ok'] = process.argv.slice(2);
const event = JSON.parse(readFileSync(0, 'utf8'));

const tool = event.tool_name ?? event.toolName ?? 'unknown';
let args = event.tool_input ?? event.toolArgs ?? {};

if (typeof args === 'string') {
  try {
    args = JSON.parse(args);
  } catch {
    args = {};
  }
}

const input = {};

if (tool === 'apply_patch') {
  const patch = Array.isArray(args.command)
    ? args.command.join('\n')
    : String(args.command ?? '');

  input.files = [
    ...patch.matchAll(
      /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm
    ),
  ].map((m) => m[1].trim());
} else {
  for (const key of [
    'file_path',
    'filePath',
    'path',
    'command',
    'pattern',
    'url',
    'name',
    'skill',
  ]) {
    if (typeof args[key] === 'string') {
      input[key] = args[key].slice(0, 200);
    }
  }
}

const dir = join(
  process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  '.agent-log'
);

mkdirSync(dir, { recursive: true });

const row = {
  ts: new Date().toISOString(),
  tool,
  input,
  result,
  session: event.session_id ?? event.sessionId ?? 'unknown',
  source,
};

appendFileSync(
  join(dir, `${source}.jsonl`),
  `${JSON.stringify(row)}\n`
);