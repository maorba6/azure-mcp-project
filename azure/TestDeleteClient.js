import axios from 'axios';

export class TestDeleteClient {
    constructor(azureAuth) {
        this.auth = azureAuth;
    }

    // ─────────────────────────────────────────────────────────────
    // INSPECTION HELPERS — fetch work item type/title for summaries
    // ─────────────────────────────────────────────────────────────

    /**
     * Fetch a single work item's type and title. Returns { id, type, title } or throws.
     */
    async getWorkItemSummary(id) {
        const witApi = await this.auth.getWitApi();
        const wi = await witApi.getWorkItem(id, ["System.WorkItemType", "System.Title"]);
        return {
            id: Number(id),
            type: wi.fields["System.WorkItemType"] || "Unknown",
            title: wi.fields["System.Title"] || ""
        };
    }

    /**
     * Fetch a work item including its relations. Returns the raw work item.
     */
    async getWorkItemWithRelations(id) {
        const witApi = await this.auth.getWitApi();
        // expand level 1 = Relations
        return await witApi.getWorkItem(Number(id), undefined, undefined, 1);
    }

    /**
     * Fetch many work item summaries in bulk. Returns array of { id, type, title, error? }.
     */
    async getWorkItemSummariesBulk(ids) {
        const org = (this.auth.url || "").replace(/\/$/, "");
        const headers = { 'Authorization': this.auth.authHeader, 'Content-Type': 'application/json' };
        const apiVersion = 'api-version=7.1';
        const witBaseUrl = `${org}/_apis/wit/workitems`;

        const results = [];
        // ADO caps the "ids" query at ~200 per call.
        for (let i = 0; i < ids.length; i += 200) {
            const chunk = ids.slice(i, i + 200);
            try {
                const res = await axios.get(
                    `${witBaseUrl}?ids=${chunk.join(',')}&fields=System.WorkItemType,System.Title&errorPolicy=Omit&${apiVersion}`,
                    { headers, timeout: 15000 }
                );
                const found = new Map();
                for (const wi of (res.data.value || [])) {
                    found.set(Number(wi.id), wi);
                }
                for (const id of chunk) {
                    const wi = found.get(Number(id));
                    if (wi) {
                        results.push({
                            id: Number(id),
                            type: wi.fields["System.WorkItemType"] || "Unknown",
                            title: wi.fields["System.Title"] || ""
                        });
                    } else {
                        results.push({ id: Number(id), type: null, title: null, error: "Not found" });
                    }
                }
            } catch (err) {
                const errMsg = err.response?.data?.message || err.message;
                for (const id of chunk) {
                    results.push({ id: Number(id), type: null, title: null, error: errMsg });
                }
            }
        }
        return results;
    }

    // ─────────────────────────────────────────────────────────────
    // DESTRUCTIVE: delete work items by ID (type-aware routing)
    // ─────────────────────────────────────────────────────────────

    /**
     * Delete a list of work items by ID. Routes based on type:
     *   Test Plan → testplan delete endpoint
     *   Test Suite → testplan suite delete endpoint (requires parent plan lookup)
     *   Everything else → work item DELETE endpoint (project-scoped)
     *
     * `summaries` must be the same length as the IDs the caller wants to delete,
     * with each entry's `type` already resolved. This avoids re-fetching.
     *
     * Sequential, best-effort. Returns { succeeded: [...ids], failed: [{id, error}] }.
     */
    async deleteByIds(summaries) {
        const succeeded = [];
        const failed = [];

        for (const s of summaries) {
            if (s.error) {
                failed.push({ id: s.id, error: s.error });
                continue;
            }
            try {
                if (s.type === "Test Plan") {
                    await this._deleteTestPlan(s.id);
                } else if (s.type === "Test Suite") {
                    await this._deleteTestSuiteByWorkItemId(s.id);
                } else if (s.type === "Test Case" || s.type === "Shared Steps" || s.type === "Shared Parameter") {
                    await this._deleteTestCase(s.id);
                } else {
                    await this._deleteWorkItem(s.id);
                }
                succeeded.push(s.id);
            } catch (err) {
                const errMsg = err.response?.data?.message || err.message;
                failed.push({ id: s.id, error: errMsg });
            }
        }

        return { succeeded, failed };
    }

    async _deleteWorkItem(id) {
        const org = (this.auth.url || "").replace(/\/$/, "");
        const headers = { 'Authorization': this.auth.authHeader };
        const apiVersion = 'api-version=7.1';
        // Work item DELETE requires project segment per ADO REST docs.
        const witBaseUrl = `${org}/${this.auth.project}/_apis/wit/workitems`;
        await axios.delete(`${witBaseUrl}/${id}?${apiVersion}`, { headers, timeout: 15000 });
    }

    async _deleteTestPlan(planId) {
        const org = (this.auth.url || "").replace(/\/$/, "");
        const headers = { 'Authorization': this.auth.authHeader };
        const apiVersion = 'api-version=7.1';
        const testBaseUrl = `${org}/${this.auth.project}/_apis/testplan`;
        await axios.delete(`${testBaseUrl}/plans/${planId}?${apiVersion}`, { headers, timeout: 15000 });
    }

    /**
     * Delete a Test Case, Shared Steps, or Shared Parameters work item via
     * the testplan TCM endpoint. The work item DELETE endpoint is explicitly
     * blocked by ADO for test artifacts.
     */
    async _deleteTestCase(testCaseId) {
        const org = (this.auth.url || "").replace(/\/$/, "");
        const headers = { 'Authorization': this.auth.authHeader };
        const apiVersion = 'api-version=7.1';
        const testBaseUrl = `${org}/${this.auth.project}/_apis/testplan`;
        await axios.delete(`${testBaseUrl}/testcases/${testCaseId}?${apiVersion}`, { headers, timeout: 15000 });
    }

    /**
     * Delete a Test Suite given just the suite's work item ID. We must first
     * find the parent plan by querying suite metadata.
     */
    async _deleteTestSuiteByWorkItemId(suiteId) {
        // The Test Suite work item includes plan info in its fields.
        // Field: "Microsoft.VSTS.TCM.TestPlanId" (sometimes), or via relations.
        // Fallback: getWorkItem and inspect.
        const witApi = await this.auth.getWitApi();
        const wi = await witApi.getWorkItem(Number(suiteId), undefined, undefined, 1);
        const planId = wi.fields?.["Microsoft.VSTS.TCM.TestPlanId"]
            ?? wi.fields?.["Microsoft.VSTS.TCM.TestPlan"]
            ?? null;

        if (!planId) {
            throw new Error(`Cannot resolve parent plan for suite ${suiteId}. Delete via plan context instead.`);
        }

        const org = (this.auth.url || "").replace(/\/$/, "");
        const headers = { 'Authorization': this.auth.authHeader };
        const apiVersion = 'api-version=7.1';
        const testBaseUrl = `${org}/${this.auth.project}/_apis/testplan`;
        await axios.delete(`${testBaseUrl}/Plans/${planId}/suites/${suiteId}?${apiVersion}`, { headers, timeout: 15000 });
    }

    // ─────────────────────────────────────────────────────────────
    // NON-DESTRUCTIVE: remove a connection between two work items
    // ─────────────────────────────────────────────────────────────

    /**
     * Discover relations from `childId` that point to `parentId`.
     * Also checks whether `childId` is in any suite owned by `parentId` (Test Case ↔ Suite case).
     *
     * Returns { relations: [...], specialSuiteMatch: boolean, childType, parentType }.
     *
     * Each relation entry: { kind: 'workitem'|'testplan', index, rel, friendlyName, description }.
     */
    async discoverRelations(childId, parentId) {
        const child = await this.getWorkItemWithRelations(childId);
        const childType = child.fields?.["System.WorkItemType"] || "Unknown";
        const parent = await this.getWorkItemSummary(parentId);
        const parentType = parent.type;

        const relations = [];

        // 1. Scan work item relations array
        const parentUrlTail = `/${parentId}`;
        const rels = child.relations || [];
        for (let i = 0; i < rels.length; i++) {
            const r = rels[i];
            if (typeof r.url === "string" && r.url.endsWith(parentUrlTail)) {
                relations.push({
                    kind: "workitem",
                    index: i,
                    rel: r.rel,
                    friendlyName: this._friendlyRelName(r.rel),
                    description: `${this._friendlyRelName(r.rel)} link from ${childType} ${childId} → ${parentType} ${parentId}`
                });
            }
        }

        // 2. Special case: Test Case ↔ Suite membership isn't in the relations array.
        //    If child is a Test Case and parent is a Test Suite, check if child is in parent's suite.
        let specialSuiteMatch = false;
        if (childType === "Test Case" && parentType === "Test Suite") {
            try {
                // Resolve suite's plan
                const suiteWi = await this.getWorkItemWithRelations(parentId);
                const planId = suiteWi.fields?.["Microsoft.VSTS.TCM.TestPlanId"]
                    ?? suiteWi.fields?.["Microsoft.VSTS.TCM.TestPlan"]
                    ?? null;
                if (planId) {
                    const org = (this.auth.url || "").replace(/\/$/, "");
                    const headers = { 'Authorization': this.auth.authHeader };
                    const apiVersion = 'api-version=7.1';
                    const testBaseUrl = `${org}/${this.auth.project}/_apis/testplan`;
                    const casesRes = await axios.get(
                        `${testBaseUrl}/Plans/${planId}/Suites/${parentId}/TestCase?${apiVersion}`,
                        { headers, timeout: 15000 }
                    );
                    const cases = casesRes.data.value || [];
                    if (cases.some(c => Number(c.workItem.id) === Number(childId))) {
                        specialSuiteMatch = true;
                        relations.push({
                            kind: "testplan",
                            index: -1,
                            rel: "SuiteMembership",
                            friendlyName: "Suite membership",
                            description: `Test Case ${childId} is a member of Test Suite ${parentId} (Plan ${planId})`,
                            _planId: planId
                        });
                    }
                }
            } catch {
                // If suite lookup fails, don't fail the whole discovery — user might be asking
                // about a non-suite relation.
            }
        }

        return { relations, specialSuiteMatch, childType, parentType };
    }

    /**
     * Execute a specific relation removal. `relation` is one entry from discoverRelations().
     */
    async executeRemoval(childId, parentId, relation) {
        if (relation.kind === "testplan") {
            const org = (this.auth.url || "").replace(/\/$/, "");
            const headers = { 'Authorization': this.auth.authHeader };
            const apiVersion = 'api-version=7.1';
            const testBaseUrl = `${org}/${this.auth.project}/_apis/testplan`;
            await axios.delete(
                `${testBaseUrl}/Plans/${relation._planId}/Suites/${parentId}?testCaseIds=${childId}&${apiVersion}`,
                { headers, timeout: 15000 }
            );
            return { removed: "suite membership" };
        }

        // Work item relation removal = PATCH with remove op by index
        const witApi = await this.auth.getWitApi();
        await witApi.updateWorkItem(
            null,
            [{ op: "remove", path: `/relations/${relation.index}` }],
            Number(childId),
            this.auth.projectRaw
        );
        return { removed: relation.friendlyName };
    }

    _friendlyRelName(rel) {
        // Map ADO internal relation names to human names
        const map = {
            "System.LinkTypes.Hierarchy-Forward": "Child",
            "System.LinkTypes.Hierarchy-Reverse": "Parent",
            "System.LinkTypes.Related": "Related",
            "System.LinkTypes.Dependency-Forward": "Successor",
            "System.LinkTypes.Dependency-Reverse": "Predecessor",
            "System.LinkTypes.Duplicate-Forward": "Duplicate Of",
            "System.LinkTypes.Duplicate-Reverse": "Duplicate",
            "Microsoft.VSTS.Common.TestedBy-Forward": "Tests",
            "Microsoft.VSTS.Common.TestedBy-Reverse": "Tested By",
            "Microsoft.VSTS.TestCase.SharedStepReferencedBy-Forward": "Shared Step Reference",
            "Microsoft.VSTS.TestCase.SharedStepReferencedBy-Reverse": "Shared Step Referenced By"
        };
        return map[rel] || rel;
    }
}
