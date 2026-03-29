export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  roots: ["<rootDir>/packages"],
  testMatch: ["**/?(*.)+(spec|test).ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "esnext",
          target: "esnext",
        },
      },
    ],
  },
  collectCoverageFrom: [
    "packages/*/src/**/*.ts",
    "!packages/*/src/**/*.d.ts",
    "!packages/*/src/**/*.test.ts",
    "!packages/*/src/index.ts",
  ],
  coveragePathIgnorePatterns: ["/node_modules/"],
  moduleNameMapper: {
    "^@agentrun-ai/core$": "<rootDir>/packages/core/src/index.ts",
    "^@agentrun-ai/gcp$": "<rootDir>/packages/gcp/src/index.ts",
    "^@agentrun-ai/aws$": "<rootDir>/packages/aws/src/index.ts",
  },
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
};
