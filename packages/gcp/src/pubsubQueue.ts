// SPDX-License-Identifier: AGPL-3.0-only

import { PubSub } from "@google-cloud/pubsub";
import { createHash } from "crypto";
import type { QueueProvider } from "@agentrun-ai/core";

/**
 * Pub/Sub-backed QueueProvider.
 *
 * Topic names are derived by applying a configurable naming pattern.
 * By default, the pattern `{prefix}{sha1}` hashes the logical queue name
 * with SHA-1 and prepends the configured prefix.
 *
 * @param projectId   - GCP project ID
 * @param topicPrefix - Prefix prepended to the SHA-1 hash of the queue name
 */
export class PubSubQueueProvider implements QueueProvider {
    private pubsub: PubSub;
    private topicPrefix: string;

    constructor(projectId: string, topicPrefix = "") {
        this.pubsub = new PubSub({ projectId });
        this.topicPrefix = topicPrefix;
    }

    async send(queueName: string, payload: Record<string, unknown>): Promise<void> {
        const hash = createHash("sha1").update(queueName).digest("hex");
        const topicName = `${this.topicPrefix}${hash}`;

        const topic = this.pubsub.topic(topicName);
        const data = Buffer.from(JSON.stringify(payload));

        await topic.publishMessage({ data });
    }
}
