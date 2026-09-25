/**
 * <sac-shortcut-sheet>  —  the "keyboard shortcuts" cheat-sheet overlay.
 *
 * A modal glass panel (the <sac-dialog> look) that lists every ACTIVE binding
 * in sac.hotkeys, grouped by the `group` each one was registered with, plus
 * static entries the registry cannot express — mouse gestures, hold-keys,
 * wheel ("Space + drag", "Alt + click", "Wheel"). It reads the registry each
 * time it opens, so it is never out of date: a tool that registers a key
 * (e.g. <sac-toolbox hotkeys>) shows up without any extra wiring.
 *
 * Usually reached through the helper, not the element:
 *
 *   sac.shortcuts.bind();                       // "?" opens / closes it
 *   const off = sac.shortcuts.add([             // gestures, held keys …
 *       { group: "View", keys: "Space + drag", description: "Pan" },
 *       { group: "View", keys: ["Wheel"],      description: "Zoom" },
 *       { group: "Draw", keys: ["Alt", "click"], description: "Pick a color" },
 *   ]);
 *   sac.shortcuts.show({ title: "Atelier shortcuts" });
 *
 * <sac-shortcut-sheet> — attributes:
 *   title — heading, default "Keyboard shortcuts".
 *   open  — reflected while shown (read it, don't write it — use open()).
 * Properties:
 *   extra — array of { group?, keys, description }. `keys` is an array of
 *           chips (["Alt", "click"]) or one string split on "+"
 *           ("Space + drag"). Ungrouped entries land in "General".
 * Methods:
 *   open() · close() · toggle()
 * Events:
 *   sac:close — after it closes (Escape, backdrop, close button, close()).
 *               Bubbles, composed (it lives in <body>, listeners may be far).
 *
 * Grouping: registry groups first, in the order their first binding was
 * registered, then groups only the extras use; "General" (ungrouped) always
 * last. Bindings registered WITHOUT a description are internal plumbing
 * (a modal's temporary Escape) and are not listed.
 *
 * sac.shortcuts — the helper (one shared sheet in <body>, created lazily):
 *   show({ title?, extra? })  — open; `extra` adds one-off entries for this
 *                               opening only.
 *   hide() · toggle(opts?)
 *   add(entries)              — persistent extras, shown on every opening →
 *                               remove function (idempotent).
 *   bind(combo = "shift+?", opts?)
 *                             — registers a toggle hotkey (description
 *                               "Keyboard shortcuts", group "Help") →
 *                               unregister function. "shift+?" because the
 *                               registry matches EXACTLY and "?" is a shifted
 *                               key on the common layouts (US Shift+/, DE
 *                               Shift+ß, FR Shift+,): the event arrives as
 *                               key "?" WITH shiftKey, so plain "?" would never
 *                               fire.
 *
 * Keyboard: Escape closes; Tab cycles the scrollable list and the close
 * button (focus trap); focus returns to whatever opened it.
 *
 * Compact (≤768px, or a phone held sideways): a bottom sheet — full width,
 * above the home-indicator safe area, at most 85dvh with the list scrolling;
 * the two-column layout collapses to one. The close button reaches 44 × 44
 * under (pointer: coarse).
 *
 * Theming: tokens only — the <sac-dialog> glass, kbd chips in the ui.css kbd
 * recipe (re-stated here: document styles do not pierce the shadow root).
 */
class SacShortcutSheet extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._extra = [];
        this._onKeydown = this._onKeydown.bind(this);
    }

    static get observedAttributes() { return ["title"]; }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
    }

    attributeChangedCallback() {
        const h = this.shadowRoot.getElementById("ss-title");
        if (h) h.textContent = this._title();
    }

    get extra() { return this._extra.slice(); }
    set extra(list) {
        this._extra = Array.isArray(list) ? list.slice() : [];
        if (this.hasAttribute("open")) this._fill();
    }

    open() {
        if (!this.shadowRoot.firstChild) this._render();
        if (this.hasAttribute("open")) { this._fill(); return; }
        this._restoreFocus = document.activeElement;
        this._fill();
        this.setAttribute("open", "");
        document.addEventListener("keydown", this._onKeydown, true);
        const close = this.shadowRoot.querySelector(".close");
        if (close) close.focus({ preventScroll: true });
    }

    close() {
        if (!this.hasAttribute("open")) return;
        this.removeAttribute("open");
        document.removeEventListener("keydown", this._onKeydown, true);
        const back = this._restoreFocus;
        this._restoreFocus = null;
        if (back && back.isConnected && typeof back.focus === "function") back.focus({ preventScroll: true });
        this.dispatchEvent(new CustomEvent("sac:close", { bubbles: true, composed: true }));
    }

    toggle() { if (this.hasAttribute("open")) this.close(); else this.open(); }

    _title() { return this.getAttribute("title") || "Keyboard shortcuts"; }

    _onKeydown(e) {
        if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            this.close();
            return;
        }
        if (e.key === "Tab") {
            const items = [this.shadowRoot.querySelector(".body"), this.shadowRoot.querySelector(".close")];
            const idx = items.indexOf(this.shadowRoot.activeElement);
            e.preventDefault();
            items[(idx + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
        }
    }

    /* ------------------------------------------------------------ data --- */

    /** Chips for a registry display string. macOS spells chords as one glyph
     *  run (⌘K) — that stays one chip; elsewhere "Ctrl+Shift+K" splits, and a
     *  literal "+" key ("Ctrl++") survives as the last chip. */
    static _splitDisplay(display) {
        if (window.sac && sac.hotkeys && sac.hotkeys.isMac()) return [display];
        if (display === "+") return ["+"];
        const plusKey = display.endsWith("++");
        const parts = (plusKey ? display.slice(0, -2) : display).split("+").filter(Boolean);
        if (plusKey) parts.push("+");
        return parts;
    }

    static _splitKeys(keys) {
        if (Array.isArray(keys)) return keys.map(String);
        const s = String(keys == null ? "" : keys).trim();
        if (s === "+") return ["+"];
        return s.split(/\s*\+\s*/).filter(Boolean);
    }

    _groups() {
        const GENERAL = "General";
        const order = [];
        const map = new Map();
        const put = (group, chips, description) => {
            const g = group || GENERAL;
            if (!map.has(g)) { map.set(g, []); order.push(g); }
            map.get(g).push({ chips, description });
        };
        const reg = (window.sac && sac.hotkeys) ? sac.hotkeys.list() : [];
        reg.filter((b) => b.description)
           .forEach((b) => put(b.group, SacShortcutSheet._splitDisplay(b.display), b.description));
        const extras = this._extra.concat(this._oneOff || []);
        extras.filter((x) => x && x.keys != null)
              .forEach((x) => put(x.group, SacShortcutSheet._splitKeys(x.keys), x.description || ""));
        // "General" last — it is the leftovers bucket, not a headline.
        const named = order.filter((g) => g !== GENERAL);
        if (map.has(GENERAL)) named.push(GENERAL);
        return named.map((g) => ({ name: g, rows: map.get(g) }));
    }

    _fill() {
        const body = this.shadowRoot.querySelector(".body");
        if (!body) return;
        body.textContent = "";
        const groups = this._groups();
        if (!groups.length) {
            const p = document.createElement("p");
            p.className = "empty";
            p.textContent = "No keyboard shortcuts are registered.";
            body.appendChild(p);
            return;
        }
        for (const g of groups) {
            const sec = document.createElement("section");
            const h = document.createElement("h3");
            h.textContent = g.name;
            sec.appendChild(h);
            const table = document.createElement("table");
            for (const row of g.rows) {
                const tr = document.createElement("tr");
                const k = document.createElement("td");
                k.className = "keys";
                row.chips.forEach((c, i) => {
                    if (i) k.appendChild(document.createTextNode(" + "));
                    const kbd = document.createElement("kbd");
                    kbd.textContent = c;
                    k.appendChild(kbd);
                });
                const d = document.createElement("td");
                d.textContent = row.description;
                tr.append(k, d);
                table.appendChild(tr);
            }
            sec.appendChild(table);
            body.appendChild(sec);
        }
    }

    /* ---------------------------------------------------------- render --- */

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    position: fixed;
                    inset: 0;
                    z-index: 20000;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                }
                :host([open]) { display: flex; }
                .backdrop {
                    position: absolute;
                    inset: 0;
                    background: color-mix(in srgb, var(--sink) 50%, transparent);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    opacity: 0;
                    animation: fade-in 150ms ease-out forwards;
                }
                .panel {
                    position: relative;
                    width: 640px;
                    max-width: calc(100vw - 32px);
                    max-height: calc(100dvh - 32px);
                    display: flex;
                    flex-direction: column;
                    background: color-mix(in srgb, var(--surface) 75%, transparent);
                    backdrop-filter: blur(20px) saturate(180%);
                    -webkit-backdrop-filter: blur(20px) saturate(180%);
                    border: 1px solid var(--border-strong);
                    border-radius: var(--radius-l);
                    box-shadow:
                        0 20px 50px color-mix(in srgb, var(--sink) 50%, transparent),
                        inset 0 0 0 1px color-mix(in srgb, var(--fg) 5%, transparent);
                    opacity: 0;
                    transform: scale(0.96);
                    animation: pop-in 150ms ease-out forwards;
                    color: var(--text);
                }
                .head {
                    flex: none;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    padding: 16px 16px 4px 20px;
                }
                .title {
                    font-family: 'Outfit', sans-serif;
                    font-weight: 700;
                    font-size: 1.05rem;
                    letter-spacing: -0.01em;
                    margin: 0;
                }
                .close {
                    width: var(--icon-btn-size, 26px);
                    height: var(--icon-btn-size, 26px);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                    border: none;
                    border-radius: var(--radius-m);
                    background: transparent;
                    color: var(--text-muted);
                    cursor: pointer;
                    --icon-size: var(--icon-btn-icon, 14px);
                }
                .close:hover { background: var(--hover); color: var(--text); }
                .close:focus-visible, .body:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                }
                .body {
                    flex: 1 1 auto;
                    min-height: 0;
                    overflow-y: auto;
                    padding: 8px 20px 20px;
                    columns: 2 260px;
                    column-gap: 28px;
                    font-size: 0.85rem;
                    line-height: 1.4;
                }
                .body::-webkit-scrollbar { width: 10px; height: 10px; }
                .body::-webkit-scrollbar-track { background: transparent; }
                .body::-webkit-scrollbar-thumb {
                    background: var(--scrollbar-thumb);
                    background-clip: content-box;
                    border: 2px solid transparent;
                    border-radius: 999px;
                }
                .body::-webkit-scrollbar-thumb:hover {
                    background: var(--scrollbar-thumb-hover);
                    background-clip: content-box;
                }
                @supports not selector(::-webkit-scrollbar) {
                    .body { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) transparent; }
                }
                section { break-inside: avoid; margin: 0 0 16px; }
                h3 {
                    margin: 8px 0 6px;
                    font-family: var(--caption-font, 'Outfit', sans-serif);
                    font-size: var(--caption-size, 0.78rem);
                    font-weight: var(--caption-weight, 700);
                    letter-spacing: var(--caption-tracking, 0.12em);
                    text-transform: uppercase;
                    color: var(--text-dim);
                }
                table { width: 100%; border-collapse: collapse; }
                td {
                    padding: 5px 0;
                    border-bottom: 1px solid var(--border);
                    vertical-align: baseline;
                    color: var(--text-muted);
                }
                tr:last-child td { border-bottom: none; }
                td.keys {
                    white-space: nowrap;
                    padding-right: 14px;
                    width: 1%;
                    color: var(--text-dim);
                    font-size: 0.8em;
                }
                /* The ui.css kbd recipe, re-stated for the shadow root. */
                kbd {
                    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                    font-size: 0.95em;
                    background: var(--field);
                    border: 1px solid var(--border-strong);
                    border-bottom-width: 2px;
                    border-radius: var(--radius-s);
                    padding: 2px 6px;
                    color: var(--text);
                }
                .empty { margin: 0; color: var(--text-muted); }

                @keyframes fade-in { to { opacity: 1; } }
                @keyframes pop-in  { to { opacity: 1; transform: scale(1); } }
                @keyframes sheet-in {
                    from { opacity: 1; transform: translateY(100%); }
                    to   { opacity: 1; transform: none; }
                }
                @media (max-width: 768px), (max-height: 480px) and (pointer: coarse) {
                    :host { align-items: flex-end; }
                    .panel {
                        width: 100%;
                        max-width: 100%;
                        max-height: 85dvh;
                        border-bottom: none;
                        border-radius: var(--radius-l) var(--radius-l) 0 0;
                        padding-bottom: env(safe-area-inset-bottom, 0px);
                        transform: translateY(100%);
                        animation: sheet-in 220ms var(--ease-smooth) forwards;
                    }
                    .body { columns: 1; }
                }
                @media (pointer: coarse) {
                    .close { width: 44px; height: 44px; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .backdrop, .panel { animation-duration: 1ms; }
                }
            </style>
            <div class="backdrop" part="backdrop"></div>
            <div class="panel" part="panel" role="dialog" aria-modal="true" aria-labelledby="ss-title">
                <div class="head">
                    <h2 class="title" id="ss-title"></h2>
                    <button class="close" type="button" aria-label="Close"><sac-icon name="close"></sac-icon></button>
                </div>
                <div class="body" tabindex="0"></div>
            </div>
        `;
        this.shadowRoot.getElementById("ss-title").textContent = this._title();
        this.shadowRoot.querySelector(".backdrop").addEventListener("click", () => this.close());
        this.shadowRoot.querySelector(".close").addEventListener("click", () => this.close());
    }
}

customElements.define("sac-shortcut-sheet", SacShortcutSheet);

/* sac.shortcuts — one shared sheet in <body>, created on first use. */
(function () {
    if (!window.sac) { console.warn("[sac.shortcuts] globals.js must load first — shortcut sheet helper unavailable."); return; }
    let sheet = null;
    const persistent = [];     // entries from add(), shown on every opening

    function ensure() {
        if (!sheet || !sheet.isConnected) {
            sheet = document.createElement("sac-shortcut-sheet");
            document.body.appendChild(sheet);
        }
        return sheet;
    }

    sac.shortcuts = {
        show(opts = {}) {
            const s = ensure();
            if (opts.title) s.setAttribute("title", opts.title);
            else s.removeAttribute("title");
            s._oneOff = Array.isArray(opts.extra) ? opts.extra.slice() : [];
            s.extra = persistent;
            s.open();
            return s;
        },
        hide() { if (sheet) sheet.close(); },
        toggle(opts) {
            if (sheet && sheet.hasAttribute("open")) this.hide();
            else this.show(opts);
        },
        add(entries) {
            const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
            persistent.push(...list);
            if (sheet && sheet.hasAttribute("open")) sheet.extra = persistent;
            let spent = false;
            return function remove() {
                if (spent) return;
                spent = true;
                list.forEach((x) => {
                    const i = persistent.indexOf(x);
                    if (i !== -1) persistent.splice(i, 1);
                });
                if (sheet && sheet.hasAttribute("open")) sheet.extra = persistent;
            };
        },
        bind(combo = "shift+?", opts = {}) {
            if (!sac.hotkeys) { console.warn("[sac.shortcuts] bind: hotkeys.js is not loaded."); return function () {}; }
            return sac.hotkeys.register(combo, () => sac.shortcuts.toggle(opts), {
                description: "Keyboard shortcuts", group: "Help",
            });
        },
    };
})();
