/**
 * <sac-log>
 *
 * Structured timestamped log entries.
 * Colors: info→--ok, warn→--accent-warm, error→--danger.
 *
 * Methods:
 *   add(text, level)   — level: "info" | "warn" | "error"
 *   clear()
 *   copy()             — copies all entries to clipboard
 *
 * add() APPENDS one node — it never rebuilds the list, so only the new entry
 * plays the slide-in and existing rows don't flicker. Entry text is written
 * with textContent; log strings routinely come from errors and user input.
 *
 * Compact/touch: entry text is always selectable (user-select: text — the
 * kit's app shells switch selection off, and copying a log line off a phone
 * is the point). Under (pointer: coarse) the Copy/Clear header buttons are
 * 44px targets (the header grows to 44px rather than halos spilling onto the
 * first entry). The body is its own container: below 480px of its own width
 * long unbroken strings (URLs, stack paths) wrap instead of scrolling
 * sideways.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;
    /** Timestamps follow the kit language (sac.lang.locale()), not the
     *  browser's default locale. */
    const stamp = (date) => date.toLocaleTimeString(
        (window.sac && window.sac.lang) ? window.sac.lang.locale() : undefined);

class SacLog extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this.entries = [];
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this.render();
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
    }

    add(text, level = "info") {
        const date = new Date();
        const entry = { ts: stamp(date), date, text, level };
        this.entries.push(entry);
        const body = this.shadowRoot.getElementById("body");
        if (body) {
            body.appendChild(this._entryNode(entry));
            body.scrollTop = body.scrollHeight;
        }
    }

    clear() {
        this.entries = [];
        const body = this.shadowRoot.getElementById("body");
        if (body) body.replaceChildren();
    }

    async copy() {
        const text = this.entries.map(e => `[${e.ts}] ${e.level.toUpperCase()}: ${e.text}`).join("\n");
        try {
            await navigator.clipboard.writeText(text);
            this.flashCopied();
        } catch {
            // ignore
        }
    }

    flashCopied() {
        const btn = this.shadowRoot.getElementById("copy-btn");
        if (!btn) return;
        btn.textContent = t("log.copied", "Copied!");
        clearTimeout(this._copiedTimer);
        this._copiedTimer = setTimeout(() => {
            this._copiedTimer = null;
            btn.textContent = t("log.copy", "Copy");
        }, 1500);
    }

    /** Language switch: header strings and every timestamp, in place —
     *  entries, scroll position and a running "Copied!" flash survive. */
    _relabel() {
        const root = this.shadowRoot;
        const head = root.querySelector(".hdr > span");
        if (!head) return;
        head.textContent = t("log.header", "LOG");
        root.getElementById("copy-btn").textContent = this._copiedTimer
            ? t("log.copied", "Copied!") : t("log.copy", "Copy");
        root.getElementById("clear-btn").textContent = t("log.clear", "Clear");
        const spans = root.querySelectorAll("#body .entry .ts");
        this.entries.forEach((e, i) => {
            if (!e.date) return;
            e.ts = stamp(e.date);
            if (spans[i]) spans[i].textContent = e.ts;
        });
    }

    render() {
        // Header strings land in TEXT positions of the template below.
        const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const L = {
            header: esc(t("log.header", "LOG")),
            copy:   esc(t("log.copy",   "Copy")),
            clear:  esc(t("log.clear",  "Clear")),
        };
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: flex;
                    flex-direction: column;
                    background: var(--field);
                    border-radius: var(--radius-m);
                    border: 1px solid var(--border);
                    font-size: 0.8rem;
                    font-family: 'Inter', sans-serif;
                    height: 100%;
                    min-height: 120px;
                }
                .hdr {
                    display: flex;
                    justify-content: space-between;
                    padding: 0.4rem 0.75rem;
                    border-bottom: 1px solid var(--border);
                    color: var(--text-dim);
                    font-size: 0.7rem;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }
                .hdr button {
                    font-size: 0.7rem;
                    color: color-mix(in srgb, var(--fg) 78%, var(--bg));
                    cursor: pointer;
                    border: none;
                    background: none;
                    padding: 0.1rem 0.4rem;
                    margin-left: 0.3rem;
                    border-radius: var(--radius-m);
                    font-family: inherit;
                }
                .hdr button:hover { color: var(--text); background: var(--hover); }
                .body {
                    flex: 1;
                    overflow-y: auto;
                    padding: 0.5rem 0.75rem;
                    color: color-mix(in srgb, var(--fg) 78%, var(--bg));
                    /* user-select is inherited through the shadow boundary,
                       so a shell's "none" would make the log uncopyable. */
                    -webkit-user-select: text;
                    user-select: text;
                    container-type: inline-size;
                }
                @container (max-width: 480px) {
                    .entry { overflow-wrap: anywhere; }
                }
                @media (pointer: coarse) {
                    .hdr { align-items: center; padding-top: 0; padding-bottom: 0; }
                    .hdr button { min-height: 44px; min-width: 44px; padding: 0 0.6rem; }
                }
                @media (hover: none) {
                    .hdr button:hover { color: color-mix(in srgb, var(--fg) 78%, var(--bg)); background: none; }
                }
                .entry {
                    padding: 0.2rem 0;
                    animation: slideIn 0.2s ease-out;
                }
                @keyframes slideIn {
                    from { transform: translateY(5px); opacity: 0; }
                    to   { transform: translateY(0);   opacity: 1; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .entry { animation: none; }
                }
                .entry .ts { color: var(--text-dim); margin-right: 0.5rem; }
                .entry.info  { color: var(--ok-text); }
                .entry.warn  { color: var(--accent-warm-text); }
                .entry.error { color: var(--danger-text); }

                /* Scrollbar theme — duplicated because the global rule in
                   ui.css doesn't pierce Shadow DOM. */
                .body::-webkit-scrollbar { width: 6px; }
                .body::-webkit-scrollbar-track { background: transparent; }
                .body::-webkit-scrollbar-thumb {
                    background: var(--scrollbar-thumb);
                    border-radius: 999px;
                }
            </style>
            <div class="hdr">
                <span>${L.header}</span>
                <div>
                    <button id="copy-btn">${L.copy}</button>
                    <button id="clear-btn">${L.clear}</button>
                </div>
            </div>
            <div class="body" id="body"></div>
        `;
        this.shadowRoot.getElementById("copy-btn").addEventListener("click", () => this.copy());
        this.shadowRoot.getElementById("clear-btn").addEventListener("click", () => this.clear());
        this.renderBody();
    }

    _entryNode({ ts, text, level }) {
        const div = document.createElement("div");
        div.className = `entry ${level}`;
        const tsEl = document.createElement("span");
        tsEl.className = "ts";
        tsEl.textContent = ts;
        const msg = document.createElement("span");
        msg.textContent = String(text);
        div.append(tsEl, msg);
        return div;
    }

    /** Full repaint — initial render only; add() appends instead. */
    renderBody() {
        const body = this.shadowRoot.getElementById("body");
        if (!body) return;
        body.replaceChildren(...this.entries.map(e => this._entryNode(e)));
        body.scrollTop = body.scrollHeight;
    }
}

customElements.define("sac-log", SacLog);
})();
