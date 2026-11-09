/**
 * <sac-command-palette>  —  Ctrl-K command palette.
 *
 * One line of markup per app (usually already in the shell template):
 *
 *   <sac-command-palette></sac-command-palette>
 *
 * From there it is self-wiring. It binds `mod+k` (Ctrl-K / ⌘K) through
 * sac.hotkeys on connect, and it does NOT keep a command list of its own —
 * it merges three live sources every time it opens, so what you see is
 * always the app's current state:
 *
 *   1. Views    — sac.router.routes(), one row per registered route with a
 *                 label; running it calls sac.router.navigate(hash) — through
 *                 sac.scope.hashFor() when scope.js is loaded, so a view
 *                 chosen inside #/scope/SLUG/… stays in that workspace (the
 *                 <sac-nav> rule). A prefix route ("#/files/*") navigates
 *                 to its prefix. External links open in a new tab, unscoped.
 *                 A route bound to the other kind of workspace (register's
 *                 scope: "root"/"scoped") is left out; a route with `open`
 *                 (a window app) runs it instead of navigating.
 *   2. Commands — everything registered on sac.commands (below), grouped by
 *                 each command's `group` (default "Commands"). An app owns
 *                 its toolbar, so toolbar actions it wants keyboard-reachable
 *                 are registered here too.
 *   3. Sources  — async result sources (sac.commands.registerSource), asked
 *                 on every keystroke for results the app cannot list ahead
 *                 of time (full-text search on a server, a database).
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
 *       list() → the registered commands, in registration order. A
 *              command registered without a `group` lists group null — the
 *              palette shows it under the kit's "Commands" heading, in the
 *              current language.
 *       registerSource({ id, group, minLength, debounce, search }) → unregister fn
 *              search(query, { signal }) → Promise<[{ id, label, icon, hint,
 *              hotkey, run }]> (or a plain array). Called with the trimmed
 *              query once it is at least `minLength` long (default 1 — never
 *              on an empty field) and `debounce` ms (default 150) after the
 *              last keystroke. `signal` aborts when the query changes again
 *              or the palette closes; a superseded answer is dropped even if
 *              the source ignores the signal, so a stale result never
 *              renders. `group` is a string or a function returning one
 *              (default "Results"). id upserts like register().
 *              The source ranks its own results — the palette keeps their
 *              order and does not filter them by label. They join the end
 *              of a static group of the same name, or a group of their own
 *              below the static ones: arriving results never move rows
 *              that are already shown, and the selected row stays selected.
 *              While a call is pending its heading shows a small spinner;
 *              a rejected call is logged and leaves one quiet "Couldn't
 *              load results" line — it never breaks the palette. `hint` is
 *              dim secondary text (a path, a snippet) after the label.
 *       unregisterSource(id)
 *       sources() → the registered sources, in registration order.
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
                    // null = the kit default, resolved at display time so
                    // the heading follows a runtime language switch.
                    group:  command.group || null,
                    hotkey: command.hotkey || null,
                    run:    typeof command.run === "function" ? command.run : null,
                });
                return function unregister() { registry.delete(id); };
            },
            unregister(id) { registry.delete(String(id)); },
            list() { return Array.from(registry.values()); },
        };
    }

    // Async result sources, installed separately so a sac.commands that
    // predates them (a second copy of the kit, an app's own stub) gains the
    // API instead of silently lacking it.
    if (window.sac && sac.commands && !sac.commands.registerSource) {
        const sources = new Map();      // id → source
        Object.assign(sac.commands, {
            registerSource(source) {
                if (!source || source.id == null || source.id === "" || typeof source.search !== "function") {
                    console.error("[sac.commands] registerSource: an `id` and a `search` function are required", source);
                    return function () {};
                }
                const id = String(source.id);
                const minLength = Number(source.minLength);
                const debounce = Number(source.debounce);
                const entry = {
                    id,
                    // A string, a function returning one (resolved on every
                    // render, so it can follow the language), or null = the
                    // kit's "Results" heading.
                    group:     source.group || null,
                    minLength: Number.isFinite(minLength) && minLength >= 0 ? minLength : 1,
                    debounce:  Number.isFinite(debounce) && debounce >= 0 ? debounce : 150,
                    search:    source.search,
                };
                sources.set(id, entry);
                return function unregisterSource() {
                    if (sources.get(id) === entry) sources.delete(id);
                };
            },
            unregisterSource(id) { sources.delete(String(id)); },
            sources() { return Array.from(sources.values()); },
        });
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

    /** "#/notes" → "#/scope/SLUG/notes" inside a scoped workspace when
     *  scope.js is loaded; anything else (no scope.js, a plain href)
     *  passes through unchanged. */
    function scopedHash(hash) {
        return (typeof hash === "string" && hash.startsWith("#") &&
                window.sac && sac.scope && typeof sac.scope.hashFor === "function")
            ? sac.scope.hashFor(hash) : hash;
    }

    /** A source's heading in the current language. */
    function sourceGroup(source) {
        let group = source.group;
        if (typeof group === "function") {
            try { group = group(); } catch (err) { group = null; }
        }
        return group ? String(group) : t("palette.group-results", "Results");
    }

    /** A source's answer → palette entries. Anything that is not a list, or
     *  an item without a label, is dropped rather than breaking the panel. */
    function normalizeResults(list, source) {
        if (!Array.isArray(list)) {
            if (list != null) console.warn(`[sac-command-palette] source "${source.id}" returned a non-array:`, list);
            return [];
        }
        const out = [];
        for (const item of list) {
            if (!item || item.label == null || item.label === "") continue;
            out.push({
                id:     item.id != null ? String(item.id) : null,
                label:  String(item.label),
                icon:   typeof item.icon === "string" ? item.icon : null,
                hint:   item.hint != null && item.hint !== "" ? String(item.hint) : null,
                hotkey: typeof item.hotkey === "string" ? item.hotkey : null,
                run:    typeof item.run === "function" ? item.run : null,
            });
        }
        return out;
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
            this._offLang  = null;
            this._matches  = [];    // static entries matching the query, grouped
            this._sourceState = new Map();  // source id → { query, status, results, timer, controller }
        }

        connectedCallback() {
            if (!this.shadowRoot.firstChild) this._render();

            if (window.sac && sac.hotkeys) {
                if (!this._unhotkey) {
                    this._unhotkey = sac.hotkeys.register("mod+k", () => this.toggle(), {
                        // A function: listings resolve it in the current language.
                        description: () => t("palette.title", "Command palette"),
                    });
                }
            } else {
                console.warn("[sac-command-palette] sac.hotkeys is not loaded — " +
                             "mod+k is unbound. Load kit/js/lib/hotkeys.js before the components.");
            }

            if (window.sac && sac.lang && !this._offLang) {
                this._offLang = sac.lang.onChange(() => this._relabel());
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
            if (this._offLang)  { this._offLang();  this._offLang  = null; }
            if (this._ownsApi && window.sac) { sac.palette = null; this._ownsApi = false; }
            this.close();
        }

        /* ---------------------------------------------------------- API */

        open() {
            if (this.hasAttribute("open")) return;
            if (!this.shadowRoot.firstChild) this._render();

            this._restoreFocus = deepActiveElement();
            this._resetSources();
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
            this._resetSources();       // nothing in flight outlives the panel
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

        /**
         * Runtime language switch: the chrome strings in place; while open,
         * the entries are re-collected (group headings are kit strings) and
         * re-filtered with the typed query — the selected row stays selected.
         */
        _relabel() {
            if (!this.shadowRoot.firstChild) return;
            const panel = this.shadowRoot.querySelector(".panel");
            panel.setAttribute("aria-label", t("palette.title", "Command palette"));
            this._input.setAttribute("placeholder", t("palette.placeholder", "Type a command…"));
            this._input.setAttribute("aria-label", t("palette.search", "Search commands"));
            this._list.setAttribute("aria-label", t("palette.commands", "Commands"));
            this._empty.textContent = t("palette.empty", "No matching commands");
            if (!this.hasAttribute("open")) return;

            const selected = this._visible[this._index];
            const scroll = this._list.scrollTop;
            const oldEntries = this._entries;
            this._entries = this._collect();
            this._apply(this._input.value);
            // Entries are rebuilt, so find the old selection by position in
            // the (unchanged) source order.
            // Async source results are not rebuilt — they are still the same
            // objects.
            const at = selected ? oldEntries.indexOf(selected) : -1;
            const again = at !== -1 ? this._entries[at] : selected;
            const row = again ? this._visible.indexOf(again) : -1;
            if (row !== -1) this._select(row);
            this._list.scrollTop = scroll;
        }

        /* ------------------------------------------------------- sources */

        /** Merge the three sources. Called on every open — never cached. */
        _collect() {
            const entries = [];

            // 1. Views — every labelled route, under its own palette group
            //    when it names one (sac.apps files app routes under "Apps");
            //    palette: false keeps a route out.
            const router = window.sac && sac.router;
            if (router && typeof router.routes === "function") {
                for (const route of router.routes()) {
                    if (!route || !route.label || route.palette === false) continue;
                    // Not in this workspace (scope: "root"/"scoped") — not here either.
                    if (router.inScope && !router.inScope(route)) continue;
                    const group = typeof route.palette === "function" ? route.palette()
                        : route.palette || t("palette.group-views", "Views");
                    const hash = route.hash;
                    // A "route" can be a real hash destination OR an external
                    // link the nav panel also lists (Download, Source). Running
                    // an absolute URL through navigate() would only mangle the
                    // hash and bounce home — open it as a link instead.
                    const isExternal = /^[a-z][a-z0-9+.-]*:/i.test(hash) && !hash.startsWith("#");
                    entries.push({
                        group: String(group),
                        label: String(route.label),
                        icon:  route.icon || null,
                        hotkey: null,
                        // In-app hashes stay inside the active scoped
                        // workspace — the rule <sac-nav> follows for its
                        // links. Resolved when run, not when collected.
                        run:   route.open
                            ? () => route.open(route)
                            : isExternal
                            ? () => window.open(hash, "_blank", "noopener")
                            : () => router.navigate(scopedHash(hash)),
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
         * A keystroke: rank and group the static entries, start the async
         * sources on the new query, render, select the first row.
         */
        _apply(query) {
            const raw = String(query || "").trim();
            const q = raw.toLowerCase();

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
            this._matches = groups;

            this._searchSources(raw);
            this._renderList(null);
        }

        /**
         * Rebuild the result rows: the static matches first, in their ranked
         * order, then the async sources' results. Source results never
         * reorder what is already there — they join the end of a static
         * group that has their name, or add a group below the static ones —
         * so rows do not jump under the pointer or the keyboard while
         * results stream in. `keep` = the entry to keep selected when it is
         * still listed (the row index follows it); otherwise the first row.
         *
         * Rows are ephemeral UI, rebuilt wholesale; the list container and
         * everything around it is created once in _render().
         */
        _renderList(keep) {
            const groups = this._matches.map((g) => ({
                name: g.name, items: g.items.map((it) => it.entry), pending: false, failed: false,
            }));
            const byName = new Map(groups.map((g) => [g.name, g]));
            let busy = false;
            const sources = (window.sac && sac.commands && typeof sac.commands.sources === "function")
                ? sac.commands.sources() : [];
            for (const source of sources) {
                const st = this._sourceState.get(source.id);
                if (!st || st.status === "idle") continue;
                const name = sourceGroup(source);
                let g = byName.get(name);
                if (!g) {
                    // A pending or failed source with nothing to show only
                    // earns a heading for its spinner / note.
                    if (st.status === "done" && st.results.length === 0) continue;
                    g = { name, items: [], pending: false, failed: false };
                    byName.set(name, g);
                    groups.push(g);
                }
                if (st.status === "pending") { g.pending = true; busy = true; }
                if (st.status === "error") g.failed = true;
                for (const r of st.results) g.items.push(r);
            }

            const list = this._list;
            list.textContent = "";
            this._rows = [];
            this._visible = [];
            let headers = 0;

            for (const g of groups) {
                if (g.items.length === 0 && !g.pending && !g.failed) continue;
                headers++;
                const header = document.createElement("div");
                header.className = "group";
                header.setAttribute("role", "presentation");
                const name = document.createElement("span");
                name.textContent = g.name;
                header.appendChild(name);
                if (g.pending) {
                    const spin = document.createElement("sac-spinner");
                    spin.setAttribute("label", t("palette.searching", "Searching…"));
                    header.appendChild(spin);
                }
                list.appendChild(header);

                for (const entry of g.items) this._appendRow(entry);

                if (g.failed && !g.pending) {
                    const note = document.createElement("div");
                    note.className = "note";
                    note.setAttribute("role", "presentation");
                    note.textContent = t("palette.source-error", "Couldn't load results");
                    list.appendChild(note);
                }
            }

            if (busy) list.setAttribute("aria-busy", "true");
            else list.removeAttribute("aria-busy");
            this._empty.hidden = headers > 0;
            this._index = 0;
            const at = keep ? this._visible.indexOf(keep) : -1;
            this._select(at === -1 ? 0 : at);
        }

        _appendRow(entry) {
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

            if (entry.hint) {
                const hint = document.createElement("span");
                hint.className = "hint";
                hint.textContent = entry.hint;
                row.appendChild(hint);
            }

            if (entry.hotkey) {
                const kbd = document.createElement("kbd");
                kbd.textContent = hotkeyLabel(entry.hotkey);
                row.appendChild(kbd);
            }

            row.addEventListener("mouseenter", () => this._select(index));
            row.addEventListener("click", () => this._run(this._visible[index]));

            this._list.appendChild(row);
            this._rows.push(row);
            this._visible.push(entry);
        }

        /* ------------------------------------------------ async sources */

        /**
         * Start every registered source on `query` (trimmed, original case).
         * A source whose state already holds this query is left alone (a
         * language switch re-applies the same text — no refetch). Anything
         * older is superseded: its debounce timer is cleared and its
         * in-flight call aborted, and a late answer is dropped by identity,
         * so a stale result can never render.
         */
        _searchSources(query) {
            const sources = (window.sac && sac.commands && typeof sac.commands.sources === "function")
                ? sac.commands.sources() : [];
            for (const source of sources) {
                let st = this._sourceState.get(source.id);
                if (st && st.source === source && st.query === query) continue;
                if (st) this._cancel(st);
                st = { source, query, status: "idle", results: [], timer: null, controller: null };
                this._sourceState.set(source.id, st);
                if (query.length < source.minLength) continue;
                st.status = "pending";
                st.timer = setTimeout(() => this._startSearch(st), source.debounce);
            }
        }

        _startSearch(st) {
            st.timer = null;
            if (this._sourceState.get(st.source.id) !== st) return;
            const controller = new AbortController();
            st.controller = controller;
            const settle = (status, results) => {
                // Superseded (a newer keystroke, close) or aborted: drop.
                if (controller.signal.aborted || this._sourceState.get(st.source.id) !== st) return;
                st.controller = null;
                st.status = status;
                st.results = results;
                this._renderList(this._visible[this._index]);
            };
            let pending;
            try {
                pending = Promise.resolve(st.source.search(st.query, { signal: controller.signal }));
            } catch (err) {
                pending = Promise.reject(err);
            }
            pending.then(
                (list) => settle("done", normalizeResults(list, st.source)),
                (err) => {
                    if (controller.signal.aborted) return;   // our own abort — silent
                    console.warn(`[sac-command-palette] source "${st.source.id}" failed:`, err);
                    settle("error", []);
                });
        }

        _cancel(st) {
            if (st.timer) { clearTimeout(st.timer); st.timer = null; }
            if (st.controller) { st.controller.abort(); st.controller = null; }
        }

        _resetSources() {
            this._sourceState.forEach((st) => this._cancel(st));
            this._sourceState.clear();
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
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        padding: 8px 10px 4px;
                        font-size: 0.66rem;
                        font-weight: 700;
                        text-transform: uppercase;
                        letter-spacing: 0.08em;
                        color: var(--text-dim);
                    }
                    /* A pending async source: a small ring beside its heading. */
                    .group sac-spinner { --spinner-size: 10px; }

                    /* A failed async source: one quiet line, never a banner. */
                    .note {
                        padding: 2px 10px 8px 36px;
                        font-size: 0.78rem;
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
                    /* Press: answers the moment it goes down. The row under a
                       mouse is the selected one (mouseenter selects), so its
                       tint deepens and it stays the accent row; a row pressed
                       before it is selected (a finger) gets the wash. */
                    .row:active:not([aria-selected="true"]) { background: var(--hover-strong); }
                    .row[aria-selected="true"]:active {
                        background: color-mix(in srgb, var(--accent) 26%, transparent);
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
                    /* Secondary text of an async result (a path, a snippet):
                       dim, and the first thing to give way to the label. */
                    .hint {
                        flex: 0 1 auto;
                        max-width: 45%;
                        min-width: 0;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                        font-size: 0.78rem;
                        color: var(--text-dim);
                    }

                    /* The ui.css <kbd> baseline, re-stated for the shadow root. */
                    kbd {
                        flex: none;
                        font-family: var(--font-mono);
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
                    .list::-webkit-scrollbar { width: calc(8px + 2 * var(--scrollbar-gap)); }
                    .list::-webkit-scrollbar-track { background: transparent; }
                    .list::-webkit-scrollbar-thumb {
                        background: var(--scrollbar-thumb);
                        background-clip: content-box;
                        border: var(--scrollbar-gap) solid transparent;
                        border-radius: 999px;
                    }
                    .list::-webkit-scrollbar-thumb:hover {
                        background: var(--scrollbar-thumb-hover);
                        background-clip: content-box;
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

                    /* Reduced transparency / more contrast: the panel turns
                       solid (the glass hue, nothing shining through) and drops
                       the blur. The backdrop is a scrim — it keeps its dim and
                       only loses the blur. */
                    @media (prefers-reduced-transparency: reduce) {
                        .backdrop { backdrop-filter: none; -webkit-backdrop-filter: none; }
                        .panel { background: var(--glass-solid); backdrop-filter: none; -webkit-backdrop-filter: none; }
                    }
                    @media (prefers-contrast: more) {
                        .backdrop { backdrop-filter: none; -webkit-backdrop-filter: none; }
                        .panel { background: var(--glass-solid); backdrop-filter: none; -webkit-backdrop-filter: none; border-color: var(--border-contrast); }
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
