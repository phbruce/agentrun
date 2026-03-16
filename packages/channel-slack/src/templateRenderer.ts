// SPDX-License-Identifier: AGPL-3.0-only

interface BlockTemplate {
    blocks: any[];
}

export interface RenderContext {
    vars: Record<string, string>;
    lists?: Record<string, Record<string, string>[]>;
    slots?: Record<string, any[]>;
}

// ---------------------------------------------------------------------------
// Embedded templates (avoid runtime file I/O for portability)
// ---------------------------------------------------------------------------

const GREETING_TEMPLATE: BlockTemplate = {
    blocks: [
        { _slot: "header" },
        { type: "divider" },
        { _slot: "skills" },
        { _slot: "useCases" },
        { type: "divider" },
        {
            type: "context",
            elements: [
                { type: "mrkdwn", text: "Read-only. Select a workflow or ask in natural language." },
            ],
        },
    ],
};

const RESPONSE_TEMPLATE: BlockTemplate = {
    blocks: [
        {
            type: "context",
            elements: [
                { type: "mrkdwn", text: "*{{label}}*  |  {{query}}" },
            ],
        },
        { type: "divider" },
        { _slot: "content" },
        { type: "divider" },
        {
            type: "context",
            elements: [
                { type: "mrkdwn", text: "{{toolList}}  |  {{duration}}s  |  {{tokens}} tokens" },
            ],
        },
    ],
};

const ERROR_TEMPLATE: BlockTemplate = {
    blocks: [
        {
            type: "context",
            elements: [
                { type: "mrkdwn", text: "{{query}}" },
            ],
        },
        { type: "divider" },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: "*Error:* {{error}}",
            },
        },
        {
            type: "context",
            elements: [
                { type: "mrkdwn", text: "Try rephrasing your query or verify the resource exists." },
            ],
        },
    ],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderGreeting(ctx: RenderContext): any[] {
    return renderTemplate(GREETING_TEMPLATE, ctx);
}

export function renderResponse(ctx: RenderContext): any[] {
    return renderTemplate(RESPONSE_TEMPLATE, ctx);
}

export function renderError(ctx: RenderContext): any[] {
    return renderTemplate(ERROR_TEMPLATE, ctx);
}

// ---------------------------------------------------------------------------
// Template engine
// ---------------------------------------------------------------------------

function renderTemplate(template: BlockTemplate, ctx: RenderContext): any[] {
    const result: any[] = [];

    for (const block of template.blocks) {
        if ("_repeat" in block) {
            const repeatBlock = block as any;
            const items = ctx.lists?.[repeatBlock._repeat] ?? [];
            if (items.length === 0 && repeatBlock._empty) {
                result.push(resolveVars(repeatBlock._empty, ctx.vars));
            } else {
                for (const item of items) {
                    const merged = { ...ctx.vars, ...item };
                    result.push(resolveVars(repeatBlock._template, merged));
                }
            }
        } else if ("_slot" in block) {
            const slotBlock = block as any;
            const slotContent = ctx.slots?.[slotBlock._slot] ?? [];
            result.push(...slotContent);
        } else {
            result.push(resolveVars(block, ctx.vars));
        }
    }

    return result;
}

function resolveVars(obj: any, vars: Record<string, string>): any {
    if (typeof obj === "string") {
        return obj.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
    }
    if (Array.isArray(obj)) {
        return obj.map((item) => resolveVars(item, vars));
    }
    if (obj !== null && typeof obj === "object") {
        const resolved: any = {};
        for (const [key, value] of Object.entries(obj)) {
            resolved[key] = resolveVars(value, vars);
        }
        return resolved;
    }
    return obj;
}
