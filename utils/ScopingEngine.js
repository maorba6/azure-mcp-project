// utils/ScopingEngine.js
// Intelligent file scoring engine to scope AI test generation

import fs from 'fs';
import path from 'path';

// Ignore patterns to prevent searching massive or irrelevant directories
const IGNORE_DIRS = new Set(['node_modules', '.git', '.cursor', 'dist', 'build', 'out', 'bin', 'obj', 'logs', 'coverage']);
const IGNORE_EXTS = new Set(['.json', '.md', '.log', '.env', '.lock', '.png', '.jpg', '.svg', '.pdb', '.dll']);

/**
 * Extracts normalized keyword tokens from a string.
 */
function extractTokens(text) {
    if (!text) return [];
    // Remove punctuation, convert to lowercase, split by whitespace/camelCase/underscores if possible
    const normalized = text.replace(/[^\w\s-]/g, ' ').toLowerCase();
    const words = normalized.split(/\s+/).filter(w => w.length > 3);
    
    // Extremely basic stop-word removal
    const stopWords = new Set(["this", "that", "with", "from", "when", "then", "should", "will", "user", "system", "must", "have"]);
    return [...new Set(words.filter(w => !stopWords.has(w)))];
}

/**
 * Recursively gets all relevant files in a directory up to a max depth.
 */
function getFiles(dir, depth = 0, maxDepth = 5) {
    if (depth > maxDepth) return [];
    let results = [];
    try {
        const list = fs.readdirSync(dir);
        for (const file of list) {
            if (IGNORE_DIRS.has(file)) continue;
            
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                results = results.concat(getFiles(fullPath, depth + 1, maxDepth));
            } else {
                const ext = path.extname(file).toLowerCase();
                if (!IGNORE_EXTS.has(ext)) {
                    results.push(fullPath);
                }
            }
        }
    } catch (e) {
        // Silently skip unreadable directories
    }
    return results;
}

/**
 * Scores files against PBI context and returns the absolute paths of the top N most relevant code files.
 * @param {string} title - PBI Title
 * @param {string} criteria - PBI Acceptance criteria
 * @param {number} topN - Number of files to return
 */
export function getRelevantPbiFiles(title, criteria, topN = 5) {
    const tokens = extractTokens(`${title} ${criteria}`);
    if (tokens.length === 0) return [];

    const allFiles = getFiles(process.cwd());
    const scoredFiles = [];

    // Safety limit to avoid hanging on massive monorepos where ignore lists failed
    const MAX_FILES_TO_EVALUATE = 2000;
    const filesToEvaluate = allFiles.slice(0, MAX_FILES_TO_EVALUATE);

    for (const filePath of filesToEvaluate) {
        let score = 0;
        const fileName = path.basename(filePath).toLowerCase();

        // 1. Filename match heavily weighted
        for (const token of tokens) {
            if (fileName.includes(token)) score += 10;
        }

        // 2. Content match lightly weighted
        if (score > 0) { // optimization
            try {
                const content = fs.readFileSync(filePath, 'utf8').toLowerCase();
                for (const token of tokens) {
                    // Match whole words roughly
                    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`\\b${escaped}\\b`, 'g');
                    const matches = content.match(regex);
                    if (matches) {
                        score += Math.min(matches.length, 5); // cap frequency points
                    }
                }
            } catch (e) {
                // Ignore binary files or unreadable files
            }
        }

        if (score > 0) {
            scoredFiles.push({ file: filePath, score });
        }
    }

    scoredFiles.sort((a, b) => b.score - a.score);
    return scoredFiles.slice(0, topN).map(item => item.file);
}
