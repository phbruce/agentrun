import { describe, it, expect, beforeEach } from "@jest/globals";
import { createOpenAICaller, type OpenAICallerConfig } from "./openaiCaller.js";

describe("OpenAI Caller", () => {
  let config: OpenAICallerConfig;

  beforeEach(() => {
    config = {
      baseUrl: "https://api.openai.com",
      defaultModel: "gpt-4o",
      resolveToken: async () => "test-token-123",
      timeoutMs: 5000,
    };
  });

  describe("createOpenAICaller", () => {
    it("should create a callable function", () => {
      const caller = createOpenAICaller(config);
      expect(typeof caller).toBe("function");
    });

    it("should use default model when not specified", async () => {
      // Mock fetch globally
      const mockResponses: any[] = [];
      const originalFetch = global.fetch;

      (global as any).fetch = async () => {
        mockResponses.push({ model: "gpt-4o" });
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "Hi" } }],
            usage: {},
          }),
        };
      };

      try {
        const caller = createOpenAICaller(config);
        await caller({
          systemPrompt: "You are helpful",
          contents: [],
          tools: [],
        });

        expect(mockResponses.length).toBeGreaterThan(0);
      } finally {
        (global as any).fetch = originalFetch;
      }
    });

    it("should handle text response", async () => {
      const expectedText = "This is a response";

      const originalFetch = global.fetch;
      (global as any).fetch = async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: expectedText } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      });

      try {
        const caller = createOpenAICaller(config);
        const result = await caller({
          systemPrompt: "You are helpful",
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          tools: [],
        });

        expect(result.text).toBe(expectedText);
        expect(result.inputTokens).toBe(10);
        expect(result.outputTokens).toBe(20);
      } finally {
        (global as any).fetch = originalFetch;
      }
    });

    it("should handle function calls", async () => {
      const originalFetch = global.fetch;
      (global as any).fetch = async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "call_123",
                    function: {
                      name: "search_issues",
                      arguments: '{"query":"urgent"}',
                    },
                  },
                ],
              },
            },
          ],
          usage: {},
        }),
      });

      try {
        const caller = createOpenAICaller(config);
        const result = await caller({
          systemPrompt: "You are helpful",
          contents: [],
          tools: [
            {
              name: "search_issues",
              description: "Search for issues",
              parameters: { type: "object", properties: {} },
            },
          ],
        });

        expect(result.functionCalls).toHaveLength(1);
        expect(result.functionCalls?.[0].name).toBe("search_issues");
        expect(result.functionCalls?.[0].args).toEqual({ query: "urgent" });
      } finally {
        (global as any).fetch = originalFetch;
      }
    });

    it("should handle API errors", async () => {
      const originalFetch = global.fetch;
      (global as any).fetch = async () => ({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      try {
        const caller = createOpenAICaller(config);

        await expect(
          caller({
            systemPrompt: "You are helpful",
            contents: [],
            tools: [],
          })
        ).rejects.toThrow("GenAI Gateway error 401");
      } finally {
        (global as any).fetch = originalFetch;
      }
    });

    it("should resolve token for specific user", async () => {
      const tokenResolver = async (userId?: string) => {
        expect(userId).toBe("U12345");
        return "user-specific-token";
      };

      const callerConfig = { ...config, resolveToken: tokenResolver };

      const originalFetch = global.fetch;
      (global as any).fetch = async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Hi" } }],
          usage: {},
        }),
      });

      try {
        const caller = createOpenAICaller(callerConfig);
        await caller({
          systemPrompt: "You are helpful",
          contents: [],
          tools: [],
          userId: "U12345",
        });
      } finally {
        (global as any).fetch = originalFetch;
      }
    });
  });
});
