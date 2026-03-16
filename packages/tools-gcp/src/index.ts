// SPDX-License-Identifier: AGPL-3.0-only

// @agentrun-ai/tools-gcp — GCP infrastructure monitoring tools

// GCP clients
export { projectId, redactEnvVars } from "./_clients.js";

// Tool factories + singleton instances
export { createDescribeGkeCluster, describeGkeCluster } from "./describeGkeCluster.js";
export { createDescribeCloudSql, describeCloudSql } from "./describeCloudSql.js";
export { createListCloudFunctions, listCloudFunctions } from "./listCloudFunctions.js";
export { createGetCloudFunctionDetails, getCloudFunctionDetails } from "./getCloudFunctionDetails.js";
export { createSearchCloudLogging, searchCloudLogging } from "./searchCloudLogging.js";
export { createListPubsubTopics, listPubsubTopics } from "./listPubsubTopics.js";
export { createGetPubsubTopicAttributes, getPubsubTopicAttributes } from "./getPubsubTopicAttributes.js";
export { createSearchKnowledgeBase, searchKnowledgeBase } from "./searchKnowledgeBase.js";

// Aggregate factory
import { describeGkeCluster } from "./describeGkeCluster.js";
import { describeCloudSql } from "./describeCloudSql.js";
import { listCloudFunctions } from "./listCloudFunctions.js";
import { getCloudFunctionDetails } from "./getCloudFunctionDetails.js";
import { searchCloudLogging } from "./searchCloudLogging.js";
import { listPubsubTopics } from "./listPubsubTopics.js";
import { getPubsubTopicAttributes } from "./getPubsubTopicAttributes.js";
import { searchKnowledgeBase } from "./searchKnowledgeBase.js";

export function createGcpTools() {
    return [
        describeGkeCluster,
        describeCloudSql,
        listCloudFunctions,
        getCloudFunctionDetails,
        searchCloudLogging,
        listPubsubTopics,
        getPubsubTopicAttributes,
        searchKnowledgeBase,
    ];
}
