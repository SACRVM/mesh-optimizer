/**
 * <sac-file-browser accept=".png,image/*" pixelated></sac-file-browser>
 *
 *   browser.store = sac.fs.shared("files");
 *   browser.addEventListener("sac:choose", (e) => open(e.detail.paths));
 *
 * A folder view over any sac.fs handle — the user's files (sac.fs.shared),
 * an app's own drawer (context.fs), a host's own space. A path
 * "sprites/hero.png" IS the folder "sprites", so folders are derived from
 * list(). An empty folder the user created keeps itself alive with a hidden
 * marker entry, "<folder>/.folder" — never listed, removed with the folder.
 * It is the list inside the open/save dialogs of sac.files.virtual(), and on
 * its own the body of a "Files" app.
 *
 * Rows: folders first, then files by name — thumbnail (image files) or icon,
 * name, size, date. Files that do not match `accept` are left out.
 *
 * Attributes:
 *   accept      — ".png,image/*" — the file input's grammar: `.ext` matches
 *                 the name suffix, `type/*` the MIME prefix, `type/sub` exactly.
 *                 Absent = every file.
 *   multiple    — presence: Ctrl/⌘-click and Shift-click select several.
 *   readonly    — presence hides New folder, the per-row delete buttons and
 *                 the Delete key: a view that changes nothing.
 *   pixelated   — presence draws thumbnails with hard pixel edges. Default
 *                 smooth: most images are not pixel art.
 *   root-label  — the first breadcrumb. Default "Files".
 *
 * Properties:
 *   store    — the sac.fs handle to browse (list/stat/read/remove). Setting
 *              it resets to the root and reloads.
 *   path     — the current folder ("" = root), get/set. Setting navigates.
 *   selected — the selected file paths, array (folders are never selected).
 *
 * Methods:
 *   refresh()          — re-read the current folder.
 *   up()               — one folder up.
 *   newFolder()        — an inline name field; Enter creates the folder
 *                        (its ".folder" marker) and goes into it.
 *   select(path)       — select one file by path (e.g. the name being saved).
 *
 * Events (bubble + composed — a dialog around it listens):
 *   sac:select   — detail { paths }: the selection changed (user action).
 *   sac:choose   — detail { paths }: a file was double-clicked / Enter'd.
 *   sac:navigate — detail { path }: the folder changed.
 *   sac:remove   — detail { path, folder }: a file — or a folder with
 *                  everything in it — was deleted (after confirming).
 *
 * Keyboard: ↑/↓ Home/End move · Enter opens the folder / chooses the file ·
 * Backspace goes up · Delete removes a file or folder (asks first) · Shift+↑/↓ extends when
 * `multiple`.
 *
 * Language: every kit string goes through sac.t and follows a runtime
 * switch in place (folder, selection, focus row and scroll survive); sizes
 * and dates are formatted in sac.lang.locale().
 *
 * Compact: under a 480px container the size and date columns drop out; rows
 * are 44px on touch.
 *
 * Theming: tokens only — selected row = --accent-tint ground and
 * --accent-text name; the thumbnail checker is --checker-a/--checker-b.
 */
(function () {
    const TAG = "sac-file-browser";
    if (customElements.get(TAG)) return;

    // Keeps an empty folder alive. A dotted name no picker lists.
    const MARKER = ".folder";

    const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    const icon = (n) => {
        const p = window.sac && sac.icons ? sac.icons.get(n) : null;
        return p ? `<svg ${ICON_ATTRS} aria-hidden="true">${p}</svg>` : "";
    };
    const t = (key, fallback) => (window.sac && sac.t ? sac.t(key, fallback) : fallback);
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
    function formatDate(ms) {
        if (!ms) return "";
        const d = new Date(ms);
        const today = new Date();
        const sameDay = d.toDateString() === today.toDateString();
        return sameDay
            ? d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })
            : d.toLocaleDateString(locale(), { year: "numeric", month: "short", day: "numeric" });
    }

    class SacFileBrowser extends HTMLElement {
        static get observedAttributes() { return ["accept", "root-label", "readonly"]; }

        constructor() {
            super();
            this.attachShadow({ mode: "open" });
            this._store = null;
            this._path = "";
            this._rows = [];          // [{ kind: "folder"|"file", path, name, stat? }]
            this._sel = new Set();    // selected file paths
            this._focus = 0;          // index of the keyboard row
            this._anchor = null;      // shift-range anchor
            this._urls = [];          // thumbnail object URLs to revoke
            this._loadToken = 0;
        }

        connectedCallback() {
            if (!this.shadowRoot.firstChild) this._render();
            if (this._store) this.refresh();
            if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
        }
        disconnectedCallback() {
            this._revoke();
            if (this._offLang) { this._offLang(); this._offLang = null; }
        }

        /** Runtime language switch: chrome labels in place, then crumbs and
         *  rows repainted from the component's own state (folder, selection,
         *  focus row) — no reload. Scroll and an open new-folder field survive. */
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
            this._crumbs();
            const list = sr.querySelector(".list");
            const scroll = list.scrollTop;
            const pending = list.querySelector(".new-folder");
            if (pending) pending.remove();     // detached, not settled: its blur is ignored
            this._paint();
            if (pending) {
                list.querySelector(".empty")?.remove();
                list.prepend(pending);
                const input = pending.querySelector("input");
                const name = t("files.new-folder-name", "Folder name");
                input.setAttribute("aria-label", name);
                input.setAttribute("placeholder", name);
                input.focus({ preventScroll: true });
            }
            list.scrollTop = scroll;
        }
        attributeChangedCallback() {
            if (!this.shadowRoot.firstChild) return;
            this._crumbs();
            if (this._store) this.refresh();
        }

        get store() { return this._store; }
        set store(handle) {
            this._store = handle || null;
            this._path = "";
            this._sel.clear();
            if (this.isConnected) this.refresh();
        }

        get path() { return this._path; }
        set path(p) { this._go(String(p || "").replace(/^\/+|\/+$/g, ""), false); }

        get selected() { return Array.from(this._sel); }

        select(path) {
            this._sel = new Set(path ? [path] : []);
            const i = this._rows.findIndex((r) => r.path === path);
            if (i >= 0) this._focus = i;
            this._paint();
        }

        up() {
            if (!this._path) return;
            const cut = this._path.lastIndexOf("/");
            this._go(cut < 0 ? "" : this._path.slice(0, cut), true);
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
            list.prepend(row);
            list.querySelector(".empty")?.remove();
            const input = row.querySelector("input");
            input.focus();
            let settled = false;
            const done = async (commit) => {
                if (settled) return;
                settled = true;
                const name = input.value.trim().replace(/[\\/]+/g, "-");
                row.remove();
                if (!commit || !name || name.startsWith(".") || !this._store) { this._paint(); return; }
                const path = this._path ? `${this._path}/${name}` : name;
                try { await this._store.write(`${path}/${MARKER}`, {}); }
                catch (err) { console.error("[sac-file-browser] could not create the folder:", err); this._paint(); return; }
                this._go(path, true);
            };
            input.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); done(true); }
                if (e.key === "Escape") { e.preventDefault(); done(false); }
            });
            input.addEventListener("blur", () => { if (row.isConnected) done(!!input.value.trim()); });
        }

        /* ------------------------------------------------------ loading -- */

        async refresh() {
            if (!this.shadowRoot.firstChild) this._render();
            const store = this._store;
            this._crumbs();
            if (!store) { this._rows = []; this._paint(); return; }
            const token = ++this._loadToken;
            const prefix = this._path ? this._path + "/" : "";
            let keys = [];
            try { keys = await store.list(prefix); }
            catch (err) { console.error("[sac-file-browser] list() failed:", err); }
            const folders = new Set();
            const files = [];
            for (const key of keys) {
                const rest = key.slice(prefix.length);
                if (!rest) continue;
                const cut = rest.indexOf("/");
                if (cut >= 0) folders.add(rest.slice(0, cut));
                else if (rest !== MARKER) files.push(key);
            }
            const ok = acceptTest(this.getAttribute("accept"));
            const stats = await Promise.all(files.map(async (p) => {
                try { return await store.stat(p); } catch (err) { return null; }
            }));
            if (token !== this._loadToken) return;       // a newer load won
            const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
            this._rows = [
                ...Array.from(folders).map((name) => ({ kind: "folder", name, path: prefix + name })).sort(byName),
                ...stats.filter((s) => s && ok(s)).map((s) => ({ kind: "file", name: s.name, path: s.path, stat: s })).sort(byName),
            ];
            for (const p of Array.from(this._sel)) {
                if (!this._rows.some((r) => r.path === p)) this._sel.delete(p);
            }
            this._focus = Math.min(this._focus, Math.max(0, this._rows.length - 1));
            this._paint();
        }

        _go(path, user) {
            if (path === this._path && !user) return;
            this._path = path;
            this._sel.clear();
            this._focus = 0;
            this._anchor = null;
            this.refresh();
            if (user) this._emit("sac:navigate", { path });
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
                    }
                    :host([hidden]) { display: none; }
                    .bar {
                        flex: none;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        padding-bottom: 8px;
                        min-width: 0;
                    }
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
                    .crumb:focus-visible, .tool:focus-visible, .del:focus-visible {
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
                    .tool:hover:not(:disabled) { background: var(--hover); color: var(--text); }
                    .tool:disabled { opacity: 0.35; cursor: default; }
                    .list {
                        flex: 1;
                        min-height: 120px;
                        overflow-y: auto;
                        overscroll-behavior-y: contain;
                        display: flex;
                        flex-direction: column;
                        gap: 2px;
                        padding: 4px;
                        border: 1px solid var(--border);
                        border-radius: var(--radius-m);
                        background: var(--field);
                        outline: none;
                        scrollbar-width: thin;
                        scrollbar-color: var(--scrollbar-thumb) transparent;
                    }
                    .list:focus-visible { border-color: var(--accent); }
                    .row {
                        display: flex;
                        align-items: center;
                        gap: 0.6rem;
                        padding: 4px 4px 4px 6px;
                        min-height: 36px;
                        border-radius: var(--radius-m);
                        color: var(--text-muted);
                        cursor: pointer;
                        user-select: none;
                    }
                    .row:hover { background: var(--hover); color: var(--text); }
                    .row.sel { background: var(--accent-tint); color: var(--accent-text); }
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
                    .row[data-kind="folder"] .box { color: var(--accent-text); }
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
                    .row:not(.sel) .name { color: var(--text); }
                    .meta {
                        flex: none;
                        width: 5.5rem;
                        text-align: right;
                        font-size: 0.75rem;
                        color: var(--text-dim);
                        font-variant-numeric: tabular-nums;
                        white-space: nowrap;
                    }
                    .meta.date { width: 7rem; }
                    .del { opacity: 0; }
                    .row:hover .del, .row.focus .del, .del:focus-visible { opacity: 1; }
                    .del:hover { color: var(--danger-text); background: var(--hover); }
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
                    .empty {
                        margin: auto;
                        padding: 24px 12px;
                        text-align: center;
                        color: var(--text-dim);
                        font-size: 0.8rem;
                    }
                    @container (max-width: 480px) {
                        .meta { display: none; }
                    }
                    @media (pointer: coarse) {
                        .row { min-height: 44px; }
                        .tool, .del { width: 44px; height: 44px; }
                        .del { opacity: 1; }
                    }
                </style>
                <div class="bar" part="bar">
                    <button class="tool up" type="button" part="up"
                            title="${esc(t("files.up", "Up one folder"))}"
                            aria-label="${esc(t("files.up", "Up one folder"))}">${icon("chevron-up")}</button>
                    <nav class="crumbs" aria-label="${esc(t("files.location", "Location"))}"></nav>
                    <button class="tool mk" type="button" part="new-folder"
                            title="${esc(t("files.new-folder", "New folder"))}"
                            aria-label="${esc(t("files.new-folder", "New folder"))}">${icon("folder-plus")}</button>
                </div>
                <div class="list" part="list" role="listbox" tabindex="0"
                     aria-label="${esc(t("files.list", "Files"))}"></div>
            `;
            const sr = this.shadowRoot;
            sr.querySelector(".up").addEventListener("click", () => this.up());
            sr.querySelector(".mk").addEventListener("click", () => this.newFolder());
            const list = sr.querySelector(".list");
            list.addEventListener("click", (e) => this._onClick(e));
            list.addEventListener("dblclick", (e) => {
                const row = e.target.closest(".row[data-i]");
                if (row && !e.target.closest(".del")) this._activate(+row.dataset.i);
            });
            list.addEventListener("keydown", (e) => this._onKey(e));
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

        _paint() {
            const list = this.shadowRoot.querySelector(".list");
            if (!list) return;
            this._revoke();
            if (!this._rows.length) {
                list.innerHTML = `<div class="empty">${esc(this._path
                    ? t("files.empty-folder", "This folder is empty.")
                    : t("files.empty", "Nothing here yet."))}</div>`;
                list.removeAttribute("aria-activedescendant");
                return;
            }
            const readonly = this.hasAttribute("readonly");
            list.innerHTML = this._rows.map((r, i) => {
                const sel = this._sel.has(r.path);
                const kindIcon = r.kind === "folder" ? "folder"
                    : /^image\//.test(r.stat.type) ? "image" : "document";
                const del = !readonly
                    ? `<button class="del" type="button" tabindex="-1" data-del="${i}"
                              title="${esc(t("files.delete", "Delete"))}"
                              aria-label="${esc(t("files.delete", "Delete"))} ${esc(r.name)}">${icon("trash")}</button>`
                    : "";
                return `<div class="row${sel ? " sel" : ""}${i === this._focus ? " focus" : ""}"
                             id="r${i}" data-i="${i}" data-kind="${r.kind}" role="option"
                             aria-selected="${sel}">
                        <span class="box" data-thumb="${i}">${icon(kindIcon)}</span>
                        <span class="name" title="${esc(r.name)}">${esc(r.name)}</span>
                        <span class="meta size">${r.kind === "file" ? esc(formatSize(r.stat.size)) : ""}</span>
                        <span class="meta date">${r.kind === "file" ? esc(formatDate(r.stat.modified)) : ""}</span>
                        ${del}
                    </div>`;
            }).join("");
            list.setAttribute("aria-activedescendant", `r${this._focus}`);
            this._thumbs(this._loadToken);
        }

        /** Image files get their own picture as the icon. */
        async _thumbs(token) {
            const store = this._store;
            if (!store) return;
            for (let i = 0; i < this._rows.length; i++) {
                const r = this._rows[i];
                if (r.kind !== "file" || !/^image\//.test(r.stat.type) || !r.stat.binary) continue;
                let file = r._file;
                if (!file) {
                    try { file = r._file = await store.read(r.path, null); } catch (err) { file = null; }
                }
                if (token !== this._loadToken || !(file instanceof Blob)) continue;
                const box = this.shadowRoot.querySelector(`[data-thumb="${i}"]`);
                if (!box) continue;
                const url = URL.createObjectURL(file);
                this._urls.push(url);
                box.innerHTML = `<img alt="" src="${url}">`;
            }
        }

        _revoke() {
            this._urls.forEach((u) => URL.revokeObjectURL(u));
            this._urls = [];
        }

        /* -------------------------------------------------- interaction -- */

        _onClick(e) {
            const del = e.target.closest(".del");
            if (del) { e.stopPropagation(); this._delete(+del.dataset.del); return; }
            const row = e.target.closest(".row[data-i]");
            if (!row) return;
            const i = +row.dataset.i;
            const r = this._rows[i];
            this._focus = i;
            if (r.kind === "folder") {
                // Folders open on a single click — nothing to select there.
                this._go(r.path, true);
                return;
            }
            const multi = this.hasAttribute("multiple");
            if (multi && (e.ctrlKey || e.metaKey)) {
                if (this._sel.has(r.path)) this._sel.delete(r.path); else this._sel.add(r.path);
                this._anchor = i;
            } else if (multi && e.shiftKey && this._anchor != null) {
                this._range(this._anchor, i);
            } else {
                this._sel = new Set([r.path]);
                this._anchor = i;
            }
            this._paint();
            this.shadowRoot.querySelector(".list").focus({ preventScroll: true });
            this._emit("sac:select", { paths: this.selected });
        }

        _range(a, b) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            this._sel = new Set(this._rows.slice(lo, hi + 1).filter((r) => r.kind === "file").map((r) => r.path));
        }

        _activate(i) {
            const r = this._rows[i];
            if (!r) return;
            if (r.kind === "folder") { this._go(r.path, true); return; }
            if (!this._sel.has(r.path)) {
                this._sel = new Set([r.path]);
                this._emit("sac:select", { paths: this.selected });
            }
            this._emit("sac:choose", { paths: this.selected });
        }

        _onKey(e) {
            const n = this._rows.length;
            const move = (to) => {
                e.preventDefault();
                if (!n) return;
                const i = Math.max(0, Math.min(n - 1, to));
                const r = this._rows[i];
                this._focus = i;
                if (r.kind === "file") {
                    if (e.shiftKey && this.hasAttribute("multiple") && this._anchor != null) this._range(this._anchor, i);
                    else { this._sel = new Set([r.path]); this._anchor = i; }
                    this._emit("sac:select", { paths: this.selected });
                }
                this._paint();
                this.shadowRoot.getElementById(`r${i}`)?.scrollIntoView({ block: "nearest" });
            };
            switch (e.key) {
                case "ArrowDown": move(this._focus + 1); break;
                case "ArrowUp":   move(this._focus - 1); break;
                case "Home":      move(0); break;
                case "End":       move(n - 1); break;
                case "Enter":     e.preventDefault(); this._activate(this._focus); break;
                case "Backspace": e.preventDefault(); this.up(); break;
                case "Delete":
                    if (this.hasAttribute("readonly")) return;
                    e.preventDefault();
                    if (this._rows[this._focus]) this._delete(this._focus);
                    break;
            }
        }

        async _delete(i) {
            const r = this._rows[i];
            if (!r || !this._store) return;
            const folder = r.kind === "folder";
            // A folder goes with everything in it — say how much.
            const inside = folder
                ? (await this._store.list(r.path + "/")).filter((k) => !k.endsWith("/" + MARKER))
                : [];
            let answer = "delete";
            if (window.sac && sac.dialog) {
                const message = !folder
                    ? `“${r.name}” ${t("files.delete-message", "will be permanently deleted.")}`
                    : inside.length
                        ? `“${r.name}” ${t("files.delete-folder-message", "and the {n} file(s) in it will be permanently deleted.")
                            .replace("{n}", inside.length)}`
                        : `“${r.name}” ${t("files.delete-folder-empty", "is empty and will be removed.")}`;
                answer = await sac.dialog.confirm({
                    title: folder ? t("files.delete-folder-title", "Delete this folder?")
                                  : t("files.delete-title", "Delete this file?"),
                    message,
                    buttons: [
                        // labelKey: the buttons follow a language switch in place.
                        { action: "cancel", label: "Cancel", labelKey: "files.cancel" },
                        { action: "delete", label: "Delete", labelKey: "files.delete", kind: "destructive", armAfterMs: 1200 },
                    ],
                });
            }
            if (answer !== "delete") return;
            try {
                if (folder) {
                    for (const key of await this._store.list(r.path + "/")) await this._store.remove(key);
                } else {
                    await this._store.remove(r.path);
                }
            } catch (err) { console.error("[sac-file-browser] remove() failed:", err); return; }
            this._sel.delete(r.path);
            this._emit("sac:remove", { path: r.path, folder });
            await this.refresh();
            this.shadowRoot.querySelector(".list").focus({ preventScroll: true });
        }

        _emit(name, detail) {
            this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
        }
    }

    customElements.define(TAG, SacFileBrowser);
})();
