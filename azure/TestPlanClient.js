import axios from 'axios';

export class TestPlanClient {
    constructor(azureAuth) {
        this.auth = azureAuth;
    }

    async ensureSuite(pbiId, pbiTitle, options = {}) {
        const { planId: optPlanId, mode, existingSuiteId } = options;
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

        let planId = optPlanId;

        if (planId === undefined) {
            // Find existing Test Plan by name (Architecture change: decouple plan relations, use name matching)
            const allPlansRes = await axios.get(`${testBaseUrl}/plans?${apiVersion}`, { headers, timeout: 15000 });
            const allPlans = allPlansRes.data.value || [];
            const existingPlan = allPlans.find(p => p.name === `Plan: ${pbiTitle}`);
            planId = existingPlan?.id || null;

            if (!planId) {
                // 1. Create Test Plan if it doesn't exist
                const planRes = await axios.post(
                    `${testBaseUrl}/plans?${apiVersion}`,
                    { name: `Plan: ${pbiTitle}` },
                    { headers, timeout: 15000 }
                );
                planId = planRes.data.id;
            }
        }

        // 3. Resolve Root Suite
        const planDetail = await axios.get(`${testBaseUrl}/plans/${planId}?${apiVersion}`, { headers, timeout: 15000 });
        const rootSuiteId = planDetail.data.rootSuite.id;

        // 4. Smart Suite Management: Professional Naming & Anti-Duplication
        const cleanTitle = pbiTitle.replace(/[^\w\s-]/gi, '').substring(0, 50).trim();
        const suiteName = `[PBI ${pbiId}] ${cleanTitle}`;

        let suiteId = existingSuiteId;
        let idsToDelete = null;
        let mergeMode = false;
        let existingCasesByTitle = new Map();
        let suiteType = "staticTestSuite";

        if (optPlanId === undefined) {
            // Check for existing suite by name
            const existingSuites = await axios.get(`${testBaseUrl}/Plans/${planId}/suites?${apiVersion}`, { headers, timeout: 15000 });
            const foundSuite = existingSuites.data.value?.find(s => 
                s.name === suiteName || 
                (s.suiteType === "RequirementTestSuite" && s.requirementId === Number(pbiId))
            );
            suiteId = foundSuite?.id;
            if (foundSuite) {
                suiteType = foundSuite.suiteType;
            }

            if (!suiteId) {
                // Create new suite
                const suiteRes = await axios.post(
                    `${testBaseUrl}/Plans/${planId}/suites?${apiVersion}`,
                    {
                        suiteType: "requirementTestSuite",
                        name: suiteName,
                        parentSuite: { id: rootSuiteId },
                        requirementId: Number(pbiId)
                    },
                    { headers, timeout: 15000 }
                );
                suiteId = suiteRes.data.id;
                suiteType = "RequirementTestSuite";
            } else {
                // Collect existing test cases to delete AFTER we inject new ones atomically
                const currentCases = await axios.get(`${testBaseUrl}/Plans/${planId}/Suites/${suiteId}/TestCase?${apiVersion}`, { headers, timeout: 15000 });
                if (currentCases.data.value?.length > 0) {
                    idsToDelete = currentCases.data.value.map(c => c.workItem.id);
                }
            }
        } else {
            if (mode === "create_new_suite") {
                const suiteRes = await axios.post(
                    `${testBaseUrl}/Plans/${planId}/suites?${apiVersion}`,
                    {
                        suiteType: "requirementTestSuite",
                        name: suiteName,
                        parentSuite: { id: rootSuiteId },
                        requirementId: Number(pbiId)
                    },
                    { headers, timeout: 15000 }
                );
                suiteId = suiteRes.data.id;
                suiteType = "RequirementTestSuite";
            } else if (mode === "append") {
                const suiteInfoRes = await axios.get(`${testBaseUrl}/Plans/${planId}/suites/${suiteId}?${apiVersion}`, { headers, timeout: 15000 });
                suiteType = suiteInfoRes.data.suiteType;
                // IDs to delete remains null
            } else if (mode === "replace") {
                const suiteInfoRes = await axios.get(`${testBaseUrl}/Plans/${planId}/suites/${suiteId}?${apiVersion}`, { headers, timeout: 15000 });
                suiteType = suiteInfoRes.data.suiteType;
                const currentCases = await axios.get(`${testBaseUrl}/Plans/${planId}/Suites/${suiteId}/TestCase?${apiVersion}`, { headers, timeout: 15000 });
                if (currentCases.data.value?.length > 0) {
                    idsToDelete = currentCases.data.value.map(c => c.workItem.id);
                }
            } else if (mode === "merge_by_title") {
                const suiteInfoRes = await axios.get(`${testBaseUrl}/Plans/${planId}/suites/${suiteId}?${apiVersion}`, { headers, timeout: 15000 });
                suiteType = suiteInfoRes.data.suiteType;
                mergeMode = true;
                const currentCases = await axios.get(`${testBaseUrl}/Plans/${planId}/Suites/${suiteId}/TestCase?${apiVersion}`, { headers, timeout: 15000 });
                const casesList = currentCases.data.value || [];
                
                if (casesList.length > 0) {
                    const allIds = casesList.map(c => c.workItem.id);
                    const witBaseUrl = `${org}/_apis/wit/workItems`;
                    for (let i = 0; i < allIds.length; i += 200) {
                        const idChunk = allIds.slice(i, i + 200).join(',');
                        const witRes = await axios.get(`${witBaseUrl}?ids=${idChunk}&fields=System.Title,Microsoft.VSTS.TCM.Steps&${apiVersion}`, { headers, timeout: 15000 });
                        for (const wit of (witRes.data.value || [])) {
                            const title = wit.fields["System.Title"];
                            if (existingCasesByTitle.has(title)) {
                                console.warn(`Duplicate test case title found in suite during merge: "${title}". Overwriting with latest ID.`);
                            }
                            existingCasesByTitle.set(title, {
                                id: wit.id,
                                stepsXml: wit.fields["Microsoft.VSTS.TCM.Steps"]
                            });
                        }
                    }
                }
            }
        }

        return { planId, suiteId, idsToDelete, mergeMode, existingCasesByTitle, suiteType };
    }

    async getPreflight(pbiId) {
        const witApi = await this.auth.getWitApi();
        const org = (this.auth.url || "").replace(/\/$/, "");
        const headers = { 'Authorization': this.auth.authHeader, 'Content-Type': 'application/json' };
        const testBaseUrl = `${org}/${this.auth.project}/_apis/testplan`;
        const apiVersion = 'api-version=7.1';

        // 1. Fetch PBI
        const pbi = await witApi.getWorkItem(pbiId, ["System.Title", "System.WorkItemType", "Microsoft.VSTS.Common.AcceptanceCriteria", "System.State"]);
        
        const workItemType = pbi.fields?.["System.WorkItemType"];
        if (workItemType && workItemType !== "Product Backlog Item") {
            throw new Error(`Work item ${pbiId} is a "${workItemType}", not a Product Backlog Item. Please provide a valid PBI ID.`);
        }

        const pbiData = {
            id: String(pbiId),
            title: pbi.fields["System.Title"] || "",
            criteria: pbi.fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || "",
            status: pbi.fields["System.State"] || "",
            workItemType: workItemType || "Product Backlog Item"
        };

        // 2. Fetch all plans
        const allPlansRes = await axios.get(`${testBaseUrl}/plans?${apiVersion}`, { headers, timeout: 15000 });
        const allPlans = allPlansRes.data.value || [];
        
        const available_plans = allPlans.map(p => ({
            id: p.id,
            name: p.name,
            root_suite_id: p.rootSuite.id
        }));

        // 3. Fetch suites for each plan
        const existing_suites = [];
        
        // Chunked parallel execution for fetching suites (max 10 concurrent)
        const chunkArray = (arr, size) => {
            const result = [];
            for (let i = 0; i < arr.length; i += size) {
                result.push(arr.slice(i, i + size));
            }
            return result;
        };
        
        const planChunks = chunkArray(allPlans, 10);
        for (const chunk of planChunks) {
            await Promise.all(chunk.map(async (plan) => {
                try {
                    const suitesRes = await axios.get(`${testBaseUrl}/Plans/${plan.id}/suites?${apiVersion}`, { headers, timeout: 15000 });
                    const suites = suitesRes.data.value || [];
                    
                    for (const suite of suites) {
                        const isRequirementSuite = suite.suiteType === "RequirementTestSuite" && suite.requirementId === Number(pbiId);
                        const isLegacySuite = new RegExp(`^\\[PBI\\s+${pbiId}\\]`, 'i').test(suite.name);
                        
                        if (isRequirementSuite || isLegacySuite) {
                            // Fetch test case count
                            const casesRes = await axios.get(`${testBaseUrl}/Plans/${plan.id}/Suites/${suite.id}/TestCase?${apiVersion}`, { headers, timeout: 15000 });
                            const testCaseCount = casesRes.data.value ? casesRes.data.value.length : 0;
                            
                            existing_suites.push({
                                plan_id: plan.id,
                                plan_name: plan.name,
                                suite_id: suite.id,
                                suite_name: suite.name,
                                suite_type: suite.suiteType,
                                test_case_count: testCaseCount,
                                is_legacy: !!isLegacySuite,
                                requirement_id: suite.requirementId || null
                            });
                        }
                    }
                } catch (e) {
                    // Ignore errors for individual plans, might not have access
                    console.warn(`Failed to fetch suites for plan ${plan.id}:`, e.message);
                }
            }));
        }

        return {
            pbi: pbiData,
            existing_suites,
            available_plans
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


}
