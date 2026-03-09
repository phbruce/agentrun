// SPDX-License-Identifier: AGPL-3.0-only
export type ResponseCategory =
    | "greeting"
    | "lambda"
    | "kubernetes"
    | "database"
    | "logs"
    | "pull_requests"
    | "metrics"
    | "sqs"
    | "generic";

const GREETING_PATTERNS = new Set([
    "oi", "olá", "ola", "hello", "hi", "hey",
    "help", "ajuda", "menu", "comandos", "commands",
    "bom dia", "boa tarde", "boa noite",
]);

const CATEGORY_KEYWORDS: Record<Exclude<ResponseCategory, "greeting" | "generic">, string[]> = {
    lambda: ["lambda", "lambdas", "função", "funcao", "funções", "funcoes", "function", "functions", "invoke", "timeout", "memory", "runtime", "cold start", "concurrency"],
    kubernetes: ["k8s", "kubernetes", "pod", "pods", "node", "nodes", "eks", "cluster", "namespace", "service", "ingress", "hpa", "istio", "helm"],
    database: ["database", "banco", "db", "rds", "aurora", "postgres", "postgresql", "proxy", "rds proxy", "query", "conexão", "conexao", "connection", "oltp"],
    logs: ["log", "logs", "cloudwatch", "erro", "error", "exception", "stack trace", "stacktrace"],
    pull_requests: ["pr", "prs", "pull request", "pull requests", "merge", "branch", "commit", "commits", "github", "review", "deploy", "deployment", "deployado", "release", "shipped", "mergou", "merged"],
    metrics: ["métrica", "metrica", "métricas", "metricas", "metric", "metrics", "cpu", "memória", "memoria", "memory", "latência", "latencia", "latency", "throughput", "invocations", "errors", "duration"],
    sqs: ["sqs", "fila", "filas", "queue", "queues", "dlq", "dead letter", "mensagens paradas", "backlog", "stuck", "mensagens falhando"],
};

export function classifyQuery(query: string): ResponseCategory {
    const normalized = query.trim().toLowerCase();

    if (GREETING_PATTERNS.has(normalized)) {
        return "greeting";
    }

    const scores: Partial<Record<ResponseCategory, number>> = {};

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        let score = 0;
        for (const kw of keywords) {
            if (normalized.includes(kw)) {
                score += kw.includes(" ") ? 2 : 1; // multi-word keywords score higher
            }
        }
        if (score > 0) {
            scores[category as ResponseCategory] = score;
        }
    }

    const entries = Object.entries(scores) as [ResponseCategory, number][];
    if (entries.length === 0) return "generic";

    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
}
