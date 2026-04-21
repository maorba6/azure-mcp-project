// utils/HtmlUtils.js
// Production-grade module for handling Azure DevOps rich text synchronization

/**
 * Validates, sanitizes, and formats plain text or HTML into the required
 * XML-entity-encoded HTML format expected by Azure DevOps Test Case Steps.
 *
 * @param {string} text - The raw input string (plain text or mixed HTML).
 * @returns {string} - XML entity encoded string wrapped safely in <P> tags if not already Block HTML.
 */
export function formatAzureStep(text) {
    if (text === null || text === undefined) {
        return '&lt;P&gt;&lt;/P&gt;';
    }

    // Ensure string
    let processor = String(text).trim();
    if (!processor) {
        return '&lt;P&gt;&lt;/P&gt;';
    }

    // Step 1: Fix any previously XML-encoded entities (Decode so we don't double-encode)
    processor = processor
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'");

    // Step 2: Check if string is already wrapped in a block-level HTML tag (P, DIV, PRE)
    const isBlockHtml = /^<(p|div|pre|h[1-6])[\s>]/i.test(processor) && /<\/(p|div|pre|h[1-6])>$/i.test(processor);

    // Step 3: XML-entity encode all payload manually. 
    // We only preserve specific whitelisted rich text tags (b, i, u, code, br)
    
    // First, escape EVERYTHING to be safe.
    let htmlSafe = processor
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    // Then, unescape whitelisted inline tags
    const allowedInlineTags = ['b', 'i', 'u', 'code', 'br'];
    allowedInlineTags.forEach(tag => {
        // e.g. &lt;b&gt; -> <b> (which then becomes &lt;b&gt; in final XML mapping)
        const openRegex = new RegExp(`&lt;${tag}([^&]*?)&gt;`, 'gi');
        const closeRegex = new RegExp(`&lt;/${tag}&gt;`, 'gi');
        
        // Unescape them to standard `<` and `>` so they survive as real HTML
        htmlSafe = htmlSafe.replace(openRegex, `<${tag}$1>`).replace(closeRegex, `</${tag}>`);
    });

    // Step 4: Apply Block Wrapper if missing
    let finalHtml;
    // For block HTML (if the user already provided <p>), unescape the outer wrapper as well
    if (isBlockHtml) {
        // Unescape P, DIV tags
        const blockTags = ['p', 'div', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
        blockTags.forEach(tag => {
            const openRegex = new RegExp(`&lt;${tag}([^&]*?)&gt;`, 'gi');
            const closeRegex = new RegExp(`&lt;/${tag}&gt;`, 'gi');
            htmlSafe = htmlSafe.replace(openRegex, `<${tag}$1>`).replace(closeRegex, `</${tag}>`);
        });
        finalHtml = htmlSafe;
    } else {
        // Otherwise wrap in <P>
        finalHtml = `<P>${htmlSafe}</P>`;
    }

    // Step 5: The final payload must be XML-entity encoded for the entire string.
    // Meaning the <P> actually needs to be &lt;P&gt; for Azure DevOps <parameterizedString> 
    const azureEncoded = finalHtml
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    return azureEncoded;
}
