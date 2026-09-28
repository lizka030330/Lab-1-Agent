import { appendFileSync, mkdirSync } from "node:fs"
import path from "node:path"

// Лише шлях, команда чи шаблон — ніколи вміст файлу.
const brief = (tool, args = {}) => {
  if (tool === "apply_patch") {
    const files = [...String(args.patchText ?? "").matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)]
    return { files: files.map((m) => m[1].trim()) }
  }

  const out = {}
  for (const key of ["filePath", "command", "pattern", "url", "name"]) {
    if (typeof args[key] === "string") out[key] = args[key].slice(0, 200)
  }
  return out
}

export const AgentLog = async ({ directory }) => {
  const dir = path.join(directory, ".agent-log")

  const log = (row) => {
    mkdirSync(dir, { recursive: true })
    appendFileSync(path.join(dir, "opencode.jsonl"), JSON.stringify(row) + "\n")
  }

  return {
    "tool.execute.after": async (input) =>
      log({
        ts: new Date().toISOString(),
        tool: input.tool,
        input: brief(input.tool, input.args),
        result: "ok",
        session: input.sessionID,
        source: "opencode"
      }),
  }
}