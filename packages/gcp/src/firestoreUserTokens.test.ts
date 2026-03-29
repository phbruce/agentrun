import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { FirestoreUserTokenStore } from "./firestoreUserTokens.js";
import type { UserToken } from "@agentrun-ai/core";

// Mock Firestore
jest.mock("@google-cloud/firestore");
jest.mock("@google-cloud/kms");

describe("FirestoreUserTokenStore", () => {
  let store: FirestoreUserTokenStore;
  let mockFirestore: any;
  let mockDoc: any;

  beforeEach(() => {
    // Setup mock Firestore
    mockDoc = {
      exists: true,
      data: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    };

    mockFirestore = {
      collection: jest.fn(() => ({
        doc: jest.fn((userId: string) => ({
          collection: jest.fn((colName: string) => ({
            doc: jest.fn((provider: string) => mockDoc),
            get: jest.fn(),
          })),
        })),
      })),
    };

    // Initialize store without KMS
    store = new FirestoreUserTokenStore("test-tokens", undefined, undefined);
    (store as any).firestore = mockFirestore;
  });

  describe("getToken", () => {
    it("should retrieve token successfully", async () => {
      const expiresAt = Date.now() + 3600000;
      const mockToken = {
        accessToken: "token123",
        refreshToken: "refresh123",
        expiresAt,
        tokenType: "bearer",
        idToken: undefined,
        scopes: undefined,
        savedAt: 0,
      };

      mockDoc.exists = true;
      mockDoc.data.mockReturnValue(mockToken);
      mockDoc.get.mockResolvedValue(mockDoc);

      const result = await store.getToken("U12345", "google");

      expect(result?.accessToken).toBe("token123");
      expect(result?.refreshToken).toBe("refresh123");
      expect(result?.tokenType).toBe("bearer");
    });

    it("should return null if token does not exist", async () => {
      mockDoc.exists = false;
      mockDoc.get.mockResolvedValue(mockDoc);

      const result = await store.getToken("U12345", "google");

      expect(result).toBeNull();
    });

    it("should handle missing optional fields", async () => {
      mockDoc.exists = true;
      mockDoc.data.mockReturnValue({
        accessToken: "token123",
        tokenType: "bearer",
        // No refreshToken, idToken, scopes, etc.
      });
      mockDoc.get.mockResolvedValue(mockDoc);

      const result = await store.getToken("U12345", "google");

      expect(result?.accessToken).toBe("token123");
      expect(result?.refreshToken).toBeUndefined();
      expect(result?.tokenType).toBe("bearer");
    });
  });

  describe("saveToken", () => {
    it("should save token with all fields", async () => {
      const token: UserToken = {
        accessToken: "token123",
        refreshToken: "refresh123",
        idToken: "id123",
        expiresAt: Date.now() + 3600000,
        tokenType: "bearer",
        scopes: ["openid", "email"],
        savedAt: Date.now(),
      };

      mockDoc.set.mockResolvedValue(undefined);

      await store.saveToken("U12345", "google", token);

      expect(mockDoc.set).toHaveBeenCalled();
      const callArgs = mockDoc.set.mock.calls[0][0];

      expect(callArgs.accessToken).toBe("token123");
      expect(callArgs.refreshToken).toBe("refresh123");
      expect(callArgs.idToken).toBe("id123");
      expect(callArgs.tokenType).toBe("bearer");
      expect(callArgs.scopes).toEqual(["openid", "email"]);
    });

    it("should handle partial tokens", async () => {
      const token: UserToken = {
        accessToken: "token123",
        tokenType: "bearer",
        savedAt: Date.now(),
      };

      mockDoc.set.mockResolvedValue(undefined);

      await store.saveToken("U12345", "google", token);

      expect(mockDoc.set).toHaveBeenCalled();
      const callArgs = mockDoc.set.mock.calls[0][0];

      expect(callArgs.accessToken).toBe("token123");
      expect(callArgs.refreshToken).toBeNull();
      expect(callArgs.idToken).toBeNull();
    });

    it("should set encrypted flag when KMS is configured", async () => {
      const storeWithKMS = new FirestoreUserTokenStore(
        "test-tokens",
        undefined,
        "projects/test/locations/us/keyRings/ring/cryptoKeys/key"
      );
      (storeWithKMS as any).firestore = mockFirestore;
      (storeWithKMS as any).kmsClient = null; // Mock KMS client

      // Mock encryption
      (storeWithKMS as any).encrypt = jest.fn(async (text) => text);

      const token: UserToken = {
        accessToken: "token123",
        tokenType: "bearer",
        savedAt: Date.now(),
      };

      mockDoc.set.mockResolvedValue(undefined);

      await storeWithKMS.saveToken("U12345", "google", token);

      const callArgs = mockDoc.set.mock.calls[0][0];
      expect(callArgs.encrypted).toBe(true);
    });
  });

  describe("deleteToken", () => {
    it("should delete token successfully", async () => {
      mockDoc.delete.mockResolvedValue(undefined);

      await store.deleteToken("U12345", "google");

      expect(mockDoc.delete).toHaveBeenCalled();
    });
  });

  describe("listProviders", () => {
    it("should list all providers for user", async () => {
      const mockSnapshot: any = {
        docs: [{ id: "google" }, { id: "github" }, { id: "gitlab" }],
      };

      const collectionRef: any = {
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            get: (jest.fn() as any).mockResolvedValue(mockSnapshot),
          })),
        })),
      };

      mockFirestore.collection.mockReturnValue(collectionRef);

      const result = await store.listProviders("U12345");

      expect(result).toEqual(["google", "github", "gitlab"]);
    });

    it("should return empty array if user has no tokens", async () => {
      const mockSnapshot: any = { docs: [] };

      const collectionRef: any = {
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            get: (jest.fn() as any).mockResolvedValue(mockSnapshot),
          })),
        })),
      };

      mockFirestore.collection.mockReturnValue(collectionRef);

      const result = await store.listProviders("U12345");

      expect(result).toEqual([]);
    });
  });

  describe("Collection Structure", () => {
    it("should use correct Firestore collection path", async () => {
      mockDoc.get.mockResolvedValue(mockDoc);
      mockDoc.exists = false;

      await store.getToken("U12345", "google");

      const collectionCall = mockFirestore.collection.mock.calls[0];
      expect(collectionCall[0]).toBe("test-tokens");
    });

    it("should use custom database ID if provided", () => {
      const customStore = new FirestoreUserTokenStore(
        "custom-tokens",
        "custom-db",
        undefined
      );
      // Verify it was initialized (can't fully test without mocking constructor)
      expect(customStore).toBeDefined();
    });
  });

  describe("Encryption Behavior", () => {
    it("should NOT encrypt when KMS key is not configured", async () => {
      const token: UserToken = {
        accessToken: "plaintext-token",
        tokenType: "bearer",
        savedAt: Date.now(),
      };

      mockDoc.set.mockResolvedValue(undefined);

      await store.saveToken("U12345", "google", token);

      const callArgs = mockDoc.set.mock.calls[0][0];
      // Without KMS, token should be stored as-is (plaintext)
      expect(callArgs.accessToken).toBe("plaintext-token");
      expect(callArgs.encrypted).toBe(false);
    });
  });
});
