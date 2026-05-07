// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Path template resolver. Replaces `{name}` placeholders from args, with
 * optional default `{name|default}` and raw escape `{name:raw}`.
 */
export function resolvePathTemplate(
    template: string,
    args: Record<string, unknown>,
): string {
    return template.replace(/\{([^}]+)\}/g, (_match, placeholder: string) => {
        const isRaw = placeholder.endsWith(":raw");
        const cleaned = isRaw ? placeholder.slice(0, -4) : placeholder;
        const pipeIdx = cleaned.indexOf("|");
        const argName = pipeIdx >= 0 ? cleaned.slice(0, pipeIdx) : cleaned;
        const fallback = pipeIdx >= 0 ? cleaned.slice(pipeIdx + 1) : "";
        const raw = args[argName];
        const value = raw === undefined || raw === null ? fallback : String(raw);
        return isRaw ? value : encodeURIComponent(value);
    });
}
