// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from "@jest/globals";
import { parsePackContents } from "./packLoader.js";
import { collectToolNamesForScope } from "./catalog.js";

const tool = (name: string) => `
apiVersion: agentrun/v1
kind: Tool
metadata:
  name: ${name}
spec:
  type: mcp-server
  mcpTool: mcp__infra-tools__${name}
  description: ${name}
  category: test
`;

const workflow = (name: string, tools: string[], withSteps = false) => `
apiVersion: agentrun/v1
kind: Workflow
metadata:
  name: ${name}
spec:
  description: ${name}
  tools: [${tools.join(", ")}]
${withSteps ? `  steps:\n    - name: s1\n      tool: ${tools[0]}\n` : ""}`;

const useCase = (name: string, workflows: string[], scope?: string) => `
apiVersion: agentrun/v1
kind: UseCase
metadata:
  name: ${name}
spec:
  description: ${name}
  keywords: [${name}]
  workflows: [${workflows.join(", ")}]
  template: "{{query}}"
${scope ? `  scope: ${scope}\n` : ""}`;

function samplePack() {
    const files = new Map<string, string>([
        ["tools/list-a.yaml", tool("list_a")],
        ["tools/get-b.yaml", tool("get_b")],
        ["tools/list-c.yaml", tool("list_c")],
        ["workflows/wf-a.yaml", workflow("wf_a", ["list_a"])],
        ["workflows/wf-a-run.yaml", workflow("wf_a_run", ["list_a"], true)],
        ["workflows/wf-b.yaml", workflow("wf_b", ["get_b"])],
        ["workflows/wf-c-run.yaml", workflow("wf_c_run", ["list_c"], true)],
        ["use-cases/uc-a.yaml", useCase("uc_a", ["wf_a", "wf_a_run"], "alpha")],
        ["use-cases/uc-b.yaml", useCase("uc_b", ["wf_b"], "beta")],
        ["use-cases/uc-c.yaml", useCase("uc_c", ["wf_c_run"])],
    ]);
    return parsePackContents("test-pack", files).catalog;
}

describe("parsePackContents", () => {
    it("keeps spec.scope on use-cases", () => {
        const catalog = samplePack();
        expect(catalog.useCases.get("uc_a")?.scope).toBe("alpha");
        expect(catalog.useCases.get("uc_b")?.scope).toBe("beta");
        expect(catalog.useCases.get("uc_c")?.scope).toBeUndefined();
    });
});

describe("collectToolNamesForScope", () => {
    it("returns only the tools and executable workflows of the given use-cases", () => {
        const catalog = samplePack();
        expect([...collectToolNamesForScope(catalog, ["uc_a"])].sort()).toEqual(["list_a", "wf_a_run"]);
        expect([...collectToolNamesForScope(catalog, ["uc_b"])].sort()).toEqual(["get_b"]);
    });

    it("does not leak executable workflows from use-cases outside the scope", () => {
        const catalog = samplePack();
        const names = collectToolNamesForScope(catalog, ["uc_b"]);
        expect(names.has("wf_a_run")).toBe(false);
        expect(names.has("wf_c_run")).toBe(false);
    });

    it("ignores unknown use-cases", () => {
        const catalog = samplePack();
        expect(collectToolNamesForScope(catalog, ["missing"]).size).toBe(0);
    });
});
