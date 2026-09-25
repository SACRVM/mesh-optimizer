/**
 * <sac-filmstrip value="0" actions reorderable>
 *     <button slot="controls" class="icon-btn" title="Play">…</button>
 * </sac-filmstrip>
 *
 *   strip.frames = [canvas0, canvas1, imageData2, "frame3.png"];
 *   strip.addEventListener("sac:change", (e) => showFrame(e.detail.index));
 *   // after painting into frame 2:
 *   strip.refresh(2);
 *
 * The frame row of any animation or image sequence — a sprite editor's
 * timeline, a slideshow, rendered 3D frames, a video's keyframes: a
 * horizontal row of thumbnails, one active. It shows frames, it does not own
 * them — the app keeps the content and tells the strip when it changed
 * (`refresh`). Thumbnails are scaled smoothly on the token transparency
 * checker (add `pixelated` for pixel art), each with its 1-based number
 * underneath — the same number the 1…0 keys of a typical editor use.
 *
 * Frame sources (the `frames` array, any mix):
 *   HTMLCanvasElement / HTMLImageElement / ImageBitmap — drawn as is.
 *   ImageData, or a plain { width, height, data } RGBA buffer — put in.
 *   A string — an image URL, loaded then drawn (redraws when it arrives).
 *
 * Attributes:
 *   value       — active frame index (0-based), reflected. Clamped into the
 *                 frame range on render. Default 0.
 *   thumb-size  — thumbnail box edge in px, default 48.
 *   actions     — presence adds trailing Add / Duplicate / Delete buttons.
 *   reorderable — presence enables drag-to-reorder (sac.sortable) and
 *                 Alt+←/→.
 *   label       — accessible name of the strip, default "Frames".
 *   pixelated   — presence draws thumbnails with hard pixel edges and an
 *                 integer scale when the frame fits (pixel art). Default:
 *                 smooth scaling to the thumbnail box.
 *
 * Properties:
 *   frames — get/set array. Setting rebuilds every thumbnail and fires
 *            nothing. The getter returns the strip's current order (after
 *            user reorders), as a new array.
 *   value  — get/set number; setting is SILENT, like every value control.
 *
 * Methods:
 *   refresh(index?) — redraw one thumbnail (or all) from its source, after
 *                     the app painted into it. Sources are held by reference,
 *                     so a canvas the app keeps drawing into just needs this.
 *
 * Events (bubble, not composed, user action only):
 *   sac:change  — detail { index }: the user picked a frame.
 *   sac:reorder — detail { from, to }: the user moved a frame. The strip has
 *                 ALREADY reordered itself (and the active frame followed);
 *                 the app mirrors it on its own data:
 *                 frames.splice(to, 0, ...frames.splice(from, 1)).
 *   sac:action  — detail { action: "add" | "duplicate" | "delete", index }:
 *                 an action button (or Delete key) was used; `index` is the
 *                 active frame. The strip changes nothing on its own — the
 *                 app edits its frames and sets `frames` (and `value`) anew.
 *
 * Slots:
 *   controls — leading app buttons (play, onion skin, fps…), before the
 *              thumbnails. Use the kit's .icon-btn for them.
 *
 * Keyboard (roving tabindex — the active frame is the one tab stop):
 *   ←/→ select the previous/next frame · Home/End the first/last ·
 *   Alt+←/→ move the active frame (reorderable) · Delete / Backspace fire
 *   the delete action (actions).
 *
 * Compact/touch: the thumbnail row scrolls sideways inside its own box (the
 * page never widens), the active frame is scrolled into view on every
 * change. Under (pointer: coarse) the thumbnails and action buttons reach
 * 44px targets; dragging a frame needs a 250ms long-press so a swipe still
 * scrolls the row.
 *
 * Theming: tokens only — active frame = --accent-tint ground, an --accent
 * focus-style outline (not a border) and --accent-text caption. The checker
 * is --checker-a/--checker-b. --sac-filmstrip-inset (default 0.5rem) keeps
 * the controls and actions off the element's left/right edges; set it to 0
 * inside a container that already pads.
 */
(function () {
    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

    const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

    /** Draw any supported frame source into `canvas` at native size. `onLate` fires when a URL loads. */
    function paintSource(canvas, src, onLate) {
        const ctx = canvas.getContext("2d");
        const put = (w, h, fn) => {
            canvas.width = Math.max(1, w); canvas.height = Math.max(1, h);
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            fn();
        };
        if (!src) { put(1, 1, () => {}); return; }
        if (typeof src === "string") {
            const img = new Image();
            img.onload = () => { put(img.naturalWidth, img.naturalHeight, () => ctx.drawImage(img, 0, 0)); onLate && onLate(); };
            img.src = src;
            put(1, 1, () => {});
            return;
        }
        if (src instanceof ImageData) { put(src.width, src.height, () => ctx.putImageData(src, 0, 0)); return; }
        if (src.data && src.width && src.height && !(src instanceof HTMLElement)) {
            const d = src.data instanceof Uint8ClampedArray ? src.data : new Uint8ClampedArray(src.data);
            put(src.width, src.height, () => ctx.putImageData(new ImageData(d, src.width, src.height), 0, 0));
            return;
        }
        const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
        put(w, h, () => ctx.drawImage(src, 0, 0));
    }

    /** CSS box for a w×h image in a T×T slot. Smooth: fill the slot. Pixelated:
     *  integer scale when it fits (every source pixel the same size), else shrink. */
    function fitSize(w, h, T, pixelated) {
        const s = Math.min(T / w, T / h);
        const k = pixelated && s >= 1 ? Math.floor(s) : s;
        return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
    }

    class SacFilmstrip extends HTMLElement {
        static get observedAttributes() { return ["value", "thumb-size", "actions", "reorderable", "label", "pixelated"]; }

        constructor() {
            super();
            this.attachShadow({ mode: "open" });
            this._frames = [];
            this._sortable = null;
        }

        connectedCallback() {
            if (!this.shadowRoot.firstChild) this._render();
            this._syncSortable();
            if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
        }
        disconnectedCallback() {
            if (this._sortable) { this._sortable.destroy(); this._sortable = null; }
            if (this._offLang) { this._offLang(); this._offLang = null; }
        }

        /** Kit strings onto the existing nodes: the strip's name (unless the
         *  app set `label`) and the three action buttons. */
        _labels() {
            this._strip.setAttribute("aria-label", this.getAttribute("label") || t("filmstrip.frames", "Frames"));
            const act = (action, text) => {
                const b = this._actions.querySelector(`[data-action="${action}"]`);
                b.title = text;
                b.setAttribute("aria-label", text);
            };
            act("add",       t("filmstrip.add", "Add frame"));
            act("duplicate", t("filmstrip.duplicate", "Duplicate frame"));
            act("delete",    t("filmstrip.delete", "Delete frame"));
        }

        /** Runtime language switch: labels in place — frames, thumbnails,
         *  the active frame and the strip's scroll are untouched. */
        _relabel() {
            if (!this._strip) return;
            this._labels();
            this._applyActive(false);
        }

        attributeChangedCallback(name) {
            if (!this.shadowRoot.firstChild) return;
            if (name === "value") this._applyActive(false);
            else if (name === "thumb-size" || name === "pixelated") this.refresh();
            else if (name === "actions") this._syncActions();
            else if (name === "reorderable") this._syncSortable();
            else if (name === "label") this._labels();
        }

        get frames() { return this._frames.slice(); }
        set frames(list) {
            this._frames = Array.isArray(list) ? list.slice() : [];
            if (this.shadowRoot.firstChild) this._build();
        }

        get value() {
            const n = parseInt(this.getAttribute("value"), 10);
            return Number.isFinite(n) ? n : 0;
        }
        set value(v) { this.setAttribute("value", String(v)); }

        refresh(index) {
            if (!this._strip) return;
            const cells = this._cells();
            const T = this._thumb();
            const draw = (i) => {
                const cell = cells[i];
                if (!cell) return;
                const cv = cell.querySelector("canvas");
                const fit = () => {
                    const [w, h] = fitSize(cv.width, cv.height, T, this.hasAttribute("pixelated"));
                    cv.style.width = w + "px"; cv.style.height = h + "px";
                };
                paintSource(cv, this._frames[i], fit);
                fit();
            };
            if (index == null) cells.forEach((_, i) => draw(i));
            else draw(index);
        }

        _thumb() {
            const n = parseInt(this.getAttribute("thumb-size"), 10);
            return Number.isFinite(n) && n > 8 ? n : 48;
        }
        _cells() { return Array.from(this._strip.querySelectorAll(".frame")); }
        _emit(name, detail) {
            this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: false }));
        }

        _render() {
            this.shadowRoot.innerHTML = `
                <style>
                    :host {
                        display: flex;
                        min-width: 0;
                        max-width: 100%;
                        --_t: 48px;
                    }
                    .bar {
                        display: flex;
                        align-items: center;
                        gap: 0.5rem;
                        /* Keeps the controls and actions off the edges; a
                           container that already pads sets it to 0. */
                        padding-inline: var(--sac-filmstrip-inset, 0.5rem);
                        min-width: 0;
                        flex: 1;
                    }
                    ::slotted(*) { flex: 0 0 auto; }
                    .strip {
                        display: flex;
                        gap: 6px;
                        padding: 4px;
                        overflow-x: auto;
                        overflow-y: hidden;
                        min-width: 0;
                        flex: 1;
                        scrollbar-width: thin;
                        scrollbar-color: var(--scrollbar-thumb) transparent;
                        overscroll-behavior-x: contain;
                    }
                    .frame {
                        flex: 0 0 auto;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 3px;
                        padding: 4px;
                        border: 1px solid var(--border);
                        border-radius: var(--radius-m);
                        background: var(--field);
                        color: var(--text-muted);
                        cursor: pointer;
                        font: inherit;
                        transition: background 0.15s, color 0.15s;
                        -webkit-touch-callout: none;
                    }
                    .frame:hover { background: var(--hover); color: var(--text); }
                    .frame.active {
                        background: var(--accent-tint);
                        color: var(--accent-text);
                        outline: 2px solid var(--accent);
                        outline-offset: 1px;
                    }
                    .frame:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
                    .frame[data-sortable-dragging] { box-shadow: var(--shadow-2); background: var(--panel-2); }
                    .box {
                        width: var(--_t);
                        height: var(--_t);
                        display: grid;
                        place-items: center;
                    }
                    :host([pixelated]) canvas { image-rendering: pixelated; }
                    canvas {
                        display: block;
                        /* Smooth by default (photos, vector, 3D frames);
                           [pixelated] keeps hard pixel edges for pixel art. */
                        image-rendering: auto;
                        background-color: var(--checker-a, color-mix(in srgb, var(--fg) 6%, transparent));
                        background-image: conic-gradient(
                            var(--checker-b, color-mix(in srgb, var(--fg) 12%, transparent)) 90deg,
                            transparent 90deg 180deg,
                            var(--checker-b, color-mix(in srgb, var(--fg) 12%, transparent)) 180deg 270deg,
                            transparent 270deg);
                        background-size: 8px 8px;
                    }
                    .cap {
                        font-size: 0.7rem;
                        line-height: 1;
                        font-variant-numeric: tabular-nums;
                    }
                    .actions { display: flex; gap: 2px; flex: 0 0 auto; }
                    .actions[hidden] { display: none; }
                    .act {
                        width: var(--icon-btn-size);
                        height: var(--icon-btn-size);
                        display: inline-grid;
                        place-items: center;
                        padding: 0;
                        border: none;
                        border-radius: var(--radius-m);
                        background: transparent;
                        color: var(--text-muted);
                        cursor: pointer;
                    }
                    .act svg { width: var(--icon-btn-icon); height: var(--icon-btn-icon); }
                    .act:hover { background: var(--hover); color: var(--text); }
                    .act:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
                    .act:disabled { opacity: 0.4; cursor: not-allowed; background: transparent; }
                    .act.danger:hover:not(:disabled) { color: var(--danger-text); }

                    @media (prefers-reduced-motion: reduce) {
                        .frame { transition: none; }
                    }
                    @media (pointer: coarse) {
                        .frame { min-width: 44px; min-height: 44px; touch-action: pan-x; }
                        .act { position: relative; }
                        .act::after {
                            content: "";
                            position: absolute;
                            inset: min(0px, calc((100% - 44px) / 2));
                        }
                    }
                    @media (hover: none) {
                        .frame:hover { background: var(--field); color: var(--text-muted); }
                        .frame.active:hover { background: var(--accent-tint); color: var(--accent-text); }
                        .act:hover { background: transparent; color: var(--text-muted); }
                    }
                </style>
                <div class="bar">
                    <slot name="controls"></slot>
                    <div class="strip" role="listbox" aria-orientation="horizontal"></div>
                    <div class="actions" hidden>
                        <button class="act" data-action="add" type="button"></button>
                        <button class="act" data-action="duplicate" type="button"></button>
                        <button class="act danger" data-action="delete" type="button"></button>
                    </div>
                </div>`;
            this._strip = this.shadowRoot.querySelector(".strip");
            this._actions = this.shadowRoot.querySelector(".actions");
            this._labels();
            // Icons straight from the registry — a <sac-icon> would work too,
            // but the buttons must render even before sac-icon.js is defined.
            const icon = (n) => {
                const p = window.sac && sac.icons ? sac.icons.get(n) : null;
                return p ? `<svg ${ICON_ATTRS}>${p}</svg>` : "";
            };
            this._actions.querySelector('[data-action="add"]').innerHTML = icon("plus") || "+";
            this._actions.querySelector('[data-action="duplicate"]').innerHTML = icon("copy") || "⧉";
            this._actions.querySelector('[data-action="delete"]').innerHTML = icon("trash") || "×";

            this._strip.addEventListener("click", (e) => {
                const cell = e.target.closest(".frame");
                if (!cell) return;
                this._select(this._cells().indexOf(cell), false);
            });
            this._strip.addEventListener("keydown", (e) => this._onKey(e));
            this._actions.addEventListener("click", (e) => {
                const b = e.target.closest(".act");
                if (!b || b.disabled) return;
                this._emit("sac:action", { action: b.dataset.action, index: this._clamped() });
            });
            this._syncActions();
            this._build();
        }

        _build() {
            const T = this._thumb();
            this._strip.style.setProperty("--_t", T + "px");
            this._strip.textContent = "";
            this._frames.forEach((_, i) => {
                const cell = document.createElement("button");
                cell.type = "button";
                cell.className = "frame";
                cell.setAttribute("role", "option");
                cell.innerHTML = `<span class="box"><canvas></canvas></span><span class="cap">${i + 1}</span>`;
                this._strip.appendChild(cell);
            });
            this.refresh();
            this._applyActive(false);
            this._syncActions();
        }

        _clamped() {
            const n = this._frames.length;
            return n ? Math.min(n - 1, Math.max(0, this.value)) : -1;
        }

        _applyActive(scroll = true) {
            if (!this._strip) return;
            const act = this._clamped();
            const cells = this._cells();
            const n = cells.length;
            cells.forEach((c, i) => {
                const on = i === act;
                c.classList.toggle("active", on);
                c.setAttribute("aria-selected", on ? "true" : "false");
                c.setAttribute("aria-label", t("filmstrip.frame", "Frame {i} of {n}")
                    .replace("{i}", i + 1).replace("{n}", n));
                c.querySelector(".cap").textContent = String(i + 1);
                c.tabIndex = on ? 0 : -1;
            });
            if (scroll && cells[act]) cells[act].scrollIntoView({ block: "nearest", inline: "nearest" });
            this._syncActions();
        }

        _select(i, focus) {
            const n = this._frames.length;
            if (!n) return;
            i = Math.min(n - 1, Math.max(0, i));
            const changed = i !== this._clamped();
            this.setAttribute("value", String(i));
            this._applyActive(true);
            if (focus) this._cells()[i].focus();
            if (changed) this._emit("sac:change", { index: i });
        }

        _move(from, to) {
            const n = this._frames.length;
            if (to < 0 || to >= n || from === to) return;
            const [f] = this._frames.splice(from, 1);
            this._frames.splice(to, 0, f);
            // The active frame follows the reorder — same frame, new index.
            const act = this._clamped();
            let next = act;
            if (act === from) next = to;
            else if (from < act && to >= act) next = act - 1;
            else if (from > act && to <= act) next = act + 1;
            this.setAttribute("value", String(next));
        }

        _onKey(e) {
            const cell = e.target.closest(".frame");
            if (!cell) return;
            const i = this._cells().indexOf(cell);
            const n = this._frames.length;
            const reorder = this.hasAttribute("reorderable");
            if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                if (!reorder) return;
                e.preventDefault();
                const to = i + (e.key === "ArrowLeft" ? -1 : 1);
                if (to < 0 || to >= n) return;
                this._move(i, to);
                this._build();
                this._cells()[to].focus();
                this._emit("sac:reorder", { from: i, to });
                return;
            }
            switch (e.key) {
                case "ArrowLeft":  e.preventDefault(); this._select(i - 1, true); break;
                case "ArrowRight": e.preventDefault(); this._select(i + 1, true); break;
                case "Home":       e.preventDefault(); this._select(0, true); break;
                case "End":        e.preventDefault(); this._select(n - 1, true); break;
                case "Delete":
                case "Backspace":
                    if (!this.hasAttribute("actions") || n <= 1) return;
                    e.preventDefault();
                    this._emit("sac:action", { action: "delete", index: i });
                    break;
            }
        }

        _syncActions() {
            if (!this._actions) return;
            const on = this.hasAttribute("actions");
            this._actions.hidden = !on;
            const n = this._frames.length;
            this._actions.querySelector('[data-action="duplicate"]').disabled = n < 1;
            this._actions.querySelector('[data-action="delete"]').disabled = n <= 1;
        }

        _syncSortable() {
            const want = this.isConnected && this.hasAttribute("reorderable") && this._strip && window.sac && sac.sortable;
            if (want && !this._sortable) {
                this._sortable = sac.sortable(this._strip, {
                    items: ".frame",
                    axis: "x",
                    onReorder: (from, to) => {
                        // The helper already moved the cell; re-render from data
                        // so captions, labels and tabindex agree.
                        this._move(from, to);
                        this._build();
                        this._emit("sac:reorder", { from, to });
                    },
                });
            } else if (!want && this._sortable) {
                this._sortable.destroy();
                this._sortable = null;
            }
        }
    }

    if (!customElements.get("sac-filmstrip")) customElements.define("sac-filmstrip", SacFilmstrip);
})();
