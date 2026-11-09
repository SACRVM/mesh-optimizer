/**
 * <sac-launcher>  —  User-composed launcher tile grid.
 *
 * Renders one tile per app registered in `sac.apps` (kit/js/lib/apps.js),
 * merged with a per-user layer persisted in localStorage: tile order, hidden
 * apps, and user-added ("custom") apps. The host page registers the built-in
 * apps; the user rearranges, hides and extends them — the launcher is theirs.
 *
 * LIGHT-DOM EXCEPTION: this component intentionally renders into the light
 * DOM, not a shadow root. It is a layout-level pattern host, not a leaf
 * widget: it composes the global `.grid` / `.tile` launcher CSS patterns from
 * ui.css and hosts other sac-* elements inside its tiles. Its few own rules
 * are injected once into document.head, scoped under the `sac-launcher` tag
 * and `.sac-launcher-*` classes.
 *
 * Usage:
 *   <sac-launcher storage="demo-hub"></sac-launcher>
 *
 *   sac.apps.register({ id: "notes", name: "Notes", icon: "note",
 *                       kind: "window", tag: "app-notes", src: "apps/notes.js" });
 *   document.querySelector("sac-launcher").refresh();   // if registered late
 *
 * Attributes:
 *   storage — suffix of the localStorage key `sac.launcher.<storage>` holding
 *             { v: 1, order: [ids], hidden: [ids], custom: [manifests] }.
 *             Without it (and without persist="none"): pure render of
 *             the registry — no persistence, no edit mode. Persisted ids
 *             that no longer exist
 *             are ignored and only dropped from storage the next time the
 *             user changes something. `custom` manifests are (re)registered
 *             into sac.apps on connect — they are the user-added apps.
 *   persist — "local" (default): the `storage` key above. "none": the HOST
 *             owns persistence — localStorage is never read or written; the
 *             host feeds `launcher.layout` and saves what `sac:layout`
 *             reports. Edit mode, drag, hide and menus all keep working
 *             (with or without `storage`).
 *   readonly — presence = view only: the arrangement renders (hidden tiles
 *             stay hidden, sizes and colors apply) but there is no Edit
 *             button, no drag and no move/hide/remove controls. Tile menus
 *             and launching still work.
 *   edit    — presence = edit mode. Toggled by the Edit button; settable by
 *             hand. Ignored (removed) unless editable: `storage` or
 *             persist="none", and not `readonly`.
 *   no-add  — presence = no "Add app" tile and no Add dialog: for a host
 *             that installs apps through its own flow (an isolated install,
 *             an owner-only policy). See also sac:request-add.
 *   drag    — drag reorder: absent = in edit mode only (the default),
 *             "always" = also outside edit mode, "none" = buttons only.
 *             Needs an editable launcher (see `edit`) and sac.sortable
 *             (kit/js/lib/sortable.js); without the helper the move buttons
 *             are the only path.
 *
 * Property:
 *   layout — the user layer as one plain object, in and out:
 *             { order: [keys], hidden: [keys],
 *               sizes: { key: "small" | "medium" | "wide" | "large" },
 *               colors: { key: palette slot }, custom: [manifests] }.
 *             `sizes` overrides a tile's footprint, `colors` its accent with
 *             a data-palette slot name ("blue", "teal", … — ui.css
 *             --palette-<slot>), stored as the NAME so a re-theme never
 *             rewrites saved layouts. Unknown sizes/slots are ignored.
 *             Setting it replaces the whole layer (a missing field = empty),
 *             re-syncs the grid in the same task (no flash), swaps the
 *             custom apps in sac.apps, never writes localStorage and never
 *             fires sac:layout. May be set before the element connects —
 *             it then wins over the stored layout. Keys not (yet)
 *             registered are kept until the next user change. The getter
 *             returns a copy.
 *
 * Methods:
 *   refresh() — re-read sac.apps.list() and re-sync the grid in place. The
 *               component re-syncs itself on every "sac:apps-changed" the
 *               runtime emits (and on DOMContentLoaded), so registering apps
 *               after it connected just works; refresh() remains for hosts
 *               that mutate state outside sac.apps.
 *   setLinks(list) — plain link tiles beside the sac.apps entries, for
 *               anything that already has an address (a sac.router route,
 *               another page): [{ id, name, icon, description, href, tile,
 *               accent, menu }]. No sac.apps registration involved. A
 *               link tile is a real <a href> — a "#/notes" href is an in-SPA
 *               navigation, never a reload. Its key is its `id`, sharing the
 *               key space (and so the persisted order/hidden layout) with the
 *               app tiles; an id that collides with an app tile is skipped
 *               with a warning. Link tiles can be moved and hidden, never
 *               removed (the host owns them). Unordered link tiles come
 *               before unordered app tiles. Replaces the previous list;
 *               `launcher.links` reads it back (assignable too).
 *   setMenu(key, items) — the tile's corner menu, overriding the entry's own
 *               `menu` (null = no menu, undefined = back to the entry's).
 *
 * Tile keys: an app id, "appId::tileId" for a multi-tile app's tile (see
 * Tiles), or a link tile's id — the same keys `sac:layout` reports.
 *
 * Per-tile menu: `menu` on a manifest, a manifest `tiles` entry, a link, or
 * via setMenu() — [{ id, label, labelKey, icon, checked, type, danger, disabled, onClick }]
 * with "-" for a separator. It is the tile's CONTEXT menu (sac.contextMenu):
 * right-click, a long-press on touch, Shift+F10 / the Menu key on a
 * focused tile — no corner button. Its last entry, while the layout can be
 * edited, is "Arrange": the edit mode below. No menu in edit mode.
 * `labelKey` translates the item (t(labelKey, label)). onClick(info) gets
 * { key, appId, action, launcher }; `appId` is null for a link tile.
 *
 * Events:
 *   sac:layout — detail { order, hidden, customCount, layout } after
 *                         every user change (move / drag / hide / show /
 *                         add / remove). `layout` is the full object the
 *                         `layout` property takes — save it as is;
 *                         `order` is the effective order (every tile).
 *                         Bubbles + composed.
 *   sac:tile-action — detail { key, appId, action } when a tile-menu item
 *                         is chosen (action = the item's id, else its
 *                         index). Bubbles + composed; fires after onClick.
 *   sac:request-add — the "Add app" tile was pressed. Cancelable:
 *                         preventDefault() skips the built-in Add dialog so
 *                         the host runs its own install flow. Bubbles +
 *                         composed.
 *
 * Tiles:
 *   kind:"page" apps render as real <a> links; window and view apps render
 *   as real <button> tiles calling sac.apps.open(). Every tile looks the
 *   same — what a click does is not encoded in the border. A manifest with
 *   a `tiles` array deploys SEVERAL tiles for one app (each entry may
 *   override name/icon/description/tile and carry `route` — a view
 *   sub-address — `params` for a window, and `accent`). A tile's `accent`
 *   colors the tile (icon, hover ring) AND seeds the app's --accent when
 *   opened through it — tile color = app highlight. The optional manifest
 *   field `tile` sets the footprint: "medium" (default) | "wide" spans 2
 *   grid columns | "large" spans 2 columns AND 2 rows | "small" is a
 *   ninth of a medium: nine in a row fill one medium cell as a 3×3 block
 *   (row by row, left to right; any other footprint between them starts a
 *   new block). A small tile shows its icon only —
 *   the name is its tooltip and accessible name. Unknown values fall
 *   back to medium silently. Tiles are square like the .grid pattern's
 *   (a wide one as tall as one column is wide, a large one 2×2). Small
 *   tiles stay small everywhere — a phone gains the most from the
 *   density: in a one-column grid a block is a wrapping row of ~72px
 *   squares. Wide and
 *   large collapse to medium on narrow viewports (≤768px), matching
 *   the .grid pattern — and whenever the grid itself is too narrow for two
 *   columns (a launcher inside a sac-window or split panel on a wide
 *   screen), via a container query on the grid. In edit mode each tile grows keyboard-reachable
 *   controls: move left / move right / hide (or show, on grayed hidden
 *   tiles) and — for custom apps only — remove; they take the tile's top-right
 *   corner while editing. Each control's label ("Move Notes left") is its
 *   aria-label AND its title (tooltip). Built-in (host-registered)
 *   apps can only be hidden, never removed.
 *   Remove acts at once — no confirmation — and offers Undo instead: a
 *   sac.toast "“Notes” removed" with an Undo action that puts the app back
 *   (re-registered in sac.apps, as the Add flow does) at its order
 *   position with its size, colour and hidden state. An app removed while
 *   open loses its window; Undo brings the tile back, not the window.
 *   A dashed "Add app" tile opens a <sac-dialog> form in plain language:
 *   name, icon (optional), element name, address, window width / height
 *   (optional) — plus a trust note under the address ("This runs code from
 *   that address inside this app, with your data. Only add apps you
 *   trust."). The form stays lean by design — user-added
 *   apps are always medium tiles.
 *
 * Opening: a window or view tile carries aria-busy="true" while its app
 *   loads, and a small sac-spinner shows in its corner once the wait passes
 *   200ms (no flash on a quick open; under reduced motion the ring stands
 *   still). Cleared on success and on failure — a failed load is the
 *   runtime's error toast, with Try again (sac.apps).
 *
 * Drag reorder (sac.sortable, axis "grid"): mouse/pen lift after 4px, touch
 * after a 250ms long-press (a swipe keeps scrolling the page), Escape puts
 * the tile back. A dashed outline marks the slot the tile will land in. A
 * drop persists exactly like the move buttons (the effective order is
 * stored and sac:layout fires); the buttons stay the keyboard path.
 *
 * Small tiles need a finer grid than CSS auto-placement can pack into
 * 3×3 blocks, so while at least one is shown the launcher places every
 * cell itself on a third-size grid (grid-row/grid-column inline, re-run on
 * resize and every DOM move — drag included). With no small tile the grid
 * is the plain .grid pattern, untouched.
 *
 * Compact/touch: the grid goes single-column below 581px of its own width
 * (the .grid pattern's 280px minimum), wide/large tiles included — a span-2
 * cell in a one-column grid would otherwise add a phantom column and scroll
 * the page sideways. Under (pointer: coarse) the edit controls grow from 28px
 * to a 36px look with a 44px hit halo (gap 8px, so neighbouring halos just
 * touch and never overlap); the tile-menu button does the same. Under
 * (hover: none) the Add tile's hover tint is
 * off (a tap would leave it stuck). The launcher never positions the windows
 * it opens — sac.apps creates them and sac-window maximizes itself on
 * compact.
 *
 * Portability note: the "Add app" address may be a full cross-origin URL —
 * sac.apps injects it as a classic <script> tag, and classic script tags need
 * no CORS. Any origin serving a guarded single-tag web component (the app
 * contract) can be pulled into a user's launcher — which is exactly why the
 * form says so in its trust note: the script runs same-realm, with the
 * page's data. A host that wants a safer path takes over the Add tile
 * (sac:request-add) and installs isolated (sac.apps, `isolated`).
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacLauncher extends HTMLElement {
    static get observedAttributes() { return ["storage", "persist", "readonly", "edit", "drag", "no-add"]; }

    constructor() {
        super();
        this._state = SacLauncher._emptyLayout(); // the user layer (`layout`)
        this._order = [];        // effective full order (known ids only)
        this._tiles = new Map(); // id → cell element
        this._links = [];        // setLinks() — plain link tiles
        this._menus = new Map();  // key → menu override (setMenu)
        this._sortable = null;
        this._grid = null;
        this._dialog = null;
        this._form = null;
        this._formEl = null;
        this._warned = false;
        this._uid = `sac-launcher-${SacLauncher._instances++}`;
        this._onReady = this._onReady.bind(this);
        this._onDialogKeydown = this._onDialogKeydown.bind(this);
    }

    connectedCallback() {
        // A `layout` assigned before the element upgraded sits on the
        // instance and shadows the accessor — replay it through the setter.
        if (Object.prototype.hasOwnProperty.call(this, "layout")) {
            const pending = this.layout;
            delete this.layout;
            this.layout = pending;
        }
        if (!this._grid) this._build();
        // Host pages typically register their apps in a DOMContentLoaded
        // handler — i.e. AFTER this component (a deferred script) upgraded.
        // The runtime emits "sac:apps-changed" on every register/remove;
        // re-syncing on it makes registration order irrelevant. The
        // DOMContentLoaded re-sync stays as belt and braces.
        document.addEventListener("sac:apps-changed", this._onReady);
        if (document.readyState !== "complete") {
            document.addEventListener("DOMContentLoaded", this._onReady);
        }
        // A host-assigned layout wins over the stored one.
        if (!this._hostLayout) this._loadState();
        this._sync();
        this._syncEditUI();
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
        if (!this._sortable && window.sac && typeof sac.sortable === "function") {
            this._sortable = sac.sortable(this._grid, {
                axis: "grid",
                items: SacLauncher.DRAG_ITEMS,
                ignore: "input, textarea, select, [contenteditable], [data-sortable-ignore], " +
                        ".sac-launcher-controls, sac-menu",
                disabled: () => !this._dragAllowed(),
                // A finger drags only while arranging (edit) — then at once.
                touch: () => (this.hasAttribute("edit") ? "move" : "off"),
                onReorder: () => this._onDrop(),
            });
        }
        if (!this._ctx && window.sac && typeof sac.contextMenu === "function") {
            this._ctx = sac.contextMenu(this._grid, {
                targets: ".sac-launcher-cell",
                items: (cell) => this._contextItems(cell),
                onSelect: (item, cell) => {
                    if (item.id === "__arrange") this.setAttribute("edit", "");
                    else this._onMenuSelect(cell, item._index);
                },
                disabled: () => this.hasAttribute("edit"),
            });
        }
        if (!this._dragObserver) {
            // The live slot of a lifted tile gets the drop outline.
            this._dragObserver = new MutationObserver(() => this._trackDrag());
            this._dragObserver.observe(this._grid, {
                subtree: true, attributes: true, attributeFilter: ["data-sortable-dragging"] });
        }
        if (!this._layoutObserver) {
            // Small-tile placement follows every DOM move (a drag moves cells
            // live) and every width change.
            const relayout = () => this._layout();
            this._layoutObserver = new MutationObserver(relayout);
            this._layoutObserver.observe(this._grid, { childList: true });
            this._resizeObserver = new ResizeObserver(relayout);
            this._resizeObserver.observe(this._grid);
            const mq = window.matchMedia(SacLauncher.COMPACT);
            mq.addEventListener("change", relayout);
            this._offRelayout = () => mq.removeEventListener("change", relayout);
        }
        this._layout();
    }

    disconnectedCallback() {
        if (this._sortable) { this._sortable.destroy(); this._sortable = null; }
        if (this._ctx) { this._ctx.destroy(); this._ctx = null; }
        if (this._dragObserver) { this._dragObserver.disconnect(); this._dragObserver = null; }
        if (this._layoutObserver) {
            this._layoutObserver.disconnect(); this._layoutObserver = null;
            this._resizeObserver.disconnect(); this._resizeObserver = null;
            this._offRelayout(); this._offRelayout = null;
        }
        this._stopTrack();
        if (this._offLang) { this._offLang(); this._offLang = null; }
        document.removeEventListener("sac:apps-changed", this._onReady);
        document.removeEventListener("DOMContentLoaded", this._onReady);
        document.removeEventListener("keydown", this._onDialogKeydown, true);
        if (this._dialog) { this._dialog.remove(); this._dialog = null; }
    }

    attributeChangedCallback(name, oldV, newV) {
        if (!this._grid || oldV === newV) return;
        if (name === "storage" || name === "persist") {
            this._loadState();
            this._sync();
            this._syncEditUI();
        } else if (name === "edit" || name === "drag" || name === "readonly") {
            this._syncEditUI();
        } else if (name === "no-add") {
            if (newV !== null && this._dialog && this._dialog.hasAttribute("open")) this._dialog.close();
            this._sync();
        }
    }

    /**
     * Language switch: every kit string in place — the add tile, the empty
     * note, the Edit/Done button, each tile's control labels and an open (or
     * built) Add dialog. Order, edit mode, focus and typed form values stay.
     */
    _relabel() {
        if (!this._grid) return;
        this._addLabel.textContent = t("launcher.add-app", "Add app");
        this._empty.textContent = t("launcher.no-apps", "No apps registered.");
        this._editBtn.textContent = this.hasAttribute("edit")
            ? t("launcher.done", "Done") : t("launcher.edit", "Edit");
        this._tiles.forEach((cell) => this._labelCell(cell));
        if (this._dialog) this._labelForm();
    }

    /** Re-read the registry and re-sync the grid (targeted updates only). */
    refresh() { this._sync(); }

    /** Plain link tiles beside the sac.apps entries (see header). */
    setLinks(list) {
        const out = [];
        const seen = new Set();
        (Array.isArray(list) ? list : []).forEach((l) => {
            if (!l || typeof l !== "object" || typeof l.id !== "string" || !l.id || seen.has(l.id)) {
                console.warn("[sac-launcher] setLinks(): skipping a link without a unique string id", l);
                return;
            }
            seen.add(l.id);
            out.push(Object.assign({}, l));
        });
        this._links = out;
        if (this._grid) this._sync();
    }

    get links() { return this._links.map(l => Object.assign({}, l)); }
    set links(list) { this.setLinks(list); }

    /** The user layer as one object (see header). */
    get layout() { return SacLauncher._copyLayout(this._state); }
    set layout(value) {
        const next = SacLauncher._normLayout(value);
        this._hostLayout = true;
        // Custom apps follow the layer: the previous layer's leave sac.apps,
        // the new layer's (re)register — a workspace switch never leaks them.
        if (window.sac && sac.apps) {
            const keep = new Set(next.custom.map(m => m.id));
            this._state.custom.forEach((m) => { if (!keep.has(m.id)) sac.apps.remove(m.id); });
            next.custom.forEach(m => sac.apps.register(Object.assign({}, m)));
        }
        this._state = next;
        if (this._grid) { this._sync(); this._syncEditUI(); }
    }

    /** Replace one tile's corner menu (see header). */
    setMenu(key, items) {
        if (items === undefined) this._menus.delete(key);
        else this._menus.set(key, items);
        const cell = this._tiles.get(key);
        if (cell) this._paintMenu(cell);
    }

    _onReady() { this.refresh(); }

    /* ------------------------------------------------------------------ */
    /* Build (once)                                                        */
    /* ------------------------------------------------------------------ */

    _build() {
        SacLauncher._injectStyles();
        this.textContent = "";

        this._grid = document.createElement("div");
        this._grid.className = "grid";

        // The dashed "Add app" tile — always last in the grid, edit mode only.
        this._addCell = document.createElement("div");
        this._addCell.className = "sac-launcher-cell sac-launcher-add-cell";
        this._addBtn = document.createElement("button");
        this._addBtn.type = "button";
        this._addBtn.className = "tile sac-launcher-add";
        const addIcon = document.createElement("sac-icon");
        addIcon.setAttribute("name", "plus");
        const addLabel = document.createElement("span");
        addLabel.textContent = t("launcher.add-app", "Add app");
        this._addLabel = addLabel;
        this._addBtn.append(addIcon, addLabel);
        this._addBtn.addEventListener("click", () => {
            // Cancelable: a host with its own install flow (an isolated
            // install, a policy check) takes over behind the same tile.
            const ask = new CustomEvent("sac:request-add", { bubbles: true, composed: true, cancelable: true });
            if (this.dispatchEvent(ask)) this._openAddDialog();
        });
        this._addCell.appendChild(this._addBtn);
        this._grid.appendChild(this._addCell);

        // Drop indicator: out of the grid flow (absolute), last child — the
        // in-place reorder in _sync() never walks past the Add cell.
        this._dropMark = document.createElement("div");
        this._dropMark.className = "sac-launcher-drop";
        this._dropMark.setAttribute("aria-hidden", "true");
        this._dropMark.hidden = true;
        this._grid.appendChild(this._dropMark);

        this._empty = document.createElement("p");
        this._empty.className = "sac-launcher-empty";
        this._empty.textContent = t("launcher.no-apps", "No apps registered.");
        this._empty.hidden = true;

        this._footer = document.createElement("div");
        this._footer.className = "sac-launcher-footer";
        this._editBtn = document.createElement("button");
        this._editBtn.type = "button";
        this._editBtn.className = "btn sac-launcher-edit";
        this._editBtn.textContent = t("launcher.edit", "Edit");
        this._editBtn.setAttribute("aria-pressed", "false");
        this._editBtn.addEventListener("click", () => this.toggleAttribute("edit"));
        this._footer.appendChild(this._editBtn);

        this.append(this._grid, this._empty, this._footer);
    }

    /* ------------------------------------------------------------------ */
    /* Persistence                                                         */
    /* ------------------------------------------------------------------ */

    _storageKey() {
        const s = this.getAttribute("storage");
        return s ? `sac.launcher.${s}` : null;
    }

    /** persist="none": the host owns the layout — no localStorage at all. */
    _hostOwned() { return this.getAttribute("persist") === "none"; }

    /** Edit mode, drag and the Edit button: someone must own the layout
     *  (a storage key or the host), and the viewer may change it. */
    _canEdit() {
        if (this.hasAttribute("readonly")) return false;
        return this._hostOwned() || this._storageKey() !== null;
    }

    _loadState() {
        if (this._hostOwned()) return; // the host's layer stays as it is
        this._state = SacLauncher._emptyLayout();
        const key = this._storageKey();
        if (!key) return;
        try {
            const raw = localStorage.getItem(key);
            if (raw) {
                const data = JSON.parse(raw);
                if (data && data.v === 1) {
                    if (Array.isArray(data.order))
                        this._state.order = data.order.filter(x => typeof x === "string");
                    if (Array.isArray(data.hidden))
                        this._state.hidden = data.hidden.filter(x => typeof x === "string");
                    if (Array.isArray(data.custom))
                        this._state.custom = data.custom.filter(m =>
                            m && typeof m === "object" && typeof m.id === "string");
                    const norm = SacLauncher._normLayout(data);
                    this._state.sizes = norm.sizes;
                    this._state.colors = norm.colors;
                }
            }
        } catch (err) {
            console.warn(`[sac-launcher] could not read ${key}:`, err);
        }
        // Custom manifests are the user's own apps — put them (back) into the
        // registry so sac.apps can open and deep-link them.
        if (window.sac && sac.apps) {
            this._state.custom.forEach(m => sac.apps.register(Object.assign({}, m)));
        }
    }

    /**
     * Stale keys (apps/tiles no longer registered) drop out here — on a user
     * change, never proactively on load. Filter against the ENTRY keys, not
     * app ids: a multi-tile app stores composite "appId::tileId" keys, and
     * matching those against ids alone discards every multi-tile
     * customization on save.
     */
    _prune() {
        const known = new Set(this._allEntries().map(e => e.key));
        const st = this._state;
        st.order = this._order.filter(id => known.has(id));
        st.hidden = st.hidden.filter(id => known.has(id));
        const keepKnown = (map) => {
            const out = {};
            Object.keys(map).forEach((k) => { if (known.has(k)) out[k] = map[k]; });
            return out;
        };
        st.sizes = keepKnown(st.sizes);
        st.colors = keepKnown(st.colors);
    }

    _persist() {
        if (this._hostOwned()) return;
        const key = this._storageKey();
        if (!key) return;
        const st = this._state;
        const data = { v: 1, order: st.order, hidden: st.hidden, custom: st.custom };
        // Only when used — a layout without them stays byte-identical to 2.17.
        if (Object.keys(st.sizes).length) data.sizes = st.sizes;
        if (Object.keys(st.colors).length) data.colors = st.colors;
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (err) {
            console.warn(`[sac-launcher] could not write ${key}:`, err);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Registry → grid sync (in place)                                     */
    /* ------------------------------------------------------------------ */

    _apps() {
        if (!window.sac || !sac.apps) {
            // A links-only launcher is legitimate without the app runtime.
            if (!this._warned && !this._links.length) {
                this._warned = true;
                console.warn("[sac-launcher] sac.apps is not loaded — load kit/js/lib/apps.js before the components.");
            }
            return [];
        }
        return sac.apps.list();
    }

    /**
     * A manifest expands into its launcher tiles: the `tiles` array when
     * present (complex apps deploy several entry points), the manifest
     * itself as the single default tile otherwise. Keys stay backward
     * compatible: a default tile's key IS the app id, so persisted layouts
     * survive the upgrade.
     */
    _entries(apps) {
        const out = [];
        apps.forEach((m) => {
            const kind = m.kind === "page" ? "page" : "window";
            const list = Array.isArray(m.tiles) && m.tiles.length ? m.tiles : null;
            if (!list) {
                out.push({ key: m.id, appId: m.id, kind,
                    name: m.name, icon: m.icon, description: m.description,
                    tile: m.tile, accent: m.accent,
                    route: undefined, params: undefined, href: m.href,
                    menu: m.menu });
                return;
            }
            list.forEach((tl, i) => {
                out.push({
                    key: `${m.id}::${tl.id != null ? tl.id : (tl.route != null ? tl.route : i)}`,
                    appId: m.id, kind,
                    name: tl.name || m.name,
                    icon: tl.icon || m.icon,
                    description: tl.description != null ? tl.description : m.description,
                    tile: tl.tile || m.tile,
                    accent: tl.accent || m.accent,
                    route: tl.route, params: tl.params,
                    href: tl.href || m.href,
                    menu: tl.menu !== undefined ? tl.menu : m.menu,
                });
            });
        });
        // Link tiles (setLinks) — before the app tiles, so unordered ones
        // come first; an app tile wins a key collision.
        const taken = new Set(out.map(e => e.key));
        const links = [];
        this._links.forEach((l) => {
            if (taken.has(l.id)) {
                if (!this._collided) this._collided = new Set();
                if (!this._collided.has(l.id)) {
                    this._collided.add(l.id);
                    console.warn(`[sac-launcher] link "${l.id}" collides with an app tile key — skipped.`);
                }
                return;
            }
            links.push({ key: l.id, appId: null, link: true, kind: "page",
                name: l.name, icon: l.icon, description: l.description,
                tile: l.tile, accent: l.accent,
                route: undefined, params: undefined, href: l.href,
                menu: l.menu });
        });
        return links.concat(out);
    }

    /** Every tile entry: link tiles + the registry's app tiles. */
    _allEntries() { return this._entries(this._apps()); }

    _sync() {
        // A tile in flight owns the DOM order until it lands; catch up then.
        if (this._dragging) { this._syncPending = true; return; }
        const entries = this._allEntries();
        const byKey = new Map(entries.map(e => [e.key, e]));

        // Effective order: persisted order (known keys only, stale keys
        // ignored), then any registry tiles not yet ordered, appended in
        // registration order.
        const ordered = this._state.order.filter(key => byKey.has(key));
        const seen = new Set(ordered);
        entries.forEach(e => { if (!seen.has(e.key)) ordered.push(e.key); });
        this._order = ordered;

        // Drop tiles whose entry disappeared (or whose kind changed).
        for (const [key, cell] of Array.from(this._tiles)) {
            const e = byKey.get(key);
            if (!e || cell._kind !== e.kind) {
                cell.remove();
                this._tiles.delete(key);
            }
        }

        // Create missing tiles, update all in place.
        const customIds = new Set(this._state.custom.map(m => m.id));
        const hidden = new Set(this._state.hidden);
        this._order.forEach((key, i) => {
            const e = byKey.get(key);
            let cell = this._tiles.get(key);
            if (!cell) {
                cell = this._makeCell(e);
                this._tiles.set(key, cell);
            }
            this._updateCell(cell, e, {
                hidden: hidden.has(key),
                custom: customIds.has(e.appId),
                first: i === 0,
                last: i === this._order.length - 1,
            });
        });

        // Minimal reorder: only nodes actually out of place are moved, so an
        // untouched tile (and any focus inside it) is never disturbed.
        const desired = this._order.map(id => this._tiles.get(id));
        const noAdd = this.hasAttribute("no-add");
        if (noAdd) this._addCell.remove();
        else desired.push(this._addCell);
        let cursor = this._grid.firstElementChild;
        for (const cell of desired) {
            if (cell === cursor) cursor = cursor.nextElementSibling;
            else this._grid.insertBefore(cell, cursor);
        }

        // In edit mode the Add tile is visible, so the empty hint would lie —
        // unless there is no Add tile.
        this._empty.hidden = this._order.length > 0 || (this.hasAttribute("edit") && !noAdd);
        this._layout();
    }

    /**
     * Places the cells on a third-size grid while a small tile is shown (see
     * the header). Mirrors CSS sparse auto-placement in medium units — a
     * cursor that only moves forward, each item at the first free spot that
     * fits — except that consecutive small tiles share one medium cell, nine
     * to a block (3×3). One-column grid: a medium cell is a row; a block is
     * as many ~72px squares across as fit, wrapping onto further rows.
     */
    _layout() {
        const grid = this._grid;
        if (!grid) return;
        const cells = Array.from(grid.children).filter(c =>
            c.classList.contains("sac-launcher-cell") && getComputedStyle(c).display !== "none");
        if (!cells.some(c => c.classList.contains("size-small"))) {
            if (this._fine) {
                this._fine = false;
                grid.classList.remove("sac-launcher-fine", "sac-launcher-list");
                grid.style.removeProperty("grid-template-columns");
                grid.style.removeProperty("grid-auto-rows");
                Array.from(grid.children).forEach(c => { c.style.gridColumn = ""; c.style.gridRow = ""; });
            }
            return;
        }
        const cs = getComputedStyle(grid);
        const gap = parseFloat(cs.columnGap) || 0;
        const width = grid.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
        if (width <= 0) return;
        this._fine = true;
        // The .grid pattern's auto-fill: n columns from n × 280px + (n − 1) × gap.
        const n = Math.max(1, Math.floor((width + gap) / (280 + gap)));
        const list = n === 1;
        const collapse = list || window.matchMedia(SacLauncher.COMPACT).matches;
        // One column: as many ~72px squares across as fit (at least three).
        const sub = list ? Math.max(3, Math.floor((width + gap) / (72 + gap))) : 3 * n;
        grid.classList.add("sac-launcher-fine");
        grid.classList.toggle("sac-launcher-list", list);
        grid.style.setProperty("grid-template-columns", `repeat(${sub}, minmax(0, 1fr))`);
        if (list) grid.style.removeProperty("grid-auto-rows");
        else grid.style.setProperty("grid-auto-rows", `${(width - (sub - 1) * gap) / sub}px`);

        const used = new Set();
        const free = (r, c, w, h) => {
            for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) {
                if (used.has(y + "," + x)) return false;
            }
            return true;
        };
        // Blocks: runs of consecutive small cells, nine (3×3) to a block —
        // known up front, since a one-column block takes ceil(k / sub) rows.
        const BLOCK = 9;
        const blockOf = new Map();
        let run = [];
        const flush = () => { run.forEach((c) => blockOf.set(c, run.length)); run = []; };
        for (const cell of cells) {
            if (!cell.classList.contains("size-small")) { flush(); continue; }
            run.push(cell);
            if (run.length === BLOCK) flush();
        }
        flush();
        let cr = 0, cc = 0, pack = null;
        const place = (w, h) => {
            let r = cr, c = cc;
            for (;;) {
                if (c + w > n) { r++; c = 0; continue; }
                if (free(r, c, w, h)) break;
                c++;
            }
            for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) used.add(y + "," + x);
            cr = r; cc = c + w;
            return [r, c];
        };
        for (const cell of cells) {
            const st = cell.style;
            if (cell.classList.contains("size-small")) {
                if (!pack || pack.k === BLOCK) {
                    const rows = list ? Math.ceil(blockOf.get(cell) / sub) : 1;
                    const [r, c] = place(1, rows);
                    pack = { r, c, k: 0 };
                }
                const k = pack.k++;
                if (list) {
                    st.gridColumn = `${(k % sub) + 1}`;
                    st.gridRow = `${pack.r + Math.floor(k / sub) + 1}`;
                } else {
                    st.gridColumn = `${3 * pack.c + (k % 3) + 1}`;
                    st.gridRow = `${3 * pack.r + Math.floor(k / 3) + 1}`;
                }
                continue;
            }
            pack = null;
            const large = !collapse && cell.classList.contains("size-large");
            const w = large || (!collapse && cell.classList.contains("size-wide")) ? 2 : 1;
            const h = large ? 2 : 1;
            const [r, c] = place(w, h);
            if (list) {
                st.gridColumn = "1 / -1";
                st.gridRow = `${r + 1}`;
            } else {
                st.gridColumn = `${3 * c + 1} / span ${3 * w}`;
                st.gridRow = `${3 * r + 1} / span ${3 * h}`;
            }
        }
    }

    _makeCell(entry) {
        const kind = entry.kind;

        // Cell wrapper: the tile is a real link/button and the edit controls
        // are real buttons NEXT to it (absolutely positioned on top) — never
        // interactive elements nested inside an interactive element.
        const cell = document.createElement("div");
        cell.className = "sac-launcher-cell";
        cell.dataset.id = entry.key;
        cell._kind = kind;
        cell._entry = entry;

        let tile;
        if (kind === "page") {
            tile = document.createElement("a");
        } else {
            tile = document.createElement("button");
            tile.type = "button";
        }
        tile.className = "tile sac-launcher-tile";
        tile.addEventListener("click", (e) => {
            if (this.hasAttribute("edit")) { e.preventDefault(); return; }
            if (kind !== "page") {
                e.preventDefault();
                // The tile carries what makes it distinct: its route into a
                // view app, its params for a window app, its accent for both.
                // The runtime reports load failures itself (console + toast).
                const t2 = cell._entry;
                // A palette-slot color rides in resolved: the app (or an
                // isolated frame) gets a plain color, not a var() reference.
                const accent = cell._slot
                    ? (getComputedStyle(cell._tile).getPropertyValue("--accent").trim() || t2.accent)
                    : t2.accent;
                if (window.sac && sac.apps) {
                    // Busy while the app loads (its script may take a moment
                    // to arrive): aria-busy, and a small spinner that shows
                    // only once the wait is noticeable (CSS delay). Cleared
                    // either way — a failure is the runtime's toast to tell.
                    this._setBusy(cell, true);
                    sac.apps.open(t2.appId, t2.params, { route: t2.route, accent })
                        .catch(() => {})
                        .finally(() => this._setBusy(cell, false));
                }
            }
        });

        cell._icon = document.createElement("sac-icon");
        const body = document.createElement("div");
        body.className = "sac-launcher-tile-body";
        cell._h = document.createElement("h2");
        cell._p = document.createElement("p");
        body.append(cell._h, cell._p);
        tile.append(cell._icon, body);
        cell._tile = tile;
        cell.appendChild(tile);

        const controls = document.createElement("span");
        controls.className = "sac-launcher-controls";
        const mk = (cls, iconName, handler) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = `sac-launcher-ctrl ${cls}`;
            const ic = document.createElement("sac-icon");
            ic.setAttribute("name", iconName);
            b.appendChild(ic);
            b.addEventListener("click", handler);
            controls.appendChild(b);
            return b;
        };
        cell._left = mk("left", "chevron-left", () => {
            this._move(entry.key, -1);
            this._moveFocus(cell, -1);
        });
        cell._right = mk("right", "chevron-right", () => {
            this._move(entry.key, +1);
            this._moveFocus(cell, +1);
        });
        cell._vis = mk("vis", "eye-off", () => this._toggleHidden(entry.key));
        cell._del = mk("del", "trash", () => this._removeCustom(cell._entry.appId));
        cell.appendChild(controls);
        return cell;
    }

    /** A tile's app is loading: aria-busy on the tile plus a small spinner
     *  (sac-spinner, decorative — aria-busy is the semantics). Nested opens
     *  of the same tile count, so the first to settle does not clear it. */
    _setBusy(cell, on) {
        cell._busy = Math.max(0, (cell._busy || 0) + (on ? 1 : -1));
        const busy = cell._busy > 0;
        if (busy) cell._tile.setAttribute("aria-busy", "true");
        else cell._tile.removeAttribute("aria-busy");
        if (busy && !cell._spin) {
            cell._spin = document.createElement("sac-spinner");
            cell._spin.className = "sac-launcher-busy";
            cell._spin.setAttribute("aria-hidden", "true");
            cell._tile.appendChild(cell._spin);
        } else if (!busy && cell._spin) {
            cell._spin.remove();
            cell._spin = null;
        }
    }

    _updateCell(cell, entry, f) {
        cell._entry = entry;
        const name = entry.name || entry.appId;
        cell._icon.setAttribute("name", entry.icon || "shapes");
        cell._h.textContent = name;
        cell._p.textContent = entry.description || "";
        cell._p.hidden = !entry.description;
        if (cell._kind === "page") cell._tile.setAttribute("href", entry.href || "#");
        cell.classList.toggle("hidden-app", f.hidden);
        cell.classList.toggle("custom-app", f.custom);

        // The tile's accent seed: icon color, hover ring and glow follow —
        // and the same color rides into the app when opened through it. A
        // layout color (a palette slot) wins over the entry's own accent.
        const slot = this._state.colors[entry.key];
        cell._slot = slot || null;
        const accent = slot ? `var(--palette-${slot})` : entry.accent;
        if (accent) cell._tile.style.setProperty("--accent", accent);
        else cell._tile.style.removeProperty("--accent");

        this._paintMenu(cell);

        // Footprint: the layout's size wins over the entry's `tile`; unknown
        // values fall back to medium.
        const size = this._state.sizes[entry.key] || entry.tile;
        cell.classList.toggle("size-wide", size === "wide");
        cell.classList.toggle("size-large", size === "large");
        cell.classList.toggle("size-small", size === "small");
        cell._tile.classList.toggle("small", size === "small");
        // Icon only: the name rides along as tooltip (the h2 stays the
        // accessible name, visually hidden by ui.css's .tile.small).
        if (size === "small") cell._tile.title = name;
        else cell._tile.removeAttribute("title");

        cell._left.disabled = f.first;
        cell._right.disabled = f.last;
        cell._vis.querySelector("sac-icon").setAttribute("name", f.hidden ? "eye" : "eye-off");
        cell._del.hidden = !f.custom; // built-ins can only be hidden, never removed
        this._labelCell(cell);

        // In edit mode the tiles themselves are inert; keyboard focus goes
        // straight to the controls.
        if (this.hasAttribute("edit")) cell._tile.setAttribute("tabindex", "-1");
        else cell._tile.removeAttribute("tabindex");
    }

    /**
     * The tile's menu items: a setMenu() override wins over the entry's
     * `menu`. Kept on the cell; the context menu reads them when it opens.
     */
    _paintMenu(cell) {
        const key = cell._entry.key;
        const src = this._menus.has(key) ? this._menus.get(key) : cell._entry.menu;
        const items = Array.isArray(src) ? src.filter(it => it === "-" || (it && typeof it === "object")) : [];
        cell._menuItems = items;
        cell.classList.toggle("has-menu", items.some(it => it !== "-"));
    }

    /** What the context menu shows for a cell: its items, then "Arrange"
     *  while the layout can be edited. Labels in the current language. */
    _contextItems(cell) {
        if (!cell || !cell._entry || cell.classList.contains("sac-launcher-add-cell")) return null;
        const list = (cell._menuItems || []).map((it, i) => it === "-" ? "-" : {
            id: it.id, icon: it.icon, checked: it.checked, type: it.type,
            danger: !!it.danger, disabled: !!it.disabled, _index: i,
            label: it.labelKey ? t(it.labelKey, it.label || "") : String(it.label || ""),
        });
        if (this._canEdit() && this.getAttribute("drag") !== "none") {
            list.push("-", { id: "__arrange", label: t("launcher.arrange", "Arrange"), icon: "move" });
        }
        return list;
    }

    _onMenuSelect(cell, action) {
        const it = cell._menuItems && cell._menuItems[Number(action)];
        if (!it) return;
        const e = cell._entry;
        const id = it.id != null ? it.id : Number(action);
        const info = { key: e.key, appId: e.appId, action: id, launcher: this };
        if (typeof it.onClick === "function") {
            try { it.onClick(info); }
            catch (err) { console.error("[sac-launcher] tile menu onClick failed:", err); }
        }
        this.dispatchEvent(new CustomEvent("sac:tile-action", {
            bubbles: true, composed: true,
            detail: { key: e.key, appId: e.appId, action: id },
        }));
    }

    /** The edit controls' labels — from the cell's current entry and state. */
    _labelCell(cell) {
        const entry = cell._entry;
        const name = entry.name || entry.appId;
        // One label, two readers: aria-label for assistive tech, title for
        // the pointer (the controls are bare icons).
        const label = (btn, text) => { btn.setAttribute("aria-label", text); btn.title = text; };
        label(cell._left, t("launcher.move-left", "Move {name} left").replace("{name}", name));
        label(cell._right, t("launcher.move-right", "Move {name} right").replace("{name}", name));
        label(cell._vis, (cell.classList.contains("hidden-app")
            ? t("launcher.show", "Show {name}")
            : t("launcher.hide", "Hide {name}")).replace("{name}", name));
        label(cell._del, t("launcher.remove", "Remove {name}").replace("{name}", name));
    }

    _syncEditUI() {
        if (this.hasAttribute("edit") && !this._canEdit()) {
            this.removeAttribute("edit"); // nobody owns the layout, or readonly
            return;
        }
        const editing = this.hasAttribute("edit");
        // Arranging: no context menus, no long-press menu, a finger drags.
        if (this._grid) this._grid.toggleAttribute("data-arranging", editing);
        this._footer.hidden = !this._canEdit();
        this._empty.hidden = this._order.length > 0 || editing;
        this._editBtn.textContent = editing ? t("launcher.done", "Done") : t("launcher.edit", "Edit");
        this._editBtn.setAttribute("aria-pressed", String(editing));
        this._tiles.forEach(cell => {
            if (editing) cell._tile.setAttribute("tabindex", "-1");
            else cell._tile.removeAttribute("tabindex");
        });
        this._grid.classList.toggle("sac-launcher-can-drag", this._dragAllowed());
        this._layout();   // hidden tiles appear / disappear with edit mode
    }

    /* ------------------------------------------------------------------ */
    /* Drag reorder (sac.sortable does the pointer work)                   */
    /* ------------------------------------------------------------------ */

    _dragAllowed() {
        const mode = this.getAttribute("drag");
        if (!this._canEdit() || mode === "none") return false;
        if (!(window.sac && typeof sac.sortable === "function")) return false;
        return mode === "always" || this.hasAttribute("edit");
    }

    /** Lift / land observed: show the slot outline while a tile is up. */
    _trackDrag() {
        const cell = this._grid.querySelector(":scope > [data-sortable-dragging]");
        if (!cell) { this._stopTrack(); return; }
        if (this._dragging === cell) return;
        this._dragging = cell;
        this._dropMark.hidden = false;
        this._dropMark.classList.remove("placed");   // first frame: no slide-in
        const step = () => {
            if (this._dragging !== cell) return;
            // offset* ignore the transform sortable puts on the lifted cell:
            // they are its slot — exactly where it lands on release.
            const s = this._dropMark.style;
            s.left = `${cell.offsetLeft}px`;
            s.top = `${cell.offsetTop}px`;
            s.width = `${cell.offsetWidth}px`;
            s.height = `${cell.offsetHeight}px`;
            if (!this._dropMark.classList.contains("placed")) {
                requestAnimationFrame(() => this._dropMark.classList.add("placed"));
            }
            this._trackRaf = requestAnimationFrame(step);
        };
        step();
    }

    _stopTrack() {
        const was = this._dragging;
        this._dragging = null;
        if (this._trackRaf) { cancelAnimationFrame(this._trackRaf); this._trackRaf = 0; }
        if (this._dropMark) { this._dropMark.hidden = true; this._dropMark.classList.remove("placed"); }
        if (was && this._syncPending) {
            this._syncPending = false;
            // After sortable's own clean-up (and onReorder) in this task.
            queueMicrotask(() => this._sync());
        }
    }

    /**
     * A drop moved a cell in the DOM. Read the new order straight from the
     * grid (hidden cells keep their places) and persist it exactly like the
     * move buttons do.
     */
    _onDrop() {
        this._dragging = null;          // landed — _sync() may touch the DOM again
        this._syncPending = false;      // _afterChange() re-syncs anyway
        const order = Array.from(this._grid.children)
            .filter(c => c.classList.contains("sac-launcher-cell") && c !== this._addCell)
            .map(c => c.dataset.id);
        if (order.length !== this._order.length) return;
        this._order = order;
        this._state.order = order.slice();
        this._afterChange();
    }

    /* ------------------------------------------------------------------ */
    /* User changes                                                        */
    /* ------------------------------------------------------------------ */

    _move(id, delta) {
        const i = this._order.indexOf(id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= this._order.length) return;
        [this._order[i], this._order[j]] = [this._order[j], this._order[i]];
        this._state.order = this._order.slice();
        this._afterChange();
    }

    _moveFocus(cell, dir) {
        // Reordering moves the cell in the DOM, which drops focus — put it
        // back on the pressed control (or its counterpart at the boundary).
        const btn = dir < 0 ? cell._left : cell._right;
        (btn.disabled ? (dir < 0 ? cell._right : cell._left) : btn).focus();
    }

    _toggleHidden(id) {
        const i = this._state.hidden.indexOf(id);
        if (i >= 0) this._state.hidden.splice(i, 1);
        else this._state.hidden.push(id);
        this._afterChange();
    }

    /**
     * Remove a user-added app at once — forgiveness, not confirmation: a
     * toast offers Undo, which puts back the manifest and every tile of it
     * where it was (order position, size, colour, hidden). Focus that sat
     * on the removed tile moves to the tile now in its place.
     */
    _removeCustom(id) {
        const st = this._state;
        const i = st.custom.findIndex(m => m.id === id);
        if (i < 0) return; // built-in — only hideable
        const mine = (key) => key === id || key.startsWith(id + "::");
        const keys = this._order.filter(mine);
        const snap = {
            manifest: st.custom[i],
            index: i,
            at: keys.map(k => [k, this._order.indexOf(k)]),
            hidden: st.hidden.filter(mine),
            sizes: {}, colors: {},
        };
        keys.forEach((k) => {
            if (st.sizes[k]) snap.sizes[k] = st.sizes[k];
            if (st.colors[k]) snap.colors[k] = st.colors[k];
        });
        const cell = this._tiles.get(keys[0] || id);
        const hadFocus = !!(cell && cell.contains(document.activeElement));
        const slot = cell ? this._order.indexOf(cell.dataset.id) : -1;

        st.custom.splice(i, 1);
        st.hidden = st.hidden.filter(x => !mine(x));
        st.order = st.order.filter(x => !mine(x));
        keys.forEach((k) => { delete st.sizes[k]; delete st.colors[k]; });
        if (window.sac && sac.apps) sac.apps.remove(id);
        this._afterChange();

        if (hadFocus) {
            const next = this._tiles.get(this._order[Math.min(slot, this._order.length - 1)]);
            const to = next && this.hasAttribute("edit") ? next._vis
                : (this.hasAttribute("edit") ? this._addBtn : null);
            if (to) to.focus();
        }

        if (window.sac && typeof sac.toast === "function") {
            const name = snap.manifest.name || id;
            sac.toast(t("launcher.removed", "“{name}” removed").replace("{name}", name), {
                action: { label: "Undo", labelKey: "launcher.undo", onClick: () => this._restoreCustom(snap) },
            });
        }
    }

    /** Undo a removal: the manifest back into the layer (at its old index)
     *  and the registry, each tile back at its order position with its
     *  size, colour and hidden state. Skipped when the id was taken again
     *  in the meantime (a re-add under the same name). */
    _restoreCustom(snap) {
        const st = this._state;
        const m = snap.manifest;
        if (st.custom.some(x => x.id === m.id) || (window.sac && sac.apps && sac.apps.get(m.id))) return;
        st.custom.splice(Math.min(snap.index, st.custom.length), 0, m);
        const order = st.order.filter(k => !snap.at.some(([key]) => key === k));
        snap.at.slice().sort((a, b) => a[1] - b[1])
            .forEach(([key, pos]) => order.splice(Math.min(pos, order.length), 0, key));
        st.order = order;
        snap.hidden.forEach((k) => { if (!st.hidden.includes(k)) st.hidden.push(k); });
        Object.assign(st.sizes, snap.sizes);
        Object.assign(st.colors, snap.colors);
        // State first: the register below re-syncs the grid (sac:apps-changed)
        // and must find the tile's place already there.
        if (window.sac && sac.apps) sac.apps.register(Object.assign({}, m));
        this._afterChange();
    }

    _afterChange() {
        this._sync();
        this._prune();
        this._persist();
        this.dispatchEvent(new CustomEvent("sac:layout", {
            bubbles: true,
            composed: true,
            detail: {
                order: this._order.slice(),
                hidden: this._state.hidden.slice(),
                customCount: this._state.custom.length,
                layout: this.layout,
            },
        }));
    }

    /* ------------------------------------------------------------------ */
    /* Add-app dialog                                                      */
    /* ------------------------------------------------------------------ */

    _openAddDialog() {
        if (this.hasAttribute("no-add")) return;
        if (!this._dialog) this._buildDialog();
        if (typeof this._dialog.open !== "function") {
            console.warn("[sac-launcher] <sac-dialog> is not loaded.");
            return;
        }
        this._clearFormErrors();
        this._showDialog();
    }

    _showDialog() {
        // Our keydown listener must register BEFORE the dialog's own (both
        // capture on document; same node fires in registration order) so
        // Enter in a field submits before anything else sees it.
        document.addEventListener("keydown", this._onDialogKeydown, true);
        this._dialog.open();
        const firstBad = this._formEl.querySelector('[aria-invalid="true"]');
        (firstBad || this._form.name).focus();
    }

    _buildDialog() {
        const dlg = document.createElement("sac-dialog");
        dlg.setAttribute("title", t("launcher.add-app", "Add app"));
        // labelKey: the dialog relabels its own buttons on a language switch.
        dlg.buttons = [
            { action: "cancel", label: "Cancel", labelKey: "launcher.cancel", kind: "default" },
            { action: "add", label: "Add", labelKey: "launcher.add", kind: "primary" },
        ];

        this._form = {};
        const form = document.createElement("div");
        form.className = "sac-launcher-form";

        this._formHint = document.createElement("p");
        this._formHint.className = "sac-launcher-form-hint";
        form.appendChild(this._formHint);

        this._formError = document.createElement("p");
        this._formError.className = "sac-launcher-form-error";
        this._formError.setAttribute("role", "alert");
        this._formError.hidden = true;
        form.appendChild(this._formError);

        this._formLabels = {};
        const field = (key) => {
            const wrap = document.createElement("div");
            const lab = document.createElement("label");
            lab.htmlFor = `${this._uid}-${key}`;
            const inp = document.createElement("input");
            inp.type = "text";
            inp.id = `${this._uid}-${key}`;
            wrap.append(lab, inp);
            this._form[key] = inp;
            this._formLabels[key] = lab;
            return wrap;
        };
        form.append(field("name"), field("icon"), field("tag"), field("src"));
        // The trust note sits right under the address it is about, and the
        // address field points at it (aria-describedby): what adding does,
        // then what to do about it.
        this._trust = document.createElement("p");
        this._trust.className = "sac-launcher-trust";
        this._trust.id = `${this._uid}-trust`;
        const trustIcon = document.createElement("sac-icon");
        trustIcon.setAttribute("name", "warn");
        trustIcon.setAttribute("aria-hidden", "true");
        this._trustText = document.createElement("span");
        this._trust.append(trustIcon, this._trustText);
        this._form.src.parentNode.appendChild(this._trust);
        this._form.src.setAttribute("aria-describedby", this._trust.id);
        const row = document.createElement("div");
        row.className = "sac-launcher-form-row";
        row.append(field("width"), field("height"));
        form.appendChild(row);
        this._formProblems = [];
        this._dialog = dlg;
        this._labelForm();

        dlg.appendChild(form);
        document.body.appendChild(dlg);
        dlg.addEventListener("sac:action", (e) => this._onDialogAction(e.detail.action));
        this._dialog = dlg;
        this._formEl = form;
    }

    /** Every kit string of the Add dialog — at build and on a language
     *  switch (in place: typed values, focus and the error state survive). */
    _labelForm() {
        this._dialog.setAttribute("title", t("launcher.add-app", "Add app"));
        this._formHint.textContent = t("launcher.add-hint",
            "Add an app made for this launcher. Its maker gives you its address and its element name.");
        this._trustText.textContent = t("launcher.trust-note",
            "This runs code from that address inside this app, with your data. Only add apps you trust.");
        for (const [key, [label, placeholder]] of Object.entries(SacLauncher.FIELDS)) {
            this._formLabels[key].textContent = t(`launcher.field-${key}`, label);
            this._form[key].placeholder = t(`launcher.placeholder-${key}`, placeholder);
        }
        if (this._formProblems.length) {
            const problems = this._formProblems.map((k) => t(`launcher.error-${k}`, SacLauncher.PROBLEMS[k]));
            this._formError.textContent = t("launcher.error-needs", "An app needs {problems}.")
                .replace("{problems}", problems.join(", "));
        }
    }

    _onDialogKeydown(e) {
        const dlg = this._dialog;
        if (!dlg || !dlg.hasAttribute("open")) return;
        const active = document.activeElement;
        const inForm = this._formEl.contains(active);

        if (e.key === "Enter" && inForm && active.tagName === "INPUT") {
            e.preventDefault();
            e.stopImmediatePropagation();
            dlg.close("add");
            return;
        }
        // Tab: the dialog's own trap covers the form (it walks its body).
    }

    _onDialogAction(action) {
        document.removeEventListener("keydown", this._onDialogKeydown, true);
        if (action !== "add") {
            if (this.hasAttribute("edit")) this._addBtn.focus();
            return;
        }

        const f = this._form;
        const name = f.name.value.trim();
        const tag = f.tag.value.trim().toLowerCase();
        const src = f.src.value.trim();
        const badName = !name;
        const badTag = !tag || !tag.includes("-") || /\s/.test(tag);
        const badSrc = !src;

        this._clearFormErrors();
        if (badName || badTag || badSrc) {
            // Kept as keys, so a language switch can re-word the message.
            const problems = this._formProblems = [];
            if (badName) { problems.push("name"); f.name.setAttribute("aria-invalid", "true"); }
            if (badTag) { problems.push("tag"); f.tag.setAttribute("aria-invalid", "true"); }
            if (badSrc) { problems.push("src"); f.src.setAttribute("aria-invalid", "true"); }
            this._labelForm();
            this._formError.hidden = false;
            // Re-open immediately (same task, no repaint between) — the form
            // and its values are light DOM and survive untouched.
            this._showDialog();
            return;
        }

        const size = (v) => {
            v = v.trim();
            if (!v) return null;
            return /^\d+(\.\d+)?$/.test(v) ? `${v}px` : v;
        };
        const manifest = {
            id: this._uniqueId(name),
            name,
            icon: f.icon.value.trim() || "shapes",
            kind: "window",
            tag,
            src,
        };
        const w = size(f.width.value);
        const h = size(f.height.value);
        if (w) manifest.width = w;
        if (h) manifest.height = h;

        if (window.sac && sac.apps) sac.apps.register(Object.assign({}, manifest));
        this._state.custom.push(manifest);
        this._afterChange();
        this._resetForm();
        if (this.hasAttribute("edit")) this._addBtn.focus();
    }

    _clearFormErrors() {
        if (!this._formEl) return;
        this._formProblems = [];
        this._formError.hidden = true;
        this._formError.textContent = "";
        this._formEl.querySelectorAll("[aria-invalid]").forEach(inp =>
            inp.removeAttribute("aria-invalid"));
    }

    _resetForm() {
        Object.values(this._form).forEach(inp => { inp.value = ""; });
        this._clearFormErrors();
    }

    _uniqueId(name) {
        const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app";
        const taken = (x) =>
            (window.sac && sac.apps && sac.apps.get(x) !== null) ||
            this._state.custom.some(m => m.id === x);
        let id = base;
        let n = 2;
        while (taken(id)) id = `${base}-${n++}`;
        return id;
    }

    /* ------------------------------------------------------------------ */
    /* Styles (injected once, scoped by tag/class — light-DOM component)   */
    /* ------------------------------------------------------------------ */

    static _injectStyles() {
        if (document.getElementById("sac-launcher-styles")) return;
        const style = document.createElement("style");
        style.id = "sac-launcher-styles";
        style.textContent = `
            sac-launcher { display: block; }

            sac-launcher .sac-launcher-cell { position: relative; }

            /* The grid is its own container: the footprint collapse below
               must follow the width the grid actually has, not the page's.
               On the grid (a full-width block), never on the host — see the
               responsive notes in ui.css section 15. */
            sac-launcher > .grid {
                container: sac-launcher-grid / inline-size;
                position: relative;   /* offset parent of the cells: the drop outline */
            }
            sac-launcher .sac-launcher-cell > .tile { width: 100%; height: 100%; }

            /* Manifest-declared footprint (tile: "wide" | "large"). Spans sit
               on the cell — the grid child — so everything positioned against
               the cell (tile, edit controls) covers the full area for free.
               The cell is the .grid child, so it takes the square height
               from ui.css; --grid-rows makes the large one 2×2. */
            sac-launcher .sac-launcher-cell.size-wide,
            sac-launcher .sac-launcher-cell.size-large { grid-column: span 2; }
            sac-launcher .sac-launcher-cell.size-large { grid-row: span 2; --grid-rows: 2; }
            @media (max-width: 768px), (max-height: 480px) and (pointer: coarse) {
                /* Narrow viewports: every footprint collapses to medium,
                   matching the .grid pattern's own .tile.large collapse. */
                sac-launcher .sac-launcher-cell.size-wide,
                sac-launcher .sac-launcher-cell.size-large {
                    grid-column: span 1;
                    grid-row: span 1;
                    --grid-rows: 1;
                }
            }
            /* Small tiles: _layout() places every cell on a third-size grid
               (inline grid-row / grid-column + the grid's own track list),
               so a cell's height is its rows', not the square of ui.css. A
               one-column grid lays a block out as wrapping rows of square
               cells of natural height. */
            sac-launcher > .grid.sac-launcher-fine > .sac-launcher-cell { height: auto; }
            sac-launcher > .grid.sac-launcher-fine > .sac-launcher-cell.size-small { min-height: 0; }
            sac-launcher > .grid.sac-launcher-list > .sac-launcher-cell.size-small { aspect-ratio: 1; }
            /* Two 280px columns + the 21px gap: below that the grid has one
               column and a span-2 cell would invent a second one. */
            @container sac-launcher-grid (width < 581px) {
                sac-launcher .sac-launcher-cell.size-wide,
                sac-launcher .sac-launcher-cell.size-large {
                    grid-column: span 1;
                    grid-row: span 1;
                    --grid-rows: 1;
                }
            }

            sac-launcher button.tile { text-align: left; font-size: inherit; }
            /* Link tiles (<a>) inherit the page's line-height; app tiles
               (<button>) have "normal" — one metric, so titles line up. */
            sac-launcher a.tile { line-height: normal; }
            sac-launcher .sac-launcher-tile:focus-visible,
            sac-launcher .sac-launcher-add:focus-visible {
                outline: 2px solid var(--accent);
                outline-offset: 2px;
            }

            /* Hidden apps: gone in normal mode, grayed in edit mode. */
            sac-launcher:not([edit]) .sac-launcher-cell.hidden-app { display: none; }
            sac-launcher[edit] .hidden-app .sac-launcher-tile {
                opacity: 0.45;
                filter: grayscale(1);
            }

            /* Edit mode: the tile itself goes inert — no launch affordance. */
            sac-launcher[edit] .sac-launcher-tile { cursor: default; }
            sac-launcher[edit] .sac-launcher-tile:hover {
                transform: none;
                box-shadow: none;
                border-color: var(--border-strong);
                background: var(--tile);
            }
            sac-launcher[edit] .sac-launcher-tile:hover sac-icon { transform: none; }

            /* Per-tile edit controls. */
            sac-launcher .sac-launcher-controls {
                position: absolute;
                top: 12px;
                right: 12px;
                display: none;
                gap: 4px;
            }
            sac-launcher[edit] .sac-launcher-controls { display: flex; }
            /* A small tile is too narrow for a row of controls: they wrap
               from its top-right corner, and the menu sits closer in. */
            sac-launcher .size-small > .sac-launcher-controls {
                top: 6px;
                right: 6px;
                left: 6px;
                flex-wrap: wrap;
                justify-content: flex-end;
            }
            sac-launcher .sac-launcher-ctrl {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                padding: 0;
                border: 1px solid var(--border-strong);
                border-radius: var(--radius-m);
                background: var(--glass-strong);
                color: var(--text-muted);
                cursor: pointer;
                --icon-size: 14px;
                transition: background 120ms, color 120ms, border-color 120ms,
                            transform 0.2s var(--ease-smooth);
            }
            sac-launcher .sac-launcher-ctrl:hover:not(:disabled) {
                background: var(--hover-strong);
                color: var(--text);
            }
            sac-launcher .sac-launcher-ctrl.del:hover:not(:disabled) {
                background: color-mix(in srgb, var(--danger) 12%, transparent);
                color: var(--danger);
                border-color: color-mix(in srgb, var(--danger) 30%, transparent);
            }
            /* Press: answers the moment it goes down. */
            sac-launcher .sac-launcher-ctrl:active:not(:disabled) {
                transform: scale(0.97);
                transition-duration: 0.1s;
            }
            sac-launcher .sac-launcher-ctrl:focus-visible {
                outline: 2px solid var(--accent);
                outline-offset: 2px;
            }
            sac-launcher .sac-launcher-ctrl:disabled { opacity: 0.3; cursor: not-allowed; }
            sac-launcher .sac-launcher-ctrl[hidden] { display: none; }
            @media (pointer: coarse) {
                sac-launcher .sac-launcher-controls { gap: 8px; }
                sac-launcher .sac-launcher-ctrl {
                    position: relative;
                    width: 36px;
                    height: 36px;
                    --icon-size: 16px;
                }
                /* 36px look + a halo 4px past each edge = 44px target (the
                   inset counts from the padding box, inside the 1px border). */
                sac-launcher .sac-launcher-ctrl::after {
                    content: "";
                    position: absolute;
                    inset: -5px;
                }
            }

            /* Icons inside our buttons never take the pointer: a press must
               land on the button itself (sac.sortable's ignore list matches
               the pressed node, and sac-icon's svg sits in a shadow root). */
            sac-launcher .sac-launcher-ctrl sac-icon { pointer-events: none; }

            /* Edit mode is the arrange mode (the iPhone's): the cells wiggle
               on the rotate property (ui.css keyframes), staggered; the one
               in flight holds still. Reduced motion: a dashed hairline. */
            sac-launcher[edit] .sac-launcher-cell:not(.sac-launcher-add-cell) {
                animation: sac-wiggle 0.26s ease-in-out infinite alternate;
                touch-action: none;
            }
            sac-launcher[edit] .sac-launcher-cell.size-small { animation-name: sac-wiggle-small; }
            sac-launcher[edit] .sac-launcher-cell:nth-child(2n) { animation-delay: -0.13s; animation-duration: 0.3s; }
            sac-launcher[edit] .sac-launcher-cell:nth-child(3n) { animation-delay: -0.07s; animation-duration: 0.28s; }
            sac-launcher[edit] .sac-launcher-cell[data-sortable-dragging] { animation: none; }
            @media (prefers-reduced-motion: reduce) {
                sac-launcher[edit] .sac-launcher-cell:not(.sac-launcher-add-cell) {
                    animation: none;
                    outline: 1px dashed var(--border-strong);
                    outline-offset: 3px;
                }
            }
            /* Touch: a small tile keeps the 28px controls (two per row fit);
               the halo shrinks so neighbours never overlap. */
            @media (pointer: coarse) {
                sac-launcher .size-small > .sac-launcher-controls { gap: 4px; }
                sac-launcher .size-small .sac-launcher-ctrl { width: 28px; height: 28px; }
                sac-launcher .size-small .sac-launcher-ctrl::after { inset: -2px; }
            }

            /* Drag reorder. Edit mode: the inert tile shows it can be
               grabbed. In flight: lifted look; its slot gets the outline. */
            sac-launcher[edit] .sac-launcher-can-drag > .sac-launcher-cell:not(.sac-launcher-add-cell) > .sac-launcher-tile {
                cursor: grab;
            }
            sac-launcher .sac-launcher-cell[data-sortable-dragging] > .sac-launcher-tile {
                cursor: grabbing;
                border-color: var(--accent);
                box-shadow: var(--shadow-2);
            }
            /* A tile dragged past the grid's side must not widen the page
               (a horizontal scrollbar flashing in and out mid-drag).
               Vertical stays open: the page auto-scrolls on that axis. */
            sac-launcher > .grid:has(> [data-sortable-dragging]) { overflow-x: clip; }
            sac-launcher .sac-launcher-drop {
                position: absolute;
                z-index: 1;
                box-sizing: border-box;
                border: 1px dashed var(--accent);
                border-radius: var(--radius-l);
                background: var(--accent-tint);
                pointer-events: none;
            }
            sac-launcher .sac-launcher-drop[hidden] { display: none; }
            sac-launcher .sac-launcher-drop.placed {
                transition: left 150ms var(--ease-smooth), top 150ms var(--ease-smooth),
                            width 150ms var(--ease-smooth), height 150ms var(--ease-smooth);
            }

            /* The dashed "Add app" tile (edit mode only). */
            sac-launcher .sac-launcher-add-cell { display: none; }
            sac-launcher[edit] .sac-launcher-add-cell { display: block; }
            sac-launcher .sac-launcher-add {
                align-items: center;
                justify-content: center;
                gap: 0.6rem;
                background: transparent;
                border: 1px dashed var(--border-strong);
                color: var(--text-muted);
                font-weight: 600;
                font-size: 0.95rem;
            }
            sac-launcher .sac-launcher-add sac-icon {
                margin-bottom: 0;
                color: var(--text-muted);
                --icon-size: 32px;
            }
            /* [edit] + .tile: the tile only shows in edit mode, where ui.css's
               arrange-mode reset ([data-arranging] .tile:hover) would win. */
            sac-launcher[edit] .tile.sac-launcher-add:hover {
                transform: none;
                box-shadow: none;
                background: var(--hover);
                border-color: var(--accent);
                color: var(--accent);
            }
            sac-launcher .sac-launcher-add:hover sac-icon {
                transform: none;
                color: var(--accent);
            }
            /* Press: no hover lift to give back, so a small push (a tile never
               scales — ui.css). [edit] + .tile outrank ui.css's arrange-mode
               reset, which would swallow it: this tile only shows in edit mode. */
            sac-launcher[edit] .tile.sac-launcher-add:active {
                transform: translateY(2px) translateZ(0);
                transition-duration: 0.1s;
            }
            @media (hover: none) {
                sac-launcher[edit] .tile.sac-launcher-add:hover {
                    background: transparent;
                    border-color: var(--border-strong);
                    color: var(--text-muted);
                }
                sac-launcher .sac-launcher-add:hover sac-icon { color: var(--text-muted); }
            }

            /* Footer: the unobtrusive Edit toggle. */
            sac-launcher .sac-launcher-footer {
                display: flex;
                justify-content: flex-end;
                margin-top: 1rem;
            }
            sac-launcher .sac-launcher-footer[hidden] { display: none; }
            sac-launcher .sac-launcher-edit {
                width: auto;
                padding: 0.4rem 0.9rem;
                color: var(--text-muted);
            }
            sac-launcher .sac-launcher-edit:hover:not(:disabled) { color: var(--text); }
            sac-launcher[edit] .sac-launcher-edit {
                color: var(--accent);
                background: var(--accent-tint);
                border-color: color-mix(in srgb, var(--accent) 35%, transparent);
            }

            sac-launcher .sac-launcher-empty {
                color: var(--text-dim);
                font-size: 0.9rem;
                margin: 0.5rem 0 0;
            }

            /* Add-app form (slotted into <sac-dialog>, lives in light DOM). */
            .sac-launcher-form {
                display: flex;
                flex-direction: column;
                gap: 12px;
                padding-top: 4px;
            }
            .sac-launcher-form-row { display: flex; gap: 12px; }
            .sac-launcher-form-row > div { flex: 1; }
            .sac-launcher-form-hint {
                margin: 0;
                color: var(--text-dim);
                font-size: 0.8rem;
            }
            .sac-launcher-form-error {
                margin: 0;
                color: var(--danger-text);
                font-size: 0.85rem;
            }
            .sac-launcher-form-error[hidden] { display: none; }
            .sac-launcher-form input[aria-invalid="true"] { border-color: var(--danger); }
            /* The trust note under the address: attention (--accent-warm)
               carried by the icon and a whisper of tint — never a stripe. */
            .sac-launcher-trust {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                margin: 6px 0 0;
                padding: 8px 10px;
                border-radius: var(--radius-m);
                background: color-mix(in srgb, var(--accent-warm) 7%, transparent);
                color: var(--text-muted);
                font-size: 0.8rem;
                line-height: 1.4;
            }
            .sac-launcher-trust sac-icon {
                --icon-size: 16px;
                flex: none;
                margin-top: 1px;
                color: var(--accent-warm-text);
            }

            /* Opening: a small spinner in the tile's corner — shown only once
               the wait is noticeable (200ms), so a quick open never flashes
               it. Under reduced motion it appears without the fade and
               sac-spinner itself stands still (a static ring). */
            sac-launcher .sac-launcher-tile[aria-busy="true"] { cursor: progress; }
            sac-launcher .sac-launcher-busy {
                position: absolute;
                top: 12px;
                right: 12px;
                --spinner-size: 18px;
                opacity: 0;
                pointer-events: none;
                animation: sac-launcher-busy-in 0.15s var(--ease-smooth) 0.2s forwards;
            }
            sac-launcher .size-small .sac-launcher-busy { top: 6px; right: 6px; --spinner-size: 14px; }
            @keyframes sac-launcher-busy-in { to { opacity: 1; } }

            @media (prefers-reduced-motion: reduce) {
                sac-launcher .sac-launcher-ctrl,
                sac-launcher .sac-launcher-edit,
                sac-launcher .sac-launcher-add,
                sac-launcher .sac-launcher-drop.placed { transition: none; }
                sac-launcher .sac-launcher-busy { animation-duration: 0s; }
            }
        `;
        document.head.appendChild(style);
    }
}
SacLauncher._instances = 0;
/** Layout sizes and palette slots (ui.css --palette-<slot>) `layout` accepts. */
SacLauncher.SIZES = ["small", "medium", "wide", "large"];
/** A footprint's menu label ("Small tile" / "Kleine Kachel"), for hosts
 *  that offer a size menu via setMenu() — labelKey "launcher.size-<size>". */
SacLauncher.sizeLabel = (size) => t("launcher.size-" + size,
    { small: "Small tile", medium: "Medium tile", wide: "Wide tile", large: "Large tile" }[size] || size);
/** The kit's compact breakpoint (ui.css) — wide/large collapse to medium. */
SacLauncher.COMPACT = "(max-width: 768px), (max-height: 480px) and (pointer: coarse)";
SacLauncher.PALETTE = ["blue", "orange", "red", "green", "purple", "pink", "yellow", "teal", "gray", "indigo"];
SacLauncher._emptyLayout = () => ({ order: [], hidden: [], sizes: {}, colors: {}, custom: [] });
/** Any value → a clean layout: string keys, deduped lists, known sizes and
 *  slots only, custom manifests with a string id (shallow copies). */
SacLauncher._normLayout = (v) => {
    const out = SacLauncher._emptyLayout();
    if (!v || typeof v !== "object") return out;
    const keys = (a) => Array.isArray(a)
        ? Array.from(new Set(a.filter(x => typeof x === "string" && x))) : [];
    const pick = (o, allowed) => {
        const r = {};
        if (o && typeof o === "object") Object.keys(o).forEach((k) => {
            if (allowed.includes(o[k])) r[k] = o[k];
        });
        return r;
    };
    out.order = keys(v.order);
    out.hidden = keys(v.hidden);
    out.sizes = pick(v.sizes, SacLauncher.SIZES);
    out.colors = pick(v.colors, SacLauncher.PALETTE);
    const seen = new Set();
    if (Array.isArray(v.custom)) v.custom.forEach((m) => {
        if (m && typeof m === "object" && typeof m.id === "string" && m.id && !seen.has(m.id)) {
            seen.add(m.id);
            out.custom.push(Object.assign({}, m));
        }
    });
    return out;
};
SacLauncher._copyLayout = (st) => ({
    order: st.order.slice(),
    hidden: st.hidden.slice(),
    sizes: Object.assign({}, st.sizes),
    colors: Object.assign({}, st.colors),
    custom: st.custom.map(m => Object.assign({}, m)),
});
/** What sac.sortable may lift: every tile cell (never the Add cell) — and,
 *  outside edit mode (drag="always"), only the visible ones. */
SacLauncher.DRAG_ITEMS =
    "sac-launcher[edit] > .grid > .sac-launcher-cell:not(.sac-launcher-add-cell), " +
    "sac-launcher:not([edit]) > .grid > .sac-launcher-cell:not(.sac-launcher-add-cell):not(.hidden-app)";
/** Add-dialog fields: key → [label, placeholder] English fallbacks
 *  (keys launcher.field-<key> / launcher.placeholder-<key>). */
SacLauncher.FIELDS = {
    name:   ["Name", "My App"],
    icon:   ["Icon (optional)", "e.g. star or note"],
    tag:    ["Element name", "app-my-app"],
    src:    ["Address", "https://… or apps/my-app.js"],
    width:  ["Window width (optional)", "500px"],
    height: ["Window height (optional)", "600px"],
};
/** Add-dialog validation problems: key → fallback (launcher.error-<key>). */
SacLauncher.PROBLEMS = {
    name: "a name",
    tag:  "an element name with a dash and no spaces (like app-notes)",
    src:  "an address",
};

customElements.define("sac-launcher", SacLauncher);
})();
