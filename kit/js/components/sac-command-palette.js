/**
 * <sac-command-palette>  —  Ctrl-K command palette.
 *
 * One line of markup per app (usually already in the shell template):
 *
 *   <sac-command-palette></sac-command-palette>
 *
 * From there it is self-wiring. It binds `mod+k` (Ctrl-K / ⌘K) through
 * sac.hotkeys on connect, and it does NOT keep a command list of its own —
 * it merges two live sources every time it opens, so what you see is
 * always the app's current state:
 *
 *   1. Views    — sac.router.routes(), one row per registered route with a
 *                 label; running it calls sac.router.navigate(hash).
 *   2. Commands — everything registered on sac.commands (below), grouped by
 *                 each command's `group` (default "Commands"). An app owns
 *                 its toolbar, so toolbar actions it wants keyboard-reachable
 *                 are registered here too.
 *
 * Methods:
 *   open() / close() / toggle()
 *
 * Attributes:
 *   open — reflected. Present = visible. Nothing renders while it is absent.
 *
 * API installed by this file:
 *   sac.palette  — { open, close, toggle } bound to the first connected
 *                  instance; nulled again when that instance disconnects.
 *   sac.commands — the app command registry:
 *       register({ id, label, icon, group, hotkey, run }) → unregister fn
 *              id is required and upserts: registering the same id twice
 *              replaces the entry instead of duplicating the row.
 *              `hotkey` is a DISPLAY hint (rendered as a <kbd>); binding it
 *              is the app's job — sac.hotkeys.register() — because the
 *              palette must not own an app's key bindings.
 *       unregister(id)
 *       list() → the registered commands, in registration order.
 *
 * Keyboard:
 *   mod+k        — toggle (registered via sac.hotkeys, description
 *                  "Command palette")
 *   ArrowUp/Down — move the selection, wrapping at both ends
 *   Enter        — run the selected entry, then close
 *   Escape       — close
 *   Tab          — trapped: focus stays in the search field
 *
 * Filtering is a case-insensitive SUBSEQUENCE match on the label ("dg" finds
 * "Delete Group"). Exact substring matches rank above subsequence-only ones,
 * shorter labels first within a rank; groups are ordered by their best match.
 * An empty query lists everything, grouped.
 *
 * All labels are written with textContent — route labels, toolbar titles and
 * command labels are app data, never markup.
 *
 * Compact/touch:
 *   On a compact viewport (≤768px, or a phone held sideways) the panel becomes a full-width
 *   sheet anchored to the top edge (below env(safe-area-inset-top)), rounded
 *   only at the bottom — the mirror of sac-dialog's bottom sheet, and the
 *   half of the screen an on-screen keyboard leaves free. Tapping the dimmed
 *   area below it closes it (there is no Escape key on a phone). Under
 *   (pointer: coarse) every row is at least 44px tall and the search field
 *   uses 16px type (below that iOS zooms the page on focus). Nothing is
 *   hover-only: the pointer highlight just follows the finger, a tap runs
 *   the row. mod+k does not exist on a phone — an app that wants the palette
 *   there gives it a button calling sac.palette.open().
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

    /* --------------------------------------------------------------------
       sac.commands — the app command registry. Installed defensively so a
       page can load this file twice (or after an app already populated it)
       without losing registrations.
       -------------------------------------------------------------------- */
    if (window.sac && !sac.commands) {
        const registry = new Map();     // id → command
        sac.commands = {
            register(command) {
                if (!command || command.id == null || command.id === "") {
                    console.error("[sac.commands] register: an `id` is required", command);
                    return function () {};
                }
                const id = String(command.id);
                registry.set(id, {
                    id,
                    label:  command.label != null ? String(command.label) : id,
                    icon:   command.icon || null,
                    group:  command.group || t("palette.commands", "Commands"),
                    hotkey: command.hotkey || null,
                    run:    typeof command.run === "function" ? command.run : null,
                });
                return function unregister() { registry.delete(id); };
            },
            unregister(id) { registry.delete(String(id)); },
            list() { return Array.from(registry.values()); },
        };
    }

    /* ----------------------------------------------------------- matching */

    /** 0 = prefix, 1 = substring, 2 = subsequence, -1 = no match. */
    function matchRank(label, q) {
        const l = label.toLowerCase();
        const at = l.indexOf(q);
        if (at === 0) return 0;
        if (at > 0)   return 1;
        let i = 0;
        for (let c = 0; c < q.length; c++) {
            i = l.indexOf(q[c], i);
            if (i === -1) return -1;
            i++;
        }
        return 2;
    }

    /** Focused element, following shadow roots down to the real one. */
    function deepActiveElement() {
        let el = document.activeElement;
        while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
        return el;
    }

    function hotkeyLabel(combo) {
        if (window.sac && sac.hotkeys && typeof sac.hotkeys.format === "function") {
            return sac.hotkeys.format(combo);
        }
        return String(combo);
    }

    /* ==================================================================== */

    class SacCommandPalette extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: "open" });
            this._entries  = [];    // everything collected at open time
            this._visible  = [];    // entries currently rendered, in row order
            this._rows     = [];    // the row elements, same order
            this._index    = 0;
            this._restoreFocus = null;
            this._unhotkey = null;
            this._ownsApi  = false;
        }

        connectedCallback() {
            if (!this.shadowRoot.firstChild) this._render();

            if (window.sac && sac.hotkeys) {
                if (!this._unhotkey) {
                    this._unhotkey = sac.hotkeys.register("mod+k", () => this.toggle(), {
                        description: t("palette.title", "Command palette"),
                    });
                }
            } else {
                console.warn("[sac-command-palette] sac.hotkeys is not loaded — " +
                             "mod+k is unbound. Load kit/js/lib/hotkeys.js before the components.");
            }

            // First connected instance owns the shorthand API.
            if (window.sac && !sac.palette) {
                sac.palette = {
                    open:   () => this.open(),
                    close:  () => this.close(),
                    toggle: () => this.toggle(),
                };
                this._ownsApi = true;
            }

            // Authored as <sac-command-palette open>: run the real open path
            // (collect, focus) instead of showing an empty panel.
            if (this.hasAttribute("open")) {
                this.removeAttribute("open");
                this.open();
            }
        }

        disconnectedCallback() {
            if (this._unhotkey) { this._unhotkey(); this._unhotkey = null; }
            if (this._ownsApi && window.sac) { sac.palette = null; this._ownsApi = false; }
            this.close();
        }

        /* ---------------------------------------------------------- API */

        open() {
            if (this.hasAttribute("open")) return;
            if (!this.shadowRoot.firstChild) this._render();

            this._restoreFocus = deepActiveElement();
            this._entries = this._collect();
            this._input.value = "";
            this.setAttribute("open", "");
            this._input.setAttribute("aria-expanded", "true");
            this._apply("");

            // The field only becomes focusable once :host([open]) flips the
            // display — focus() flushes style, but retry once in case an
            // engine defers it.
            this._input.focus({ preventScroll: true });
            if (this.shadowRoot.activeElement !== this._input) {
                requestAnimationFrame(() => {
                    if (this.hasAttribute("open")) this._input.focus({ preventScroll: true });
                });
            }
        }

        close() {
            if (!this.hasAttribute("open")) return;
            this.removeAttribute("open");
            if (this._input) this._input.setAttribute("aria-expanded", "false");
            const back = this._restoreFocus;
            this._restoreFocus = null;
            if (back && back.isConnected && typeof back.focus === "function") {
                back.focus({ preventScroll: true });
            }
        }

        toggle() {
            if (this.hasAttribute("open")) this.close();
            else this.open();
        }

        /* ------------------------------------------------------- sources */

        /** Merge the three sources. Called on every open — never cached. */
        _collect() {
            const entries = [];

            // 1. Views — every labelled route.
            const router = window.sac && sac.router;
            if (router && typeof router.routes === "function") {
                for (const route of router.routes()) {
                    if (!route || !route.label) continue;
                    const hash = route.hash;
                    // A "route" can be a real hash destination OR an external
                    // link the nav panel also lists (Download, Source). Running
                    // an absolute URL through navigate() would only mangle the
                    // hash and bounce home — open it as a link instead.
                    const isExternal = /^[a-z][a-z0-9+.-]*:/i.test(hash) && !hash.startsWith("#");
                    entries.push({
                        group: t("palette.group-views", "Views"),
                        label: String(route.label),
                        icon:  route.icon || null,
                        hotkey: null,
                        run:   isExternal
                            ? () => window.open(hash, "_blank", "noopener")
                            : () => router.navigate(hash),
                    });
                }
            }

            // 2. App commands. (There is no toolbar-projection source any
            //    more — an app owns its toolbar and registers the actions it
            //    wants keyboard-reachable on sac.commands.)
            const commands = (window.sac && sac.commands && sac.commands.list()) || [];
            for (const cmd of commands) {
                entries.push({
                    group:  cmd.group || t("palette.commands", "Commands"),
                    label:  String(cmd.label),
                    icon:   cmd.icon || null,
                    hotkey: cmd.hotkey || null,
                    run:    cmd.run,
                });
            }

            return entries;
        }

        /* ----------------------------------------------------- filtering */

        /**
         * Rank, group and rebuild the result rows. Rows are ephemeral UI —
         * rebuilt wholesale on every keystroke — but the list container and
         * everything around it is created once in _render().
         */
        _apply(query) {
            const q = String(query || "").trim().toLowerCase();

            // Group in order of first appearance, remembering each group's
            // best rank so a strong match can pull its group to the top.
            const groups = [];
            const byName = new Map();
            for (const entry of this._entries) {
                const rank = q ? matchRank(entry.label, q) : 0;
                if (rank === -1) continue;
                let g = byName.get(entry.group);
                if (!g) {
                    g = { name: entry.group, best: rank, order: groups.length, items: [] };
                    byName.set(entry.group, g);
                    groups.push(g);
                }
                if (rank < g.best) g.best = rank;
                g.items.push({ entry, rank });
            }
            if (q) {
                groups.sort((a, b) => (a.best - b.best) || (a.order - b.order));
                for (const g of groups) {
                    g.items.sort((a, b) =>
                        (a.rank - b.rank) || (a.entry.label.length - b.entry.label.length));
                }
            }

            const list = this._list;
            list.textContent = "";
            this._rows = [];
            this._visible = [];

            for (const g of groups) {
                const header = document.createElement("div");
                header.className = "group";
                header.setAttribute("role", "presentation");
                header.textContent = g.name;
                list.appendChild(header);

                for (const { entry } of g.items) {
                    const index = this._rows.length;
                    const row = document.createElement("div");
                    row.className = "row";
                    row.id = `cp-opt-${index}`;
                    row.setAttribute("role", "option");
                    row.setAttribute("aria-selected", "false");

                    // The icon cell keeps its width even when empty, so labels
                    // stay on one vertical line whether or not there's a glyph.
                    const ico = document.createElement("span");
                    ico.className = "ico";
                    if (entry.icon) {
                        const glyph = document.createElement("sac-icon");
                        glyph.setAttribute("name", entry.icon);
                        ico.appendChild(glyph);
                    }
                    row.appendChild(ico);

                    const label = document.createElement("span");
                    label.className = "label";
                    label.textContent = entry.label;
                    row.appendChild(label);

                    if (entry.hotkey) {
                        const kbd = document.createElement("kbd");
                        kbd.textContent = hotkeyLabel(entry.hotkey);
                        row.appendChild(kbd);
                    }

                    row.addEventListener("mouseenter", () => this._select(index));
                    row.addEventListener("click", () => this._run(this._visible[index]));

                    list.appendChild(row);
                    this._rows.push(row);
                    this._visible.push(entry);
                }
            }

            this._empty.hidden = this._visible.length > 0;
            this._select(0);
        }

        /* ----------------------------------------------------- selection */

        _select(index) {
            if (this._visible.length === 0) {
                this._index = 0;
                this._input.removeAttribute("aria-activedescendant");
                return;
            }
            const n = this._visible.length;
            const next = ((index % n) + n) % n;              // wraps both ways
            if (this._rows[this._index]) {
                this._rows[this._index].setAttribute("aria-selected", "false");
            }
            this._index = next;
            const row = this._rows[next];
            row.setAttribute("aria-selected", "true");
            this._input.setAttribute("aria-activedescendant", row.id);
            row.scrollIntoView({ block: "nearest" });
        }

        _run(entry) {
            if (!entry) return;
            // Close FIRST: close() restores focus to whatever was focused
            // before the palette opened, so a command that focuses something
            // itself (a dialog, an editor) is not yanked back afterwards.
            // It also guarantees a throwing command cannot leave the palette
            // hanging open.
            this.close();
            if (typeof entry.run !== "function") return;
            try {
                entry.run();
            } catch (err) {
                console.error(`[sac-command-palette] "${entry.label}" failed:`, err);
            }
        }

        /* -------------------------------------------------------- render */

        _render() {
            // Kit strings: attribute positions get quote-escaping, the empty
            // state is a text node and gets &/< escaping instead.
            const esc = (s) => String(s).replace(/"/g, "&quot;");
            const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
            const L = {
                title:       esc(t("palette.title", "Command palette")),
                placeholder: esc(t("palette.placeholder", "Type a command…")),
                search:      esc(t("palette.search", "Search commands")),
                commands:    esc(t("palette.commands", "Commands")),
                empty:       escText(t("palette.empty", "No matching commands")),
            };
            this.shadowRoot.innerHTML = `
                <style>
                    :host {
                        position: fixed;
                        inset: 0;
                        z-index: 21000;          /* above <sac-dialog> (20000), below tooltips */
                        display: none;
                        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    }
                    :host([open]) { display: block; }

                    .backdrop {
                        position: absolute;
                        inset: 0;
                        background: color-mix(in srgb, var(--bg) 55%, transparent);
                        backdrop-filter: blur(2px);
                        -webkit-backdrop-filter: blur(2px);
                        opacity: 0;
                        animation: cp-fade 120ms var(--ease-smooth) forwards;
                    }

                    /* Centering layer: pointer-events pass through to the
                       backdrop, so a click beside the panel closes. */
                    .layer {
                        position: absolute;
                        inset: 0;
                        display: flex;
                        justify-content: center;
                        align-items: flex-start;
                        padding: 15vh 16px 16px;
                        box-sizing: border-box;
                        pointer-events: none;
                    }

                    .panel {
                        pointer-events: auto;
                        box-sizing: border-box;
                        /* Never wider than the viewport minus 8px a side. */
                        width: min(560px, 92vw, 100vw - 16px);
                        display: flex;
                        flex-direction: column;
                        overflow: hidden;
                        background: var(--glass-strong);
                        backdrop-filter: blur(20px) saturate(180%);
                        -webkit-backdrop-filter: blur(20px) saturate(180%);
                        border: 1px solid var(--border-strong);
                        border-radius: var(--radius-l);
                        box-shadow: var(--shadow-2);
                        color: var(--text);
                        opacity: 0;
                        transform: translateY(-8px);
                        animation: cp-in 120ms var(--ease-smooth) forwards;
                    }

                    .search {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        padding: 12px 14px;
                        border-bottom: 1px solid var(--border);
                    }
                    .search sac-icon {
                        --icon-size: 18px;
                        flex: none;
                        color: var(--text-dim);
                    }
                    /* ui.css's global input rule cannot reach into a shadow
                       root, so the field is styled from scratch: borderless,
                       inheriting the panel's font. */
                    input {
                        flex: 1;
                        min-width: 0;
                        margin: 0;
                        padding: 0;
                        border: none;
                        background: none;
                        outline: none;
                        font: inherit;
                        font-size: 0.95rem;
                        color: var(--text);
                    }
                    input::placeholder { color: var(--text-dim); }

                    .list {
                        max-height: 50vh;
                        overflow-y: auto;
                        padding: 6px;
                    }

                    .group {
                        padding: 8px 10px 4px;
                        font-size: 0.66rem;
                        font-weight: 700;
                        text-transform: uppercase;
                        letter-spacing: 0.08em;
                        color: var(--text-dim);
                    }

                    .row {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        padding: 8px 10px;
                        border-radius: var(--radius-m);
                        font-size: 0.88rem;
                        color: var(--text-muted);
                        cursor: pointer;
                        user-select: none;
                    }
                    /* Selection = accent tint + accent text. Never an edge
                       stripe (kit rule: no thick colored borders). */
                    .row[aria-selected="true"] {
                        background: var(--accent-tint);
                        color: var(--accent);
                    }

                    .ico {
                        flex: none;
                        width: 16px;
                        height: 16px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        --icon-size: 16px;
                        color: var(--text-dim);
                    }
                    .row[aria-selected="true"] .ico { color: var(--accent); }

                    .label {
                        flex: 1;
                        min-width: 0;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }

                    /* The ui.css <kbd> baseline, re-stated for the shadow root. */
                    kbd {
                        flex: none;
                        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                        font-size: 0.72rem;
                        background: var(--field);
                        border: 1px solid var(--border-strong);
                        border-bottom-width: 2px;
                        border-radius: var(--radius-s);
                        padding: 2px 6px;
                        color: var(--text);
                    }
                    /* A touch-only device has no keyboard to press them with. */
                    @media (hover: none) and (pointer: coarse) {
                        kbd { display: none; }
                    }

                    .empty {
                        padding: 18px 12px 22px;
                        text-align: center;
                        font-size: 0.85rem;
                        color: var(--text-dim);
                    }
                    .empty[hidden] { display: none; }

                    /* Scrollbar theme — duplicated because the global rule in
                       ui.css doesn't pierce Shadow DOM. */
                    .list::-webkit-scrollbar { width: 8px; }
                    .list::-webkit-scrollbar-track { background: transparent; }
                    .list::-webkit-scrollbar-thumb {
                        background: var(--scrollbar-thumb);
                        border-radius: 999px;
                    }
                    .list::-webkit-scrollbar-thumb:hover {
                        background: var(--scrollbar-thumb-hover);
                    }

                    /* Compact: a full-width sheet hanging from the top edge,
                       clear of the notch / status bar. Top, not centre: the
                       on-screen keyboard takes the bottom half. */
                    @media (max-width: 768px), (max-height: 480px) and (pointer: coarse) {
                        .layer { padding: 0; }
                        .panel {
                            width: 100%;
                            border-top: none;
                            border-radius: 0 0 var(--radius-l) var(--radius-l);
                            padding-top: env(safe-area-inset-top, 0px);
                        }
                        /* dvh: tracks the space an on-screen keyboard leaves
                           (vh first as the fallback). */
                        .list { max-height: 60vh; max-height: 60dvh; }
                    }
                    @media (pointer: coarse) {
                        .row { min-height: 44px; box-sizing: border-box; }
                        input { font-size: max(16px, 1rem); }
                    }

                    @keyframes cp-fade { to { opacity: 1; } }
                    @keyframes cp-in   { to { opacity: 1; transform: translateY(0); } }

                    @media (prefers-reduced-motion: reduce) {
                        .backdrop, .panel {
                            animation: none;
                            opacity: 1;
                            transform: none;
                        }
                    }
                </style>
                <div class="backdrop" part="backdrop"></div>
                <div class="layer">
                    <div class="panel" part="panel" role="dialog" aria-modal="true" aria-label="${L.title}">
                        <div class="search">
                            <sac-icon name="search"></sac-icon>
                            <input type="text" id="cp-input" placeholder="${L.placeholder}"
                                   role="combobox" aria-expanded="false" aria-controls="cp-list"
                                   aria-autocomplete="list" aria-label="${L.search}"
                                   autocomplete="off" autocapitalize="off" spellcheck="false">
                        </div>
                        <div class="list" id="cp-list" role="listbox" aria-label="${L.commands}"></div>
                        <div class="empty" hidden>${L.empty}</div>
                    </div>
                </div>
            `;

            this._input = this.shadowRoot.getElementById("cp-input");
            this._list  = this.shadowRoot.getElementById("cp-list");
            this._empty = this.shadowRoot.querySelector(".empty");

            this.shadowRoot.querySelector(".backdrop")
                .addEventListener("click", () => this.close());

            this._input.addEventListener("input", () => this._apply(this._input.value));
            this._input.addEventListener("keydown", (e) => this._onKeydown(e));

            // Rows are not focusable, but a pointerdown on a non-focusable
            // area still blurs the field in some engines — keep the caret put.
            this._list.addEventListener("mousedown", (e) => e.preventDefault());
        }

        _onKeydown(e) {
            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    this._select(this._index + 1);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    this._select(this._index - 1);
                    break;
                case "Enter":
                    e.preventDefault();
                    this._run(this._visible[this._index]);
                    break;
                case "Escape":
                    e.preventDefault();
                    e.stopPropagation();       // don't also close a host dialog
                    this.close();
                    break;
                case "Tab":
                    e.preventDefault();        // focus trap: the field is the only stop
                    break;
            }
        }
    }

    customElements.define("sac-command-palette", SacCommandPalette);
})();
