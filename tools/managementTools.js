import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolsJsonPath = path.join(__dirname, '..', 'config', 'tools.json');

export async function registerManagementTools(server) {
    // A tool that lists all available tools (reads from config/tools.json)
    await server.tool(
        "help",
        "Lists all available MCP tools and their usage",
        {},
        async () => {
            try {
                const tools = JSON.parse(fs.readFileSync(toolsJsonPath, 'utf8'));

                const separator = '═'.repeat(55);
                let output = `\n${separator}\n  📖  QA MCP SERVER — AVAILABLE TOOLS\n${separator}\n`;

                tools.forEach((tool, i) => {
                    output += `\n  ${i + 1}. ${tool.name}`;
                    output += `\n     ${tool.description}`;
                    output += `\n     Usage: ${tool.usage}\n`;
                });

                output += `\n${separator}`;
                return { content: [{ type: "text", text: output }] };
            } catch (err) {
                return { content: [{ type: "text", text: `Failed to load tools: ${err.message}` }], isError: true };
            }
        }
    );
}
