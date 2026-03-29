// Jest setup file
// Add global test utilities and mocks here

// Mock Firestore globally for all tests
jest.mock("@google-cloud/firestore", () => ({
  Firestore: jest.fn(),
}));

// Mock KMS globally for all tests
jest.mock("@google-cloud/kms", () => ({
  KeyManagementServiceClient: jest.fn(),
}));
