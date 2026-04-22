import { z } from "zod";
import { getRelevantPbiFiles } from '../utils/ScopingEngine.js';

// Mutex lock to enforce ONE PBI = ONE TEST PLAN at the server level
const activeSyncLocks = new Map();

export async function registerPbiTools(server, getAzureClient, resetAzureClient) {
    // A tool for fetching PBI data from Azure DevOps
    await server.tool(
        "fetch_pbi",
        "Retrieves the title and acceptance criteria of an Azure DevOps PBI by ID",
        { id: z.string().describe("The numeric PBI ID from Azure") },
        async ({ id }) => {
            try {
                const data = await getAzureClient().getPBI(id);
                const intelligentScope = getRelevantPbiFiles(data.title, data.criteria, 5);
                
                return {
                    content: [{ type: "text", text: JSON.stringify({
                        ...data,
                        scoped_files_do_not_scan_others: intelligentScope
                    }, null, 2) }]
                };
            } catch (err) {
                if (err.message?.includes('401') || err.message?.includes('403')) resetAzureClient();
                return {
                    content: [{ type: "text", text: `Error: ${err.message}` }],
                    isError: true
                };
            }
        }
    );

    // A tool for managing test plans in Azure DevOps
    await server.tool(
        "pbi_test_sync",
        "Syncs Test Plans, Suites, and Cases to Azure DevOps for a given PBI. Without test_cases, returns PBI details.",
        {
            pbi_id: z.string(),
            test_cases: z.array(z.object({
                title: z.string(),
                steps: z.array(z.object({ action: z.string(), expected: z.string() }))
            })).optional(),
            plan_id: z.string().optional().describe("Target plan for the PBI's requirement-based suite. If omitted, legacy behavior: auto-create/reuse a plan named 'Plan: <title>'."),
            mode: z.enum(["create_new_suite", "append", "replace", "merge_by_title"]).optional().describe("How to handle an existing suite. Required when existing_suite_id is provided."),
            existing_suite_id: z.string().optional().describe("Suite to update. Required for append/replace/merge_by_title.")
        },
        async ({ pbi_id, test_cases, plan_id, mode, existing_suite_id }) => {
            const azure = getAzureClient();
            // Enforce 1-PBI to 1-Call lock
            if (test_cases && activeSyncLocks.has(pbi_id)) {
                return { content: [{ type: "text", text: `FAIL: A sync operation for PBI ${pbi_id} is already in progress. Ignoring duplicate request.` }], isError: true };
            }

            try {
                if (test_cases) activeSyncLocks.set(pbi_id, true);

                const pbiData = await azure.getPBI(pbi_id);
                if (!test_cases) {
                    const intelligentScope = getRelevantPbiFiles(pbiData.title, pbiData.criteria, 5);
                    return { content: [{ type: "text", text: JSON.stringify({ ...pbiData, scoped_files_to_scan: intelligentScope }) }] };
                }

                if (existing_suite_id !== undefined && !["append", "replace", "merge_by_title"].includes(mode)) {
                    throw new Error("mode MUST be one of append/replace/merge_by_title when existing_suite_id is provided.");
                }
                if (mode === "create_new_suite" && existing_suite_id !== undefined) {
                    throw new Error("existing_suite_id must be undefined when mode is create_new_suite.");
                }
                
                let resolvedMode = mode;
                if (plan_id !== undefined && mode === undefined && existing_suite_id === undefined) {
                    resolvedMode = "create_new_suite";
                }

                let planId;
                if (plan_id === undefined) {
                    // LEGACY PATH
                    planId = await azure.syncTestPlan(pbi_id, test_cases, pbiData.title);
                } else {
                    // NEW PATH
                    planId = await azure.syncTestPlan(pbi_id, test_cases, pbiData.title, {
                        planId: Number(plan_id),
                        mode: resolvedMode,
                        existingSuiteId: existing_suite_id !== undefined ? Number(existing_suite_id) : undefined
                    });
                }

                const org = (process.env.AZURE_ORG_URL || "").replace(/\/$/, "");
                const project = process.env.AZURE_PROJECT || "";
                const planUrl = `${org}/${encodeURIComponent(project)}/_testPlans/define?planId=${planId}`;
                return { content: [{ type: "text", text: `SUCCESS\nPlan ID: ${planId}\nPBI: ${pbi_id}\nCases synced: ${test_cases.length}\nView in Azure: ${planUrl}` }] };
            } catch (err) {
                if (err.message?.includes('401') || err.message?.includes('403')) resetAzureClient();
                const errorDetail = err.response?.data?.message || err.message;
                return { content: [{ type: "text", text: `FAIL: ${errorDetail}` }], isError: true };
            } finally {
                if (test_cases) activeSyncLocks.delete(pbi_id);
            }
        }
    );

    // A tool for preflighting test suites and plans for a PBI
    await server.tool(
        "pbi_preflight",
        "Read-only. Reports existing test suites for a PBI (both new requirement-based and legacy) plus the list of available plans the suite could be added to.",
        { pbi_id: z.string().describe("The numeric PBI ID from Azure") },
        async ({ pbi_id }) => {
            try {
                const data = await getAzureClient().getPreflight(pbi_id);
                return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
            } catch (err) {
                if (err.message?.includes('401') || err.message?.includes('403')) resetAzureClient();
                return {
                    content: [{ type: "text", text: `Error: ${err.message}` }],
                    isError: true
                };
            }
        }
    );
}
