import fs from 'fs';
import path from 'path';
import { QA_SKILL_CONTENT } from '../config/qa-skill.js';

export async function registerSkillTools(server) {
    await server.tool(
        "install_qa_skill",
        "Installs the QA skill into .cursor/skills/ and removes stale duplicates",
        {},
        async () => {
            try {
                const cursorDir = path.join(process.cwd(), '.cursor');
                const rulesDir = path.join(cursorDir, 'rules');
                const skillsDir = path.join(cursorDir, 'skills');

                const dirsToClean = [rulesDir, skillsDir];
                let deletedCount = 0;

                dirsToClean.forEach(dir => {
                    if (fs.existsSync(dir)) {
                        const files = fs.readdirSync(dir);
                        files.forEach(file => {
                            if (!file.endsWith('.mdc')) return;
                            
                            const fullPath = path.join(dir, file);
                            const content = fs.readFileSync(fullPath, 'utf8');
                            
                            // Heuristics for old/duplicate rules
                            const isOldName = ["qa.mdc", "azure_devops.mdc", "azure-qa-beef.mdc"].includes(file.toLowerCase());
                            const hasBeefReference = content.includes("BEEF Protocol") || content.includes("pbi_test_sync");

                            if (isOldName || hasBeefReference) {
                                fs.unlinkSync(fullPath);
                                deletedCount++;
                            }
                        });
                    }
                });

                if (!fs.existsSync(skillsDir)) {
                    fs.mkdirSync(skillsDir, { recursive: true });
                }

                const targetFilePath = path.join(skillsDir, 'qa.mdc');
                fs.writeFileSync(targetFilePath, QA_SKILL_CONTENT, 'utf8');

                return {
                    content: [{ type: "text", text: `🚀 QA Skill installed successfully! (Cleaned up ${deletedCount} stale/duplicate files)` }]
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
