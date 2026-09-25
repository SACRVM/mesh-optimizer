/**
 * SACRVM APPKIT — markdown help loader (ES module).
 * Requires BOTH `marked` (kit/js/vendor/marked.min.js) and DOMPurify
 * (kit/js/vendor/purify.min.js) on window. A help file is a fetched, often
 * untrusted document, so sanitising is mandatory — a missing DOMPurify is a
 * hard error, never a silent pass-through that injects raw markdown output.
 *
 * Loads a markdown file, renders it to HTML, and injects it into the target
 * element. Internal `.md` links load recursively in place, resolved against
 * the file they appear in (not the hosting page); `http(s)` links open in a
 * new tab.
 *
 * @param {string} filename          Path to the markdown file.
 * @param {string} targetElementId   ID of the element to render into
 *                                   (default: 'help-content').
 */

/** Kit i18n: sac.t when globals.js is loaded, the English fallback when
 *  the component runs standalone. */
const t = (key, fallback) =>
    (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

export async function loadHelp(filename, targetElementId = 'help-content') {
    const contentDiv = document.getElementById(targetElementId);
    if (!contentDiv) {
        console.warn(`[HelpLoader] Target element '#${targetElementId}' not found.`);
        return;
    }

    try {
        if (!window.marked) {
            throw new Error("marked.js not found on window (kit/js/vendor/marked.min.js).");
        }
        if (!window.DOMPurify) {
            throw new Error("DOMPurify not found on window (kit/js/vendor/purify.min.js) — refusing to inject unsanitised markdown.");
        }

        // Resolve the file to an absolute URL so recursive .md links can be
        // resolved against IT, not against the hosting page's baseURI.
        const fileUrl = new URL(filename, document.baseURI).href;
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const text = await response.text();

        const html = window.DOMPurify.sanitize(window.marked.parse(text));
        contentDiv.innerHTML = html;

        // Link interception
        contentDiv.querySelectorAll('a').forEach(link => {
            const href = link.getAttribute('href');
            if (href && href.endsWith('.md')) {
                // A relative .md link is relative to the file it lives in.
                const nextUrl = new URL(href, fileUrl).href;
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    loadHelp(nextUrl, targetElementId);
                });
            } else if (href && href.startsWith('http')) {
                link.target = "_blank";
                link.rel = "noopener noreferrer";
            }
        });

    } catch (err) {
        console.error('[HelpLoader] Failed to load help:', err);
        // Kit strings land in TEXT positions of the error HTML below.
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        contentDiv.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--danger-text);">
                <h3>${esc(t('help.load-failed', 'Failed to load documentation'))}</h3>
                <p style="font-family: monospace; font-size: 0.8rem; background: var(--field); padding: 0.5rem; border-radius: var(--radius-m);">${err.message}</p>
                <p style="font-size: 0.8rem; opacity: 0.7;">${esc(t('help.check-console', 'Check console for details.'))}</p>
            </div>
        `;
    }
}
