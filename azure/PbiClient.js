export class PbiClient {
    constructor(azureAuth) {
        this.auth = azureAuth;
    }

    /**
     * Retrieve PBI data from Azure DevOps
     */
    async getPBI(id) {
        try {
            const witApi = await this.auth.getWitApi();
            const pbi = await witApi.getWorkItem(id, [
                "System.Title",
                "Microsoft.VSTS.Common.AcceptanceCriteria",
                "System.State",
                "System.WorkItemType"
            ]);

            const workItemType = pbi.fields["System.WorkItemType"];
            if (workItemType !== "Product Backlog Item") {
                throw new Error(`Work item ${id} is a "${workItemType}", not a Product Backlog Item. Please provide a valid PBI ID.`);
            }

            return {
                id: id,
                title: pbi.fields["System.Title"] || "No Title",
                criteria: pbi.fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || "No Criteria Defined",
                status: pbi.fields["System.State"]
            };
        } catch (error) {
            throw new Error(`Azure Fetch Error: ${error.message}`);
        }
    }
}
