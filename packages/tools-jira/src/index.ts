// SPDX-License-Identifier: AGPL-3.0-only

// @agentrun-oss/tools-jira — Jira issue tracking tools

export { jiraApi, toAdf, getBrowseUrl } from "./_api.js";
export { searchJiraIssues } from "./searchJiraIssues.js";
export { getJiraIssue } from "./getJiraIssue.js";
export { listJiraProjects } from "./listJiraProjects.js";
export { createJiraIssue } from "./createJiraIssue.js";
export { addJiraComment } from "./addJiraComment.js";
export { transitionJiraIssue } from "./transitionJiraIssue.js";

import { searchJiraIssues } from "./searchJiraIssues.js";
import { getJiraIssue } from "./getJiraIssue.js";
import { listJiraProjects } from "./listJiraProjects.js";
import { createJiraIssue } from "./createJiraIssue.js";
import { addJiraComment } from "./addJiraComment.js";
import { transitionJiraIssue } from "./transitionJiraIssue.js";

export function createJiraTools() {
    return [
        searchJiraIssues,
        getJiraIssue,
        listJiraProjects,
        createJiraIssue,
        addJiraComment,
        transitionJiraIssue
    ];
}
