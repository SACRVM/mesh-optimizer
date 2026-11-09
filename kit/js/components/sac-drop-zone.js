/**
 * <sac-drop-zone accept=".svg,image/*" multiple
 *                label="Drop your SVG here" hint="or click to browse">
 * </sac-drop-zone>
 *
 * The one surface an app needs to take files in. Drag-and-drop and the file
 * picker are the same control here, not two: whichever way the files arrive,
 * exactly one event carries them — `sac:files` with a plain Array. Apps wire
 * one listener and never care which gesture the user chose.
 *
 * The host itself IS the button: role="button", tabindex, Enter/Space, and a
 * focus ring on the whole surface. The <input type="file"> lives hidden inside
 * the shadow root and is never seen, never focused, never styled around — and
 * its value is cleared after every pick, so choosing the SAME file twice fires
 * twice (the classic file-input trap, closed here once for everyone).
 *
 * Attributes (all synced in place — nothing re-renders):
 *   accept   — mirrored VERBATIM into the hidden input, and applied to dropped
 *              files with the same semantics the input uses: `.svg` matches the
 *              name suffix (case-insensitively), `image/*` matches the MIME
 *              prefix, `image/png` must match exactly. Absent = take anything.
 *   multiple — presence = keep every accepted file; absent = the first one only.
 *   label    — the main line. Default "Drop files here".
 *   hint     — the dim second line. Default "or click to browse";
 *              `hint=""` hides the line entirely (same for `label=""`).
 *   touch-label / touch-hint — the two lines on a touch-only device
 *              ((hover: none) and (pointer: coarse)), where nothing can be
 *              dragged in from the OS. Defaults "Choose files" / "Tap to
 *              browse" — used only when the matching label/hint is not set;
 *              an app that sets `label` should set `touch-label` too.
 *   disabled — dims the surface and blocks click, keyboard AND drop. A drag
 *              over a disabled zone is not accepted, so the browser shows the
 *              "no drop" cursor rather than a lie.
 *   over     — set BY THE COMPONENT while a file drag hovers, removed on drop
 *              or leave. Read it if an app wants to style around the zone.
 *   overlay  — the zone is invisible at rest and its PARENT element is the
 *              drop surface: a file drag entering the parent shows the zone
 *              covering exactly that parent (position: absolute; inset: 0),
 *              and it disappears again on drop or leave. For a Files view
 *              whose target is "wherever the list is", not a dedicated box.
 *              A static parent gets `position: relative` (undone on removal).
 *              Nothing to click at rest, so browse() is the picker path.
 *   quiet    — no message of the zone's own about files it did not take
 *              (see "Not added" below): for an app that shows its own,
 *              from sac:rejected.
 *
 * Properties:
 *   accept / label / hint  — string, reflect the attributes.
 *   multiple / disabled / overlay / quiet — boolean, reflect the attributes.
 *
 * Methods:
 *   browse() — opens the picker. Browsers only honor this inside a user
 *              gesture, so call it from a click handler, not on a timer.
 *
 * Events (both bubble + composed, both carry a plain Array):
 *   sac:files    — detail { files } — accepted files, from EITHER input path.
 *                  Every file carries `relativePath`: its path from the dropped
 *                  root ("Photos/2026/IMG_0412.jpg"), or just its name for a
 *                  loose file. A folder drop also adds detail.folders — every
 *                  folder walked, empty ones included ("Photos", "Photos/2026").
 *   sac:rejected — detail { files, rejected, partial } — every file of a drop
 *                  or pick that was NOT delivered. `files` is the plain
 *                  Array of those Files (as before); `rejected` pairs each
 *                  with its reason: [{ file, reason }], reason "type" (outside
 *                  `accept`) or "count" (past the first file without
 *                  `multiple`). `partial` is true when sac:files fired for
 *                  the rest of the same drop (it fires first), false when
 *                  nothing was taken — the only case that fired before 2.36.
 *
 * Not added: unless `quiet`, the zone also says it, in a line under the
 * hint — "photo.jpg was not added – only .svg files", "Only one file – 4
 * were not added" — and a screen reader hears it (a polite announcement; the
 * line also joins the zone's managed aria-label). The line clears on the
 * next drag, drop or browse. An `overlay` zone is gone by then, so its
 * message goes to sac.toast (kind "warn") when the kit has one.
 *
 * Compact/touch: phones have no OS drag-and-drop, so the zone is a tap target
 * first — the whole surface (140px min) opens the picker, the touch wording
 * above replaces "drop/click", a press shows the wash, and no hover wash is
 * left behind. It follows a live switch between touch and mouse. Drops keep
 * working wherever the platform supports them.
 *
 * CSS custom properties:
 *   --drop-zone-min-height — height of the surface. Default 140px.
 *
 * CSS shadow parts:
 *   zone — the dashed surface itself, for the rare app that needs to reshape it.
 *
 * Folder drops: dropped folders are walked (DataTransferItem.webkitGetAsEntry,
 * readEntries until empty) and every file inside is delivered, `accept` and
 * `multiple` applied as usual. A drop without folders, or a browser without
 * webkitGetAsEntry, takes today's path: the top-level FileList as is.
 * The walker is public for tests and other drop targets:
 *   SacDropZone.walkEntries(entries) → Promise<{ files, folders }>
 *   (customElements.get("sac-drop-zone").walkEntries).
 *
 * The zone is a transport, not a store: it keeps no file list. Whatever the
 * app does with `detail.files` is the app's state.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacDropZone extends HTMLElement {
    static get observedAttributes() {
        return ["accept", "multiple", "label", "hint", "touch-label", "touch-hint", "disabled", "overlay", "quiet"];
    }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        // Child elements fire leave/enter storms as the pointer crosses them,
        // and drag events are composed — every shadow-internal crossing shows
        // up at the host. A depth counter is the only stable way to tell
        // "left a child" from "left the zone".
        this._depth = 0;
        this._onWindowDragEnd = this._onWindowDragEnd.bind(this);
        this._onTouchChange = () => { if (this._label) this._sync(); };
        // Overlay mode: the same handlers, bound to the parent instead.
        this._parentHandlers = {
            dragenter: (e) => this._onDragEnter(e),
            dragover:  (e) => this._onDragOver(e),
            dragleave: (e) => this._onDragLeave(e),
            drop:      (e) => this._onDrop(e),
        };
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();

        if (!this.hasAttribute("role")) this.setAttribute("role", "button");

        // A drag that ends outside the zone (dropped on the page, cancelled
        // with Escape, released over another window) never sends us a
        // dragleave — these are the safety nets.
        window.addEventListener("dragend", this._onWindowDragEnd);
        window.addEventListener("drop", this._onWindowDragEnd);
        // A convertible flips between touch and mouse — follow it.
        SacDropZone.TOUCH.addEventListener("change", this._onTouchChange);
        // The polite region "not added" is said through exists before it is
        // needed — a region born with its text is often not read.
        SacDropZone._liveRegion();
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());

        this._bindParent();
        this._sync();
    }

    disconnectedCallback() {
        window.removeEventListener("dragend", this._onWindowDragEnd);
        window.removeEventListener("drop", this._onWindowDragEnd);
        SacDropZone.TOUCH.removeEventListener("change", this._onTouchChange);
        if (this._offLang) { this._offLang(); this._offLang = null; }
        this._unbindParent();
        this._clearOver();
    }

    attributeChangedCallback(name) {
        if (!this.shadowRoot.firstChild) return;   // pre-upgrade attribute
        if (name === "disabled" && this.hasAttribute("disabled")) this._clearOver();
        if (name === "overlay") { this._clearOver(); this._bindParent(); }
        if (name === "quiet" && this.hasAttribute("quiet")) this._note([]);
        this._sync();
    }

    /* ---------------------------------------------------------------- API */

    get accept() { return this.getAttribute("accept") || ""; }
    set accept(v) {
        if (v == null || v === "") this.removeAttribute("accept");
        else this.setAttribute("accept", String(v));
    }

    get label() { return this.getAttribute("label"); }
    set label(v) {
        if (v == null) this.removeAttribute("label");
        else this.setAttribute("label", String(v));
    }

    get hint() { return this.getAttribute("hint"); }
    set hint(v) {
        if (v == null) this.removeAttribute("hint");
        else this.setAttribute("hint", String(v));
    }

    get multiple() { return this.hasAttribute("multiple"); }
    set multiple(v) { this.toggleAttribute("multiple", !!v); }

    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { this.toggleAttribute("disabled", !!v); }

    /** Open the file picker programmatically (needs a user gesture). */
    browse() {
        if (this.hasAttribute("disabled")) return;
        if (!this.shadowRoot.firstChild) this._render();
        if (this._rejected) this._note([]);
        this._input.click();
    }

    get overlay() { return this.hasAttribute("overlay"); }
    set overlay(v) { this.toggleAttribute("overlay", !!v); }

    get quiet() { return this.hasAttribute("quiet"); }
    set quiet(v) { this.toggleAttribute("quiet", !!v); }

    /* ------------------------------------------------------------ overlay */

    /** Overlay mode: the parent carries the drag listeners (and must be a
     *  positioning context). Rebinds cleanly when the attribute flips. */
    _bindParent() {
        const want = this.isConnected && this.hasAttribute("overlay") ? this.parentNode : null;
        if (want === this._parent) return;
        this._unbindParent();
        if (!want) return;
        this._parent = want;
        for (const [type, fn] of Object.entries(this._parentHandlers)) want.addEventListener(type, fn);
        // A shadow root has no box of its own — its host is the surface.
        const box = want instanceof ShadowRoot ? want.host : want;
        if (box instanceof HTMLElement && getComputedStyle(box).position === "static") {
            box.style.position = "relative";
            this._positioned = box;
        }
    }

    _unbindParent() {
        if (!this._parent) return;
        for (const [type, fn] of Object.entries(this._parentHandlers)) this._parent.removeEventListener(type, fn);
        this._parent = null;
        if (this._positioned) { this._positioned.style.position = ""; this._positioned = null; }
    }

    /* --------------------------------------------------------------- sync */

    /** Push every attribute onto the existing nodes. Never re-renders. */
    _sync() {
        const disabled = this.hasAttribute("disabled");

        // On a touch-only device there is no file to drag in from the OS, so
        // "Drop files here / or click to browse" describes a gesture nobody
        // can make. The tap-to-browse wording takes over — touch-label /
        // touch-hint when the app set them, else the kit's touch defaults.
        // An app's own label/hint with no touch-* twin is kept as written.
        const touch = SacDropZone.TOUCH.matches;
        const pick = (name, key, fallback) => {
            if (touch) {
                const tv = this.getAttribute("touch-" + name);
                if (tv != null) return tv;
                if (this.getAttribute(name) == null) return t(key + "-touch", SacDropZone["TOUCH_" + name.toUpperCase()]);
            }
            const v = this.getAttribute(name);
            return v == null ? t(key, fallback) : v;
        };
        const labelText = pick("label", "drop-zone.label", SacDropZone.DEFAULT_LABEL);
        // An overlay only exists mid-drag — "or click to browse" would be a
        // lie there, so its default hint is none (an explicit hint still shows).
        const hintText  = this.hasAttribute("overlay") && this.getAttribute("hint") == null
            ? "" : pick("hint", "drop-zone.hint", SacDropZone.DEFAULT_HINT);

        this._label.textContent = labelText;
        this._hint.textContent  = hintText;
        this._label.hidden = labelText === "";
        this._hint.hidden  = hintText === "";

        // accept goes in verbatim — the input is the authority for the picker
        // path, _accepts() mirrors its semantics for the drop path.
        const accept = this.getAttribute("accept");
        if (accept == null) this._input.removeAttribute("accept");
        else this._input.setAttribute("accept", accept);
        this._input.multiple = this.hasAttribute("multiple");
        this._input.disabled = disabled;

        // The host is the button, so the host carries the button's state.
        this.tabIndex = disabled ? -1 : 0;
        this.setAttribute("aria-disabled", disabled ? "true" : "false");
        if (this._managesAria) {
            const parts = [labelText, hintText, this._msgLabel].filter(Boolean);
            if (parts.length) this.setAttribute("aria-label", parts.join(". "));
            else this.removeAttribute("aria-label");
        }
    }

    /** Runtime language switch: _sync() already only writes text and
     *  attributes onto the existing nodes, so it is the relabel — after a
     *  standing "not added" message is re-worded (not re-announced). */
    _relabel() {
        if (!this._label) return;
        if (this._rejected) this._note(this._rejected, false);
        else this._sync();
    }

    /* -------------------------------------------------------------- files */

    /** `accept` split into lowercased entries. Empty = accept everything. */
    _acceptList() {
        const raw = this.getAttribute("accept");
        if (!raw) return [];
        return raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    }

    /** The <input accept> matching rules, applied by hand to a dropped File. */
    _accepts(file, list) {
        if (list.length === 0) return true;
        const name = (file.name || "").toLowerCase();
        const type = (file.type || "").toLowerCase();
        return list.some((entry) => {
            if (entry.charAt(0) === ".") return name.endsWith(entry);     // .svg
            if (entry.endsWith("/*")) {                                    // image/*
                return type !== "" && type.startsWith(entry.slice(0, -1));
            }
            return type !== "" && type === entry;                          // image/png
        });
    }

    /**
     * One funnel for both input paths: filter, cap at one file when `multiple`
     * is absent, announce. Files the picker returns are already filtered by the
     * input — running them through anyway keeps the event contract identical.
     * Nothing vanishes silently: every file not delivered is reported in
     * sac:rejected with its reason, and (unless `quiet`) said in the zone.
     */
    _deliver(fileList, folders) {
        const all = Array.from(fileList || []);
        if (all.length === 0 && !(folders && folders.length)) return;
        for (const file of all) {
            // A loose file's path is its name (a directory-mode picker
            // already knows the real one). Walked files arrive tagged.
            if (file.relativePath === undefined) SacDropZone.setPath(file, file.webkitRelativePath || file.name);
        }

        const list = this._acceptList();
        const accepted = [];
        const rejected = [];
        for (const file of all) {
            if (this._accepts(file, list)) accepted.push(file);
            else rejected.push({ file, reason: "type" });
        }
        // Without `multiple` the first accepted file goes through; the rest
        // are rejected for their count, not dropped on the floor.
        const taken = this.hasAttribute("multiple") ? accepted : accepted.slice(0, 1);
        for (const file of accepted.slice(taken.length)) rejected.push({ file, reason: "count" });

        // (A dropped folder holding only empty folders still announces
        // them — accepted is empty, but nothing was rejected either.)
        const partial = taken.length > 0 || !rejected.length;
        if (partial) this._emit("sac:files", taken, folders);
        if (rejected.length) {
            this.dispatchEvent(new CustomEvent("sac:rejected", {
                detail: { files: rejected.map((r) => r.file), rejected, partial },
                bubbles:  true,
                composed: true,
            }));
        }
        this._note(rejected, true);
    }

    _emit(type, files, folders) {
        const detail = { files };
        if (folders) detail.folders = folders;
        this.dispatchEvent(new CustomEvent(type, {
            detail,
            bubbles:  true,
            composed: true,
        }));
    }

    /* ----------------------------------------------------------- not added */

    /** The "not added" lines for a rejected list, in the current language. */
    _noteLines(rejected) {
        const byType  = rejected.filter((r) => r.reason === "type");
        const byCount = rejected.filter((r) => r.reason === "count");
        const types = (this.getAttribute("accept") || "").split(",").map((s) => s.trim()).filter(Boolean).join(", ");
        const fill = (text, map) => text.replace(/\{(\w+)\}/g, (m, k) => (k in map ? String(map[k]) : m));
        const lines = [];
        if (byType.length === 1) {
            lines.push(fill(t("drop-zone.rejected-type", "{name} was not added – only {types} files"),
                { name: byType[0].file.name, types }));
        } else if (byType.length > 1) {
            lines.push(fill(t("drop-zone.rejected-types", "{n} files were not added – only {types} files"),
                { n: byType.length, types }));
        }
        if (byCount.length === 1) {
            lines.push(fill(t("drop-zone.rejected-count-one", "Only one file – {name} was not added"),
                { name: byCount[0].file.name }));
        } else if (byCount.length > 1) {
            lines.push(fill(t("drop-zone.rejected-count", "Only one file – {n} were not added"),
                { n: byCount.length }));
        }
        return lines;
    }

    /** Show (or, with [], clear) the zone's "not added" message. `say`
     *  announces it; a language switch only re-words it. */
    _note(rejected, say) {
        this._rejected = rejected && rejected.length && !this.hasAttribute("quiet") ? rejected : null;
        if (!this._msg) return;
        const lines = this._rejected ? this._noteLines(this._rejected) : [];
        this._msgText.textContent = "";
        lines.forEach((line) => {
            const div = document.createElement("div");
            div.textContent = line;
            this._msgText.appendChild(div);
        });
        this._msg.hidden = !lines.length;
        const text = lines.join(". ");
        this._msgLabel = text;
        this._sync();
        if (!say || !lines.length) return;
        // An overlay is gone once the drag ends — its words go to a toast.
        if (this.hasAttribute("overlay")) {
            if (window.sac && typeof sac.toast === "function") sac.toast(text, { kind: "warn" });
            else SacDropZone._announce(text);
        } else {
            SacDropZone._announce(text);
        }
    }

    /* ---------------------------------------------------------------- drag */

    /** True only for drags actually carrying files — text and link drags are
     *  not our business and must not light the zone up. */
    _hasFiles(e) {
        const types = e.dataTransfer && e.dataTransfer.types;
        if (!types) return false;
        return Array.prototype.indexOf.call(types, "Files") !== -1;
    }

    _clearOver() {
        this._depth = 0;
        this.removeAttribute("over");
    }

    _onWindowDragEnd() {
        if (this.hasAttribute("over") || this._depth !== 0) this._clearOver();
    }

    /** In overlay mode the host's own listeners stand down — the event
     *  bubbles on to the parent's, which counts it once. */
    _foreign(e) {
        return !!this._parent && e.currentTarget === this;
    }

    _onDragEnter(e) {
        if (this._foreign(e) || this.hasAttribute("disabled") || !this._hasFiles(e)) return;
        e.preventDefault();
        this._depth++;
        if (!this.hasAttribute("over")) {
            this.setAttribute("over", "");
            if (this._rejected) this._note([]);        // a new try: the old message goes
        }
    }

    _onDragOver(e) {
        if (this._foreign(e) || this.hasAttribute("disabled") || !this._hasFiles(e)) return;
        // Without BOTH of these the drop event never fires at all.
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    }

    /* Deliberately NOT gated on _hasFiles: if a browser trims dataTransfer on
       leave, gating here would strand the zone in its `over` state forever.
       Depth 0 already means "we were never entered", so there is nothing to
       undo. */
    _onDragLeave(e) {
        if (this._foreign(e) || this._depth === 0) return;
        this._depth--;
        if (this._depth <= 0) this._clearOver();
    }

    _onDrop(e) {
        if (this._foreign(e) || this.hasAttribute("disabled")) return;
        const dt = e.dataTransfer;
        // Entries must be taken NOW — the DataTransfer is emptied once this
        // handler returns. null = no folder in the drop (or no API).
        const entries = SacDropZone.dirEntries(dt);
        // Read the files, not the types: `types` is the right question while
        // the drag is still moving, the FileList is the right one on drop.
        if (!entries && (!dt || !dt.files || dt.files.length === 0)) {
            this._clearOver();
            return;
        }
        e.preventDefault();
        this._clearOver();
        if (this._rejected) this._note([]);
        if (!entries) { this._deliver(dt.files); return; }
        SacDropZone.walkEntries(entries).then(({ files, folders }) => this._deliver(files, folders));
    }

    /* ------------------------------------------------------------ pointer */

    _onClick() {
        if (this.hasAttribute("disabled")) return;
        if (this._rejected) this._note([]);
        this._input.click();
    }

    _onKeyDown(e) {
        if (this.hasAttribute("disabled")) return;
        if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
        e.preventDefault();          // Space would scroll the page
        if (this._rejected) this._note([]);
        this._input.click();
    }

    /* ------------------------------------------------------------- render */

    _render() {
        // Decided once, before the first _sync(): only own aria-label if the
        // author did not write one themselves.
        this._managesAria = !this.hasAttribute("aria-label");

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    /* Overridable from the outside: outer-tree declarations
                       beat :host ones, so this is a default, not a lock. */
                    --drop-zone-min-height: 140px;

                    display: block;
                    box-sizing: border-box;
                    border-radius: var(--radius-l);
                    cursor: pointer;
                    user-select: none;
                    -webkit-user-select: none;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                }
                :host(:focus) { outline: none; }
                :host(:focus-visible) {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                }
                :host([disabled]) {
                    cursor: not-allowed;
                    opacity: 0.45;
                }

                .zone {
                    box-sizing: border-box;
                    min-height: var(--drop-zone-min-height);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 0.4rem;
                    padding: 1.5rem 1.25rem;
                    text-align: center;
                    background: var(--glass);
                    /* Thin neutral hairline — dashed says "target", without a
                       fat colored frame on a rounded surface. */
                    border: 1px dashed var(--border-strong);
                    border-radius: var(--radius-l);
                    transition: background 150ms var(--ease-smooth),
                                border-color 150ms var(--ease-smooth),
                                box-shadow 150ms var(--ease-smooth);
                }

                /* Nothing inside is interactive, and transparent content means
                   one less source of enter/leave churn during a drag. */
                .content {
                    display: contents;
                    pointer-events: none;
                }

                .icon {
                    --icon-size: 26px;
                    color: var(--text-dim);
                    transition: color 150ms var(--ease-smooth);
                }
                .label {
                    color: var(--text);
                    font-size: 0.9rem;
                    font-weight: 500;
                    transition: color 150ms var(--ease-smooth);
                }
                .hint {
                    color: var(--text-muted);
                    font-size: 0.8rem;
                }
                /* "Not added": the warn icon carries the kind (its colour),
                   the words stay in reading ink. */
                .msg {
                    display: flex;
                    align-items: flex-start;
                    gap: 6px;
                    max-width: 100%;
                    margin-top: 0.2rem;
                    color: var(--text);
                    font-size: 0.8rem;
                    font-weight: 500;
                    text-align: start;
                    overflow-wrap: anywhere;
                }
                .msg[hidden] { display: none; }
                .msg sac-icon {
                    --icon-size: 14px;
                    flex: none;
                    margin-top: 1px;
                    color: var(--accent-warm-text);
                }

                :host(:not([disabled]):hover) .zone {
                    background: linear-gradient(var(--hover), var(--hover)), var(--glass);
                }
                :host(:not([disabled]):hover) .icon { color: var(--text-muted); }
                /* Press (a mouse): the wash steps up the moment it goes down.
                   A wash, not a scale — the surface never moves. Touch keeps
                   its own press in the (hover: none) block below. */
                :host(:not([disabled]):active) .zone {
                    background: linear-gradient(var(--hover-strong), var(--hover-strong)), var(--glass);
                    transition-duration: 0s;
                }

                /* Drag-over: an accent WASH plus the icon and label flipping to
                   accent. No thickened border, no scale — the surface must not
                   move a pixel while the user is aiming at it.
                   The :not([disabled]) is not redundant: it lifts these rules
                   to the hover rules' specificity, so drag-over always wins
                   over hover in the browsers that keep :hover alive mid-drag. */
                :host([over]:not([disabled])) .zone {
                    background:
                        linear-gradient(color-mix(in srgb, var(--accent) 6%, transparent),
                                        color-mix(in srgb, var(--accent) 6%, transparent)),
                        var(--glass);
                    border-color: var(--accent);
                    box-shadow: inset 0 0 24px color-mix(in srgb, var(--accent) 10%, transparent);
                }
                :host([over]:not([disabled])) .icon,
                :host([over]:not([disabled])) .label { color: var(--accent); }

                /* Touch: no hover wash stuck after the tap that opened the
                   picker; the press itself gives the feedback instead. */
                @media (hover: none) {
                    :host(:not([disabled]):hover) .zone { background: var(--glass); }
                    :host(:not([disabled]):hover) .icon { color: var(--text-dim); }
                    :host(:not([disabled]):active) .zone {
                        background: linear-gradient(var(--hover), var(--hover)), var(--glass);
                    }
                }

                /* Never seen, never focused — only clicked, by us. */
                #picker { display: none; }

                /* Overlay: invisible at rest, then exactly the parent's box
                   while a file drag hovers it. */
                :host([overlay]) {
                    --drop-zone-min-height: 0px;
                    position: absolute;
                    inset: 0;
                    z-index: 20;
                    display: none;
                    cursor: default;
                }
                :host([overlay][over]:not([disabled])) { display: block; }
                :host([overlay]) .zone {
                    height: 100%;
                    background: var(--glass-strong);
                    backdrop-filter: blur(4px);
                    -webkit-backdrop-filter: blur(4px);
                }
                :host([overlay][over]:not([disabled])) .zone {
                    background:
                        linear-gradient(color-mix(in srgb, var(--accent) 8%, transparent),
                                        color-mix(in srgb, var(--accent) 8%, transparent)),
                        var(--glass-strong);
                }

                @media (prefers-reduced-motion: reduce) {
                    .zone, .icon, .label { transition: none; }
                }

                /* Reduced transparency / more contrast: the overlay surface
                   turns solid (the glass hue, nothing shining through) and
                   drops the blur; the drag-over tint stays, a layer of its own
                   on top. (It is only ever seen while a drag is over it.) */
                @media (prefers-reduced-transparency: reduce) {
                    :host([overlay]) .zone { background: var(--glass-solid); backdrop-filter: none; -webkit-backdrop-filter: none; }
                    :host([overlay][over]:not([disabled])) .zone {
                        background:
                            linear-gradient(color-mix(in srgb, var(--accent) 8%, transparent),
                                            color-mix(in srgb, var(--accent) 8%, transparent)),
                            var(--glass-solid);
                    }
                }
                @media (prefers-contrast: more) {
                    :host([overlay]) .zone { background: var(--glass-solid); backdrop-filter: none; -webkit-backdrop-filter: none; border-color: var(--border-contrast); }
                    :host([overlay][over]:not([disabled])) .zone {
                        background:
                            linear-gradient(color-mix(in srgb, var(--accent) 8%, transparent),
                                            color-mix(in srgb, var(--accent) 8%, transparent)),
                            var(--glass-solid);
                    }
                }
            </style>
            <div class="zone" part="zone">
                <div class="content">
                    <sac-icon class="icon" name="upload"></sac-icon>
                    <div class="label"></div>
                    <div class="hint"></div>
                    <div class="msg" part="message" aria-hidden="true" hidden>
                        <sac-icon name="warn"></sac-icon><div class="msg-text"></div>
                    </div>
                </div>
            </div>
            <input id="picker" type="file" tabindex="-1" aria-hidden="true">
        `;

        this._label = this.shadowRoot.querySelector(".label");
        this._hint  = this.shadowRoot.querySelector(".hint");
        this._msg   = this.shadowRoot.querySelector(".msg");
        this._msgText = this.shadowRoot.querySelector(".msg-text");
        this._input = this.shadowRoot.getElementById("picker");

        this._input.addEventListener("change", () => {
            // Snapshot, then clear, then announce: File objects survive the
            // reset, and the input is already clean when app code runs. Without
            // the reset, picking the same file twice in a row is silent (the
            // input's value never changed, so no second `change`).
            const files = Array.from(this._input.files || []);
            this._input.value = "";
            this._deliver(files);
        });
        // click is composed, so _input.click() would bubble back out to the
        // host's own click handler and re-open the picker forever.
        this._input.addEventListener("click", (e) => e.stopPropagation());

        this.addEventListener("click", (e) => this._onClick(e));
        this.addEventListener("keydown", (e) => this._onKeyDown(e));
        this.addEventListener("dragenter", (e) => this._onDragEnter(e));
        this.addEventListener("dragover", (e) => this._onDragOver(e));
        this.addEventListener("dragleave", (e) => this._onDragLeave(e));
        this.addEventListener("drop", (e) => this._onDrop(e));
    }
}

SacDropZone.DEFAULT_LABEL = "Drop files here";
SacDropZone.DEFAULT_HINT  = "or click to browse";
SacDropZone.TOUCH_LABEL   = "Choose files";
SacDropZone.TOUCH_HINT    = "Tap to browse";

/** The one polite live region every zone speaks through — on <body>, not in
 *  the zone: the host is role="button", and WebKit hides a button's
 *  descendants from assistive tech, a live region among them. Created on the
 *  first connect, visually hidden. */
SacDropZone._liveRegion = () => {
    let el = SacDropZone._live;
    if (el && el.isConnected) return el;
    if (!document.body) return null;
    el = document.createElement("div");
    el.setAttribute("role", "status");
    el.setAttribute("data-sac-drop-zone-live", "");
    Object.assign(el.style, {
        position: "absolute", width: "1px", height: "1px", margin: "-1px", padding: "0",
        overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: "0",
    });
    document.body.appendChild(el);
    SacDropZone._live = el;
    return el;
};

/** Say `text` politely: cleared first and set a frame later, so the same
 *  words twice in a row are read twice. */
SacDropZone._announce = (text) => {
    const el = SacDropZone._liveRegion();
    if (!el) return;
    cancelAnimationFrame(SacDropZone._liveRaf);
    el.textContent = "";
    SacDropZone._liveRaf = requestAnimationFrame(() => { el.textContent = String(text || ""); });
};
/** Tag a File with its path from the dropped root. Files are extensible;
 *  defined non-enumerable, so the File still looks like a plain File. */
SacDropZone.setPath = (file, path) => {
    try { Object.defineProperty(file, "relativePath", { value: path, configurable: true }); }
    catch (err) { /* a frozen stand-in — keep going without the path */ }
    return file;
};

/** The drop's FileSystemEntry list when it holds at least one folder; null
 *  otherwise (a plain file drop, or no webkitGetAsEntry) — the caller then
 *  keeps the flat FileList path, unchanged. */
SacDropZone.dirEntries = (dt) => {
    const items = dt && dt.items;
    if (!items || !items.length || typeof items[0].webkitGetAsEntry !== "function") return null;
    const entries = [];
    for (const item of Array.from(items)) {
        if (item.kind !== "file") continue;
        const entry = item.webkitGetAsEntry();
        if (entry) entries.push(entry);
    }
    return entries.some((en) => en.isDirectory) ? entries : null;
};

/** Walk FileSystemEntry objects depth-first → { files, folders }. Every file
 *  gets `relativePath`; an unreadable entry is skipped with a warning, never
 *  aborts the drop. readEntries() hands out one batch per call (Chrome: 100),
 *  so it is called until it returns an empty one. */
SacDropZone.walkEntries = async (entries) => {
    const files = [];
    const folders = [];
    const fileOf  = (entry)  => new Promise((res, rej) => entry.file(res, rej));
    const batchOf = (reader) => new Promise((res, rej) => reader.readEntries(res, rej));
    const walk = async (entry, prefix) => {
        const path = prefix + entry.name;
        try {
            if (entry.isFile) {
                files.push(SacDropZone.setPath(await fileOf(entry), path));
            } else if (entry.isDirectory) {
                folders.push(path);
                const reader = entry.createReader();
                const children = [];
                for (let batch = await batchOf(reader); batch.length; batch = await batchOf(reader)) {
                    children.push(...batch);
                }
                children.sort((a, b) => a.name.localeCompare(b.name));
                for (const child of children) await walk(child, path + "/");
            }
        } catch (err) {
            console.warn(`[sac-drop-zone] skipped "${path}":`, err);
        }
    };
    for (const entry of entries) await walk(entry, "");
    return { files, folders };
};

/* Touch-only: no fine pointer and no hover anywhere — a phone or tablet
   without a mouse. A laptop with a touchscreen still has its mouse, so it
   keeps the drop wording. */
SacDropZone.TOUCH = matchMedia("(hover: none) and (pointer: coarse)");

customElements.define("sac-drop-zone", SacDropZone);
})();
