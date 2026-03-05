// SPDX-License-Identifier: AGPL-3.0-only

// @agentrun-oss/tools-github — GitHub PR and commit monitoring tools

export { getOrg, getAllowedRepos, githubApi } from "./_api.js";
export { listOpenPrs } from "./listOpenPrs.js";
export { getPrDetails } from "./getPrDetails.js";
export { recentCommits } from "./recentCommits.js";

import { listOpenPrs } from "./listOpenPrs.js";
import { getPrDetails } from "./getPrDetails.js";
import { recentCommits } from "./recentCommits.js";

export function createGithubTools() {
    return [listOpenPrs, getPrDetails, recentCommits];
}
