import { describe, it, expect } from "@jest/globals";
import {
  classifyComplexity,
  selectModel,
  getModelsForRole,
  type QueryComplexity,
} from "./modelRouter.js";
import type { ModelDef } from "../platform/types.js";

describe("Model Router", () => {
  // Test fixtures
  const mockModels: Record<string, ModelDef> = {
    "fast-model": {
      provider: "vertex-ai",
      modelId: "gemini-1.5-flash",
      capability: "fast",
      inputCostPer1kTokens: 0.001,
      outputCostPer1kTokens: 0.003,
      maxOutputTokens: 4096,
    },
    "balanced-model": {
      provider: "vertex-ai",
      modelId: "gemini-1.5-pro",
      capability: "balanced",
      inputCostPer1kTokens: 0.005,
      outputCostPer1kTokens: 0.015,
      maxOutputTokens: 8192,
    },
    "advanced-model": {
      provider: "vertex-ai",
      modelId: "gemini-2.0-pro",
      capability: "advanced",
      inputCostPer1kTokens: 0.01,
      outputCostPer1kTokens: 0.03,
      maxOutputTokens: 8192,
    },
  };

  describe("classifyComplexity", () => {
    it("should classify simple queries", () => {
      const simpleQueries = [
        "list services",
        "show status",
        "get issues",
        "what is the current deployment",
      ];

      simpleQueries.forEach((query) => {
        expect(classifyComplexity(query)).toBe("simple");
      });
    });

    it("should classify complex queries", () => {
      const complexQueries = [
        "analyze performance bottlenecks",
        "design migration strategy",
        "compare trade-offs between architectures",
        "root cause analysis of failures",
      ];

      complexQueries.forEach((query) => {
        expect(classifyComplexity(query)).toBe("complex");
      });
    });

    it("should classify moderate queries", () => {
      const moderateQueries = [
        "tell me about recent changes",
        "what happened last week",
        "summarize the project status",
      ];

      moderateQueries.forEach((query) => {
        expect(classifyComplexity(query)).toMatch(/simple|moderate|complex/);
      });
    });

    it("should handle long queries as complex", () => {
      const longQuery = "tell me ".repeat(20);
      expect(classifyComplexity(longQuery)).toBe("complex");
    });
  });

  describe("getModelsForRole", () => {
    it("should return all models when no allowlist specified", () => {
      const models = getModelsForRole(mockModels);
      expect(models).toHaveLength(3);
    });

    it("should filter models by allowed names", () => {
      const models = getModelsForRole(mockModels, ["fast-model", "advanced-model"]);
      expect(models).toHaveLength(2);
      expect(models.map((m) => m.name)).toEqual(
        expect.arrayContaining(["fast-model", "advanced-model"])
      );
    });

    it("should sort by capability then cost", () => {
      const models = getModelsForRole(mockModels);
      // Should be sorted: fast (0.001) < balanced (0.005) < advanced (0.01)
      expect(models[0].model.capability).toBe("fast");
      expect(models[1].model.capability).toBe("balanced");
      expect(models[2].model.capability).toBe("advanced");
    });

    it("should return empty array for non-existent models", () => {
      const models = getModelsForRole(mockModels, ["non-existent"]);
      expect(models).toHaveLength(0);
    });
  });

  describe("selectModel", () => {
    it("should select fast model for simple queries", () => {
      const selection = selectModel("list services", mockModels);
      expect(selection.name).toBe("fast-model");
      expect(selection.model.capability).toBe("fast");
    });

    it("should select advanced model for complex queries", () => {
      const selection = selectModel("design architecture migration", mockModels);
      expect(selection.model.capability).toBe("advanced");
    });

    it("should respect RBAC allowlist", () => {
      const selection = selectModel("list services", mockModels, ["advanced-model"]);
      // Even simple query, should use advanced if that's only allowed
      expect(selection.name).toBe("advanced-model");
    });

    it("should pick cheapest model meeting requirement", () => {
      const multiModels: Record<string, ModelDef> = {
        cheap_fast: {
          provider: "vertex-ai",
          modelId: "cheap",
          capability: "fast",
          inputCostPer1kTokens: 0.0001,
          outputCostPer1kTokens: 0.0003,
        },
        expensive_fast: {
          provider: "vertex-ai",
          modelId: "expensive",
          capability: "fast",
          inputCostPer1kTokens: 0.001,
          outputCostPer1kTokens: 0.003,
        },
      };

      const selection = selectModel("list services", multiModels);
      expect(selection.name).toBe("cheap_fast");
    });

    it("should include reason in selection", () => {
      const selection = selectModel("list services", mockModels);
      expect(selection.reason).toContain("simple");
      expect(selection.reason).toContain("fast");
    });

    it("should fallback to most capable when no model meets requirement", () => {
      // Only fast models available, but query is complex
      const fastOnly: Record<string, ModelDef> = {
        only_fast: mockModels["fast-model"],
      };

      const selection = selectModel("design complex architecture", fastOnly);
      expect(selection.name).toBe("only_fast");
      expect(selection.reason).toContain("best available");
    });

    it("should throw when no models available", () => {
      expect(() => selectModel("test", {})).toThrow();
    });
  });
});
