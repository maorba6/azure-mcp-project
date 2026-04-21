import { AzureAuth } from './azure/AzureAuth.js';
import { PbiClient } from './azure/PbiClient.js';
import { TestPlanClient } from './azure/TestPlanClient.js';
import { TestCaseClient } from './azure/TestCaseClient.js';
import axios from 'axios';

export class AzureClient {
    constructor() {
        this.auth = new AzureAuth();
        this.pbiClient = new PbiClient(this.auth);
        this.testPlanClient = new TestPlanClient(this.auth);
        this.testCaseClient = new TestCaseClient(this.auth);
    }

    /**
     * Retrieve PBI data from Azure DevOps
     */
    async getPBI(id) {
        return await this.pbiClient.getPBI(id);
    }

    /**
     * Syncs a Test Plan with a specific PBI:
     * Professional Naming, Anti-Duplication, and Deep Coverage.
     */
    async syncTestPlan(pbiId, testCases, pbiTitle = null) {
        try {
            // 1-4. Plan creation/linking, Suite creation/resolution
            const { planId, suiteId, idsToDelete } = await this.testPlanClient.ensureSuite(pbiId, pbiTitle);
            
            // 5-6. Inject Test Cases and Delete Old Ones
            await this.testCaseClient.injectTestCases(planId, suiteId, idsToDelete, testCases, pbiId);

            return planId;
        } catch (error) {
            const status = error.response?.status;
            const url = error.config?.url;
            const method = error.config?.method;
            const body = error.response?.data && JSON.stringify(error.response.data).slice(0, 500);
            const detail = status
                ? `${status} ${method || "?"} ${url || "?"} ${body || ""}`
                : (error.response?.data?.message || error.message);
            throw new Error(`syncTestPlan failed: ${detail}`);
        }
    }

    /**
     * Fetch existing test plan info
     */
    async getTestPlanInfo(pbiId) {
        const info = await this.testPlanClient.getPlanInfo(pbiId);
        if (!info) {
            return `No test plan linked to PBI ${pbiId} yet. Run tp ${pbiId} to generate one.`;
        }
        return info;
    }

    /**
     * Fetches raw validation data for a test plan (Suites + Test Cases with Steps)
     */
    async getValidationData(planId) {
        const org = (this.auth.url || "").replace(/\/$/, "");
        const headers = { 'Authorization': this.auth.authHeader, 'Content-Type': 'application/json' };
        const apiVersion = 'api-version=7.1';
        const testBaseUrl = `${org}/${this.auth.project}/_apis/testplan`;
        const witBaseUrl = `${org}/_apis/wit/workItems`;

        // 1. Collect suites: top-level list plus children under each parent (root list often omits [PBI n] leaf suites)
        const topRes = await axios.get(`${testBaseUrl}/Plans/${planId}/suites?${apiVersion}`, { headers, timeout: 15000 });
        const top = topRes.data.value || [];
        const seen = new Set();
        const suites = [];
        const addList = (arr) => {
            for (const s of arr || []) {
                if (s?.id != null && !seen.has(s.id)) {
                    seen.add(s.id);
                    suites.push(s);
                }
            }
        };
        addList(top);
        for (const parent of top) {
            try {
                const childRes = await axios.get(
                    `${testBaseUrl}/Plans/${planId}/suites?${apiVersion}&parentSuiteId=${parent.id}`,
                    { headers, timeout: 15000 }
                );
                addList(childRes.data.value);
            } catch {
                // parentSuiteId filter not supported in some orgs — ignore
            }
        }

        const fullCases = [];
        // 2. Fetch test cases for each suite
        for (const suite of suites) {
            const casesRes = await axios.get(`${testBaseUrl}/Plans/${planId}/Suites/${suite.id}/TestCase?${apiVersion}`, { headers, timeout: 15000 });
            const currentCases = casesRes.data.value || [];
            
            if (currentCases.length > 0) {
                const allIds = currentCases.map(c => c.workItem.id);
                
                // 3. Fetch full test case details in chunks of 200 to check steps
                for (let i = 0; i < allIds.length; i += 200) {
                    const idChunk = allIds.slice(i, i + 200).join(',');
                    const witRes = await axios.get(`${witBaseUrl}?ids=${idChunk}&fields=System.Title,Microsoft.VSTS.TCM.Steps&${apiVersion}`, { headers, timeout: 15000 });
                    fullCases.push(...(witRes.data.value || []));
                }
            }
        }

        return { suites, fullCases };
    }

    async getPlanInfoById(planId) {
        try {
            return await this.testPlanClient.getPlanInfoById(planId);
        } catch (error) {
            throw new Error(`getPlanInfoById failed: ${error.response?.data?.message || error.message}`);
        }
    }

    async deletePlan(planId) {
        try {
            return await this.testPlanClient.deletePlan(planId);
        } catch (error) {
            throw new Error(`deletePlan failed: ${error.response?.data?.message || error.message}`);
        }
    }
}