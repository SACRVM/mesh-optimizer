/**
 * <sac-file-browser accept=".png,image/*" pixelated></sac-file-browser>
 *
 *   browser.store = sac.fs.shared("files");
 *   browser.addEventListener("sac:choose", (e) => open(e.detail.paths));
 *
 * A folder view over any sac.fs handle — the user's files (sac.fs.shared),
 * an app's own drawer (context.fs), a host's own space, a server-backed
 * store. A path "sprites/hero.png" IS the folder "sprites", so folders are
 * derived from the listing. An empty folder the user created keeps itself
 * alive with a hidden marker entry, "<folder>/.folder" — never listed,
 * removed with the folder. It is the list inside the open/save dialogs of
 * sac.files.virtual(), and on its own the body of a "Files" app — one pane
 * of a two-pane commander included.
 *
 * Rows: folders first, then files — thumbnail (image files) or icon, name,
 * then the meta columns (size and date by default). Files that do not match
 * `accept` are left out. Rows are virtualised: a folder of thousands of
 * entries renders only the rows in view.
 *
 * Store: the required five (list/stat/read/write/remove), plus the optional
 * ones when the store has them — through sac.fs.ops when sac.fs is loaded:
 *   entries(prefix) — one call per folder instead of list() + one stat()
 *                     per file;
 *   url(path)       — thumbnails stream from a URL instead of read()-ing the
 *                     bytes into a Blob;
 *   rename(path, n) / move(from, to) — the built-in rename; without them
 *                     it falls back to read + write + remove.
 *
 * Attributes:
 *   accept        — ".png,image/*" — the file input's grammar: `.ext`
 *                   matches the name suffix, `type/*` the MIME prefix,
 *                   `type/sub` exactly. Absent = every file.
 *   multiple      — presence: marks (below). Ctrl/⌘-click and Shift-click
 *                   select several, as before.
 *   readonly      — presence hides New folder, the per-row delete buttons,
 *                   the Delete/F2 keys, rename() and drops: a view that
 *                   changes nothing (rows can still be dragged out).
 *   pixelated     — presence draws thumbnails with hard pixel edges. Default
 *                   smooth: most images are not pixel art.
 *   no-thumbnails — presence: image files show the image icon, nothing is
 *                   fetched for them.
 *   root-label    — the first breadcrumb. Default "Files".
 *   columns       — the meta columns, in order, from "type size date".
 *                   Default "size date"; "" = the name only.
 *   sort          — "name" (default) | "size" | "date" | "type". Folders
 *                   always come first (by name).
 *   sort-dir      — "asc" (default) | "desc".
 *   header        — presence shows a column header; its labels sort by
 *                   their column (again = reverse) and fire sac:sort.
 *   cursor-style  — "bar": the cursor row is a solid --accent bar with
 *                   --on-accent ink while the list has focus (a hairline
 *                   frame without it), and only marked rows are tinted — the
 *                   commander look. "quiet": selected / marked rows and the
 *                   cursor are a --hover tint — no ring, no bar, no hairline;
 *                   the cursor shows while the browser has the keys (focus
 *                   in the list, or `active` below). Default: the tinted
 *                   selected row.
 *   flush         — presence: the list has no border, radius or ground of
 *                   its own — it sits flush in a host panel.
 *   active        — the "has the keys" cue of a two-pane layout, in the bar
 *                   only: a 1px hairline under it, --accent on the active
 *                   pane, and a muted bar on the other. "" / "true" = this
 *                   pane has the keys, "false" = the other one does (the
 *                   host toggles it — it knows, even while focus is in a
 *                   dialog), "auto" = follows focus inside the browser.
 *                   Absent = no cue, as before.
 *   show-hidden   — presence lists dot entries (".config", ".apps/"):
 *                   files and folders whose name starts with a dot are
 *                   hidden by default, like a desktop file manager. The
 *                   host binds it to its own toggle (a menu item, a key
 *                   chord). The ".folder" marker is never listed.
 *   parent-row    — presence: a ".." row first in every folder below the
 *                   root — going up is a row like any other (cursor onto it,
 *                   Enter), the commander convention. Always first, whatever
 *                   the sort, never hidden by the dot rule. It is not an
 *                   entry: never marked (mark keys, Ctrl/Shift-click, select-
 *                   all, mark mode skip it), deleted, renamed or dragged, and
 *                   never in sac:choose / sac:select / sac:mark, `selected`,
 *                   `marked` or `items`. Enter, a click or a double-click =
 *                   up(); a drop on it drops into the parent folder. On it,
 *                   `cursor` is null and sac:cursor says kind "parent". It
 *                   is the one way up by pointer: the bar's Up button goes,
 *                   and the current folder's icon (part="here") stands over
 *                   the rows' icon column instead.
 *   delete-button — the per-row trash button: "cursor" (default) shows it
 *                   on the hovered row and on the cursor row, always on
 *                   touch; "hover" only on the row under a hovering pointer
 *                   (never on touch) and only while that row is the whole
 *                   job — nothing marked, or just that row; "none" drops it
 *                   (a host with its own delete action — the Delete key
 *                   stays). The button is part="delete".
 *   tap           — what a touch / pen tap on a FILE does: "open" opens it
 *                   (sac:choose, one tap — no double-tap to find), "select"
 *                   only selects it. Absent = "open", unless the browser
 *                   sits inside a <sac-dialog>, whose OK button is what
 *                   confirms a pick (the sac.files dialogs set "select").
 *                   A mouse click always selects, a double-click opens; a
 *                   tap on a folder always opens it.
 *
 * Slots:
 *   title — sits in the header row between Up and the breadcrumb: a
 *           workspace menu, a pane caption. Hide the kit's own breadcrumb
 *           with ::part(crumbs) { display: none } when the title replaces it.
 *
 * Marks (`multiple`): a set of rows, folders included, independent of the
 * keyboard cursor. Shift+↑/↓/PgUp/PgDn/Home/End and Shift-click mark the
 * range from the anchor (added to what was marked before); Ctrl/⌘-click
 * and Ctrl/⌘+Space toggle one row; Ctrl/⌘+A marks every row; Esc clears
 * (and only then stops the key — an unmarked Esc still closes a dialog).
 * Plain arrows move the cursor and keep the marks; a plain click clears them.
 * Changing folders clears them.
 *
 * Mark mode (`multiple`, for touch): the context menu's "Select" (a
 * long-press on touch opens it — see Context menu) marks the row and turns
 * mark mode on: a check box shows on every row, a tap toggles a row's mark
 * (folders too — nothing opens), Space toggles without a modifier, and the
 * bar trades Up / breadcrumb / New folder for "{n} selected" and Done. It
 * ends with Done, Esc, unmarking the last row, a folder change, or the
 * `selecting` property. Ending clears the marks. Mouse and keyboard
 * gestures above are unchanged. Under (pointer: coarse) the bar also shows
 * a visible "Select" button (part="select") that turns mark mode on with
 * nothing marked yet — the long-press is not the only way in (2.36.0).
 *
 * States: a listing slower than 300ms shows "Loading…" (aria-busy on the
 * list) — a quick one never flashes it, and while the folder in view is
 * only being re-read its rows stay. A FAILED listing is never shown as
 * empty: "Couldn't open this folder." (role="alert") with a Try again
 * button (part="retry") that reloads. Empty stays "This folder is empty.".
 *
 * Name fields (rename, New folder) close only when the change landed. A
 * name starting with "." (New folder too), one already taken, or a store
 * that refuses the write keeps the field open with the typed name and a
 * note under it ("Couldn't rename this. Try again, or pick another
 * name.") — aria-invalid, aria-describedby and role="alert".
 *
 * Delete that stops partway (the store refuses one) says so in an error
 * toast: "2 of 5 items were not deleted." / "Couldn't delete “x”.".
 *
 * Context menu (sac.contextMenu): right-click a row, long-press it on
 * touch, or Shift+F10 / the Menu key on the cursor row. The cursor moves
 * onto that row. Built in: "Select" first (`multiple`, an unmarked row),
 * Open, and — not `readonly` — Rename and Delete (Delete acts on the marks
 * when the row is one of several marked). The browser's own menu never
 * shows on the list. Add or change entries with sac:context (below).
 *
 * Properties:
 *   store    — the sac.fs handle to browse. Setting it resets to the root
 *              and reloads.
 *   path     — the current folder ("" = root), get/set. Setting navigates.
 *   selected — the selected FILE paths: the marked files when anything is
 *              marked, else the file the user last clicked / arrowed onto.
 *   marked   — the marked paths, folders included (no trailing slash), in
 *              row order; get/set (setting fires nothing; needs `multiple`).
 *   cursor   — the path of the row under the keyboard cursor (file or
 *              folder), get/set. Setting moves it and scrolls it into view.
 *   items    — the rows in view order, read-only: [{ kind, path, name,
 *              stat }] (stat is null for folders) — for a status line.
 *   showHidden — the show-hidden attribute as a boolean, get/set.
 *   selecting — mark mode on/off, get/set (needs `multiple`). Setting true
 *              enters it with the current marks (none is fine — a host's
 *              own "Select" button); false leaves it and clears the marks.
 *              Setting fires nothing.
 *
 * Methods:
 *   focus(opts?)  — keyboard focus into the list, on the cursor row (a
 *                   rename / new-folder field when one is open) — no
 *                   shadowRoot reach-in.
 *   refresh()     — re-read the current folder (the cursor stays on its row).
 *   up()          — one folder up; the cursor lands on the folder left.
 *   newFolder()   — an inline name field; Enter creates the folder (its
 *                   ".folder" marker) and goes into it.
 *   rename(path?) — an inline name field on the row (default: the cursor
 *                   row), for the host's own chord; F2 is built in. Enter
 *                   commits, Esc cancels, leaving the field commits a
 *                   changed name. A name starting with "." or one already
 *                   in the folder keeps the field open, and so does a
 *                   rename the store refuses (see Name fields). The component
 *                   performs it (sac.fs.ops.rename, store.rename/move, or
 *                   read + write + remove), like delete and New folder —
 *                   unless a sac:request-rename listener cancels.
 *   select(path)  — select one file by path (e.g. the name being saved);
 *                   clears the marks.
 *
 * Events (bubble + composed — a dialog around it listens):
 *   sac:select         — { paths }: the selection changed (user action).
 *   sac:mark           — { paths }: the marks changed (user action, or
 *                        cleared by a folder change).
 *   sac:cursor         — { path, kind }: the row under the cursor changed
 *                        (a move, or the folder loading under it). On the
 *                        ".." row (parent-row): { path: null, kind: "parent" }.
 *   sac:selecting      — { selecting }: mark mode turned on or off — by a
 *                        long-press, Done, Esc, the last unmark, a folder
 *                        change (not by the property setter): show / hide a
 *                        "Delete (3)" action bar with it.
 *   sac:choose         — { paths }: a file was double-clicked / Enter'd,
 *                        or tapped on touch (see `tap`).
 *   sac:navigate       — { path }: the folder changed.
 *   sac:sort           — { key, dir }: a header label changed the sort.
 *   sac:request-remove — CANCELABLE, before anything is deleted:
 *                        { path, folder, permanent, paths } — `permanent` =
 *                        Shift was held (Shift+Delete / Shift-click on the
 *                        trash button); `paths` = every target (the marked
 *                        rows when Delete acts on marks; path/folder = the
 *                        first). preventDefault() skips the built-in confirm
 *                        and delete — the host trashes instead.
 *   sac:remove         — { path, folder }: one per item deleted by the
 *                        built-in path (after its confirm).
 *   sac:request-rename — CANCELABLE: { from, to, folder } before a rename;
 *                        preventDefault() and the host renames (then
 *                        refresh(), cursor = to).
 *   sac:rename         — { from, to, folder }: the built-in rename landed.
 *   sac:context        — CANCELABLE, before a row's context menu opens:
 *                        { path, kind, paths, items } — `paths` = what it
 *                        acts on (the marks, or the row); `items` is the
 *                        built-in list (sac.contextMenu items, each with
 *                        its onClick) — push, splice or replace entries in
 *                        place. preventDefault() = no menu.
 *   sac:drop           — { paths, target, copy, source } rows dragged from a
 *                        sac-file-browser (this one or another; `source` =
 *                        that element, null across documents), or { files,
 *                        target, copy: true } OS files. `target` = the
 *                        folder dropped on, or this browser's folder. `copy`
 *                        = Ctrl (Option on macOS) held. The component moves
 *                        nothing — the host does (sac.fs.ops.move/copy/
 *                        write), then refresh()es. Drops onto the dragged
 *                        rows themselves, into their own subtree, or a move
 *                        into the folder they are already in, are refused
 *                        while the stores match.
 *
 * Keyboard: ↑/↓ PgUp/PgDn Home/End move · Enter opens the folder /
 * chooses the file (on "..": goes up) · Backspace or Alt+↑ goes up · Delete removes the marked
 * rows or the cursor row (asks first; Shift = permanent in the event) ·
 * F2 renames · the mark keys above with `multiple`.
 *
 * Language: every kit string goes through sac.t and follows a runtime
 * switch in place (folder, cursor, marks, an open name field and scroll
 * survive); sizes are formatted in sac.lang.locale(). Dates follow
 * sac.regional — its date order (2026-09-25 · 25.09.2026 · 25/09/2026 ·
 * 09/25/2026) and, for today's files, its hour cycle — and repaint in place
 * on sac.regional.set(); without sac.regional, sac.lang.locale() as before.
 *
 * Compact: under a 480px container the meta columns drop out; rows, header
 * labels and buttons are 44px on touch (the Done button too).
 *
 * Theming: tokens only — selected / marked row = --accent-tint ground and
 * --accent-text name; the bar cursor = --accent / --on-accent; the quiet
 * rows = --hover; --file-browser-bar-height = the bar's height (a floor;
 * unset = its buttons', 28px / 44px on touch — line it up with a host
 * footer); the
 * thumbnail checker is --checker-a/--checker-b. Rows expose
 * part="row file|folder|parent [selected] [marked] [cursor]", so a host can style
 * e.g. ::part(marked) itself; also part="delete" (the trash button),
 * "check" (the mark-mode box), "done" and "count" (the mark-mode bar),
 * "select" (the touch Select button) and "retry" (Try again).
 */
(function () {
    const TAG = "sac-file-browser";
    if (customElements.get(TAG)) return;

    // Keeps an empty folder alive. A dotted name no picker lists.
    const MARKER = ".folder";
    // The ".." row's key in the row index — never a real path.
    const PARENT = "\u0000..";
    // The dataTransfer type of a row drag between browsers.
    const DRAG_TYPE = "application/x-sac-file-paths";
    // The in-page drag in flight: dataTransfer data is unreadable during
    // dragover, so the paths and source travel here too.
    let dragging = null;

    const META = ["type", "size", "date"];
    const SORTS = ["name", "size", "date", "type"];
    const GAP = 2;          // px between rows
    const PAD = 4;          // the list's own padding
    const OVERSCAN = 8;     // rows rendered beyond the viewport, each side
    const THUMB_JOBS = 4;   // thumbnails fetched at once
    const PRESS_SLOP = 10;      // px a held finger may drift before it is a scroll
    const SLOW_MS = 300;        // a listing slower than this shows "Loading…"

    const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    const icon = (n) => {
        const p = window.sac && sac.icons ? sac.icons.get(n) : null;
        return p ? `<svg ${ICON_ATTRS} aria-hidden="true">${p}</svg>` : "";
    };
    const t = (key, fallback) => (window.sac && sac.t ? sac.t(key, fallback) : fallback);
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const ops = () => (window.sac && sac.fs && sac.fs.ops) || null;
    const baseName = (p) => p.slice(p.lastIndexOf("/") + 1);
    const dirName = (p) => { const c = p.lastIndexOf("/"); return c < 0 ? "" : p.slice(0, c); };
    const extOf = (name) => { const m = /\.([^./]+)$/.exec(name || ""); return m && m.index > 0 ? m[1] : ""; };
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

    /** The <input accept> grammar, as one predicate over { name, type }. */
    function acceptTest(accept) {
        const parts = String(accept || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (!parts.length) return () => true;
        return ({ name, type }) => {
            const n = String(name || "").toLowerCase();
            const m = String(type || "").toLowerCase();
            return parts.some((p) => p.startsWith(".") ? n.endsWith(p)
                : p.endsWith("/*") ? m.startsWith(p.slice(0, -1))
                : m === p);
        };
    }

    /** The page language's locale for Intl output; the browser's own when
     *  globals.js is not loaded. Read per call — the language can change. */
    const locale = () => (window.sac && sac.lang ? sac.lang.locale() : undefined);

    function formatSize(bytes) {
        if (bytes == null) return "";
        if (bytes < 1024) return `${bytes} B`;
        const num = (v, digits) => v.toLocaleString(locale(),
            { minimumFractionDigits: digits, maximumFractionDigits: digits });
        if (bytes < 1024 * 1024) return `${num(bytes / 1024, bytes < 10240 ? 1 : 0)} KB`;
        return `${num(bytes / 1048576, 1)} MB`;
    }
    /** The page-wide date / time format, or null without globals.js. */
    const regional = () => (window.sac && sac.regional ? sac.regional.get() : null);
    const pad2 = (n) => String(n).padStart(2, "0");

    /** "14:05" / "02:05 PM" — the hour cycle's clock, as sac-time-field shows it. */
    function formatTime(d, reg) {
        const h = d.getHours();
        const m = pad2(d.getMinutes());
        if (reg.hourCycle !== "h12") return `${pad2(h)}:${m}`;
        return `${pad2(h % 12 || 12)}:${m} ${h >= 12 ? t("time-field.pm", "PM") : t("time-field.am", "AM")}`;
    }
    /** The day in the regional order, as sac-date-field shows it. */
    function formatDay(d, reg) {
        const y = d.getFullYear();
        const mo = pad2(d.getMonth() + 1);
        const dd = pad2(d.getDate());
        switch (reg.date) {
            case "dmy.": return `${dd}.${mo}.${y}`;
            case "dmy/": return `${dd}/${mo}/${y}`;
            case "mdy/": return `${mo}/${dd}/${y}`;
            default:     return `${y}-${mo}-${dd}`;
        }
    }
    /** Today's files show the time, older ones the day. `full` = both. */
    function formatDate(ms, full) {
        if (!ms) return "";
        const d = new Date(ms);
        const today = new Date();
        const sameDay = d.toDateString() === today.toDateString();
        const reg = regional();
        if (reg) {
            if (full) return `${formatDay(d, reg)} ${formatTime(d, reg)}`;
            return sameDay ? formatTime(d, reg) : formatDay(d, reg);
        }
        if (full) return d.toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
        return sameDay
            ? d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })
            : d.toLocaleDateString(locale(), { year: "numeric", month: "short", day: "numeric" });
    }
    const typeLabel = (r) => r.kind === "folder"
        ? t("files.type-folder", "Folder")
        : (extOf(r.name).toUpperCase() || t("files.type-file", "File"));

    /** One folder level from list() + stat() — for a store without
     *  entries() when sac.fs (and its ops) is not loaded. */
    async function foldList(store, prefix) {
        const folders = new Set();
        const names = [];
        for (const key of await store.list(prefix)) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length);
            if (!rest) continue;
            const cut = rest.indexOf("/");
            if (cut >= 0) folders.add(prefix + rest.slice(0, cut));
            else if (rest !== MARKER) names.push(key);
        }
        const files = await Promise.all(names.map(async (p) => {
            try { return await store.stat(p); } catch (err) { return null; }
        }));
        return { folders: Array.from(folders), files };
    }

    class SacFileBrowser extends HTMLElement {
        static get observedAttributes() {
            return ["accept", "root-label", "readonly", "multiple", "sort", "sort-dir", "columns", "header", "no-thumbnails", "delete-button", "show-hidden", "parent-row"];
        }

        constructor() {
            super();
            this.attachShadow({ mode: "open" });
            this._store = null;
            this._path = "";
            this._rows = [];          // [{ kind: "folder"|"file", path, name, stat }]
            this._index = new Map();  // path → row index
            this._sel = new Set();    // the file the user last clicked / arrowed onto
            this._marks = new Set();  // marked paths, folders included (`multiple`)
            this._base = null;        // the marks a Shift range adds to
            this._focus = 0;          // index of the keyboard row (the cursor)
            this._anchor = null;      // shift-range anchor
            this._lastCursor = null;  // the cursor path sac:cursor last reported
            this._pendingCursor = null; // a path the cursor lands on after the next load
            this._els = new Map();    // path → live row element (the rendered window)
            this._renaming = null;    // { path, el, cancel } while a rename field is open
            this._thumbs = new Map(); // path → thumbnail src, null = none
            this._urls = [];          // thumbnail object URLs to revoke
            this._queue = [];         // thumbnail paths waiting
            this._jobs = 0;
            this._raf = 0;
            this._loadToken = 0;
            this._selecting = false;  // mark mode (touch)
            this._press = null;       // { id, x0, y0, path, el, timer } while a touch hold is pending
            this._eatClick = false;   // the click that ends a long-press is not a tap
            this._lastPointer = "";   // pointerType of the last press on the list ("touch" taps open)
            this._loading = false;    // a slow listing is under way (aria-busy, "Loading…")
            this._failed = false;     // the last listing failed ("Couldn't open this folder")
            this._shownPath = null;   // the folder whose rows are on screen
            this._slowTimer = 0;
            this._msgSeq = 0;         // ids for name-field messages
        }

        connectedCallback() {
            if (!this.shadowRoot.firstChild) this._render();
            this._wireContext();
            if (this._store) this.refresh();
            if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
            // Page-wide date / time format switch: the date column repaints in place.
            if (window.sac && sac.regional && !this._offRegional) this._offRegional = sac.regional.onChange(() => this._relabel());
            if (!this._ro && window.ResizeObserver) {
                const list = this.shadowRoot.querySelector(".list");
                this._ro = new ResizeObserver(() => { this._gutter(); this._renderWindow(false); });
                this._ro.observe(list);
            }
        }
        disconnectedCallback() {
            if (this._ctx) { this._ctx.destroy(); this._ctx = null; }
            this._revoke();
            if (this._offLang) { this._offLang(); this._offLang = null; }
            if (this._offRegional) { this._offRegional(); this._offRegional = null; }
            if (this._ro) { this._ro.disconnect(); this._ro = null; }
            clearTimeout(this._slowTimer);
            this._pressEnd();
        }

        /** Runtime language switch: chrome labels in place, then crumbs, the
         *  header and rows repainted from the component's own state (folder,
         *  cursor, marks) — no reload. Scroll and an open name field survive. */
        _relabel() {
            const sr = this.shadowRoot;
            if (!sr.firstChild) return;
            const label = (sel, text, title) => {
                const el = sr.querySelector(sel);
                if (!el) return;
                el.setAttribute("aria-label", text);
                if (title) el.setAttribute("title", text);
            };
            label(".up", t("files.up", "Up one folder"), true);
            label(".mk", t("files.new-folder", "New folder"), true);
            label(".crumbs", t("files.location", "Location"));
            label(".list", t("files.list", "Files"));
            const done = sr.querySelector(".done");
            if (done) done.textContent = t("files.select-done", "Done");
            const selBtn = sr.querySelector(".bar .sel");
            if (selBtn) selBtn.textContent = t("files.select", "Select");
            for (const m of sr.querySelectorAll(".field-msg")) m.textContent = t(m.dataset.key, m._fallback);
            this._count();
            this._crumbs();
            this._head();
            const list = sr.querySelector(".list");
            const scroll = list.scrollTop;
            const pending = list.querySelector(".new-folder input");
            if (pending) {
                const name = t("files.new-folder-name", "Folder name");
                pending.setAttribute("aria-label", name);
                pending.setAttribute("placeholder", name);
            }
            const field = this._renaming && this._renaming.el.querySelector("input.rename");
            if (field) field.setAttribute("aria-label", t("files.rename-label", "New name"));
            this._paint();
            list.scrollTop = scroll;
        }
        attributeChangedCallback(name, old, value) {
            if (!this.shadowRoot.firstChild || old === value) return;
            switch (name) {
                case "sort":
                case "sort-dir":
                    this._head();
                    this._resort();
                    break;
                case "columns":
                case "header":
                case "no-thumbnails":
                    this._head();
                    this._paint();
                    break;
                case "multiple":
                    if (value == null) { this._marks.clear(); this._mode(false); }
                    this._multiAttr();
                    this._paint();
                    break;
                case "delete-button":
                    this._head();
                    this._paint();
                    break;
                default:                         // accept, root-label, readonly, show-hidden, parent-row
                    this._crumbs();
                    this._head();
                    if (this._store) this.refresh(); else this._paint();
            }
        }

        get showHidden() { return this.hasAttribute("show-hidden"); }
        set showHidden(v) { this.toggleAttribute("show-hidden", !!v); }

        get store() { return this._store; }
        set store(handle) {
            this._store = handle || null;
            this._path = "";
            this._shownPath = null;   // the rows on screen belong to the old store
            this._sel.clear();
            this._marks.clear();
            this._mode(false);
            this._endRename();
            this._resetScroll();
            if (this.isConnected) this.refresh();
        }

        get path() { return this._path; }
        set path(p) { this._go(String(p || "").replace(/^\/+|\/+$/g, ""), false); }

        get selected() {
            if (this._marks.size) return this._rows.filter((r) => r.kind === "file" && this._marks.has(r.path)).map((r) => r.path);
            return Array.from(this._sel);
        }

        get marked() { return this._rows.filter((r) => this._marks.has(r.path)).map((r) => r.path); }
        set marked(paths) {
            if (!this.hasAttribute("multiple")) return;
            this._marks = new Set(Array.from(paths || [], String));
            this._base = null;
            this._anchor = null;
            this._renderWindow(false);
        }

        get cursor() { const r = this._rows[this._focus]; return r && r.kind !== "parent" ? r.path : null; }
        set cursor(p) {
            const i = this._index.get(String(p));
            if (i == null) { this._pendingCursor = p == null ? null : String(p); return; }
            this._focus = i;
            this._anchor = i;
            this._base = new Set(this._marks);
            this._lastCursor = this._rows[i].path;
            this._reveal(i);
        }

        get items() {
            return this._rows.filter((r) => r.kind !== "parent")
                .map((r) => ({ kind: r.kind, path: r.path, name: r.name, stat: r.stat || null }));
        }

        get selecting() { return this._selecting; }
        set selecting(on) {
            on = !!on && this.hasAttribute("multiple");
            if (on === this._selecting) return;
            if (!on) { this._marks.clear(); this._base = null; this._anchor = null; }
            this._mode(on);
            this._renderWindow(false);
        }

        /** Keyboard focus into the list (the cursor row stays), or into an
         *  open rename / new-folder field. */
        focus(options) {
            if (!this.shadowRoot.firstChild) this._render();
            const sr = this.shadowRoot;
            const field = sr.querySelector(".list input.rename");
            if (field) { field.focus(options); return; }
            sr.querySelector(".list").focus(options);
            if (this._rows[this._focus]) this._reveal(this._focus);
        }

        /** Mark mode on/off: the bar, the check boxes. The state only — the
         *  caller clears marks and reports (sac:selecting) as it needs. */
        _mode(on) {
            this._selecting = !!on;
            const sr = this.shadowRoot;
            for (const el of sr.querySelectorAll(".bar, .head, .list")) el.classList.toggle("selecting", this._selecting);
            this._count();
        }

        /** Leave / enter mark mode after a user gesture, and say so. */
        _userMode(on) {
            if (!!on === this._selecting) return;
            this._mode(on);
            this._emit("sac:selecting", { selecting: this._selecting });
        }

        /** "{n} selected" in the mark-mode bar. */
        _count() {
            const el = this.shadowRoot.querySelector(".count");
            if (el) el.textContent = t("files.selected-count", "{n} selected").replace("{n}", this._marks.size);
        }

        select(path) {
            this._sel = new Set(path ? [path] : []);
            this._marks.clear();
            const i = this._index.get(path);
            if (i != null) { this._focus = i; this._anchor = i; this._reveal(i); }
            else this._renderWindow(false);
        }

        up() {
            if (!this._path) return;
            const cut = this._path.lastIndexOf("/");
            this._go(cut < 0 ? "" : this._path.slice(0, cut), true, this._path);
        }

        newFolder() {
            const list = this.shadowRoot.querySelector(".list");
            if (list.querySelector(".new-folder")) return;
            const row = document.createElement("div");
            row.className = "row new-folder";
            row.innerHTML = `<span class="box">${icon("folder")}</span>
                <input class="rename" type="text" spellcheck="false"
                       aria-label="${esc(t("files.new-folder-name", "Folder name"))}"
                       placeholder="${esc(t("files.new-folder-name", "Folder name"))}">`;
            list.insertBefore(row, list.querySelector(".canvas"));
            list.scrollTop = 0;
            this._renderWindow(false);
            const input = row.querySelector("input");
            input.focus();
            let settled = false;
            let pending = false;      // the folder is being written
            const close = () => { settled = true; row.remove(); this._paint(); };
            // The field closes only when the folder exists (or on Escape /
            // an empty name). A dot name or a failed write keeps it open,
            // the typed name in it, with the reason under it.
            const done = async (commit) => {
                if (settled || pending) return;
                const name = input.value.trim().replace(/[\\/]+/g, "-");
                if (!commit || !name || !this._store) { close(); return; }
                if (name.startsWith(".")) {
                    this._fieldMsg(input, "files.rename-dot", "A name cannot start with a dot.");
                    return;
                }
                const path = this._path ? `${this._path}/${name}` : name;
                pending = true;
                input.readOnly = true;
                try { await this._store.write(`${path}/${MARKER}`, {}); }
                catch (err) {
                    console.error("[sac-file-browser] could not create the folder:", err);
                    pending = false;
                    input.readOnly = false;
                    if (row.isConnected) {
                        this._fieldMsg(input, "files.new-folder-failed",
                            "Couldn't create this folder. Try again, or pick another name.");
                    }
                    return;
                }
                pending = false;
                if (!row.isConnected) return;   // the folder changed meanwhile
                close();
                this._go(path, true);
            };
            input.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); done(true); }
                if (e.key === "Escape") { e.preventDefault(); if (!pending) close(); }
            });
            input.addEventListener("input", () => this._fieldMsg(input, null));
            input.addEventListener("blur", () => { if (row.isConnected) done(!!input.value.trim()); });
        }

        /** A name field's problem: aria-invalid, and a visible note under the
         *  field (role="alert", so it is also spoken) that the field points
         *  at. `key` null clears it. The note follows a language switch. */
        _fieldMsg(input, key, fallback) {
            let msg = input._msg;
            if (key == null) {
                input.removeAttribute("aria-invalid");
                input.removeAttribute("aria-describedby");
                if (msg) { msg.remove(); input._msg = null; }
                return;
            }
            if (!msg) {
                msg = input._msg = document.createElement("span");
                msg.className = "field-msg";
                msg.id = `fm${++this._msgSeq}`;
                msg.setAttribute("role", "alert");
                input.after(msg);
            }
            msg.dataset.key = key;
            msg._fallback = fallback;
            msg.textContent = t(key, fallback);
            input.setAttribute("aria-invalid", "true");
            input.setAttribute("aria-describedby", msg.id);
        }

        rename(path) {
            if (this.hasAttribute("readonly") || !this._store) return false;
            const i = path == null ? this._focus : this._index.get(String(path));
            const r = i == null ? null : this._rows[i];
            if (!r || r.kind === "parent") return false;
            if (this._renaming) {
                if (this._renaming.path === r.path) { this._renaming.el.querySelector("input.rename")?.focus(); return true; }
                this._renaming.cancel();
            }
            this._focus = i;
            this._reveal(i);
            const el = this._els.get(r.path);
            if (!el) return false;
            const list = this.shadowRoot.querySelector(".list");
            const nameEl = el.querySelector(".name");
            const input = document.createElement("input");
            input.className = "rename";
            input.type = "text";
            input.spellcheck = false;
            input.value = r.name;
            input.setAttribute("aria-label", t("files.rename-label", "New name"));
            nameEl.hidden = true;
            nameEl.after(input);
            el.draggable = false;
            el.classList.add("renaming");
            input.focus();
            const dot = r.kind === "file" ? r.name.lastIndexOf(".") : -1;
            input.setSelectionRange(0, dot > 0 ? dot : r.name.length);

            let settled = false;
            let pending = false;      // the rename is being carried out
            const close = () => {
                settled = true;
                this._fieldMsg(input, null);
                input.remove();
                nameEl.hidden = false;
                el.draggable = true;
                el.classList.remove("renaming");
                if (this._renaming && this._renaming.el === el) this._renaming = null;
            };
            const refuse = (how, key, fallback) => {
                if (how === "blur") { close(); return; }
                this._fieldMsg(input, key, fallback);
            };
            const done = async (how) => {
                if (settled || pending) return;
                const name = input.value.trim().replace(/[\\/]+/g, "-");
                if (!how || !name || name === r.name) { close(); if (how !== "blur") list.focus({ preventScroll: true }); return; }
                if (name.startsWith(".")) return refuse(how, "files.rename-dot", "A name cannot start with a dot.");
                const dir = dirName(r.path);
                const to = dir ? `${dir}/${name}` : name;
                if (this._index.has(to)) return refuse(how, "files.rename-taken", "That name is already taken here.");
                // Carried out with the field still up: it closes once the
                // rename landed (or the host took it over); a failure keeps
                // it open, the typed name in it, the reason under it.
                pending = true;
                input.readOnly = true;
                const landed = () => { close(); if (how !== "blur") list.focus({ preventScroll: true }); };
                const ok = await this._doRename(r, to, landed);
                pending = false;
                if (ok !== false || settled) return;
                input.readOnly = false;
                this._fieldMsg(input, "files.rename-failed", "Couldn't rename this. Try again, or pick another name.");
                if (how !== "blur") input.focus();
            };
            input.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); done("enter"); }
                if (e.key === "Escape") { e.preventDefault(); if (!pending) done(null); }
            });
            input.addEventListener("input", () => this._fieldMsg(input, null));
            input.addEventListener("blur", () => { if (input.isConnected) done("blur"); });
            this._renaming = { path: r.path, el, cancel: close };
            return true;
        }

        /** Carry a rename out. `landed()` runs the moment it is done (or the
         *  host took it over), before the reload. → true (landed), null (the
         *  host's — sac:request-rename was cancelled), false (it failed: the
         *  caller keeps the field open). */
        async _doRename(r, to, landed) {
            const from = r.path;
            const detail = { from, to, folder: r.kind === "folder" };
            if (!this._emit("sac:request-rename", detail, true)) { if (landed) landed(); return null; }
            const store = this._store;
            try {
                const o = ops();
                if (o && o.rename) await o.rename(store, from, baseName(to));
                else if (typeof store.rename === "function") await store.rename(from, baseName(to));
                else if (typeof store.move === "function") await store.move(from, to);
                else {
                    // The required five only: copy every key over, then drop the old ones.
                    if (from.toLowerCase() !== to.toLowerCase()
                        && ((await store.stat(to)) || (await store.list(to + "/")).length)) {
                        throw new Error(`"${to}" already exists`);
                    }
                    const keys = detail.folder ? await store.list(from + "/") : [from];
                    for (const k of keys) await store.write(to + k.slice(from.length), await store.read(k, null));
                    for (const k of keys) await store.remove(k);
                }
            } catch (err) {
                console.error("[sac-file-browser] rename failed:", err);
                return false;
            }
            if (landed) landed();
            for (const set of [this._marks, this._sel]) {
                if (set.has(from)) { set.delete(from); set.add(to); }
            }
            this._pendingCursor = to;
            this._emit("sac:rename", detail);
            await this.refresh();
            return true;
        }

        /* ------------------------------------------------------ loading -- */

        async refresh() {
            if (!this.shadowRoot.firstChild) this._render();
            const store = this._store;
            this._crumbs();
            if (!store) { this._failed = false; this._setBusy(false); this._setRows([]); this._paint(); return; }
            const token = ++this._loadToken;
            const prefix = this._path ? this._path + "/" : "";
            // A slow load says so — after SLOW_MS, never for a quick one (no
            // flash). Rows of the folder in view stay meanwhile; rows of the
            // folder just left (or a failure being retried) make way for it.
            clearTimeout(this._slowTimer);
            this._slowTimer = setTimeout(() => {
                if (token !== this._loadToken) return;
                this._setBusy(true);
                if (this._shownPath !== this._path || this._failed) {
                    this._failed = false;
                    this._setRows([]);
                    this._paint();
                }
            }, SLOW_MS);
            let listing;
            let failed = false;
            try { listing = await this._load(store, prefix); }
            catch (err) {
                // Not "empty": a failed listing shows itself as one, with Try again.
                console.error("[sac-file-browser] listing failed:", err);
                listing = { folders: [], files: [] };
                failed = true;
            }
            if (token !== this._loadToken) return;       // a newer load won
            clearTimeout(this._slowTimer);
            this._setBusy(false);
            this._failed = failed;
            this._shownPath = this._path;
            // The cursor row as it is NOW, after the load — read before the
            // await it lost a click, tap or arrow made meanwhile. A cursor
            // asked for meanwhile (up(), rename, the setter) wins over it.
            const r0 = this._rows[this._focus];
            const keep = this._pendingCursor != null ? this._pendingCursor : (r0 ? r0.path : null);
            this._pendingCursor = null;
            const ok = acceptTest(this.getAttribute("accept"));
            // Dot entries stay out unless show-hidden asks for them.
            const shown = this.hasAttribute("show-hidden") ? () => true : (name) => !name.startsWith(".");
            const seen = new Set();
            const folders = [];
            for (let f of listing.folders || []) {
                f = String(f).replace(/\/+$/, "");
                if (!f) continue;
                if (prefix && !f.startsWith(prefix)) f = prefix + f;   // a store that answered with names
                if (seen.has(f) || !shown(baseName(f))) continue;
                seen.add(f);
                folders.push({ kind: "folder", name: baseName(f), path: f, stat: null });
            }
            const files = (listing.files || [])
                .filter((s) => s && s.path && baseName(s.path) !== MARKER)
                .map((s) => ({ kind: "file", name: s.name || baseName(s.path), path: s.path, stat: s }))
                .filter((r) => shown(r.name) && ok({ name: r.name, type: r.stat.type }));
            this._setRows(this._withParent(this._sorted(folders, files)));
            const hadMarks = this._marks.size > 0;
            for (const set of [this._sel, this._marks]) {
                for (const p of Array.from(set)) if (!this._index.has(p)) set.delete(p);
            }
            // The marked rows went away (deleted, moved by the host): mark mode ends with them.
            if (this._selecting && hadMarks && !this._marks.size) this._userMode(false);
            const i = keep != null ? this._index.get(keep) : undefined;
            this._focus = i != null ? i : Math.min(this._focus, Math.max(0, this._rows.length - 1));
            if (this._anchor != null && this._anchor >= this._rows.length) this._anchor = null;
            this._revoke();
            this._paint();
            if (i != null) this._reveal(i);
            this._emitCursor();
        }

        /** Loading (a slow one): aria-busy on the list, and the "Loading…"
         *  state when there are no rows to show meanwhile (_paint). */
        _setBusy(on) {
            on = !!on;
            if (on === !!this._loading) return;
            this._loading = on;
            const list = this.shadowRoot.querySelector(".list");
            if (!list) return;
            if (on) list.setAttribute("aria-busy", "true");
            else list.removeAttribute("aria-busy");
        }

        /** { folders, files: stat[] } for one level — entries() when the
         *  store (or sac.fs.ops) offers it, else list() + stat(). */
        async _load(store, prefix) {
            const o = ops();
            if (o && typeof o.entries === "function") return o.entries(store, prefix);
            if (typeof store.entries === "function") return store.entries(prefix);
            return foldList(store, prefix);
        }

        /** parent-row: the ".." row first, below the root only. */
        _withParent(rows) {
            if (!this._path || !this.hasAttribute("parent-row")) return rows;
            return [{ kind: "parent", name: "..", path: PARENT, target: dirName(this._path), stat: null }, ...rows];
        }

        _setRows(rows) {
            this._rows = rows;
            this._index = new Map(rows.map((r, i) => [r.path, i]));
        }

        _sortState() {
            let key = (this.getAttribute("sort") || "name").trim().toLowerCase();
            if (key === "modified") key = "date";
            if (!SORTS.includes(key)) key = "name";
            return { key, desc: (this.getAttribute("sort-dir") || "").trim().toLowerCase() === "desc" };
        }

        _sorted(folders, files) {
            const { key, desc } = this._sortState();
            const byName = (a, b) => collator.compare(a.name, b.name);
            folders.sort(byName);
            if (key === "name" && desc) folders.reverse();
            const val = {
                size: (r) => r.stat.size || 0,
                date: (r) => r.stat.modified || 0,
            };
            files.sort((a, b) => {
                let d = 0;
                if (key === "type") d = collator.compare(extOf(a.name), extOf(b.name));
                else if (val[key]) d = val[key](a) - val[key](b);
                if (!d) d = byName(a, b);
                return desc ? -d : d;
            });
            return [...folders, ...files];
        }

        _resort() {
            const cur = this.cursor;
            this._setRows(this._withParent(this._sorted(
                this._rows.filter((r) => r.kind === "folder"),
                this._rows.filter((r) => r.kind === "file"))));
            const i = cur != null ? this._index.get(cur) : undefined;
            this._focus = i != null ? i : 0;
            this._anchor = null;
            this._paint();
            if (this._rows.length) this._reveal(this._focus);
        }

        _go(path, user, cursorTo = null) {
            if (path === this._path && !user) return;
            const hadMarks = this._marks.size > 0;
            const wasSelecting = this._selecting;
            this._endRename();
            this._path = path;
            this._sel.clear();
            this._marks.clear();
            this._base = null;
            this._focus = 0;
            this._anchor = null;
            this._pendingCursor = cursorTo;
            this._mode(false);
            this._resetScroll();
            this.refresh();
            if (user && hadMarks) this._emit("sac:mark", { paths: [] });
            // Mark mode ends with any folder change — the host's bar must hear it.
            if (wasSelecting) this._emit("sac:selecting", { selecting: false });
            if (user) this._emit("sac:navigate", { path });
        }

        _resetScroll() {
            const list = this.shadowRoot.querySelector(".list");
            if (list) list.scrollTop = 0;
        }

        _endRename() {
            if (this._renaming) this._renaming.cancel();
        }

        /* ---------------------------------------------------- rendering -- */

        _render() {
            this.shadowRoot.innerHTML = `
                <style>
                    :host {
                        display: flex;
                        flex-direction: column;
                        min-width: 0;
                        min-height: 0;
                        container-type: inline-size;
                        color: var(--text);
                        font-size: 0.85rem;
                        --row-h: 36px;
                        --del-w: 28px;
                    }
                    :host([hidden]) { display: none; }
                    /* The gap below is a margin, so --file-browser-bar-height
                       is the strip itself (a floor: 44px touch targets never clip). */
                    .bar {
                        flex: none;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        box-sizing: border-box;
                        min-height: var(--file-browser-bar-height, 0px);
                        margin-bottom: 8px;
                        min-width: 0;
                    }
                    /* active: "has the keys" shows in the bar only — a 1px
                       hairline under it, --accent on the active pane, and a
                       quieter bar on the other one. */
                    :host([active]) .bar {
                        border-bottom: 1px solid var(--border);
                        margin-bottom: 4px;
                    }
                    :host([active]:not([active="false"]):not([active="auto"])) .bar,
                    :host([active="auto"]:focus-within) .bar { border-bottom-color: var(--accent); }
                    :host([active="false"]) .bar :is(.tool, .crumbs, .count),
                    :host([active="false"]) ::slotted([slot="title"]),
                    :host([active="auto"]:not(:focus-within)) .bar :is(.tool, .crumbs, .count),
                    :host([active="auto"]:not(:focus-within)) ::slotted([slot="title"]) { opacity: 0.6; }
                    ::slotted([slot="title"]) { flex: 0 1 auto; min-width: 0; }
                    .crumbs {
                        flex: 1;
                        min-width: 0;
                        display: flex;
                        align-items: center;
                        gap: 2px;
                        overflow: hidden;
                        white-space: nowrap;
                    }
                    .crumb {
                        font: inherit;
                        font-weight: 600;
                        background: none;
                        border: 0;
                        color: var(--text-muted);
                        padding: 4px 6px;
                        border-radius: var(--radius-m);
                        cursor: pointer;
                        min-width: 0;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        flex-shrink: 1;
                    }
                    .crumb:hover { background: var(--hover); color: var(--text); }
                    .crumb[aria-current] { color: var(--text); cursor: default; background: none; }
                    /* Press: answers the moment it goes down. */
                    .crumb:active:not([aria-current]) { background: var(--hover-strong); transition-duration: 0s; }
                    .crumb:focus-visible, .tool:focus-visible, .del:focus-visible, .hcol:focus-visible {
                        outline: 2px solid var(--accent); outline-offset: -2px;
                    }
                    .sep { color: var(--text-dim); flex: none; }
                    .tool, .del {
                        --icon-size: 16px;
                        flex: none;
                        display: grid;
                        place-items: center;
                        width: 28px;
                        height: 28px;
                        padding: 0;
                        border: 0;
                        border-radius: var(--radius-m);
                        background: none;
                        color: var(--text-muted);
                        cursor: pointer;
                    }
                    .tool svg, .del svg { width: 16px; height: 16px; }
                    /* parent-row: ".." is the one way up, so the Up button
                       goes; the current folder's icon stands in its place,
                       exactly over the rows' icon column (list border + pad +
                       row inset), its name over theirs. */
                    .here { display: none; }
                    :host([parent-row]) .up { display: none; }
                    :host([parent-row]) .here {
                        flex: none;
                        display: grid;
                        place-items: center;
                        width: 28px;
                        height: 28px;
                        margin-left: ${PAD + 7}px;
                        margin-right: calc(0.6rem - 10px);
                        color: var(--accent-text);
                    }
                    .here svg { width: 18px; height: 18px; }
                    .tool:hover:not(:disabled) { background: var(--hover); color: var(--text); }
                    .tool:active:not(:disabled) { background: var(--hover-strong); transition-duration: 0s; }
                    .tool:disabled { opacity: 0.35; cursor: default; }

                    /* Column header — outside the listbox, aligned with the
                       rows: border + padding + the row's own inset, and the
                       list's scrollbar gutter on the right. */
                    .head {
                        flex: none;
                        display: flex;
                        align-items: center;
                        gap: 0.6rem;
                        min-width: 0;
                        padding: 0 calc(${PAD + 5}px + var(--sbw, 0px)) 4px ${PAD + 7}px;
                    }
                    .head[hidden] { display: none; }
                    .head .box { height: auto; }
                    .hcol {
                        font: inherit;
                        font-size: 0.75rem;
                        font-weight: 600;
                        color: var(--text-dim);
                        background: none;
                        border: 0;
                        border-radius: var(--radius-s);
                        padding: 2px 0;
                        min-height: 24px;
                        display: flex;
                        align-items: center;
                        justify-content: flex-end;
                        gap: 2px;
                        cursor: pointer;
                        white-space: nowrap;
                        overflow: hidden;
                    }
                    .hcol.name, .hcol.type { justify-content: flex-start; }
                    .hcol:hover, .hcol[aria-pressed="true"] { color: var(--text); }
                    .hcol:active { background: var(--hover-strong); transition-duration: 0s; }
                    .hcol svg { flex: none; width: 12px; height: 12px; }
                    .del-sp { flex: none; width: var(--del-w); }

                    .list {
                        position: relative;
                        flex: 1;
                        min-height: 120px;
                        overflow-y: auto;
                        overscroll-behavior-y: contain;
                        display: flex;
                        flex-direction: column;
                        gap: ${GAP}px;
                        padding: ${PAD}px;
                        border: 1px solid var(--border);
                        border-radius: var(--radius-m);
                        background: var(--field);
                        outline: none;
                    }
                    /* Scrollbar — the kit recipe (ui.css §5), re-stated because
                       ::-webkit-scrollbar does not pierce a shadow root. Firefox, which has
                       no ::-webkit-scrollbar, gets the standard pair instead. */
                    .list::-webkit-scrollbar { width: var(--scrollbar-size); height: var(--scrollbar-size); }
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
                    .list::-webkit-scrollbar-corner { background: transparent; }
                    @supports not selector(::-webkit-scrollbar) {
                        .list { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) transparent; }
                    }
                    .list:focus-visible { border-color: var(--accent); }
                    .list.drop {
                        border-color: var(--accent);
                        background: color-mix(in srgb, var(--accent) 6%, var(--field));
                    }
                    .canvas { position: relative; flex: none; }
                    .row {
                        box-sizing: border-box;
                        display: flex;
                        align-items: center;
                        gap: 0.6rem;
                        padding: 4px 4px 4px 6px;
                        min-height: var(--row-h);
                        border-radius: var(--radius-m);
                        color: var(--text-muted);
                        cursor: pointer;
                        user-select: none;
                    }
                    .canvas > .row {
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        height: var(--row-h);
                    }
                    .row:hover { background: var(--hover); color: var(--text); }
                    .row:active:not(.sel) { background: var(--hover-strong); transition-duration: 0s; }
                    .row.sel { background: var(--accent-tint); color: var(--accent-text); }
                    .row.drop { background: var(--accent-tint); color: var(--accent-text); }
                    .list:focus-visible .row.focus { box-shadow: inset 0 0 0 2px var(--accent); }
                    .box {
                        flex: none;
                        width: 28px;
                        height: 28px;
                        display: grid;
                        place-items: center;
                        border-radius: var(--radius-s);
                        overflow: hidden;
                    }
                    .box svg { width: 18px; height: 18px; }
                    .row[data-kind="folder"] .box,
                    .row[data-kind="parent"] .box { color: var(--accent-text); }
                    .list.selecting .row[data-kind="parent"] .check { visibility: hidden; }
                    .box img {
                        width: 100%;
                        height: 100%;
                        object-fit: contain;
                        image-rendering: auto;
                        background-color: var(--checker-a, color-mix(in srgb, var(--fg) 6%, transparent));
                        background-image: conic-gradient(
                            var(--checker-b, color-mix(in srgb, var(--fg) 12%, transparent)) 90deg,
                            transparent 90deg 180deg,
                            var(--checker-b, color-mix(in srgb, var(--fg) 12%, transparent)) 180deg 270deg,
                            transparent 270deg);
                        background-size: 6px 6px;
                    }
                    :host([pixelated]) .box img { image-rendering: pixelated; }
                    .name {
                        flex: 1;
                        min-width: 0;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                        color: inherit;
                    }
                    .name[hidden] { display: none; }
                    .row:not(.sel) .name { color: var(--text); }
                    .meta {
                        flex: none;
                        width: 5.5rem;
                        text-align: right;
                        font-size: 0.75rem;
                        color: var(--text-dim);
                        font-variant-numeric: tabular-nums;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .meta.date { width: 7rem; }
                    .meta.type { width: 4.5rem; text-align: left; }
                    /* delete-button: "cursor" (default) = hovered + cursor
                       row; "hover" = a hovering pointer's row only, and not
                       while other rows are marked (data-marks). */
                    .del { opacity: 0; }
                    :host(:not([delete-button="hover"])) :is(.row:hover, .row.focus) .del,
                    .del:focus-visible { opacity: 1; }
                    @media (hover: hover) {
                        :host([delete-button="hover"]) .row:hover .del { opacity: 1; }
                    }
                    :host([delete-button="hover"]) .list[data-marks="many"] .del,
                    :host([delete-button="hover"]) .list[data-marks="one"] .row:not(.mark) .del,
                    .list.selecting .del { visibility: hidden; }
                    .del:hover { color: var(--danger-text); background: var(--hover); }
                    .del:active { background: var(--hover-strong); transition-duration: 0s; }

                    /* Mark mode: a check box per row, the bar shows the count. */
                    .check, .check-sp { display: none; flex: none; width: 20px; }
                    .list.selecting .check {
                        display: grid;
                        place-items: center;
                        height: 20px;
                        box-sizing: border-box;
                        border: 1px solid var(--border-strong);
                        border-radius: var(--radius-s);
                        color: var(--on-accent);
                    }
                    .check svg { width: 14px; height: 14px; visibility: hidden; }
                    .list.selecting .row.mark .check { background: var(--accent); border-color: var(--accent); }
                    .row.mark .check svg { visibility: visible; }
                    .head.selecting .check-sp { display: block; }
                    .row { -webkit-touch-callout: none; }
                    .bar .count {
                        display: none;
                        flex: 1;
                        min-width: 0;
                        padding: 4px 6px;
                        font-weight: 600;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }
                    .bar .done {
                        display: none;
                        width: auto;
                        padding: 0 10px;
                        font: inherit;
                        font-weight: 600;
                        color: var(--accent-text);
                    }
                    .bar.selecting .count { display: block; }
                    .bar.selecting .done { display: grid; }
                    .bar.selecting :is(.up, .here, .crumbs, .mk) { display: none; }
                    :host([readonly]) .del,
                    :host([readonly]) .mk { display: none; }
                    .rename {
                        flex: 1;
                        min-width: 0;
                        font: inherit;
                        color: var(--text);
                        background: var(--field);
                        border: 1px solid var(--accent);
                        border-radius: var(--radius-s);
                        padding: 3px 6px;
                        outline: none;
                    }
                    .rename[aria-invalid="true"] { border-color: var(--danger); }
                    .empty {
                        margin: auto;
                        padding: 24px 12px;
                        text-align: center;
                        color: var(--text-dim);
                        font-size: 0.8rem;
                    }
                    .empty[hidden], .new-folder ~ .empty { display: none; }
                    /* Loading (a slow listing only): a small ring + a word. */
                    .empty.loading {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 8px;
                        color: var(--text-muted);
                    }
                    .empty.loading sac-spinner { --spinner-size: 16px; }
                    /* Failed: never mistaken for "empty" — the warning icon
                       (attention ink), the message in readable ink, and the
                       way out. */
                    .empty.failed {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 10px;
                        color: var(--text-muted);
                        font-size: 0.85rem;
                    }
                    .state-msg {
                        margin: 0;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                    }
                    .state-msg svg { flex: none; width: 16px; height: 16px; color: var(--danger-text); }
                    .retry {
                        font: inherit;
                        font-weight: 600;
                        color: var(--text);
                        background: var(--panel-2);
                        border: 1px solid var(--border-strong);
                        border-radius: var(--radius-m);
                        padding: 5px 14px;
                        cursor: pointer;
                        transition: background-color 120ms var(--ease-smooth), transform 0.1s var(--ease-smooth);
                    }
                    .retry:hover { background: var(--hover-strong); }
                    /* Press: a boxed control gives a little. */
                    .retry:active { transform: scale(0.97); }
                    .retry:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
                    /* A name field's problem (taken, a dot, a failed write):
                       a small note under the field, over the row below — the
                       field's row lifts above its neighbours to carry it. */
                    .row.renaming { z-index: 3; }
                    .row.new-folder { position: relative; z-index: 3; }
                    .field-msg {
                        position: absolute;
                        top: calc(100% + 2px);
                        left: calc(6px + 28px + 0.6rem);
                        right: 4px;
                        padding: 4px 8px;
                        background: var(--panel-2);
                        border: 1px solid var(--border-strong);
                        border-radius: var(--radius-m);
                        box-shadow: var(--shadow-1);
                        color: var(--danger-text);
                        font-size: 0.75rem;
                        line-height: 1.35;
                        white-space: normal;
                        cursor: default;
                    }
                    /* Touch: "Select" (mark mode) as a visible button, not
                       only behind a long-press. */
                    .bar .sel {
                        display: none;
                        width: auto;
                        padding: 0 10px;
                        font: inherit;
                        font-weight: 600;
                        color: var(--accent-text);
                    }

                    /* cursor-style="bar": the commander cursor. Only marks
                       are tinted; the cursor row is a solid accent bar while
                       the list has focus, a hairline frame without it. */
                    :host([cursor-style="bar"]) .row.sel:not(.mark):not(:hover) { background: none; }
                    :host([cursor-style="bar"]) .row.sel:not(.mark) .name { color: var(--text); }
                    :host([cursor-style="bar"]) .row.focus { box-shadow: inset 0 0 0 1px var(--border-strong); }
                    :host([cursor-style="bar"]) .list:focus-within .row.focus:not(.renaming) {
                        background: var(--accent);
                        color: var(--on-accent);
                        box-shadow: none;
                    }
                    :host([cursor-style="bar"]) .list:focus-within .row.focus:not(.renaming) :is(.name, .meta, .box, .del) {
                        color: var(--on-accent);
                    }
                    :host([cursor-style="bar"]) .list.selecting:focus-within .row.focus .check { border-color: var(--on-accent); }
                    :host([cursor-style="bar"]) .list.selecting:focus-within .row.focus.mark .check {
                        background: var(--on-accent);
                        color: var(--accent);
                    }

                    /* cursor-style="quiet": selection, marks and the cursor
                       are a --hover tint — no ring, no bar, no hairline. The
                       cursor shows while the browser has the keys: focus in
                       the list, or active (not "false"; "auto" = focus). */
                    :host([cursor-style="quiet"]) .row.sel { background: var(--hover); color: var(--text); }
                    :host([cursor-style="quiet"]) .row.sel .name { color: var(--text); }
                    :host([cursor-style="quiet"]) .row.focus { box-shadow: none; }
                    :host([cursor-style="quiet"]) .list:focus-within .row.focus,
                    :host([cursor-style="quiet"][active]:not([active="false"]):not([active="auto"])) .row.focus {
                        background: var(--hover);
                        color: var(--text);
                    }

                    /* flush: the list drops its own frame and ground and
                       sits flush in the host's panel (the 1px border stays,
                       transparent, so the header keeps its alignment). */
                    :host([flush]) .list {
                        border-color: transparent;
                        border-radius: 0;
                        background: none;
                    }
                    :host([flush]) .list.drop {
                        border-color: var(--accent);
                        background: color-mix(in srgb, var(--accent) 6%, transparent);
                    }

                    @container (max-width: 480px) {
                        .meta { display: none; }
                    }
                    @media (hover: none) {
                        .retry:hover { background: var(--panel-2); }
                    }
                    @media (prefers-reduced-motion: reduce) {
                        .retry { transition: none; }
                        .retry:active { transform: none; background: var(--hover-strong); }
                    }
                    @media (pointer: coarse) {
                        :host { --row-h: 44px; --del-w: 44px; }
                        .tool, .del { width: 44px; height: 44px; }
                        .bar .done { width: auto; min-width: 44px; }
                        :host([multiple]) .bar:not(.selecting) .sel { display: grid; min-width: 44px; }
                        .retry { min-height: 44px; }
                        :host(:not([delete-button="hover"])) .del { opacity: 1; }
                        .hcol { min-height: 44px; }
                        .rename { font-size: 16px; }
                    }
                </style>
                <div class="bar" part="bar">
                    <button class="tool up" type="button" part="up"
                            title="${esc(t("files.up", "Up one folder"))}"
                            aria-label="${esc(t("files.up", "Up one folder"))}">${icon("chevron-up")}</button>
                    <span class="here" part="here" aria-hidden="true">${icon("folder")}</span>
                    <slot name="title"></slot>
                    <nav class="crumbs" part="crumbs" aria-label="${esc(t("files.location", "Location"))}"></nav>
                    <span class="count" part="count" role="status"></span>
                    <button class="tool mk" type="button" part="new-folder"
                            title="${esc(t("files.new-folder", "New folder"))}"
                            aria-label="${esc(t("files.new-folder", "New folder"))}">${icon("folder-plus")}</button>
                    <button class="tool sel" type="button" part="select">${esc(t("files.select", "Select"))}</button>
                    <button class="tool done" type="button" part="done">${esc(t("files.select-done", "Done"))}</button>
                </div>
                <div class="head" part="header" hidden></div>
                <div class="list" part="list" role="listbox" tabindex="0"
                     aria-label="${esc(t("files.list", "Files"))}"><div class="canvas"></div><div class="empty" hidden></div></div>
            `;
            const sr = this.shadowRoot;
            sr.querySelector(".up").addEventListener("click", () => this.up());
            sr.querySelector(".mk").addEventListener("click", () => this.newFolder());
            sr.querySelector(".done").addEventListener("click", () => this._endMarking());
            sr.querySelector(".sel").addEventListener("click", () => {
                if (!this.hasAttribute("multiple")) return;
                this._endRename();
                this._userMode(true);
                this._renderWindow(false);
            });
            sr.querySelector(".head").addEventListener("click", (e) => this._onHead(e));
            const list = sr.querySelector(".list");
            list.addEventListener("click", (e) => this._onClick(e));
            // A held finger: the row must not turn into a native drag while
            // the long-press opens its context menu. A move past the slop (a
            // scroll) or a lift ends it; pointercancel is the scroll taking over.
            list.addEventListener("pointerdown", (e) => this._pressStart(e));
            list.addEventListener("pointermove", (e) => {
                const p = this._press;
                if (p && e.pointerId === p.id && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > PRESS_SLOP) this._pressEnd();
            });
            list.addEventListener("pointerup", () => this._pressEnd());
            list.addEventListener("pointercancel", () => this._pressEnd());
            this._wireContext();
            list.addEventListener("dblclick", (e) => {
                if (this._selecting) return;
                if (e.target.closest(".rename, .del")) return;
                // A tap already opened it — a double-tap must not open it twice.
                if (this._tapOpens()) return;
                const row = e.target.closest(".canvas > .row");
                if (row) this._activate(+row.dataset.i);
            });
            list.addEventListener("keydown", (e) => this._onKey(e));
            list.addEventListener("scroll", () => {
                if (this._raf) return;
                this._raf = requestAnimationFrame(() => { this._raf = 0; this._renderWindow(false); });
            }, { passive: true });
            list.addEventListener("dragstart", (e) => this._dragStart(e));
            list.addEventListener("dragend", () => { dragging = null; this._dropHint(null); });
            list.addEventListener("dragover", (e) => this._dragOver(e));
            list.addEventListener("drop", (e) => this._drop(e));
            this._multiAttr();
            this._head();
            this._mode(this._selecting);
        }

        _multiAttr() {
            const list = this.shadowRoot.querySelector(".list");
            if (list) list.setAttribute("aria-multiselectable", String(this.hasAttribute("multiple")));
        }

        _crumbs() {
            const nav = this.shadowRoot.querySelector(".crumbs");
            if (!nav) return;
            const segs = this._path ? this._path.split("/") : [];
            const rootLabel = this.getAttribute("root-label") || t("files.root", "Files");
            const parts = [`<button class="crumb" type="button" data-p=""${segs.length ? "" : " aria-current=\"location\""}>${esc(rootLabel)}</button>`];
            segs.forEach((s, i) => {
                const p = segs.slice(0, i + 1).join("/");
                parts.push(`<span class="sep" aria-hidden="true">/</span>`);
                parts.push(`<button class="crumb" type="button" data-p="${esc(p)}"${i === segs.length - 1 ? " aria-current=\"location\"" : ""}>${esc(s)}</button>`);
            });
            nav.innerHTML = parts.join("");
            nav.querySelectorAll(".crumb").forEach((b) => b.addEventListener("click", () => {
                if (!b.hasAttribute("aria-current")) this._go(b.dataset.p, true);
            }));
            this.shadowRoot.querySelector(".up").disabled = !this._path;
        }

        /** The meta columns, in order. */
        _cols() {
            const attr = this.getAttribute("columns");
            if (attr == null) return ["size", "date"];
            return Array.from(new Set(attr.toLowerCase().split(/[\s,]+/).filter((c) => META.includes(c))));
        }

        _colLabel(c) {
            return c === "name" ? t("files.col-name", "Name")
                : c === "type" ? t("files.col-type", "Type")
                : c === "size" ? t("files.col-size", "Size")
                : t("files.col-modified", "Modified");
        }

        _head() {
            const head = this.shadowRoot.querySelector(".head");
            if (!head) return;
            head.hidden = !this.hasAttribute("header");
            if (head.hidden) { head.innerHTML = ""; return; }
            const { key, desc } = this._sortState();
            const col = (c) => {
                const label = this._colLabel(c);
                const on = c === key;
                return `<button class="hcol ${c === "name" ? "name" : `meta ${c}`}" type="button" data-sort="${c}"
                                aria-pressed="${on}"
                                title="${esc(t("files.sort-by", "Sort by {column}").replace("{column}", label))}"><span>${esc(label)}</span>${on ? icon(desc ? "chevron-down" : "chevron-up") : ""}</button>`;
            };
            head.innerHTML = `<span class="check-sp" aria-hidden="true"></span><span class="box" aria-hidden="true"></span>${col("name")}${this._cols().map(col).join("")}`
                + (this._hasDel() ? `<span class="del-sp" aria-hidden="true"></span>` : "");
            this._gutter();
        }

        /** Rows carry a trash button: not readonly, not delete-button="none". */
        _hasDel() {
            return !this.hasAttribute("readonly") && (this.getAttribute("delete-button") || "").trim().toLowerCase() !== "none";
        }

        /** The header's right inset follows the list's scrollbar width. */
        _gutter() {
            const list = this.shadowRoot.querySelector(".list");
            const head = this.shadowRoot.querySelector(".head");
            if (!list || !head || head.hidden) return;
            head.style.setProperty("--sbw", `${Math.max(0, list.offsetWidth - list.clientWidth - 2)}px`);
        }

        _onHead(e) {
            const b = e.target.closest(".hcol");
            if (!b) return;
            const k = b.dataset.sort;
            const { key, desc } = this._sortState();
            const d = k === key ? !desc : false;
            this.setAttribute("sort", k);
            if (d) this.setAttribute("sort-dir", "desc"); else this.removeAttribute("sort-dir");
            this._emit("sac:sort", { key: k, dir: d ? "desc" : "asc" });
        }

        /** Row pitch in px: the row height plus the gap. */
        _pitch() {
            const coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches;
            return (coarse ? 44 : 36) + GAP;
        }

        /** The rows changed (a load, a sort, a language switch, columns):
         *  size the canvas and rebuild the rendered window. */
        _paint() {
            const sr = this.shadowRoot;
            const list = sr.querySelector(".list");
            if (!list) return;
            const n = this._rows.length;
            sr.querySelector(".canvas").style.height = n ? `${n * this._pitch() - GAP}px` : "0px";
            const empty = sr.querySelector(".empty");
            empty.hidden = n > 0;
            if (!n) this._paintState(empty);
            if (this._renaming && !this._index.has(this._renaming.path)) this._renaming.cancel();
            this._renderWindow(true);
        }

        /** What the list says when it has no rows — three states that must
         *  never look alike: the listing FAILED ("Couldn't open this folder"
         *  + Try again), it is still LOADING (a slow load only), or the
         *  folder is EMPTY. All text via textContent. */
        _paintState(box) {
            const sr = this.shadowRoot;
            const hadFocus = sr.activeElement && box.contains(sr.activeElement);
            box.className = "empty";
            box.textContent = "";
            if (this._failed) {
                box.classList.add("failed");
                const msg = document.createElement("p");
                msg.className = "state-msg";
                msg.setAttribute("role", "alert");
                msg.innerHTML = icon("warn");
                msg.append(t("files.load-failed", "Couldn't open this folder."));
                const retry = document.createElement("button");
                retry.type = "button";
                retry.className = "retry";
                retry.setAttribute("part", "retry");
                retry.textContent = t("files.retry", "Try again");
                // Its own keys: Enter / Space press it, never the list's.
                retry.addEventListener("keydown", (e) => e.stopPropagation());
                retry.addEventListener("click", (e) => {
                    e.stopPropagation();
                    sr.querySelector(".list").focus({ preventScroll: true });
                    this.refresh();
                });
                box.append(msg, retry);
                if (hadFocus) retry.focus({ preventScroll: true });
            } else if (this._loading) {
                box.classList.add("loading");
                const spin = document.createElement("sac-spinner");
                spin.setAttribute("aria-hidden", "true");
                box.append(spin, t("files.loading", "Loading…"));
            } else {
                box.textContent = this._path
                    ? t("files.empty-folder", "This folder is empty.")
                    : t("files.empty", "Nothing here yet.");
            }
        }

        /**
         * Render the rows in view (plus overscan, the cursor row and a row
         * being renamed), reusing live elements by path; `rebuild` recreates
         * them all (except the one being renamed). Also the cheap path for
         * state-only changes — cursor, selection, marks.
         */
        _renderWindow(rebuild) {
            const sr = this.shadowRoot;
            const list = sr.querySelector(".list");
            if (!list) return;
            const canvas = sr.querySelector(".canvas");
            const rows = this._rows;
            const n = rows.length;
            const keepPath = this._renaming ? this._renaming.path : null;
            if (rebuild) {
                for (const [p, el] of this._els) {
                    if (p === keepPath) continue;
                    el.remove();
                    this._els.delete(p);
                }
            }
            const pitch = this._pitch();
            const top = list.scrollTop - canvas.offsetTop;
            const first = Math.max(0, Math.floor(top / pitch) - OVERSCAN);
            const last = Math.min(n, Math.ceil((top + list.clientHeight) / pitch) + OVERSCAN);
            const want = new Map();
            for (let i = first; i < last; i++) want.set(rows[i].path, i);
            if (rows[this._focus]) want.set(rows[this._focus].path, this._focus);
            if (keepPath && this._index.has(keepPath)) want.set(keepPath, this._index.get(keepPath));
            for (const [p, el] of this._els) {
                if (!want.has(p)) { el.remove(); this._els.delete(p); }
            }
            const shown = this._marks.size ? this._marks : this._sel;
            for (const [p, i] of want) {
                const r = rows[i];
                let el = this._els.get(p);
                if (!el) {
                    el = this._rowEl(r);
                    canvas.appendChild(el);
                    this._els.set(p, el);
                }
                const sel = shown.has(p);
                const mark = this._marks.has(p);
                const cur = i === this._focus;
                el.id = `r${i}`;
                el.dataset.i = i;
                el.style.transform = `translateY(${i * pitch}px)`;
                el.classList.toggle("sel", sel);
                el.classList.toggle("mark", mark);
                el.classList.toggle("focus", cur);
                el.setAttribute("aria-selected", String(sel));
                el.setAttribute("aria-posinset", i + 1);
                el.setAttribute("aria-setsize", n);
                el.setAttribute("part", ["row", r.kind, sel && "selected", mark && "marked", cur && "cursor"].filter(Boolean).join(" "));
            }
            if (rows[this._focus]) list.setAttribute("aria-activedescendant", `r${this._focus}`);
            else list.removeAttribute("aria-activedescendant");
            // delete-button="hover" hides the lone trash button while marks say "many".
            list.dataset.marks = !this._marks.size ? "none" : this._marks.size === 1 ? "one" : "many";
            this._count();
            this._pump();
        }

        _rowEl(r) {
            const el = document.createElement("div");
            el.className = "row";
            el.setAttribute("role", "option");
            el.dataset.kind = r.kind;
            if (r.kind === "parent") {
                // Not an entry: no drag, no delete, no meta, a box-less check.
                el.draggable = false;
                el.setAttribute("aria-label", t("files.parent", "Parent folder"));
                el.innerHTML = `<span class="check" part="check" aria-hidden="true"></span>
                    <span class="box">${icon("folder-up")}</span>
                    <span class="name" title="${esc(t("files.parent", "Parent folder"))}">..</span>
                    ${this._cols().map((c) => `<span class="meta ${c}"></span>`).join("")}`;
                return el;
            }
            el.draggable = true;
            const image = r.kind === "file" && /^image\//.test(r.stat.type || "");
            const kindIcon = r.kind === "folder" ? "folder" : image ? "image" : "document";
            const cell = (c) => {
                if (c === "type") return esc(typeLabel(r));
                if (r.kind !== "file") return "";
                return esc(c === "size" ? formatSize(r.stat.size) : formatDate(r.stat.modified));
            };
            // The date cell's tooltip carries day and time together.
            const tip = (c) => c === "date" && r.kind === "file" && r.stat.modified
                ? ` title="${esc(formatDate(r.stat.modified, true))}"` : "";
            const del = !this._hasDel() ? ""
                : `<button class="del" part="delete" type="button" tabindex="-1"
                           title="${esc(t("files.delete", "Delete"))}"
                           aria-label="${esc(t("files.delete", "Delete"))} ${esc(r.name)}">${icon("trash")}</button>`;
            el.innerHTML = `<span class="check" part="check" aria-hidden="true">${icon("check")}</span>
                <span class="box">${icon(kindIcon)}</span>
                <span class="name" title="${esc(r.name)}">${esc(r.name)}</span>
                ${this._cols().map((c) => `<span class="meta ${c}"${tip(c)}>${cell(c)}</span>`).join("")}
                ${del}`;
            if (image && !this.hasAttribute("no-thumbnails")) {
                const src = this._thumbs.get(r.path);
                if (src) el.querySelector(".box").innerHTML = `<img alt="" decoding="async" src="${esc(src)}">`;
                else if (src === undefined) this._queueThumb(r.path);
            }
            return el;
        }

        /* --------------------------------------------------- thumbnails -- */

        /** Image files get their own picture as the icon — only rows that
         *  are rendered, a few at a time, skipped once scrolled away. */
        _queueThumb(path) {
            if (!this._queue.includes(path)) this._queue.push(path);
        }

        _pump() {
            while (this._jobs < THUMB_JOBS && this._queue.length) {
                const path = this._queue.shift();
                if (!this._els.has(path) || this._thumbs.has(path)) continue;
                this._jobs++;
                this._thumb(path, this._loadToken).finally(() => { this._jobs--; this._pump(); });
            }
        }

        async _thumb(path, token) {
            const store = this._store;
            const i = this._index.get(path);
            const r = i == null ? null : this._rows[i];
            if (!store || !r) return;
            let src = null;
            let objectUrl = false;
            try {
                const o = ops();
                src = o && o.url ? await o.url(store, path)
                    : typeof store.url === "function" ? await store.url(path) : null;
            } catch (err) { src = null; }
            if (!src && r.stat.binary) {
                try {
                    const file = await store.read(path, null);
                    if (file instanceof Blob) { src = URL.createObjectURL(file); objectUrl = true; }
                } catch (err) { /* no picture — the icon stays */ }
            }
            if (token !== this._loadToken) { if (objectUrl) URL.revokeObjectURL(src); return; }
            if (objectUrl) this._urls.push(src);
            this._thumbs.set(path, src || null);
            const el = this._els.get(path);
            if (src && el) el.querySelector(".box").innerHTML = `<img alt="" decoding="async" src="${esc(src)}">`;
        }

        _revoke() {
            this._urls.forEach((u) => URL.revokeObjectURL(u));
            this._urls = [];
            this._thumbs.clear();
            this._queue = [];
        }

        /* -------------------------------------------------- interaction -- */

        /** Scroll row i into view (below the list's padding) and render. */
        _reveal(i) {
            const sr = this.shadowRoot;
            const list = sr.querySelector(".list");
            if (!list) return;
            const pitch = this._pitch();
            const top = sr.querySelector(".canvas").offsetTop + i * pitch;
            const bottom = top + pitch - GAP;
            if (top - PAD < list.scrollTop) list.scrollTop = top - PAD;
            else if (bottom + PAD > list.scrollTop + list.clientHeight) list.scrollTop = bottom + PAD - list.clientHeight;
            this._renderWindow(false);
        }

        _snapshot() {
            return { sel: this.selected.join("\n"), marks: this.marked.join("\n") };
        }

        /** Tell the host what a gesture changed: cursor, marks, selection.
         *  `forceSelect` keeps the old contract — a plain click or arrow onto
         *  a file always reports sac:select. */
        _after(snap, forceSelect) {
            this._emitCursor();
            const now = this._snapshot();
            if (now.marks !== snap.marks) this._emit("sac:mark", { paths: this.marked });
            if (forceSelect || now.sel !== snap.sel) this._emit("sac:select", { paths: this.selected });
        }

        _emitCursor() {
            const r = this._rows[this._focus];
            const p = r ? r.path : null;
            if (p === this._lastCursor) return;
            this._lastCursor = p;
            this._emit("sac:cursor", { path: p === PARENT ? null : p, kind: r ? r.kind : null });
        }

        /** Marks = the marks before the range began + the range. */
        _markRange(a, b) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            this._marks = new Set(this._base || []);
            for (let i = lo; i <= hi; i++) if (this._rows[i].kind !== "parent") this._marks.add(this._rows[i].path);
        }

        /** A toggle on empty marks starts from the selected file, as a
         *  Ctrl-click after a plain click always has. */
        _toggleMark(path) {
            if (path === PARENT) return;
            if (!this._marks.size) for (const p of this._sel) if (this._index.has(p)) this._marks.add(p);
            if (this._marks.has(path)) this._marks.delete(path); else this._marks.add(path);
        }

        _onClick(e) {
            if (this._eatClick) { this._eatClick = false; return; }
            if (e.target.closest(".rename")) return;
            const del = e.target.closest(".del");
            if (del) {
                e.stopPropagation();
                const r = this._rows[+del.closest(".row").dataset.i];
                if (r) this._remove([r], e.shiftKey);
                return;
            }
            const row = e.target.closest(".canvas > .row");
            if (!row) return;
            const i = +row.dataset.i;
            const r = this._rows[i];
            if (!r) return;
            if (r.kind === "parent") {
                if (this._selecting || e.ctrlKey || e.metaKey || e.shiftKey) return;
                this.up();
                return;
            }
            const list = this.shadowRoot.querySelector(".list");
            const snap = this._snapshot();
            const multi = this.hasAttribute("multiple");
            if (multi && (e.ctrlKey || e.metaKey)) {
                this._toggleMark(r.path);
                this._focus = this._anchor = i;
                this._base = new Set(this._marks);
            } else if (multi && e.shiftKey && this._anchor != null) {
                this._focus = i;
                this._markRange(this._anchor, i);
            } else if (this._selecting) {
                // Mark mode: a tap toggles the row — folders too, nothing opens.
                this._tapMark(i);
                list.focus({ preventScroll: true });
                return;
            } else {
                if (r.kind === "folder") {
                    // Folders open on a single click — nothing to select there.
                    this._focus = i;
                    this._go(r.path, true);
                    return;
                }
                this._marks.clear();
                this._focus = this._anchor = i;
                this._base = new Set();
                this._sel = new Set([r.path]);
                this._renderWindow(false);
                list.focus({ preventScroll: true });
                this._after(snap, true);
                // Touch: one tap opens the file — no double-tap to find —
                // unless a dialog's OK button is what confirms (see `tap`).
                if (this._tapOpens()) this._activate(i);
                return;
            }
            this._renderWindow(false);
            list.focus({ preventScroll: true });
            this._after(snap, false);
            if (this._selecting && !this._marks.size) this._userMode(false);
        }

        /** Does a tap on a file open it? Only for a touch or pen press, and
         *  then by `tap`: "open" yes, "select" no, absent = yes unless the
         *  browser sits in a <sac-dialog> (its OK button confirms the pick —
         *  the sac.files dialogs). A mouse click always just selects. */
        _tapOpens() {
            if (this._lastPointer !== "touch" && this._lastPointer !== "pen") return false;
            const mode = (this.getAttribute("tap") || "").trim().toLowerCase();
            if (mode === "open") return true;
            if (mode === "select") return false;
            for (let n = this; n; n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null) {
                if (n.localName === "sac-dialog") return false;
            }
            return true;
        }

        /** Mark mode: toggle row i's mark; the last unmark ends the mode. */
        _tapMark(i) {
            const r = this._rows[i];
            if (!r || r.kind === "parent") return;
            const snap = this._snapshot();
            if (this._marks.has(r.path)) this._marks.delete(r.path); else this._marks.add(r.path);
            this._focus = this._anchor = i;
            this._base = new Set(this._marks);
            this._renderWindow(false);
            this._after(snap, false);
            if (!this._marks.size) this._userMode(false);
        }

        /** Done / Esc: marks cleared, mark mode off. */
        _endMarking() {
            if (!this._selecting) return;
            const snap = this._snapshot();
            this._marks.clear();
            this._base = new Set();
            this._anchor = this._focus;
            this._renderWindow(false);
            this._after(snap, false);
            this._userMode(false);
        }

        /* A finger held on a row: no native drag while it is down (Chrome's
           touch drag-and-drop would take the long-press from the menu). */
        _pressStart(e) {
            this._eatClick = false;
            this._lastPointer = e.pointerType || "";
            this._pressEnd();
            if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
            if (e.button > 0 || this._renaming || e.target.closest(".rename, .del")) return;
            const el = e.target.closest(".canvas > .row");
            if (!el) return;
            el.draggable = false;
            this._press = { id: e.pointerId, x0: e.clientX, y0: e.clientY, el };
        }

        _pressEnd() {
            const p = this._press;
            if (!p) return;
            this._press = null;
            if (!p.el.classList.contains("renaming") && p.el.dataset.kind !== "parent") p.el.draggable = true;
        }

        /** "Select" (the context menu): mark row i and turn mark mode on —
         *  in mark mode already, toggle it like a tap. */
        _startMarking(i) {
            const r = this._rows[i];
            if (!r || r.kind === "parent" || !this.hasAttribute("multiple")) return;
            if (this._selecting) { this._tapMark(i); return; }
            const snap = this._snapshot();
            // Mark mode's selection is its marks: leaving it leaves nothing selected.
            this._sel.clear();
            this._marks.add(r.path);
            this._focus = this._anchor = i;
            this._base = new Set(this._marks);
            this._userMode(true);
            this._renderWindow(false);
            this._after(snap, false);
        }

        /** The context menu (right-click, long-press, Shift+F10 / Menu key)
         *  — while connected: its <sac-menu> lives in <body>. */
        _wireContext() {
            if (this._ctx || !window.sac || !sac.contextMenu || !this.shadowRoot.firstChild) return;
            this._ctx = sac.contextMenu(this.shadowRoot.querySelector(".list"), {
                targets: ".canvas > .row",
                items: (row) => this._contextItems(row),
                keyTarget: () => { const r = this._rows[this._focus]; return r ? this._els.get(r.path) || null : null; },
            });
        }

        /** A row's context menu: the cursor moves onto it, then the built-in
         *  entries — which the host may change through sac:context. */
        _contextItems(rowEl) {
            const i = +rowEl.dataset.i;
            const r = this._rows[i];
            if (!r || r.kind === "parent" || this._renaming) return null;
            const snap = this._snapshot();
            this._focus = i;
            if (!this._marks.has(r.path)) {
                this._anchor = i;
                if (r.kind === "file" && !this._marks.size) this._sel = new Set([r.path]);
            }
            this._renderWindow(false);
            this.shadowRoot.querySelector(".list").focus({ preventScroll: true });
            this._after(snap, false);

            const many = this._marks.has(r.path) && this._marks.size > 1;
            const targets = many ? this._rows.filter((x) => this._marks.has(x.path)) : [r];
            const items = [];
            if (this.hasAttribute("multiple") && !this._marks.has(r.path)) {
                items.push({ id: "select", label: t("contextmenu.select", "Select"), icon: "check",
                             onClick: () => this._startMarking(this._index.get(r.path)) }, "-");
            }
            items.push({ id: "open", label: t("files.open", "Open"), icon: r.kind === "folder" ? "folder" : "document",
                         disabled: many, onClick: () => this._activate(this._index.get(r.path)) });
            if (!this.hasAttribute("readonly")) {
                items.push({ id: "rename", label: t("files.rename", "Rename"), icon: "pencil",
                             disabled: many, onClick: () => this.rename(r.path) });
                items.push("-", { id: "delete", label: t("files.delete", "Delete"), icon: "trash", danger: true,
                                  onClick: () => this._remove(targets, false) });
            }
            const detail = { path: r.path, kind: r.kind, paths: targets.map((x) => x.path), items };
            if (!this._emit("sac:context", detail, true)) return null;
            return detail.items;
        }

        _activate(i) {
            const r = this._rows[i];
            if (!r) return;
            if (r.kind === "parent") { this.up(); return; }
            if (r.kind === "folder") { this._go(r.path, true); return; }
            if (!this._marks.has(r.path)) {
                const snap = this._snapshot();
                this._marks.clear();
                if (!this._sel.has(r.path)) this._sel = new Set([r.path]);
                this._renderWindow(false);
                this._after(snap, false);
            }
            this._emit("sac:choose", { paths: this.selected });
        }

        _onKey(e) {
            const n = this._rows.length;
            const multi = this.hasAttribute("multiple");
            const mod = e.ctrlKey || e.metaKey;
            const snap = this._snapshot();
            const list = this.shadowRoot.querySelector(".list");
            const page = Math.max(1, Math.floor(list.clientHeight / this._pitch()) - 1);
            const move = (to) => {
                e.preventDefault();
                if (!n) return;
                const i = Math.max(0, Math.min(n - 1, to));
                const r = this._rows[i];
                let force = false;
                if (multi && e.shiftKey) {
                    if (this._anchor == null) { this._anchor = this._focus; this._base = new Set(this._marks); }
                    this._focus = i;
                    this._markRange(this._anchor, i);
                } else {
                    this._focus = this._anchor = i;
                    this._base = new Set(this._marks);
                    if (r.kind === "file") {
                        this._sel = new Set([r.path]);
                        force = !this._marks.size;
                    }
                }
                this._reveal(i);
                this._after(snap, force);
            };
            const marks = (fn) => {
                e.preventDefault();
                fn();
                this._renderWindow(false);
                this._after(snap, false);
            };
            switch (e.key) {
                case "ArrowDown": if (!e.altKey) move(this._focus + 1); break;
                case "ArrowUp":
                    if (e.altKey) { e.preventDefault(); this.up(); }
                    else move(this._focus - 1);
                    break;
                case "PageDown":  move(this._focus + page); break;
                case "PageUp":    move(this._focus - page); break;
                case "Home":      move(0); break;
                case "End":       move(n - 1); break;
                case "Enter":     e.preventDefault(); this._activate(this._focus); break;
                case "Backspace": e.preventDefault(); this.up(); break;
                case "Delete": {
                    if (this.hasAttribute("readonly")) return;
                    e.preventDefault();
                    const targets = this._marks.size
                        ? this._rows.filter((r) => this._marks.has(r.path))
                        : [this._rows[this._focus]].filter((r) => r && r.kind !== "parent");
                    if (targets.length) this._remove(targets, e.shiftKey);
                    break;
                }
                case "F2":
                    if (this.hasAttribute("readonly")) return;
                    e.preventDefault();
                    this.rename();
                    break;
                case "Escape":
                    if (this._selecting) { e.preventDefault(); e.stopPropagation(); this._endMarking(); break; }
                    // Only a clear stops the key — an unmarked Esc closes the dialog around.
                    if (!this._marks.size) return;
                    e.stopPropagation();
                    marks(() => { this._marks.clear(); this._base = new Set(); this._anchor = this._focus; });
                    break;
                case "a":
                case "A":
                    if (!multi || !mod || e.altKey || e.shiftKey || !n) return;
                    marks(() => {
                        this._marks = new Set(this._rows.filter((r) => r.kind !== "parent").map((r) => r.path));
                        this._base = new Set(this._marks);
                    });
                    break;
                case " ":
                    if (!this._rows[this._focus]) return;
                    // Mark mode: Space alone toggles, like a tap.
                    if (this._selecting && !mod) { e.preventDefault(); this._tapMark(this._focus); break; }
                    if (!multi || !mod) return;
                    marks(() => {
                        this._toggleMark(this._rows[this._focus].path);
                        this._anchor = this._focus;
                        this._base = new Set(this._marks);
                    });
                    break;
            }
        }

        /** Delete rows — after a cancelable sac:request-remove, and then the
         *  built-in armed confirm that says how much goes. */
        async _remove(targets, permanent) {
            if (!targets.length || !this._store) return;
            const first = targets[0];
            const go = this._emit("sac:request-remove", {
                path: first.path,
                folder: first.kind === "folder",
                permanent: !!permanent,
                paths: targets.map((r) => r.path),
            }, true);
            if (!go) return;
            const store = this._store;
            // A folder goes with everything in it — say how much.
            const inside = async (r) => r.kind === "folder"
                ? (await store.list(r.path + "/")).filter((k) => !k.endsWith("/" + MARKER))
                : [];
            let answer = "delete";
            if (window.sac && sac.dialog) {
                let title, message;
                if (targets.length === 1) {
                    const folder = first.kind === "folder";
                    const n = (await inside(first)).length;
                    title = folder ? t("files.delete-folder-title", "Delete this folder?")
                                   : t("files.delete-title", "Delete this file?");
                    message = !folder
                        ? `“${first.name}” ${t("files.delete-message", "will be permanently deleted.")}`
                        : n
                            ? `“${first.name}” ${t("files.delete-folder-message", "and the {n} file(s) in it will be permanently deleted.")
                                .replace("{n}", n)}`
                            : `“${first.name}” ${t("files.delete-folder-empty", "is empty and will be removed.")}`;
                } else {
                    let files = 0;
                    for (const r of targets) files += r.kind === "folder" ? (await inside(r)).length : 1;
                    title = t("files.delete-many-title", "Delete {n} items?").replace("{n}", targets.length);
                    message = t("files.delete-many-message", "{n} items, {files} file(s) in all, will be permanently deleted.")
                        .replace("{n}", targets.length).replace("{files}", files);
                }
                answer = await sac.dialog.confirm({
                    title,
                    message,
                    buttons: [
                        // labelKey: the buttons follow a language switch in place.
                        { action: "cancel", label: "Cancel", labelKey: "files.cancel" },
                        { action: "delete", label: "Delete", labelKey: "files.delete", kind: "destructive", armAfterMs: 1200 },
                    ],
                });
            }
            if (answer !== "delete") return;
            const snap = this._snapshot();
            let gone = 0;
            for (const r of targets) {
                const folder = r.kind === "folder";
                try {
                    if (folder) {
                        for (const key of await store.list(r.path + "/")) await store.remove(key);
                    } else {
                        await store.remove(r.path);
                    }
                } catch (err) { console.error("[sac-file-browser] remove() failed:", err); break; }
                gone++;
                this._sel.delete(r.path);
                this._marks.delete(r.path);
                this._emit("sac:remove", { path: r.path, folder });
            }
            // Stopped partway: say what is still there — the list alone
            // would only show it by what did not disappear.
            if (gone < targets.length && window.sac && typeof sac.toast === "function") {
                const left = targets.length - gone;
                sac.toast(targets.length === 1
                    ? t("files.delete-failed-one", "Couldn't delete “{name}”.").replace("{name}", first.name)
                    : t("files.delete-failed-many", "{n} of {total} items were not deleted.")
                        .replace("{n}", left).replace("{total}", targets.length),
                    { kind: "error" });
            }
            if (this._snapshot().marks !== snap.marks) this._emit("sac:mark", { paths: this.marked });
            if (this._selecting && !this._marks.size) this._userMode(false);
            await this.refresh();
            this.shadowRoot.querySelector(".list").focus({ preventScroll: true });
        }

        /* ---------------------------------------------------- drag/drop -- */

        _dragStart(e) {
            const row = e.target.closest && e.target.closest(".canvas > .row");
            const r = row ? this._rows[+row.dataset.i] : null;
            // A touch hold is a long-press (mark mode), never a drag; ".." never.
            if (!r || r.kind === "parent" || this._renaming || this._press || this._eatClick || !e.dataTransfer) { if (row) e.preventDefault(); return; }
            const paths = this._marks.has(r.path) ? this.marked : [r.path];
            e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ paths }));
            e.dataTransfer.setData("text/plain", paths.join("\n"));
            e.dataTransfer.effectAllowed = "copyMove";
            dragging = { source: this, paths };
        }

        /** Where a drag over this list would land, or null when it may not. */
        _dropTarget(e) {
            const dt = e.dataTransfer;
            if (!dt || !this._store || this.hasAttribute("readonly")) return null;
            const types = Array.from(dt.types || []);
            const internal = types.includes(DRAG_TYPE);
            if (!internal && !types.includes("Files")) return null;
            const row = e.target.closest && e.target.closest(".canvas > .row");
            const r = row ? this._rows[+row.dataset.i] : null;
            const onFolder = r && (r.kind === "folder" || r.kind === "parent");
            const target = !onFolder ? this._path : r.kind === "parent" ? r.target : r.path;
            const copy = !internal || e.ctrlKey || e.altKey;
            if (internal && dragging && (dragging.source === this || dragging.source._store === this._store)) {
                const paths = dragging.paths;
                if (paths.some((p) => target === p || target.startsWith(p + "/"))) return null;
                if (!copy && paths.every((p) => dirName(p) === target)) return null;
            }
            return { internal, target, copy, row: onFolder ? row : null };
        }

        _dropHint(el) {
            const list = this.shadowRoot.querySelector(".list");
            list.classList.toggle("drop", el === list);
            list.querySelectorAll(".row.drop").forEach((r) => { if (r !== el) r.classList.remove("drop"); });
            if (el && el !== list) el.classList.add("drop");
            clearTimeout(this._dropTimer);
            // dragleave is noisy across child elements; a hint not renewed by
            // dragover within a beat goes away on its own.
            if (el) this._dropTimer = setTimeout(() => this._dropHint(null), 150);
        }

        _dragOver(e) {
            const d = this._dropTarget(e);
            if (!d) { this._dropHint(null); return; }
            e.preventDefault();
            e.dataTransfer.dropEffect = d.copy ? "copy" : "move";
            this._dropHint(d.row || this.shadowRoot.querySelector(".list"));
        }

        _drop(e) {
            const d = this._dropTarget(e);
            this._dropHint(null);
            if (!d) return;
            e.preventDefault();
            if (d.internal) {
                let paths = null;
                try { paths = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)).paths; } catch (err) { /* below */ }
                if (!Array.isArray(paths)) paths = dragging ? dragging.paths : [];
                this._emit("sac:drop", { paths, target: d.target, copy: d.copy, source: dragging ? dragging.source : null });
            } else {
                this._emit("sac:drop", { files: Array.from(e.dataTransfer.files || []), target: d.target, copy: true });
            }
            dragging = null;
        }

        /** Dispatch; a cancelable event answers false when prevented. */
        _emit(name, detail, cancelable = false) {
            return this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true, cancelable }));
        }
    }

    customElements.define(TAG, SacFileBrowser);
})();
