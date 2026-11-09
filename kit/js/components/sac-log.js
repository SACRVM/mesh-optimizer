/**
 * <sac-log>
 *
 * Structured timestamped log entries.
 * Colors: info→--ok, warn→--accent-warm, error→--danger. The level is never
 * colour alone: every entry leads with its level icon (info a circled i,
 * warn a triangle, error a circled × — three shapes) and carries the level
 * as words for screen readers ("Warning: …").
 *
 * Methods:
 *   add(text, level)   — level: "info" | "warn" | "error"
 *   clear()            — empties the log for good, silently (app code).
 *   copy()             — copies all entries to clipboard; resolves true /
 *                        false. A failure is reported, never swallowed:
 *                        sac.toast (kind "error") "Couldn't copy – select the
 *                        text and press Ctrl+C" (the platform's keys), or a
 *                        console warning without the toast module.
 *
 * add() APPENDS one node — it never rebuilds the list, so only the new entry
 * plays the slide-in and existing rows don't flicker. Entry text is written
 * with textContent; log strings routinely come from errors and user input.
 * It scrolls the new entry into view only when the body was already at (or
 * within ~24px of) the bottom — someone reading further up is not yanked
 * away.
 *
 * The header's Clear button is forgiving: the entries go, and a toast offers
 * Undo ("Log cleared · Undo"), which puts them back in front of anything
 * logged since. Without sac.toast the button clears for good, like clear().
 *
 * ARIA: the body is role="log" (polite, named by the header), so each new
 * entry is read as it arrives.
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
    /** Level → icon name (sac.icons) and the words a screen reader hears. */
    const LEVELS = {
        info:  { icon: "info",  key: "log.level-info",  fallback: "Info" },
        warn:  { icon: "warn",  key: "log.level-warn",  fallback: "Warning" },
        error: { icon: "error", key: "log.level-error", fallback: "Error" },
    };
    const levelOf = (level) => LEVELS[level] || LEVELS.info;
    /** The "copy failed" advice, with the platform's own copy keys. */
    const copyFailed = () => {
        const keys = (window.sac && sac.hotkeys && sac.hotkeys.format) ? sac.hotkeys.format("mod+c") : "Ctrl+C";
        return t("log.copy-failed", "Couldn't copy – select the text and press {keys}").replace("{keys}", () => keys);
    };

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
            // Follow the tail only when the reader is already there.
            const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight <= 24;
            body.appendChild(this._entryNode(entry));
            if (atEnd) body.scrollTop = body.scrollHeight;
        }
    }

    clear() {
        this.entries = [];
        const body = this.shadowRoot.getElementById("body");
        if (body) body.replaceChildren();
    }

    /** The Clear button: clear, then offer Undo through a toast. Undo puts
     *  the cleared entries back in front of whatever was logged since. */
    _clearWithUndo() {
        const saved = this.entries.slice();
        this.clear();
        if (!saved.length || !(window.sac && typeof sac.toast === "function")) return;
        sac.toast(t("log.cleared", "Log cleared"), {
            action: {
                label: t("log.undo", "Undo"),
                labelKey: "log.undo",
                onClick: () => {
                    this.entries = saved.concat(this.entries);
                    this.renderBody(true);
                },
            },
        });
    }

    async copy() {
        const text = this.entries.map(e => `[${e.ts}] ${String(e.level).toUpperCase()}: ${e.text}`).join("\n");
        try {
            if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("Clipboard API unavailable");
            await navigator.clipboard.writeText(text);
            this.flashCopied();
            return true;
        } catch (err) {
            // Never swallowed: say so, and what to do instead.
            console.warn("sac-log: copy failed", err);
            if (window.sac && typeof sac.toast === "function") sac.toast(copyFailed(), { kind: "error" });
            return false;
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
        const words = root.querySelectorAll("#body .entry .lv-text");
        this.entries.forEach((e, i) => {
            const lv = levelOf(e.level);
            if (words[i]) words[i].textContent = `${t(lv.key, lv.fallback)}: `;
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
                /* Press: answers the moment it goes down. */
                .hdr button:active { background: var(--hover-strong); transition-duration: 0s; }
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
                    /* …but the press itself still shows (a touch is a hover too). */
                    .hdr button:active { background: var(--hover-strong); }
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
                /* The level's shape: info, warn and error differ without
                   their colour. Inline, so a wrapped entry keeps its flow. */
                .entry .lv {
                    --icon-size: 12px;
                    margin-right: 0.35rem;
                    vertical-align: -1px;
                }
                /* The level as words, for screen readers only. */
                .lv-text {
                    position: absolute;
                    width: 1px;
                    height: 1px;
                    margin: -1px;
                    padding: 0;
                    overflow: hidden;
                    clip: rect(0 0 0 0);
                    white-space: nowrap;
                    border: 0;
                }
                .body { position: relative; }

                /* Scrollbar theme — duplicated because the global rule in
                   ui.css doesn't pierce Shadow DOM. */
                .body::-webkit-scrollbar { width: var(--scrollbar-size); }
                .body::-webkit-scrollbar-track { background: transparent; }
                .body::-webkit-scrollbar-thumb {
                    background: var(--scrollbar-thumb);
                    background-clip: content-box;
                    border: var(--scrollbar-gap) solid transparent;
                    border-radius: 999px;
                }
            </style>
            <div class="hdr">
                <span id="hdr-title">${L.header}</span>
                <div>
                    <button id="copy-btn">${L.copy}</button>
                    <button id="clear-btn">${L.clear}</button>
                </div>
            </div>
            <div class="body" id="body" role="log" aria-labelledby="hdr-title"></div>
        `;
        this.shadowRoot.getElementById("copy-btn").addEventListener("click", () => this.copy());
        this.shadowRoot.getElementById("clear-btn").addEventListener("click", () => this._clearWithUndo());
        this.renderBody();
    }

    _entryNode({ ts, text, level }) {
        const div = document.createElement("div");
        div.className = `entry ${level}`;
        const tsEl = document.createElement("span");
        tsEl.className = "ts";
        tsEl.textContent = ts;
        const lv = levelOf(level);
        const icon = document.createElement("sac-icon");
        icon.className = "lv";
        icon.setAttribute("name", lv.icon);
        icon.setAttribute("aria-hidden", "true");
        const words = document.createElement("span");
        words.className = "lv-text";
        words.textContent = `${t(lv.key, lv.fallback)}: `;
        const msg = document.createElement("span");
        msg.textContent = String(text);
        div.append(tsEl, icon, words, msg);
        return div;
    }

    /** Full repaint — initial render and Undo; add() appends instead.
     *  `still`: no slide-in (a restore is not news). */
    renderBody(still) {
        const body = this.shadowRoot.getElementById("body");
        if (!body) return;
        const nodes = this.entries.map(e => this._entryNode(e));
        if (still) {
            nodes.forEach((n) => { n.style.animation = "none"; });
            // Restored entries are not new: the log stays quiet for the
            // swap instead of reading every line again.
            body.setAttribute("aria-live", "off");
            requestAnimationFrame(() => body.removeAttribute("aria-live"));
        }
        body.replaceChildren(...nodes);
        body.scrollTop = body.scrollHeight;
    }
}

customElements.define("sac-log", SacLog);
})();
