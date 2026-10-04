/**
 * Дві форми API для одного ядра циклу (крок 08). Без SDK — видно, що саме передається «дротом».
 * fetch передається параметром: тести підставляють підробку й не ходять у мережу.
 *
 *   Messages-форма:          Ollama  http://localhost:11434/v1/messages
 *   Chat Completions-форма:  Gemini  https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
 *                            Ollama  http://localhost:11434/v1/chat/completions
 */
import { fromChatUsage, fromMessagesUsage, type ChatUsage, type MessagesUsage } from '../cost';
import type { Message, Model, ToolCall } from './agent-loop';

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface AdapterOptions {
  /** Повна адреса ендпоінта. */
  readonly url: string;
  readonly model: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: Fetch;
}

async function postJson(o: AdapterOptions, body: unknown): Promise<unknown> {
  const send = o.fetch ?? fetch;
  const res = await send(o.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...o.headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${o.url} → HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  return res.json();
}

// ---- Messages-форма: блоки tool_use / tool_result ----------------------------------------

interface MessagesBlock {
  readonly type: string;
  readonly text?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
}

interface MessagesResponse {
  readonly content: readonly MessagesBlock[];
  readonly usage: MessagesUsage;
}

function toMessagesParam(m: Message): object {
  switch (m.role) {
    case 'user':
      return { role: 'user', content: m.text };
    case 'assistant':
      return {
        role: 'assistant',
        content: [
          ...(m.text !== '' || m.calls.length === 0 ? [{ type: 'text', text: m.text || '(порожньо)' }] : []),
          ...m.calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })),
        ],
      };
    case 'tool':
      // результати повертаються повідомленням КОРИСТУВАЧА
      return {
        role: 'user',
        content: m.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.call.id,
          content: r.content,
          is_error: r.outcome !== 'ok',
        })),
      };
  }
}

export function messagesModel(o: AdapterOptions & { readonly maxTokens?: number }): Model {
  return async (system, messages, tools) => {
    const data = (await postJson(o, {
      model: o.model,
      max_tokens: o.maxTokens ?? 2048, // передаємо завжди: обмежує довжину відповіді
      system,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.jsonSchema })),
      messages: messages.map(toMessagesParam),
    })) as MessagesResponse;
    const calls: ToolCall[] = data.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id ?? '', name: b.name ?? '', input: b.input })); // input — уже об'єкт
    const text = data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    return { text, calls, usage: fromMessagesUsage(data.usage) };
  };
}

// ---- Chat Completions-форма: tool_calls / повідомлення role "tool" -----------------------

interface ChatToolCall {
  readonly id?: string;
  readonly function: { readonly name: string; readonly arguments: string };
}

interface ChatResponse {
  readonly choices: readonly {
    readonly message: { readonly content?: string | null; readonly tool_calls?: readonly ChatToolCall[] };
  }[];
  readonly usage: ChatUsage;
}

/** Аргументи тут — JSON-РЯДОК. Зламаний рядок лишаємо як є: його відхилить zod в інструменті. */
function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function toChatMessages(m: Message): object[] {
  switch (m.role) {
    case 'user':
      return [{ role: 'user', content: m.text }];
    case 'assistant':
      if (m.calls.length === 0) return [{ role: 'assistant', content: m.text }];
      return [
        {
          role: 'assistant',
          content: m.text === '' ? null : m.text,
          // сирий виклик повертаємо без змін: провайдер може класти туди службові поля
          tool_calls: m.calls.map(
            (c) => c.raw ?? { id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } },
          ),
        },
      ];
    case 'tool':
      // окремого is_error у цій формі немає — позначаємо текстом
      return m.results.map((r) => ({
        role: 'tool',
        tool_call_id: r.call.id,
        content: r.outcome === 'ok' ? r.content : `ПОМИЛКА (${r.outcome}): ${r.content}`,
      }));
  }
}

export function chatCompletionsModel(o: AdapterOptions): Model {
  return async (system, messages, tools) => {
    const data = (await postJson(o, {
      model: o.model,
      messages: [{ role: 'system', content: system }, ...messages.flatMap(toChatMessages)],
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.jsonSchema },
      })),
    })) as ChatResponse;
    const message = data.choices[0]?.message;
    if (message === undefined) throw new Error('Відповідь без choices[0].message');
    const calls: ToolCall[] = (message.tool_calls ?? []).map((c, i) => {
      const id = c.id ?? `call_${i}`;
      return { id, name: c.function.name, input: parseArguments(c.function.arguments), raw: { ...c, id } };
    });
    return { text: message.content ?? '', calls, usage: fromChatUsage(data.usage) };
  };
}