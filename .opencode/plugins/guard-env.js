
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ENV_PATTERN =
  /(^|[^A-Za-z0-9_$])\.env(\.(local|development|production|test)(\.local)?)?([^.A-Za-z0-9_]|$)/i;

const getTarget = (args = {}) =>
  [
    args.command,
    args.filePath,
    args.file_path,
    args.path,
    args.patchText,
    args.patch,
  ]
    .filter((value) => typeof value === "string")
    .join("\n");

export const GuardEnv = async ({ directory }) => {
  return {
    "tool.execute.before": async (input, output) => {
      const args = output?.args ?? {};
      const target = getTarget(args);

      if (!ENV_PATTERN.test(target)) return;

      const logDir = join(directory, ".agent-log");
      mkdirSync(logDir, { recursive: true });

      const safeCommand = String(args.command ?? "")
        .replace(/=[^\s]+/g, "=***")
        .slice(0, 200);

      const row = {
        ts: new Date().toISOString(),
        tool: input.tool,
        input: args.command
          ? { command: safeCommand }
          : {
              filePath: String(
                args.filePath ?? args.file_path ?? args.path ?? ""
              ).slice(0, 200),
            },
        result: "denied",
        session: input.sessionID,
        source: "opencode",
      };

      appendFileSync(
        join(logDir, "opencode.jsonl"),
        JSON.stringify(row) + "\n"
      );

      throw new Error(
        "Політика курсу: доступ до .env заборонено. Зупинись і запитай людину."
      );
    },
  };
};
