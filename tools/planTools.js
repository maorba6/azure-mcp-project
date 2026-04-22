import { z } from "zod";

/**
 * Accepts: "123", "123,124,125", "100-105", or an array of strings.
 * Returns: array of unique integer IDs.
 */
function parseIdInput(input) {
    const raw = Array.isArray(input) ? input : [input];
    const out = new Set();
    for (const piece of raw) {
        const s = String(piece).trim();
        if (!s) continue;
        // Range
        const rangeMatch = s.match(/^(\d+)\s*-\s*(\d+)$/);
        if (rangeMatch) {
            const lo = Number(rangeMatch[1]);
            const hi = Number(rangeMatch[2]);
            if (lo <= hi && hi - lo <= 1000) {
                for (let i = lo; i <= hi; i++) out.add(i);
            }
            continue;
        }
        // Comma list
        if (s.includes(",")) {
            for (const part of s.split(",")) {
                const n = Number(part.trim());
                if (Number.isInteger(n) && n > 0) out.add(n);
            }
            continue;
        }
        // Single
        const n = Number(s);
        if (Number.isInteger(n) && n > 0) out.add(n);
    }
    return Array.from(out);
}

export async function registerPlanTools(server, getAzureClient, resetAzureClient) {

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
        "delete",
        "Permanently deletes work items by ID. Accepts a single ID, an array of IDs, or a range like '100-105'. Shows a preview summary when confirm is false; actually deletes when confirm is true. Soft-deletes to ADO recycle bin (14-day recovery).",
        {
            ids: z.union([
                z.string().describe("A single ID ('123'), comma-list ('123,124'), or range ('100-105')."),
                z.array(z.string())
            ]).describe("Work item ID(s) to delete."),
            confirm: z.boolean().describe("Must be true to execute. When false, returns a preview summary only.")
        },
        async ({ ids, confirm }) => {
            // Parse IDs — accept string (single, comma list, range), or array.
            const parsed = parseIdInput(ids);
            if (parsed.length === 0) {
                return { content: [{ type: "text", text: "FAIL: no valid IDs parsed from input." }], isError: true };
            }

            const azure = getAzureClient();
            try {
                const summaries = await azure.getWorkItemSummariesBulk(parsed);

                // Build the preview
                const typeCounts = {};
                for (const s of summaries) {
                    const key = s.error ? "Unresolved" : s.type;
                    typeCounts[key] = (typeCounts[key] || 0) + 1;
                }

                const lines = [];
                lines.push("═══ DELETE PREVIEW ═══");
                lines.push(`Total items: ${summaries.length}`);
                for (const [type, count] of Object.entries(typeCounts)) {
                    lines.push(`  - ${type}: ${count}`);
                }
                lines.push("");
                lines.push("Details:");
                for (const s of summaries) {
                    if (s.error) {
                        lines.push(`  - [${s.id}] UNRESOLVED: ${s.error}`);
                    } else {
                        const title = s.title.length > 60 ? s.title.slice(0, 57) + "..." : s.title;
                        lines.push(`  - [${s.type} ${s.id}] "${title}"`);
                    }
                }
                lines.push("═══════════════════════════");

                if (!confirm) {
                    lines.push("");
                    lines.push("Preview only. Re-run with confirm: true to execute.");
                    return { content: [{ type: "text", text: lines.join("\n") }] };
                }

                // Execute
                const resolvable = summaries.filter(s => !s.error);
                const result = await azure.deleteWorkItemsByIds(resolvable);

                lines.push("");
                lines.push(`✅ Destroyed: ${result.succeeded.length}/${resolvable.length}`);
                if (result.failed.length > 0) {
                    lines.push("Failures:");
                    for (const f of result.failed) {
                        lines.push(`  - ID ${f.id}: ${f.error}`);
                    }
                }
                const unresolved = summaries.filter(s => s.error);
                if (unresolved.length > 0) {
                    lines.push(`Unresolved (skipped): ${unresolved.length}`);
                }

                const anyFailure = result.failed.length > 0 || unresolved.length > 0;
                return { content: [{ type: "text", text: lines.join("\n") }], ...(anyFailure ? { isError: true } : {}) };
            } catch (err) {
                if (err.message?.includes('401') || err.message?.includes('403')) resetAzureClient();
                const errorDetail = err.response?.data?.message || err.message;
                return { content: [{ type: "text", text: `FAIL: ${errorDetail}` }], isError: true };
            }
        }
    );

    await server.tool(
        "remove",
        "Severs a connection between two work items. Pass the child (the thing being removed) first, then the parent (the container). Auto-detects the relation type. When confirm is false, returns a preview.",
        {
            child_id: z.string().describe("The ID of the work item being removed."),
            parent_id: z.string().describe("The ID of the work item it is being removed FROM."),
            relation_type: z.string().optional().describe("Internal relation name (e.g. 'System.LinkTypes.Related'). Only needed when the tool reports multiple matching relations."),
            confirm: z.boolean().describe("Must be true to execute. When false, returns a preview summary only.")
        },
        async ({ child_id, parent_id, relation_type, confirm }) => {
            const azure = getAzureClient();
            try {
                const discovery = await azure.discoverRelations(child_id, parent_id);
                const relations = discovery.relations;

                if (relations.length === 0) {
                    return {
                        content: [{ type: "text", text: `No connection found between ${discovery.childType} ${child_id} and ${discovery.parentType} ${parent_id}. Nothing to remove.` }]
                    };
                }

                // Filter by explicit relation_type if provided
                let selected = relations;
                if (relation_type) {
                    selected = relations.filter(r => r.rel === relation_type);
                    if (selected.length === 0) {
                        return {
                            content: [{ type: "text", text: `No relation of type "${relation_type}" found between ${child_id} and ${parent_id}. Available: ${relations.map(r => r.rel).join(", ")}.` }],
                            isError: true
                        };
                    }
                }

                // Preview
                const lines = [];
                lines.push("═══ REMOVE PREVIEW ═══");
                lines.push(`Child:  ${discovery.childType} ${child_id}`);
                lines.push(`Parent: ${discovery.parentType} ${parent_id}`);
                lines.push("");

                if (selected.length > 1) {
                    lines.push(`⚠ Found ${selected.length} connections. Re-run with relation_type to pick one:`);
                    for (const r of selected) {
                        lines.push(`  - "${r.friendlyName}"  (relation_type: "${r.rel}")`);
                    }
                    lines.push("═══════════════════════════");
                    return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
                }

                const target = selected[0];
                lines.push(`Action: Remove ${target.description}`);
                lines.push("═══════════════════════════");

                if (!confirm) {
                    lines.push("");
                    lines.push("Preview only. Re-run with confirm: true to execute.");
                    return { content: [{ type: "text", text: lines.join("\n") }] };
                }

                const result = await azure.executeRelationRemoval(child_id, parent_id, target);
                lines.push("");
                lines.push(`✅ Removed: ${result.removed}`);
                return { content: [{ type: "text", text: lines.join("\n") }] };
            } catch (err) {
                if (err.message?.includes('401') || err.message?.includes('403')) resetAzureClient();
                const errorDetail = err.response?.data?.message || err.message;
                return { content: [{ type: "text", text: `FAIL: ${errorDetail}` }], isError: true };
            }
        }
    );
}
