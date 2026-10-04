/**
 * Власний агентний цикл (крок 08): модель → виклики інструментів → результати → повтор.
 * Ядро не знає форми API — її ховає адаптер (adapters.ts). Зупинки: валідна відповідь,
 * ліміт кроків, бюджет токенів. Фінальний вихід приймається лише після перевірки zod.
 */
import { z } from 'zod';

import { addUsage, ZERO_USAGE, type Usage } from '../cost';
import type { AgentTool, LogEntry, ToolOutcome } from './tools';

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  /** Сирий об'єкт виклику від провайдера — адаптер повертає його в історії без змін. */
  readonly raw?: unknown;
}

export interface ToolResult {
  readonly call: ToolCall;
  readonly outcome: ToolOutcome;
  readonly content: string;
}

export type Message =
  | { readonly role: 'user'; readonly text: string }
  | { readonly role: 'assistant'; readonly text: string; readonly calls: readonly ToolCall[] }
  | { readonly role: 'tool'; readonly results: readonly ToolResult[] };

export interface ModelTurn {
  readonly text: string;
  readonly calls: readonly ToolCall[];
  readonly usage: Usage;
}

/** Один виклик моделі. Реалізують адаптери форм API, у тестах — підроблена модель. */
export type Model = (
  system: string,
  messages: readonly Message[],
  tools: readonly AgentTool[],
) => Promise<ModelTurn>;

export interface LoopOptions<T> {
  readonly model: Model;
  readonly tools: readonly AgentTool[];
  readonly system: string;
  readonly task: string;
  readonly output: z.ZodType<T>;
  readonly maxSteps: number;
  readonly tokenBudget: number;
  readonly session: string;
  readonly log: (entry: LogEntry) => void;
}

export type LoopResult<T> =
  | { readonly stop: 'done'; readonly output: T; readonly steps: number; readonly usage: Usage }
  | { readonly stop: 'max-steps' | 'token-budget'; readonly steps: number; readonly usage: Usage };

/** Дістає JSON із тексту: моделі часто обгортають його в ```json … ```. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export async function runAgentLoop<T>(o: LoopOptions<T>): Promise<LoopResult<T>> {
  const messages: Message[] = [{ role: 'user', text: o.task }];
  let usage = ZERO_USAGE;

  for (let step = 1; step <= o.maxSteps; step++) {
    if (usage.inputTokens + usage.outputTokens >= o.tokenBudget) {
       return { stop: 'token-budget', steps: step - 1, usage };
   } 
    const turn = await o.model(o.system, messages, o.tools);
    usage = addUsage(usage, turn.usage);
    messages.push({ role: 'assistant', text: turn.text, calls: turn.calls });

    if (turn.calls.length === 0) {
      const parsed = o.output.safeParse(extractJson(turn.text));
      if (parsed.success) return { stop: 'done', output: parsed.data, steps: step, usage };
      messages.push({
        role: 'user',
        text: `Відповідь не пройшла схему:\n${z.prettifyError(parsed.error)}\nПоверни лише JSON за схемою.`,
      });
      continue;
    }

    const results: ToolResult[] = [];
    for (const call of turn.calls) {
      const tool = o.tools.find((t) => t.name === call.name);
      const { outcome, content } = tool
        ? await tool.run(call.input)
        : { outcome: 'error' as const, content: `Невідомий інструмент: ${call.name}` };
      o.log({
        ts: new Date().toISOString(),
        tool: call.name,
        input: call.input,
        result: outcome,
        session: o.session,
        source: 'agent-loop',
      });
      results.push({ call, outcome, content });
    }
    messages.push({ role: 'tool', results });
  }
  return { stop: 'max-steps', steps: o.maxSteps, usage };
}