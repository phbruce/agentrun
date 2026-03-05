// SPDX-License-Identifier: AGPL-3.0-only
import { ensurePlatform } from "../platform/bootstrap.js";
import type { SessionMessage } from "../platform/types.js";

export type { SessionMessage };

const MAX_HISTORY_CHARS = 50_000;

export async function saveMessage(
    sessionId: string,
    ts: string,
    role: "user" | "assistant",
    content: string,
    userId: string,
): Promise<void> {
    const registry = ensurePlatform();
    await registry.sessions.saveMessage(sessionId, ts, role, content, userId);
}

export async function getHistory(sessionId: string): Promise<SessionMessage[]> {
    const registry = ensurePlatform();
    return registry.sessions.getHistory(sessionId);
}

export function buildPromptWithHistory(history: SessionMessage[], currentQuery: string): string {
    if (history.length === 0) return currentQuery;

    // Build history block, truncating from the beginning if too long
    const lines: string[] = [];
    let totalChars = 0;

    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        const prefix = msg.role === "user" ? "Usuário" : "Assistente";
        const line = `${prefix}: ${msg.content}`;

        if (totalChars + line.length > MAX_HISTORY_CHARS) break;

        lines.unshift(line);
        totalChars += line.length;
    }

    return `[Histórico da conversa — use como contexto]\n${lines.join("\n")}\n\n[Pergunta atual]\nUsuário: ${currentQuery}`;
}
