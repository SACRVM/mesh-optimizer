/**
 * <sac-layer-list value="ink" actions></sac-layer-list>
 *
 *   list.layers = [
 *       { id: "ink",   name: "Ink",        visible: true,  locked: false, thumb: inkCanvas },
 *       { id: "color", name: "Flat color", visible: true,  locked: false, thumb: colorCanvas },
 *       { id: "bg",    name: "Background", visible: false, locked: true,  thumb: bgCanvas },
 *   ];
 *   list.addEventListener("sac:toggle", (e) => setLayerProp(e.detail.id, e.detail.prop, e.detail.value));
 *
 * The layer stack of any layered document — a paint or pixel editor, a
 * design tool, a map editor, a compositor. The list shows layers, it
 * does not own them: the app keeps the pixels and the truth, the list
 * reports what the user did and keeps its own rows in step so it never
 * flickers back while the app catches up.
 *
 * ORDER: the array is the list, top to bottom — layers[0] is the TOP row and
 * the TOPMOST layer (drawn last). Compositing bottom-up means iterating the
 * array in reverse. Every index in every event is an index into this order.
 *
 * Row: thumbnail (smooth on the token checker; `pixelated` for pixel art),
 * name, visibility eye,
 * lock. A hidden layer's row is dimmed; a locked one shows a solid lock.
 *
 * Layer fields: id (string, required, unique) · name · visible (default
 *   true) · locked (default false) · thumb — optional thumbnail source:
 *   HTMLCanvasElement / HTMLImageElement / ImageBitmap, ImageData, a plain
 *   { width, height, data } RGBA buffer, or an image URL string.
 *
 * Attributes:
 *   value       — active layer id, reflected.
 *   actions     — presence adds a footer with Add / Duplicate / Delete.
 *   thumb-size  — thumbnail box edge in px, default 32.
 *   label       — accessible name of the list, default "Layers".
 *   pixelated   — presence draws thumbnails with hard pixel edges and an
 *                 integer scale when they fit (pixel art). Default: smooth.
 *
 * Properties:
 *   layers — get/set array. Setting rebuilds the rows and fires nothing
 *            (the objects are copied — the list never mutates yours). The
 *            getter returns the list's current state as new objects.
 *   value  — get/set active id; setting is SILENT.
 *
 * Methods:
 *   refresh(id?) — redraw one thumbnail (or all) after the app painted.
 *
 * Events (bubble, not composed, user action only — the list has already
 * applied the change to its own rows when they fire):
 *   sac:change  — detail { id }: a different layer became active.
 *   sac:reorder — detail { from, to }: a layer moved (array indices, top =
 *                 0). Mirror it: layers.splice(to, 0, ...layers.splice(from, 1)).
 *   sac:toggle  — detail { id, prop: "visible" | "locked", value }.
 *   sac:rename  — detail { id, name }: trimmed, non-empty, actually changed.
 *   sac:action  — detail { action: "add" | "duplicate" | "delete", id }:
 *                 footer button; `id` is the active layer. The list changes
 *                 nothing itself — the app edits its stack and sets `layers`
 *                 (and `value`) anew. Delete is disabled on the last layer.
 *
 * Interaction:
 *   Click a row to activate it · drag a row to reorder (sac.sortable) ·
 *   double-click the name, or F2 on a row, to rename (Enter / blur commits,
 *   Escape reverts) · ↑/↓ move the active layer, Home/End jump ·
 *   Alt+↑/↓ move the active layer up/down the stack · Tab from the active
 *   row reaches its eye and lock buttons (roving: only the active row is a
 *   tab stop).
 *
 * Compact/touch: rows are 44px tall under (pointer: coarse), the eye and
 * lock buttons get 44px hit halos, and dragging a row needs a 250ms
 * long-press so a swipe still scrolls the panel.
 *
 * Theming: tokens only — active row = --accent-tint ground and --accent-text
 * name; the checker is --checker-a/--checker-b.
 */
(function () {
    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;
    /** A kit string with {name} filled in (layer names are app data). */
    const tn = (key, fallback, name) => t(key, fallback).replace("{name}", () => name);
    const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    const icon = (n) => {
        const p = window.sac && sac.icons ? sac.icons.get(n) : null;
        return p ? `<svg ${ICON_ATTRS}>${p}</svg>` : "";
    };

    /** Draw any supported thumbnail source into `canvas` at native size. */
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

    /** Smooth: fill the slot. Pixelated: integer scale when it fits, else shrink. */
    function fitSize(w, h, T, pixelated) {
        const s = Math.min(T / w, T / h);
        const k = pixelated && s >= 1 ? Math.floor(s) : s;
        return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
    }

    class SacLayerList extends HTMLElement {
        static get observedAttributes() { return ["value", "actions", "thumb-size", "label", "pixelated"]; }

        constructor() {
            super();
            this.attachShadow({ mode: "open" });
            this._layers = [];
            this._sortable = null;
            this._editing = null;
        }

        connectedCallback() {
            if (!this.shadowRoot.firstChild) this._render();
            if (!this._sortable && window.sac && sac.sortable) {
                this._sortable = sac.sortable(this._list, {
                    items: ".row",
                    axis: "y",
                    disabled: () => !!this._editing,
                    onReorder: (from, to) => {
                        this._moveData(from, to);
                        this._build();
                        this._emit("sac:reorder", { from, to });
                    },
                });
            }
            if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
        }
        disconnectedCallback() {
            if (this._sortable) { this._sortable.destroy(); this._sortable = null; }
            if (this._offLang) { this._offLang(); this._offLang = null; }
        }

        /** Kit strings onto the existing nodes: the list's name (unless the
         *  app set `label`) and the three footer actions. */
        _labels() {
            this._list.setAttribute("aria-label", this.getAttribute("label") || t("layer-list.layers", "Layers"));
            const act = (action, text) => {
                const b = this._foot.querySelector(`[data-action="${action}"]`);
                b.title = text;
                b.setAttribute("aria-label", text);
            };
            act("add",       t("layer-list.add", "Add layer"));
            act("duplicate", t("layer-list.duplicate", "Duplicate layer"));
            act("delete",    t("layer-list.delete", "Delete layer"));
        }

        /** Runtime language switch: every label in place via _paintRow — no
         *  rebuild, so the active layer, focus, scroll and a rename in
         *  progress (its typed text included) all survive. */
        _relabel() {
            if (!this._list) return;
            this._labels();
            const rows = this._rows();
            this._layers.forEach((l, i) => { if (rows[i]) this._paintRow(rows[i], l); });
            const input = this._list.querySelector(".name input");
            if (input) input.setAttribute("aria-label", t("layer-list.name", "Layer name"));
        }

        attributeChangedCallback(name) {
            if (!this.shadowRoot.firstChild) return;
            if (name === "value") this._applyActive();
            else if (name === "actions") this._syncActions();
            else if (name === "thumb-size") this._build();
            else if (name === "pixelated") this.refresh();
            else if (name === "label") this._labels();
        }

        get layers() { return this._layers.map((l) => ({ ...l })); }
        set layers(list) {
            this._layers = (Array.isArray(list) ? list : []).map((l) => ({
                ...l,
                id: String(l.id),
                name: l.name == null ? String(l.id) : String(l.name),
                visible: l.visible !== false,
                locked: !!l.locked,
            }));
            if (this.shadowRoot.firstChild) this._build();
        }

        get value() { return this.getAttribute("value") || ""; }
        set value(v) { this.setAttribute("value", String(v)); }

        refresh(id) {
            if (!this._list) return;
            const T = this._thumb();
            this._rows().forEach((row, i) => {
                if (id != null && row.dataset.id !== String(id)) return;
                const cv = row.querySelector("canvas");
                const fit = () => {
                    const [w, h] = fitSize(cv.width, cv.height, T, this.hasAttribute("pixelated"));
                    cv.style.width = w + "px"; cv.style.height = h + "px";
                };
                paintSource(cv, this._layers[i] && this._layers[i].thumb, fit);
                fit();
            });
        }

        _thumb() {
            const n = parseInt(this.getAttribute("thumb-size"), 10);
            return Number.isFinite(n) && n > 8 ? n : 32;
        }
        _rows() { return Array.from(this._list.querySelectorAll(".row")); }
        _index(id) { return this._layers.findIndex((l) => l.id === id); }
        _emit(name, detail) {
            this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: false }));
        }

        _render() {
            this.shadowRoot.innerHTML = `
                <style>
                    :host {
                        display: flex;
                        flex-direction: column;
                        min-width: 0;
                        --_t: 32px;
                    }
                    .list {
                        display: flex;
                        flex-direction: column;
                        gap: 2px;
                        min-height: 0;
                        overflow-y: auto;
                        overscroll-behavior-y: contain;
                        scrollbar-width: thin;
                        scrollbar-color: var(--scrollbar-thumb) transparent;
                    }
                    .row {
                        display: flex;
                        align-items: center;
                        gap: 0.5rem;
                        padding: 4px 4px 4px 6px;
                        border-radius: var(--radius-m);
                        color: var(--text-muted);
                        cursor: pointer;
                        user-select: none;
                        -webkit-touch-callout: none;
                        transition: background 0.15s, color 0.15s;
                    }
                    .row:hover { background: var(--hover); color: var(--text); }
                    .row.active { background: var(--accent-tint); color: var(--accent-text); }
                    .row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
                    .row[data-sortable-dragging] { background: var(--panel-2); box-shadow: var(--shadow-2); }
                    .row.hidden-layer .box,
                    .row.hidden-layer .name { opacity: 0.45; }
                    .box {
                        flex: 0 0 auto;
                        width: var(--_t);
                        height: var(--_t);
                        display: grid;
                        place-items: center;
                        border-radius: var(--radius-s);
                        background: var(--field);
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
                        background-size: 6px 6px;
                    }
                    .name {
                        flex: 1;
                        min-width: 0;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                        font-size: 0.85rem;
                    }
                    .name input {
                        width: 100%;
                        box-sizing: border-box;
                        font: inherit;
                        color: var(--text);
                        background: var(--field);
                        border: 1px solid var(--accent);
                        border-radius: var(--radius-s);
                        padding: 1px 4px;
                        outline: none;
                        user-select: text;
                    }
                    .tog, .act {
                        flex: 0 0 auto;
                        width: var(--icon-btn-size);
                        height: var(--icon-btn-size);
                        display: inline-grid;
                        place-items: center;
                        padding: 0;
                        border: none;
                        border-radius: var(--radius-m);
                        background: transparent;
                        color: inherit;
                        cursor: pointer;
                    }
                    .tog svg, .act svg { width: var(--icon-btn-icon); height: var(--icon-btn-icon); }
                    .tog:hover, .act:hover { background: var(--hover-strong); color: var(--text); }
                    .tog:focus-visible, .act:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
                    /* An unlocked lock is quiet until the row is looked at. */
                    .tog.lock:not([aria-pressed="true"]) { opacity: 0.35; }
                    .row:hover .tog.lock, .row.active .tog.lock, .tog.lock:focus-visible { opacity: 1; }
                    .foot {
                        display: flex;
                        justify-content: flex-end;
                        gap: 2px;
                        padding-top: 4px;
                        margin-top: 4px;
                        border-top: 1px solid var(--border);
                    }
                    .foot[hidden] { display: none; }
                    .act { color: var(--text-muted); }
                    .act:disabled { opacity: 0.4; cursor: not-allowed; background: transparent; }
                    .act.danger:hover:not(:disabled) { color: var(--danger-text); }

                    @media (prefers-reduced-motion: reduce) {
                        .row { transition: none; }
                    }
                    @media (pointer: coarse) {
                        .row { min-height: 44px; }
                        .tog, .act { position: relative; }
                        .tog::after, .act::after {
                            content: "";
                            position: absolute;
                            inset: min(0px, calc((100% - 44px) / 2));
                        }
                        .tog.lock:not([aria-pressed="true"]) { opacity: 0.6; }
                    }
                    @media (hover: none) {
                        .row:hover { background: transparent; color: var(--text-muted); }
                        .row.active:hover { background: var(--accent-tint); color: var(--accent-text); }
                    }
                </style>
                <div class="list" role="listbox"></div>
                <div class="foot" hidden>
                    <button class="act" data-action="add" type="button">${icon("plus") || "+"}</button>
                    <button class="act" data-action="duplicate" type="button">${icon("copy") || "⧉"}</button>
                    <button class="act danger" data-action="delete" type="button">${icon("trash") || "×"}</button>
                </div>`;
            this._list = this.shadowRoot.querySelector(".list");
            this._foot = this.shadowRoot.querySelector(".foot");
            this._labels();

            this._list.addEventListener("click", (e) => {
                const row = e.target.closest(".row");
                if (!row || this._editing) return;
                const tog = e.target.closest(".tog");
                if (tog) { this._toggle(row.dataset.id, tog.dataset.prop); return; }
                this._activate(row.dataset.id, false);
            });
            this._list.addEventListener("dblclick", (e) => {
                if (e.target.closest(".tog")) return;
                const row = e.target.closest(".row");
                if (row) this._rename(row.dataset.id);
            });
            this._list.addEventListener("keydown", (e) => this._onKey(e));
            this._foot.addEventListener("click", (e) => {
                const b = e.target.closest(".act");
                if (!b || b.disabled) return;
                this._emit("sac:action", { action: b.dataset.action, id: this.value });
            });
            this._syncActions();
            this._build();
        }

        _build() {
            this._editing = null;
            this._list.style.setProperty("--_t", this._thumb() + "px");
            this._list.textContent = "";
            for (const l of this._layers) {
                const row = document.createElement("div");
                row.className = "row";
                row.dataset.id = l.id;
                row.setAttribute("role", "option");
                row.innerHTML = `
                    <span class="box"><canvas></canvas></span>
                    <span class="name"></span>
                    <button class="tog eye" type="button" data-prop="visible"></button>
                    <button class="tog lock" type="button" data-prop="locked"></button>`;
                row.querySelector(".name").textContent = l.name;
                this._list.appendChild(row);
                this._paintRow(row, l);
            }
            this.refresh();
            this._applyActive();
            this._syncActions();
        }

        /** Row state that the toggles change — no rebuild, so focus stays put. */
        _paintRow(row, l) {
            row.classList.toggle("hidden-layer", !l.visible);
            const state = [l.name];
            if (!l.visible) state.push(t("layer-list.hidden", "hidden"));
            if (l.locked)   state.push(t("layer-list.locked", "locked"));
            row.setAttribute("aria-label", state.join(", "));
            const eye = row.querySelector(".eye");
            eye.innerHTML = icon(l.visible ? "eye" : "eye-off");
            eye.setAttribute("aria-pressed", l.visible ? "false" : "true");
            eye.setAttribute("aria-label", l.visible
                ? tn("layer-list.hide-named", "Hide {name}", l.name)
                : tn("layer-list.show-named", "Show {name}", l.name));
            eye.title = l.visible ? t("layer-list.hide", "Hide layer") : t("layer-list.show", "Show layer");
            const lock = row.querySelector(".lock");
            lock.innerHTML = icon(l.locked ? "lock" : "unlock");
            lock.setAttribute("aria-pressed", l.locked ? "true" : "false");
            lock.setAttribute("aria-label", l.locked
                ? tn("layer-list.unlock-named", "Unlock {name}", l.name)
                : tn("layer-list.lock-named", "Lock {name}", l.name));
            lock.title = l.locked ? t("layer-list.unlock", "Unlock layer") : t("layer-list.lock", "Lock layer");
        }

        _applyActive() {
            if (!this._list) return;
            const rows = this._rows();
            let act = this.value;
            if (!rows.some((r) => r.dataset.id === act)) act = rows[0] ? rows[0].dataset.id : "";
            rows.forEach((r) => {
                const on = r.dataset.id === act;
                r.classList.toggle("active", on);
                r.setAttribute("aria-selected", on ? "true" : "false");
                // Roving: only the active row (and its toggles) are tab stops.
                r.tabIndex = on ? 0 : -1;
                r.querySelectorAll(".tog").forEach((b) => { b.tabIndex = on ? 0 : -1; });
            });
        }

        _activate(id, focus) {
            if (id == null || this._index(id) < 0) return;
            const changed = id !== this.value;
            this.setAttribute("value", id);
            const row = this._rows().find((r) => r.dataset.id === id);
            if (row) {
                if (focus) row.focus();
                row.scrollIntoView({ block: "nearest" });
            }
            if (changed) this._emit("sac:change", { id });
        }

        _toggle(id, prop) {
            const i = this._index(id);
            if (i < 0) return;
            const l = this._layers[i];
            l[prop] = !l[prop];
            this._paintRow(this._rows()[i], l);
            this._emit("sac:toggle", { id, prop, value: l[prop] });
        }

        _moveData(from, to) {
            const [l] = this._layers.splice(from, 1);
            this._layers.splice(to, 0, l);
        }

        _rename(id) {
            const i = this._index(id);
            if (i < 0 || this._editing) return;
            const row = this._rows()[i];
            const slot = row.querySelector(".name");
            const old = this._layers[i].name;
            const input = document.createElement("input");
            input.type = "text";
            input.value = old;
            input.setAttribute("aria-label", t("layer-list.name", "Layer name"));
            slot.textContent = "";
            slot.appendChild(input);
            this._editing = id;
            input.focus();
            input.select();

            let done = false;
            const finish = (commit) => {
                if (done) return;
                done = true;
                const name = input.value.trim();
                const ok = commit && name && name !== old;
                if (ok) this._layers[i].name = name;
                this._editing = null;
                slot.textContent = this._layers[i].name;
                this._paintRow(row, this._layers[i]);
                row.focus();
                if (ok) this._emit("sac:rename", { id, name });
            };
            input.addEventListener("keydown", (e) => {
                e.stopPropagation();   // the row's arrow/F2 keys stay out of the editor
                if (e.key === "Enter") { e.preventDefault(); finish(true); }
                else if (e.key === "Escape") { e.preventDefault(); finish(false); }
            });
            input.addEventListener("blur", () => finish(true));
            input.addEventListener("click", (e) => e.stopPropagation());
            input.addEventListener("dblclick", (e) => e.stopPropagation());
        }

        _onKey(e) {
            if (this._editing) return;
            const row = e.target.closest(".row");
            if (!row || e.target !== row) return;   // keys on the toggles are theirs
            const rows = this._rows();
            const i = rows.indexOf(row);
            const n = rows.length;
            if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                e.preventDefault();
                const to = i + (e.key === "ArrowUp" ? -1 : 1);
                if (to < 0 || to >= n) return;
                const id = row.dataset.id;
                this._moveData(i, to);
                this._build();
                this._rows()[to].focus();
                this._emit("sac:reorder", { from: i, to });
                if (id !== this.value) this._activate(id, true);
                return;
            }
            const go = (j) => { if (rows[j]) this._activate(rows[j].dataset.id, true); };
            switch (e.key) {
                case "ArrowUp":   e.preventDefault(); go(Math.max(0, i - 1)); break;
                case "ArrowDown": e.preventDefault(); go(Math.min(n - 1, i + 1)); break;
                case "Home":      e.preventDefault(); go(0); break;
                case "End":       e.preventDefault(); go(n - 1); break;
                case "F2":        e.preventDefault(); this._rename(row.dataset.id); break;
                case "Enter":
                case " ":         e.preventDefault(); this._activate(row.dataset.id, true); break;
            }
        }

        _syncActions() {
            if (!this._foot) return;
            this._foot.hidden = !this.hasAttribute("actions");
            const n = this._layers.length;
            this._foot.querySelector('[data-action="duplicate"]').disabled = n < 1;
            this._foot.querySelector('[data-action="delete"]').disabled = n <= 1;
        }
    }

    if (!customElements.get("sac-layer-list")) customElements.define("sac-layer-list", SacLayerList);
})();
