// SPDX-License-Identifier: AGPL-3.0-only
import { ensurePlatform } from "../platform/bootstrap.js";

export interface MonthlyUsage {
    inputTokens: number;
    outputTokens: number;
    queryCount: number;
}

export async function trackUsage(userId: string, inputTokens: number, outputTokens: number): Promise<void> {
    const registry = ensurePlatform();
    await registry.usage.track(userId, inputTokens, outputTokens);
}

export async function getMonthlyUsage(userId: string): Promise<MonthlyUsage> {
    const registry = ensurePlatform();
    return registry.usage.getMonthly(userId);
}
