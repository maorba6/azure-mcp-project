import axios from 'axios';

export class TestPlanClient {
    constructor(azureAuth) {
        this.auth = azureAuth;
    }

    async ensureSuite(pbiId, pbiTitle) {
        const witApi = await this.auth.getWitApi();
        const org = (this.auth.url || "").replace(/\/$/, "");
        const headers = { 'Authorization': this.auth.authHeader, 'Content-Type': 'application/json' };

        const testBaseUrl = `${org}/${this.auth.project}/_apis/testplan`;
        const apiVersion = 'api-version=7.1';

        // Fetch PBI for context, title, and existing Plan relation (expand level 4)
        const pbi = await witApi.getWorkItem(pbiId, undefined, undefined, 4);
        
        const workItemType = pbi.fields?.["System.WorkItemType"];
        if (workItemType && workItemType !== "Product Backlog Item") {
            throw new Error(`Work item ${pbiId} is a "${workItemType}", not a Product Backlog Item. Please provide a valid PBI ID.`);
        }
        
        if (!pbiTitle) {
            pbiTitle = pbi.fields["System.Title"] || "Requirement";
        }

        // Find existing Test Plan by name (Architecture change: decouple plan relations, use name matching)
        const allPlansRes = await axios.get(`${testBaseUrl}/plans?${apiVersion}`, { headers, timeout: 15000 });
        const allPlans = allPlansRes.data.value || [];
        const existingPlan = allPlans.find(p => p.name === `Plan: ${pbiTitle}`);
        let planId = existingPlan?.id || null;

        if (!planId) {
            // 1. Create Test Plan if it doesn't exist
            const planRes = await axios.post(
                `${testBaseUrl}/plans?${apiVersion}`,
                { name: `Plan: ${pbiTitle}` },
                { headers, timeout: 15000 }
            );
            planId = planRes.data.id;
        }

        // 3. Resolve Root Suite
        const planDetail = await axios.get(`${testBaseUrl}/plans/${planId}?${apiVersion}`, { headers, timeout: 15000 });
        const rootSuiteId = planDetail.data.rootSuite.id;

        // 4. Smart Suite Management: Professional Naming & Anti-Duplication
        const cleanTitle = pbiTitle.replace(/[^\w\s-]/gi, '').substring(0, 50).trim();
        const suiteName = `[PBI ${pbiId}] ${cleanTitle}`;

        // Check for existing suite by name
        const existingSuites = await axios.get(`${testBaseUrl}/Plans/${planId}/suites?${apiVersion}`, { headers, timeout: 15000 });
        let suiteId = existingSuites.data.value?.find(s => s.name === suiteName)?.id;

        let idsToDelete = null;
        if (!suiteId) {
            // Create new suite
            const suiteRes = await axios.post(
                `${testBaseUrl}/Plans/${planId}/suites?${apiVersion}`,
                {
                    suiteType: "staticTestSuite",
                    name: suiteName,
                    parentSuite: { id: rootSuiteId }
                },
                { headers, timeout: 15000 }
            );
            suiteId = suiteRes.data.id;
        } else {
            // Collect existing test cases to delete AFTER we inject new ones atomically
            const currentCases = await axios.get(`${testBaseUrl}/Plans/${planId}/Suites/${suiteId}/TestCase?${apiVersion}`, { headers, timeout: 15000 });
            if (currentCases.data.value?.length > 0) {
                idsToDelete = currentCases.data.value.map(c => c.workItem.id);
            }
        }

        return { planId, suiteId, idsToDelete };
    }

    async getPlanInfo(pbiId) {
        const witApi = await this.auth.getWitApi();
        const org = (this.auth.url || "").replace(/\/$/, "");
        const headers = { 'Authorization': this.auth.authHeader, 'Content-Type': 'application/json' };
        const apiVersion = 'api-version=7.1';
        const testBaseUrl = `${org}/${this.auth.project}/_apis/testplan`;

        // Search by plan name (Traceability Refactor: Plans decoupling)
        const pbi = await witApi.getWorkItem(pbiId, ["System.Title", "System.WorkItemType"], undefined, undefined);
        const pbiTitle = pbi.fields["System.Title"] || "";
        const workItemType = pbi.fields?.["System.WorkItemType"];
        if (workItemType && workItemType !== "Product Backlog Item") {
            throw new Error(`Work item ${pbiId} is a "${workItemType}", not a Product Backlog Item.`);
        }

        const planName = `Plan: ${pbiTitle}`;
        const allPlansRes = await axios.get(`${testBaseUrl}/plans?${apiVersion}`, { headers, timeout: 15000 });
        const allPlans = allPlansRes.data.value || [];
        const matchedPlan = allPlans.find(p => p.name === planName);

        if (!matchedPlan) return null;
        const planId = matchedPlan.id;

        const project = this.auth.project; // Encoded project name
        const planUrl = `${org}/${project}/_testPlans/define?planId=${planId}`;

        // Fetch Suites
        const suitesRes = await axios.get(`${testBaseUrl}/Plans/${planId}/suites?${apiVersion}`, { headers, timeout: 15000 });
        const suites = suitesRes.data.value || [];
        
        const testCases = [];
        const suitesSummary = suites.map(s => ({ id: s.id, name: s.name }));

        for (const suite of suites) {
            const casesRes = await axios.get(`${testBaseUrl}/Plans/${planId}/Suites/${suite.id}/TestCase?${apiVersion}`, { headers, timeout: 15000 });
            const cases = casesRes.data.value || [];
            testCases.push(...cases.map(c => ({
                id: c.workItem.id,
                title: c.workItem.name || c.workItem.title || `Work Item ${c.workItem.id}`
            })));
        }

        return {
            planId,
            planName,
            suites: suitesSummary,
            testCases,
            planUrl
        };
    }

    async getPlanInfoById(planId) {
        const org = (this.auth.url || "").replace(/\/$/, "");
        const headers = { 'Authorization': this.auth.authHeader, 'Content-Type': 'application/json' };
        const apiVersion = 'api-version=7.1';
        const testBaseUrl = `${org}/${this.auth.project}/_apis/testplan`;

        const planRes = await axios.get(`${testBaseUrl}/plans/${planId}?${apiVersion}`, { headers, timeout: 15000 });
        const planName = planRes.data.name;
        const planUrl = `${org}/${this.auth.project}/_testPlans/define?planId=${planId}`;

        const suitesRes = await axios.get(`${testBaseUrl}/Plans/${planId}/suites?${apiVersion}`, { headers, timeout: 15000 });
        const suites = suitesRes.data.value || [];
        const suitesSummary = suites.map(s => ({ id: s.id, name: s.name }));

        const testCases = [];
        for (const suite of suites) {
            const casesRes = await axios.get(`${testBaseUrl}/Plans/${planId}/Suites/${suite.id}/TestCase?${apiVersion}`, { headers, timeout: 15000 });
            const cases = casesRes.data.value || [];
            testCases.push(...cases.map(c => ({
                id: c.workItem.id,
                title: c.workItem.name || c.workItem.title || `Work Item ${c.workItem.id}`
            })));
        }

        return { planId, planName, suites: suitesSummary, testCases, planUrl };
    }

    async deletePlan(planId) {
        const org = (this.auth.url || "").replace(/\/$/, "");
        const headers = { 'Authorization': this.auth.authHeader, 'Content-Type': 'application/json' };
        const apiVersion = 'api-version=7.1';
        const testBaseUrl = `${org}/${this.auth.project}/_apis/testplan`;

        const planRes = await axios.get(`${testBaseUrl}/plans/${planId}?${apiVersion}`, { headers, timeout: 15000 });
        const planName = planRes.data.name;

        await axios.delete(`${testBaseUrl}/plans/${planId}?${apiVersion}`, { headers, timeout: 15000 });

        return { planId, planName };
    }
}
