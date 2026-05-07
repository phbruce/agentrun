// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @agentrun-ai/executor-cli — CLI executor.
 *
 * Spawns a subprocess from the tool's co-located impl file. The contract is
 * universal: stdin gets a single JSON message with the args, the subprocess
 * writes a single JSON object to stdout. Supported runtimes: node (.mjs/.js),
 * Python 3 (.py), bash (.sh).
 */

import { spawn } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import type {
    Executor,
    ExecutionContext,
    ToolDef,
    ToolResult,
} from "@agentrun-ai/core";

export interface CliExecutorConfig {
    /** Default subprocess timeout (ms). Tools may override per-manifest. */
    defaultTimeoutMs?: number;
}

export class CliExecutor implements Executor {
    readonly type = "cli";

    constructor(private readonly config: CliExecutorConfig = {}) {}

    async execute(
        tool: ToolDef,
        args: Record<string, unknown>,
        ctx: ExecutionContext,
    ): Promise<ToolResult> {
        const cli = tool.cli;
        if (!cli?.impl) {
            return errorResult(`Tool '${tool.name}' missing cli.impl in manifest`);
        }

        const implPath = resolvePath(cli.impl);
        const interpreter = cli.interpreter ?? inferInterpreter(implPath);
        const timeoutMs = cli.timeoutMs ?? this.config.defaultTimeoutMs ?? 10_000;

        const stdin = JSON.stringify({
            args,
            ctx: { userId: ctx.userId, source: ctx.source, team: ctx.team },
        });

        try {
            const stdout = await runSubprocess(interpreter, implPath, stdin, timeoutMs);
            const parsed = JSON.parse(stdout);
            return { content: [{ type: "json", data: parsed }] };
        } catch (err) {
            const e = err as Error;
            ctx.logger.error(`[cli-executor] tool '${tool.name}' failed: ${e.message}`);
            return errorResult(`CLI tool '${tool.name}' failed: ${e.message}`);
        }
    }
}

function inferInterpreter(implPath: string): string {
    if (implPath.endsWith(".py")) return "python3";
    if (implPath.endsWith(".sh")) return "bash";
    return "node";
}

function runSubprocess(
    interpreter: string,
    file: string,
    stdin: string,
    timeoutMs: number,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = spawn(interpreter, [file], { stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            proc.kill("SIGTERM");
            reject(new Error(`subprocess timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        proc.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        proc.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        proc.on("close", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (code !== 0) {
                reject(new Error(`exit ${code}: ${stderr.slice(0, 500)}`));
                return;
            }
            resolve(stdout);
        });
        proc.on("error", (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });
        proc.stdin.write(stdin);
        proc.stdin.end();
    });
}

function errorResult(message: string): ToolResult {
    return { content: [{ type: "text", text: message }], isError: true };
}

export default async function register(
    platform: { registerExecutor(e: Executor): void; logger: { info: (m: string) => void } },
    config?: unknown,
): Promise<void> {
    platform.registerExecutor(new CliExecutor((config as CliExecutorConfig | undefined) ?? {}));
    platform.logger.info("[@agentrun-ai/executor-cli] registered");
}
