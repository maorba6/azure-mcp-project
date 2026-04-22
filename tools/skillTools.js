import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { QA_SKILL_CONTENT } from '../config/qa-skill.js';

export async function registerSkillTools(server) {
    await server.tool(
        "install_qa_skill",
        "Installs the QA BEEF protocol rule into <project_path>/.cursor/rules/qa.mdc. Removes stale duplicate rule files from both .cursor/rules/ and .cursor/skills/.",
        {
            project_path: z.string().describe("Absolute path to the project workspace root (the folder that should contain .cursor/rules/). The LLM must pass the active workspace path.")
        },
        async ({ project_path }) => {
            try {
                // 1. Validate project_path
                if (!fs.existsSync(project_path)) {
                    return {
                        content: [{ type: "text", text: `FAIL: project_path "${project_path}" does not exist. Pass the absolute path to the workspace root.` }],
                        isError: true
                    };
                }
                const stat = fs.statSync(project_path);
                if (!stat.isDirectory()) {
                    return {
                        content: [{ type: "text", text: `FAIL: project_path "${project_path}" is not a directory.` }],
                        isError: true
                    };
                }

                const cursorDir = path.join(project_path, '.cursor');
                const rulesDir = path.join(cursorDir, 'rules');
                const skillsDir = path.join(cursorDir, 'skills'); // legacy wrong location — clean only

                // 2. Clean stale duplicates from BOTH directories
                const dirsToClean = [rulesDir, skillsDir];
                let deletedCount = 0;

                dirsToClean.forEach(dir => {
                    if (!fs.existsSync(dir)) return;
                    const files = fs.readdirSync(dir);
                    files.forEach(file => {
                        if (!file.endsWith('.mdc')) return;

                        const fullPath = path.join(dir, file);
                        let content = '';
                        try {
                            content = fs.readFileSync(fullPath, 'utf8');
                        } catch {
                            return;
                        }

                        const isOldName = ["qa.mdc", "azure_devops.mdc", "azure-qa-beef.mdc"].includes(file.toLowerCase());
                        const hasBeefReference = content.includes("BEEF Protocol") || content.includes("pbi_test_sync");

                        if (isOldName || hasBeefReference) {
                            try {
                                fs.unlinkSync(fullPath);
                                deletedCount++;
                            } catch {
                                // ignore individual failures
                            }
                        }
                    });
                });

                // 3. Ensure rules/ exists
                if (!fs.existsSync(rulesDir)) {
                    fs.mkdirSync(rulesDir, { recursive: true });
                }

                // 4. Write the rule
                const targetFilePath = path.join(rulesDir, 'qa.mdc');
                fs.writeFileSync(targetFilePath, QA_SKILL_CONTENT, 'utf8');

                return {
                    content: [{ type: "text", text: `🚀 QA Skill installed to ${targetFilePath} (cleaned up ${deletedCount} stale duplicate files)` }]
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Failed to install setup: ${error.message}` }],
                    isError: true
                };
            }
        }
    );
}
