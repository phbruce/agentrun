// SPDX-License-Identifier: AGPL-3.0-only
import type { IdentitySource, Role } from "../rbac/types.js";
import type { FormatMode } from "../channels/types.js";
import { getRoleConfigs, VIEWS_SECTION } from "../rbac/roleConfig.js";
import { getDisplayName, getRoleForUser } from "../rbac/userRegistry.js";
import { getUseCasesForRole, getWorkflowsForUseCase, getToolDefsForRole, getSkillsForRole, getKnowledgeBasesForRole } from "../catalog/catalog.js";
import { PlatformRegistry } from "../platform/registry.js";

export function buildSystemPrompt(userId: string, source: IdentitySource, formatMode: FormatMode = "markdown"): string {
    const role = getRoleForUser(userId, source);
    const displayName = getDisplayName(userId, source);
    const roleConfigs = getRoleConfigs();
    const config = roleConfigs[role];
    const persona = config?.persona ?? "Respostas concisas e diretas.";

    return [
        buildBaseSection(userId, displayName, role),
        buildUseCasesSection(role),
        buildToolCatalogSection(role),
        buildSkillsSection(role),
        buildKnowledgeBasesSection(role),
        buildPersonaSection(role, persona),
        buildViewsSection(role),
        buildFormatSection(formatMode),
    ].filter(Boolean).join("\n\n");
}

function buildBaseSection(userId: string, displayName: string, role: Role): string {
    const registry = PlatformRegistry.instance();

    if (!registry.isConfigured) {
        // Fallback: hardcoded (should not happen in production)
        return buildHardcodedBaseSection(userId, displayName, role);
    }

    const env = registry.config.spec.environment;

    // Build resources section
    const resourceLines = env.resources.map((r) =>
        `- *${r.type}*: ${r.name} (${r.description})`,
    ).join("\n");

    // Build repos section
    const repoLines = env.repos.map((r) =>
        `- *${r.name}*: ${r.description}`,
    ).join("\n");

    return `You are the infrastructure assistant for ${env.name}.
You help the engineering team query and understand the production infrastructure.

## Identity
- Purpose: Read-only infrastructure queries
- Invoked by: ${displayName} (${userId})
- Role: ${role}

## ${env.cloud.toUpperCase()} Environment
- Account: ${env.account}
- Region: ${env.region}
- Environment: ${env.env}

## Key Resources
${resourceLines}

## Repositories
${repoLines}`;
}

function buildHardcodedBaseSection(userId: string, displayName: string, role: Role): string {
    return `You are the infrastructure assistant.
You help the engineering team query and understand the production infrastructure.

## Identity
- Purpose: Read-only infrastructure queries
- Invoked by: ${displayName} (${userId})
- Role: ${role}

## Environment
No platform config loaded. Provide a config file via AGENTRUN_PLATFORM_CONFIG or AGENTRUN_CONFIG_INLINE.`;
}

function buildUseCasesSection(role: Role): string {
    const useCases = getUseCasesForRole(role);
    if (useCases.length === 0) return "";

    const lines = useCases.map((uc) => {
        const workflows = getWorkflowsForUseCase(uc.name);
        const wfLines = workflows.map((wf) => {
            const toolNames = wf.tools.join(", ");
            return `  → ${wf.name}: ${wf.description} (tools: ${toolNames})`;
        }).join("\n");
        return `- *${uc.name}*: ${uc.description}\n${wfLines}`;
    });

    return `## Operações Disponíveis (Use Cases)
As operações que você pode realizar para este usuário:

${lines.join("\n")}`;
}

function buildPersonaSection(role: Role, persona: string): string {
    const roleConfigs = getRoleConfigs();
    const config = roleConfigs[role];
    const capabilities = config?.capabilities;

    let section = `## Persona (perfil default: ${role})\n${persona}`;
    if (capabilities) {
        section += `\nCapabilities: ${capabilities}`;
    }
    return section;
}

function buildToolCatalogSection(role: Role): string {
    const toolDefs = getToolDefsForRole(role);
    if (toolDefs.length === 0) return "";

    // Group by category
    const byCategory = new Map<string, typeof toolDefs>();
    for (const tool of toolDefs) {
        const cat = tool.category || "general";
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(tool);
    }

    const sections: string[] = [];
    for (const [category, tools] of byCategory) {
        const toolLines = tools.map(t => `  - ${t.name}: ${t.description}`).join("\n");
        sections.push(`*${category}*\n${toolLines}`);
    }

    return `## Tool Catalog\n${sections.join("\n")}`;
}

function buildSkillsSection(role: Role): string {
    const skills = getSkillsForRole(role);
    if (skills.length === 0) return "";

    const lines = skills.map(s => {
        const argsHint = s.args ? " <args>" : "";
        const parts = [`- \`${s.command}${argsHint}\`: ${s.description}`];

        // Include required tools so LLM knows what the skill needs
        if (s.tools.length > 0) {
            parts.push(`  Tools: ${s.tools.join(", ")}`);
        }

        // Extract usage example from the skill prompt (first line after "## Usage" or "```")
        const exampleMatch = s.prompt.match(/(?:example|usage|exemplo)[:\s]*\n*```?\n?(.+?)(?:\n```|\n\n|\n##)/is);
        if (exampleMatch) {
            parts.push(`  Example: \`${exampleMatch[1].trim()}\``);
        }

        return parts.join("\n");
    });

    return `## Skills (Slash Commands)\nInvoke skills by typing the command. Skills with <args> require arguments.\n\n${lines.join("\n")}`;
}

function buildKnowledgeBasesSection(role: Role): string {
    const kbs = getKnowledgeBasesForRole(role);
    if (kbs.length === 0) return "";

    const lines = kbs.map(kb => `- *${kb.name}*: ${kb.description} (tags: ${kb.tags.join(", ") || "all"})`);
    return `## Knowledge Bases (use knowledge_search tool to retrieve content)
The following knowledge bases are available. Do NOT guess their content — use the knowledge_search tool to retrieve specific information when the user asks about topics covered by these bases.

${lines.join("\n")}`;
}

function buildViewsSection(role: Role): string {
    return `${VIEWS_SECTION}

Seu perfil default é *${role}*. Use essa persona por padrão.`;
}

function buildFormatSection(mode: FormatMode): string {
    const structureRules = buildStructureRules(mode);
    const formatRules = buildFormatRules(mode);

    return `## Response Format — OBRIGATÓRIO

${structureRules}

${formatRules}

### Lambda: always show readable name
When listing Lambdas, ALWAYS show the readable name (Description field) alongside the hash. The technical name alone is useless to the user.
Format: *ReadableName* (function-prefix-{hash_short}...)

### Tool usage
- ALWAYS call tools to fetch real-time data. NEVER answer from conversation history when the user asks for current state (open MRs, active sprints, issue status, etc.).
- If the user asks the same question again, call the tool again — data may have changed.
- Do NOT hallucinate tool results. If a tool returns an error, say so.

### Anti-slop
- Concise and factual. Straight to the point.
- NEVER use filler: "let me check", "great question", "sure"
- NEVER start with greetings. Start with the information.
- If not found: "Not found." + brief reason.
- ZERO emojis. None. No exceptions.

### Language
- Respond in the same language the user writes in.

### Security
- NEVER expose secrets, passwords, or sensitive environment variables.
- READ-ONLY: never suggest modifying infrastructure.
- If ambiguous, ask for clarification briefly.`;
}

function buildStructureRules(mode: FormatMode): string {
    if (mode === "plain") {
        return `### Estrutura de seções
Use linhas em branco para separar seções lógicas.

Primeira seção: resumo geral (uma ou duas linhas).
Demais seções: comece com o título na primeira linha, seguido de detalhes abaixo.

### Detalhes chave: valor
Linhas consecutivas no formato \`Chave: valor\` para propriedades de recursos.

### Listas
Use \`- \` (hífen + espaço) para itens de lista. NÃO use bullet char (•).
Cada item deve ser uma única linha.
Para listas curtas de nomes/identificadores, use vírgulas numa única linha ao invés de bullet points.`;
    }

    if (mode === "slack-mrkdwn") {
        return `### Estrutura de seções
Sua resposta será renderizada como blocos visuais no Slack. Use \`---\` em linha própria para separar seções lógicas. Cada seção se torna um bloco visual separado por uma linha horizontal.

Primeira seção: resumo geral (uma ou duas linhas).
Demais seções: comece com *Título em bold* na primeira linha, seguido de detalhes abaixo.

Exemplo:
\`\`\`
Encontradas *155 Lambda functions* na conta prd
---
*API Functions*
Total: 50
Runtime: nodejs20.x
Config: 128MB RAM, 10s timeout
---
*Consumidores de filas*
Total: 8
Runtime: provided.al2
---
*Most recent function*
MyProcessHandler
Memory: 512MB, Timeout: 900s
Updated: 2026-02-21
\`\`\`

### Detalhes chave: valor
Linhas consecutivas no formato \`Chave: valor\` são renderizadas automaticamente como grid 2 colunas. Use esse formato para propriedades de recursos.

### Listas
Use \`- \` (hífen + espaço) para itens de lista. NÃO use bullet char (•).
Cada item deve ser uma única linha.
Para listas curtas de nomes/identificadores (ex: nomes de filas, domínios, atualizações recentes, ambientes), use vírgulas numa única linha ao invés de bullet points. Reserve bullet points apenas para itens com descrições longas ou multi-linha.`;
    }

    // markdown and gchat-card share the same structure
    return `### Estrutura de seções
Use \`---\` em linha própria para separar seções lógicas.

Primeira seção: resumo geral (uma ou duas linhas).
Demais seções: comece com **Título em bold** ou use headers \`##\`, seguido de detalhes abaixo.

### Detalhes chave: valor
Linhas consecutivas no formato \`Chave: valor\` para propriedades de recursos.

### Listas
Use \`- \` (hífen + espaço) para itens de lista. NÃO use bullet char (•).
Cada item deve ser uma única linha.
Para listas curtas de nomes/identificadores, use vírgulas numa única linha ao invés de bullet points. Reserve bullet points apenas para itens com descrições longas ou multi-linha.`;
}

function buildFormatRules(mode: FormatMode): string {
    switch (mode) {
        case "slack-mrkdwn":
            return `### Slack mrkdwn
- Bold: *texto* (NÃO **texto**)
- Itálico: _texto_
- Code inline: \`code\`
- Code block: \`\`\` (SEM language hint)
- NÃO use # para headers, NÃO use tabelas markdown, NÃO use [links](url)`;

        case "markdown":
            return `### Markdown
- Bold: **texto**
- Itálico: *texto*
- Code inline: \`code\`
- Code block: \`\`\` com language hint quando apropriado
- Headers: use \`##\` e \`###\`
- Tabelas markdown são permitidas quando apropriado
- Links: [texto](url)`;

        case "gchat-card":
            return `### Google Chat (Markdown)
- Bold: **texto**
- Itálico: *texto*
- Code inline: \`code\`
- Code block: \`\`\` com language hint quando apropriado
- Headers: use \`##\` e \`###\`
- Respostas serão renderizadas em cards do Google Chat. Mantenha formatação simples — markdown padrão funciona bem.`;

        case "plain":
            return `### Texto simples
- Sem formatação especial. Apenas texto puro.
- Use MAIÚSCULAS para ênfase quando necessário.
- Use indentação com espaços para hierarquia.`;
    }
}
