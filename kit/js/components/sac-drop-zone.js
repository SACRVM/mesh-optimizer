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
 *
 * Properties:
 *   accept / label / hint  — string, reflect the attributes.
 *   multiple / disabled    — boolean, reflect the attributes.
 *
 * Methods:
 *   browse() — opens the picker. Browsers only honor this inside a user
 *              gesture, so call it from a click handler, not on a timer.
 *
 * Events (both bubble + composed, both carry a plain Array):
 *   sac:files    — detail { files } — accepted files, from EITHER input path.
 *   sac:rejected — detail { files } — fired instead of sac:files when `accept`
 *                  filtered out every dropped file. Whether that deserves a
 *                  toast is the app's call, not the kit's.
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
        return ["accept", "multiple", "label", "hint", "touch-label", "touch-hint", "disabled"];
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

        this._sync();
    }

    disconnectedCallback() {
        window.removeEventListener("dragend", this._onWindowDragEnd);
        window.removeEventListener("drop", this._onWindowDragEnd);
        SacDropZone.TOUCH.removeEventListener("change", this._onTouchChange);
        this._clearOver();
    }

    attributeChangedCallback(name) {
        if (!this.shadowRoot.firstChild) return;   // pre-upgrade attribute
        if (name === "disabled" && this.hasAttribute("disabled")) this._clearOver();
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
        this._input.click();
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
        const hintText  = pick("hint",  "drop-zone.hint",  SacDropZone.DEFAULT_HINT);

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
            const parts = [labelText, hintText].filter(Boolean);
            if (parts.length) this.setAttribute("aria-label", parts.join(". "));
            else this.removeAttribute("aria-label");
        }
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
     */
    _deliver(fileList) {
        const all = Array.from(fileList || []);
        if (all.length === 0) return;

        const list = this._acceptList();
        const accepted = [];
        const rejected = [];
        for (const file of all) {
            if (this._accepts(file, list)) accepted.push(file);
            else rejected.push(file);
        }

        if (accepted.length === 0) {
            this._emit("sac:rejected", rejected);
            return;
        }
        this._emit("sac:files", this.hasAttribute("multiple") ? accepted : accepted.slice(0, 1));
    }

    _emit(type, files) {
        this.dispatchEvent(new CustomEvent(type, {
            detail:   { files },
            bubbles:  true,
            composed: true,
        }));
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

    _onDragEnter(e) {
        if (this.hasAttribute("disabled") || !this._hasFiles(e)) return;
        e.preventDefault();
        this._depth++;
        if (!this.hasAttribute("over")) this.setAttribute("over", "");
    }

    _onDragOver(e) {
        if (this.hasAttribute("disabled") || !this._hasFiles(e)) return;
        // Without BOTH of these the drop event never fires at all.
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    }

    /* Deliberately NOT gated on _hasFiles: if a browser trims dataTransfer on
       leave, gating here would strand the zone in its `over` state forever.
       Depth 0 already means "we were never entered", so there is nothing to
       undo. */
    _onDragLeave() {
        if (this._depth === 0) return;
        this._depth--;
        if (this._depth <= 0) this._clearOver();
    }

    _onDrop(e) {
        if (this.hasAttribute("disabled")) return;
        const dt = e.dataTransfer;
        // Read the files, not the types: `types` is the right question while
        // the drag is still moving, the FileList is the right one on drop.
        if (!dt || !dt.files || dt.files.length === 0) {
            this._clearOver();
            return;
        }
        e.preventDefault();
        this._clearOver();
        this._deliver(dt.files);
    }

    /* ------------------------------------------------------------ pointer */

    _onClick() {
        if (this.hasAttribute("disabled")) return;
        this._input.click();
    }

    _onKeyDown(e) {
        if (this.hasAttribute("disabled")) return;
        if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
        e.preventDefault();          // Space would scroll the page
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

                :host(:not([disabled]):hover) .zone {
                    background: linear-gradient(var(--hover), var(--hover)), var(--glass);
                }
                :host(:not([disabled]):hover) .icon { color: var(--text-muted); }

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

                @media (prefers-reduced-motion: reduce) {
                    .zone, .icon, .label { transition: none; }
                }
            </style>
            <div class="zone" part="zone">
                <div class="content">
                    <sac-icon class="icon" name="upload"></sac-icon>
                    <div class="label"></div>
                    <div class="hint"></div>
                </div>
            </div>
            <input id="picker" type="file" tabindex="-1" aria-hidden="true">
        `;

        this._label = this.shadowRoot.querySelector(".label");
        this._hint  = this.shadowRoot.querySelector(".hint");
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
/* Touch-only: no fine pointer and no hover anywhere — a phone or tablet
   without a mouse. A laptop with a touchscreen still has its mouse, so it
   keeps the drop wording. */
SacDropZone.TOUCH = matchMedia("(hover: none) and (pointer: coarse)");

customElements.define("sac-drop-zone", SacDropZone);
})();
