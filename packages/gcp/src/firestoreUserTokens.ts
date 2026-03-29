// SPDX-License-Identifier: AGPL-3.0-only

import { Firestore } from "@google-cloud/firestore";
import type { UserTokenStore, UserToken } from "@agentrun-ai/core";

/**
 * Firestore-backed UserTokenStore with optional Cloud KMS envelope encryption.
 *
 * Documents are stored in the structure:
 *   {collectionName}/{userId}/providers/{providerName}
 *
 * When a KMS key name is provided, the accessToken and refreshToken fields
 * are encrypted before writing and decrypted after reading. All other fields
 * (expiresAt, tokenType, scopes, savedAt) are stored in plaintext so they
 * can be queried and indexed without decryption.
 *
 * Encryption uses Google Cloud KMS symmetric encrypt/decrypt. The KMS key
 * must exist and the service account must have roles/cloudkms.cryptoKeyEncrypterDecrypter.
 */
export class FirestoreUserTokenStore implements UserTokenStore {
    private firestore: Firestore;
    private collection: string;
    private kmsKeyName: string | undefined;
    private kmsClient: any; // Lazy-loaded KeyManagementServiceClient

    constructor(collectionName = "agentrun-user-tokens", databaseId?: string, kmsKeyName?: string) {
        this.firestore = databaseId
            ? new Firestore({ databaseId })
            : new Firestore();
        this.collection = collectionName;
        this.kmsKeyName = kmsKeyName;
    }

    private async getKmsClient() {
        if (!this.kmsClient) {
            const { KeyManagementServiceClient } = await import("@google-cloud/kms");
            this.kmsClient = new KeyManagementServiceClient();
        }
        return this.kmsClient;
    }

    private async encrypt(plaintext: string): Promise<string> {
        if (!this.kmsKeyName) return plaintext;
        const client = await this.getKmsClient();
        const [result] = await client.encrypt({
            name: this.kmsKeyName,
            plaintext: Buffer.from(plaintext, "utf-8"),
        });
        return Buffer.from(result.ciphertext).toString("base64");
    }

    private async decrypt(ciphertext: string): Promise<string> {
        if (!this.kmsKeyName) return ciphertext;
        const client = await this.getKmsClient();
        const [result] = await client.decrypt({
            name: this.kmsKeyName,
            ciphertext: Buffer.from(ciphertext, "base64"),
        });
        return Buffer.from(result.plaintext).toString("utf-8");
    }

    async getToken(userId: string, provider: string): Promise<UserToken | null> {
        const doc = await this.firestore
            .collection(this.collection)
            .doc(userId)
            .collection("providers")
            .doc(provider)
            .get();

        if (!doc.exists) return null;

        const data = doc.data()!;
        return {
            accessToken: await this.decrypt(data.accessToken),
            refreshToken: data.refreshToken ? await this.decrypt(data.refreshToken) : undefined,
            idToken: data.idToken ? await this.decrypt(data.idToken) : undefined,
            expiresAt: data.expiresAt ?? undefined,
            tokenType: data.tokenType ?? "bearer",
            scopes: data.scopes ?? undefined,
            savedAt: data.savedAt ?? 0,
        };
    }

    async saveToken(userId: string, provider: string, token: UserToken): Promise<void> {
        await this.firestore
            .collection(this.collection)
            .doc(userId)
            .collection("providers")
            .doc(provider)
            .set({
                accessToken: await this.encrypt(token.accessToken),
                refreshToken: token.refreshToken ? await this.encrypt(token.refreshToken) : null,
                idToken: token.idToken ? await this.encrypt(token.idToken) : null,
                expiresAt: token.expiresAt ?? null,
                tokenType: token.tokenType,
                scopes: token.scopes ?? null,
                savedAt: token.savedAt,
                updatedAt: Date.now(),
                encrypted: !!this.kmsKeyName,
            });
    }

    async deleteToken(userId: string, provider: string): Promise<void> {
        await this.firestore
            .collection(this.collection)
            .doc(userId)
            .collection("providers")
            .doc(provider)
            .delete();
    }

    async listProviders(userId: string): Promise<string[]> {
        const snapshot = await this.firestore
            .collection(this.collection)
            .doc(userId)
            .collection("providers")
            .get();

        return snapshot.docs.map((doc) => doc.id);
    }
}
