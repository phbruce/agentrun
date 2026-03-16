// SPDX-License-Identifier: AGPL-3.0-only
// ---------------------------------------------------------------------------
// A2A Protocol Types (Google Agent-to-Agent Protocol)
// Skeleton for future protocol interoperability.
// ---------------------------------------------------------------------------

/** A2A Agent Card — describes an agent's capabilities for discovery. */
export interface AgentCard {
    name: string;
    description: string;
    url: string;
    capabilities: string[];
    authentication: { type: string; config?: Record<string, unknown> };
    version: string;
    skills?: AgentSkillCard[];
}

/** Skill entry within an Agent Card. */
export interface AgentSkillCard {
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples: string[];
}

// ---------------------------------------------------------------------------
// A2A Task Lifecycle Types
// ---------------------------------------------------------------------------

export type TaskState = "submitted" | "working" | "input-required" | "completed" | "canceled" | "failed";

export interface TaskPart {
    type: "text" | "data" | "file";
    content: string;
    mimeType?: string;
}

export interface TaskMessage {
    role: string;
    parts: TaskPart[];
}

export interface TaskRequest {
    id: string;
    sessionId?: string;
    message: TaskMessage;
}

export interface TaskStatus {
    id: string;
    state: TaskState;
    message?: TaskMessage;
    updatedAt?: string;
}

export interface TaskResponse {
    id: string;
    state: TaskState;
    message?: TaskMessage;
    artifacts?: TaskArtifact[];
}

export interface TaskArtifact {
    name: string;
    parts: TaskPart[];
}

// ---------------------------------------------------------------------------
// Protocol Adapter Interface
// ---------------------------------------------------------------------------

/** Abstract adapter for protocol interoperability (MCP, A2A, future protocols). */
export interface ProtocolAdapter {
    /** Protocol name (e.g., "mcp", "a2a") */
    name: string;

    /** Protocol version */
    protocolVersion: string;

    /** Negotiate capabilities with a remote agent. */
    negotiate(agentCard: AgentCard): Promise<boolean>;

    /** Submit a task to a remote agent. */
    submitTask(task: TaskRequest): Promise<TaskResponse>;

    /** Check the status of a running task. */
    getTaskStatus(taskId: string): Promise<TaskStatus>;
}
