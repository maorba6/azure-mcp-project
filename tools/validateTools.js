import { z } from "zod";

export async function registerValidateTools(server, getAzureClient, resetAzureClient) {
    await server.tool(
        "validate_sync",
        "Fetches a Test Plan from Azure and verifies all test cases landed with steps populated.",
        {
            plan_id: z.string(),
            expected_count: z.number().optional()
        },
        async ({ plan_id, expected_count }) => {
            const azure = getAzureClient();
            
            // Azure Client internal validation will trip if env doesn't exist
            try {
                // Delegated fetch logic to AzureClient
                const { fullCases } = await azure.getValidationData(plan_id);
                
                let totalCases = 0;
                let casesWithSteps = 0;
                let casesMissingSteps = 0;
                let missingStepDetails = [];

                for (const tc of fullCases) {
                    totalCases++;
                    const stepsXml = tc.fields['Microsoft.VSTS.TCM.Steps'];
                    
                    // Basic validation: must exist and have at least one <step> block
                    if (stepsXml && stepsXml.includes('<step ') && stepsXml.includes('ValidateStep')) {
                        casesWithSteps++;
                    } else {
                        casesMissingSteps++;
                        missingStepDetails.push(`ID ${tc.id}: ${tc.fields['System.Title']} (No steps found)`);
                    }
                }

                // 4. Evaluate success states
                let isFail = false;
                const messages = [];
                
                if (casesMissingSteps > 0) {
                    isFail = true;
                    messages.push(`❌ ${casesMissingSteps} cases are missing steps!`);
                    messages.push(`Missing details: \n - ${missingStepDetails.join('\n - ')}`);
                }

                if (expected_count !== undefined && totalCases !== expected_count) {
                    isFail = true;
                    messages.push(`❌ Count mismatch: Expected ${expected_count}, but found ${totalCases} cases attached to the plan.`);
                }
                
                if (!isFail) {
                    messages.push(`✅ ALL CLEAR: Found ${totalCases} cases and all possess step definitions.`);
                }

                const summaryStr = `Plan ID: ${plan_id}\nTotal Cases Found: ${totalCases}\nValid Cases: ${casesWithSteps}\nEmpty Cases: ${casesMissingSteps}\n\n` + messages.join('\n');

                if (isFail) {
                    return { content: [{ type: "text", text: summaryStr }], isError: true };
                }
                return { content: [{ type: "text", text: summaryStr }] };

            } catch (err) {
                if (err.message?.includes('401') || err.message?.includes('403')) resetAzureClient();
                const errorDetail = err.response?.data?.message || err.message;
                return { content: [{ type: "text", text: `VALIDATION FAIL: ${errorDetail}` }], isError: true };
            }
        }
    );
}
