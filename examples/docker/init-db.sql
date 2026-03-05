-- SPDX-License-Identifier: AGPL-3.0-only
-- Initialize the AgentRun database schema

-- Enable pgvector extension for RAG embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Sessions table (conversation history)
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ttl TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_ttl ON sessions (ttl) WHERE ttl IS NOT NULL;

-- Usage tracking table
CREATE TABLE IF NOT EXISTS usage (
    pk TEXT PRIMARY KEY,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Knowledge base chunks (RAG)
CREATE SCHEMA IF NOT EXISTS agentrun;

CREATE TABLE IF NOT EXISTS agentrun.chunks (
    id SERIAL PRIMARY KEY,
    pack TEXT NOT NULL,
    source TEXT NOT NULL,
    heading TEXT,
    content TEXT NOT NULL,
    embedding vector(1024),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_pack ON agentrun.chunks (pack);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON agentrun.chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

-- Event dedup table
CREATE TABLE IF NOT EXISTS event_dedup (
    event_id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ttl TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes')
);

CREATE INDEX IF NOT EXISTS idx_dedup_ttl ON event_dedup (ttl);
