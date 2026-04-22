import axios from 'axios';
import { formatAzureStep } from '../utils/HtmlUtils.js';
import { PayloadBudgetManager } from '../utils/PayloadBudgetManager.js';

export class TestCaseClient {
    constructor(azureAuth) {
        this.auth = azureAuth;
    }

    async injectTestCases(planId, suiteId, idsToDelete, testCases, pbiId, mergeMode = false, existingCasesByTitle = new Map(), suiteType = "staticTestSuite") {
        const witApi = await this.auth.getWitApi();
        const org = (this.auth.url || "").replace(/\/$/, "");
        const headers = { 'Authorization': this.auth.authHeader, 'Content-Type': 'application/json' };

        const testBaseUrl = `${org}/${this.auth.project}/_apis/testplan`;
        const apiVersion = 'api-version=7.1';

        // 5. Inject Test Cases (BEEF Rule: Budget-managed batch insertion)
        await PayloadBudgetManager.processBatches(testCases, async (chunk, batchCur, batchTotal) => {
            console.error(`Syncing Batch ${batchCur}/${batchTotal}...`);
            
            for (const tc of chunk) {
                if (mergeMode && existingCasesByTitle.has(tc.title)) {
                    // Update existing
                    const existingCase = existingCasesByTitle.get(tc.title);
                    await this.updateTestCaseSteps(existingCase.id, tc.steps);
                    continue; // Skip the rest of the loop (creation, linking, adding to suite)
                }

                const stepsXml = `<steps id="0" last="${tc.steps.length}">${tc.steps.map((s, i) =>
                    `<step id="${i + 1}" type="ValidateStep">` +
                    `<parameterizedString isformatted="true">${formatAzureStep(s.action)}</parameterizedString>` +
                    `<parameterizedString isformatted="true">${formatAzureStep(s.expected)}</parameterizedString>` +
                    `</step>`).join('')}</steps>`;

                const workItem = await witApi.createWorkItem(null, [
                    { "op": "add", "path": "/fields/System.Title", "value": tc.title },
                    { "op": "add", "path": "/fields/Microsoft.VSTS.TCM.Steps", "value": stepsXml }
                ], this.auth.projectRaw, "Test Case");

                // Link Test Case → PBI (Traceability) - skip for requirement suites
                if (suiteType !== "RequirementTestSuite" && suiteType !== "requirementTestSuite") {
                    const pbiUrl = `${org}/${this.auth.project}/_apis/wit/workItems/${pbiId}`;
                    try {
                        await witApi.updateWorkItem(
                            null,
                            [{
                                op: "add",
                                path: "/relations/-",
                                value: {
                                    rel: "Microsoft.VSTS.Common.TestedBy-Reverse",
                                    url: pbiUrl,
                                    attributes: { comment: "Linked by QA MCP Server" }
                                }
                            }],
                            Number(workItem.id),
                            this.auth.projectRaw
                        );
                    } catch (linkErr) {
                        const errMsg = linkErr.response?.data?.message || linkErr.message || "";
                        const isDuplicate = errMsg.includes("TF401035") || errMsg.toLowerCase().includes("relation already exists");
                        
                        if (isDuplicate) {
                            console.warn(`Idempotent relation ignored for Test Case ${workItem.id}: ${errMsg}`);
                        } else {
                            throw linkErr;
                        }
                    }
                }

                // Default test configuration (usually 1); required by Suite Test Case Add in many orgs — omitting can yield 405
                await axios.post(
                    `${testBaseUrl}/Plans/${planId}/Suites/${suiteId}/TestCase?${apiVersion}`,
                    [{ pointAssignments: [{ configurationId: 1 }], workItem: { id: workItem.id } }],
                    { headers, timeout: 15000 }
                );
            }
        });

        // 6. Delete old cases only if new ones successfully injected
        // Azure rejects DELETE .../TestCase/{id,id} (405). Use query param (see TestPlanApi.removeTestCasesFromSuite: testCaseIds).
        if (idsToDelete && idsToDelete.length > 0) {
            for (let i = 0; i < idsToDelete.length; i += 20) {
                const chunk = idsToDelete.slice(i, i + 20).join(',');
                await axios.delete(
                    `${testBaseUrl}/Plans/${planId}/Suites/${suiteId}?testCaseIds=${chunk}&${apiVersion}`,
                    { headers, timeout: 15000 }
                );
            }
        }
    }

    async updateTestCaseSteps(testCaseId, steps) {
        const witApi = await this.auth.getWitApi();
        const stepsXml = `<steps id="0" last="${steps.length}">${steps.map((s, i) =>
            `<step id="${i + 1}" type="ValidateStep">` +
            `<parameterizedString isformatted="true">${formatAzureStep(s.action)}</parameterizedString>` +
            `<parameterizedString isformatted="true">${formatAzureStep(s.expected)}</parameterizedString>` +
            `</step>`).join('')}</steps>`;

        await witApi.updateWorkItem(
            null,
            [{ op: "replace", path: "/fields/Microsoft.VSTS.TCM.Steps", value: stepsXml }],
            Number(testCaseId),
            this.auth.projectRaw
        );
    }
}
