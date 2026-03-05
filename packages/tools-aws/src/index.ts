// SPDX-License-Identifier: AGPL-3.0-only

// @agentrun-oss/tools-aws — AWS infrastructure monitoring tools

// AWS clients
export { REGION, lambdaClient, eksClient, rdsClient, cwlClient, sqsClient, redactEnvVars } from "./_clients.js";
export { createClientsForIdentity } from "./_clientFactory.js";
export type { AwsClients } from "./_clientFactory.js";

// Tool factories + singleton instances
export { createDescribeEksCluster, describeEksCluster } from "./describeEksCluster.js";
export { createDescribeRds, describeRds } from "./describeRds.js";
export { createGetLambdaDetails, getLambdaDetails } from "./getLambdaDetails.js";
export { createGetSqsAttributes, getSqsAttributes } from "./getSqsAttributes.js";
export { createListLambdas, listLambdas } from "./listLambdas.js";
export { createListSqsQueues, listSqsQueues } from "./listSqsQueues.js";
export { createSearchCloudwatchLogs, searchCloudwatchLogs } from "./searchCloudwatchLogs.js";
export { createSearchKnowledgeBase, searchKnowledgeBase } from "./searchKnowledgeBase.js";

// Aggregate factory
import { createListLambdas, listLambdas } from "./listLambdas.js";
import { createGetLambdaDetails, getLambdaDetails } from "./getLambdaDetails.js";
import { createDescribeEksCluster, describeEksCluster } from "./describeEksCluster.js";
import { createDescribeRds, describeRds } from "./describeRds.js";
import { createSearchCloudwatchLogs, searchCloudwatchLogs } from "./searchCloudwatchLogs.js";
import { createListSqsQueues, listSqsQueues } from "./listSqsQueues.js";
import { createGetSqsAttributes, getSqsAttributes } from "./getSqsAttributes.js";
import { searchKnowledgeBase } from "./searchKnowledgeBase.js";
import type { AwsClients } from "./_clientFactory.js";

export function createAwsTools(clients?: AwsClients) {
    if (!clients) {
        return [
            listLambdas,
            getLambdaDetails,
            describeEksCluster,
            describeRds,
            searchCloudwatchLogs,
            listSqsQueues,
            getSqsAttributes,
            searchKnowledgeBase,
        ];
    }

    return [
        createListLambdas(clients.lambdaClient),
        createGetLambdaDetails(clients.lambdaClient),
        createDescribeEksCluster(clients.eksClient),
        createDescribeRds(clients.rdsClient),
        createSearchCloudwatchLogs(clients.cwlClient),
        createListSqsQueues(clients.sqsClient),
        createGetSqsAttributes(clients.sqsClient),
        searchKnowledgeBase,
    ];
}

// Declarative tools
export {
    SecurityError,
    validateAwsSdkAction,
    validateHttpUrl,
    validateLambdaName,
    interpolate,
    applyOutputTransform,
    executeAwsSdk,
    executeHttp,
    executeLambda,
    hydrateDeclarativeTool,
    hydrateDeclarativeTools,
    hydrateWorkflowAsTools,
    buildZodSchema,
    executeWorkflow,
} from "./declarative/index.js";

export type {
    AwsSdkSpec,
    HttpSpec,
    LambdaSpec,
    WorkflowResult,
} from "./declarative/index.js";
