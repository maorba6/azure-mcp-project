// utils/PayloadBudgetManager.js

/**
 * Manages processing large test suites by breaking them into sequential batches
 * to prevent Azure API payload/timeout limitations.
 */

// Azure DevOps often has undocumented limits on payload sizes for large XMLs in Work Items
// We estimate string payload size and chunk appropriately.
const MAX_BYTES_PER_TCP_PAYLOAD = 500 * 1024; // 500 KB safe limit for a single REST call
const ALARM_TEST_CASE_LIMIT = 12; // Start chunking arrays larger than 12 cases at a time

export class PayloadBudgetManager {
    /**
     * Estimates the byte footprint of a test case based on its title and steps.
     */
    static estimateTestCaseBytes(tc) {
        let size = Buffer.byteLength(tc.title || '', 'utf8');
        if (tc.steps) {
            tc.steps.forEach(s => {
                size += Buffer.byteLength(s.action || '', 'utf8');
                size += Buffer.byteLength(s.expected || '', 'utf8');
            });
        }
        return size * 1.5; // 50% overhead padding for XML and JSON structural syntax
    }

    /**
     * Calculates chunk distribution dynamically.
     * @param {Array} testCases 
     * @returns {Array<Array>} Array of chunked test case arrays
     */
    static chunkTestCases(testCases) {
        const chunks = [];
        let currentChunk = [];
        let currentSize = 0;

        for (const tc of testCases) {
            const tcSize = this.estimateTestCaseBytes(tc);
            
            // If adding this pushes us over payload size limit, OR we hit max generic item count
            if ((currentSize + tcSize > MAX_BYTES_PER_TCP_PAYLOAD || currentChunk.length >= ALARM_TEST_CASE_LIMIT) && currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = [];
                currentSize = 0;
            }
            
            currentChunk.push(tc);
            currentSize += tcSize;
        }

        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    /**
     * Executes test case creation and linking sequentially across batches to avoid silent failure.
     * Returns a summary or throws detailed diagnostics.
     */
    static async processBatches(testCases, batchProcessorFn) {
        const chunks = this.chunkTestCases(testCases);
        let totalProcessed = 0;

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            try {
                // Yield to processing function provided by AzureClient
                await batchProcessorFn(chunk, i + 1, chunks.length);
                totalProcessed += chunk.length;
            } catch (err) {
                // Surface distinct diagnostics directly out for the chunk
                const failDetails = err.response?.data?.message || err.message;
                throw new Error(
                    `Batch Processing Failed on Chunk ${i + 1}/${chunks.length} ` +
                    `(Processing items ${totalProcessed + 1} to ${totalProcessed + chunk.length}). ` +
                    `Diagnostic Context: ${failDetails}`
                );
            }
        }

        return totalProcessed;
    }
}
