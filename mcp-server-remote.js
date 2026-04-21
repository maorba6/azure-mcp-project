import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { getAzureClient, resetAzureClient } from './tools/AzureClientFactory.js';
import { registerPbiTools } from './tools/pbiTools.js';
import { registerPlanTools } from './tools/planTools.js';
import { registerSkillTools } from './tools/skillTools.js';
import { registerManagementTools } from './tools/managementTools.js';
import { registerValidateTools } from './tools/validateTools.js';

// Create the MCP Server
const server = new McpServer({
    name: "azure-pbi-fetcher",
    version: "1.0.0"
});

// Start the server using Stdio
async function main() {
    try {
        // Register all modularized tools
        await registerPbiTools(server, getAzureClient, resetAzureClient);
        await registerPlanTools(server, getAzureClient, resetAzureClient);
        await registerSkillTools(server);
        await registerManagementTools(server);
        await registerValidateTools(server, getAzureClient, resetAzureClient);

        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("Azure PBI Fetcher MCP Server running... OK");

    } catch (err) {
        console.error("Startup/Tool Registration Failed:", err.stack || err.message);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error("Server Crash:", err);
    process.exit(1);
});