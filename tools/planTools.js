import { z } from "zod";

export async function registerPlanTools(server, getAzureClient, resetAzureClient) {
    await server.tool(
        "pbi_test_plan",
        "Fetches full test plan information linked to a PBI — cases, steps, suite, and Azure URL.",
        { pbi_id: z.string() },
        async ({ pbi_id }) => {
            const azure = getAzureClient();
            try {
                const info = await azure.getTestPlanInfo(pbi_id);
                
                if (typeof info === 'string') {
                    return { content: [{ type: "text", text: info }] };
                }

                const suitesStr = info.suites.map(s => `  - [ID ${s.id}] ${s.name}`).join('\n');
                const casesStr = info.testCases.map(c => `  - [ID ${c.id}] ${c.title}`).join('\n');
                const summary = [
                    "═══ TEST PLAN DETAILS ═══",
                    `Plan ID:   ${info.planId}`,
                    `Plan Name: ${info.planName}`,
                    `Suites:    ${info.suites.length}`,
                    suitesStr,
                    `Cases:     ${info.testCases.length}`,
                    "────────────────────────",
                    casesStr,
                    "────────────────────────",
                    `Azure URL: ${info.planUrl}`,
                    "════════════════════════"
                ].join('\n');

                return { content: [{ type: "text", text: summary }] };
            } catch (err) {
                if (err.message?.includes('401') || err.message?.includes('403')) resetAzureClient();
                const errorDetail = err.response?.data?.message || err.message;
                return { content: [{ type: "text", text: `FAIL: ${errorDetail}` }], isError: true };
            }
        }
    );

    await server.tool(
        "plan_inspect",
        "Fetches full test plan details directly by Plan ID — suites, all test cases, and Azure URL.",
        { plan_id: z.string() },
        async ({ plan_id }) => {
            const azure = getAzureClient();
            try {
                const info = await azure.getPlanInfoById(plan_id);

                const suitesStr = info.suites.map(s => `  - [ID ${s.id}] ${s.name}`).join('\n');
                const casesStr = info.testCases.map(c => `  - [ID ${c.id}] ${c.title}`).join('\n');
                const summary = [
                    "═══ PLAN INSPECT ═══════",
                    `Plan ID:   ${info.planId}`,
                    `Plan Name: ${info.planName}`,
                    `Suites:    ${info.suites.length}`,
                    suitesStr,
                    `Cases:     ${info.testCases.length}`,
                    "────────────────────────",
                    casesStr,
                    "────────────────────────",
                    `Azure URL: ${info.planUrl}`,
                    "════════════════════════"
                ].join('\n');

                return { content: [{ type: "text", text: summary }] };
            } catch (err) {
                if (err.message?.includes('401') || err.message?.includes('403')) resetAzureClient();
                const errorDetail = err.response?.data?.message || err.message;
                return { content: [{ type: "text", text: `FAIL: ${errorDetail}` }], isError: true };
            }
        }
    );

    await server.tool(
        "delete_plan",
        "Permanently deletes a Test Plan from Azure DevOps by Plan ID. This action is irreversible.",
        {
            plan_id: z.string(),
            confirm: z.boolean().describe("Must be true to confirm deletion. Safety guard.")
        },
        async ({ plan_id, confirm }) => {
            if (!confirm) {
                return { content: [{ type: "text", text: `CANCELLED: confirm must be true to delete plan ${plan_id}. Use delete_plan({ plan_id: "${plan_id}", confirm: true }).` }] };
            }
            const azure = getAzureClient();
            try {
                const result = await azure.deletePlan(plan_id);
                return { content: [{ type: "text", text: `✅ DELETED: Plan ID ${result.planId} ("${result.planName}") has been permanently removed from Azure DevOps.` }] };
            } catch (err) {
                if (err.message?.includes('401') || err.message?.includes('403')) resetAzureClient();
                const errorDetail = err.response?.data?.message || err.message;
                return { content: [{ type: "text", text: `FAIL: ${errorDetail}` }], isError: true };
            }
        }
    );
}
