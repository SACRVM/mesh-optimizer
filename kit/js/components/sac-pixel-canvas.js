/**
 * <sac-pixel-canvas>  —  the pixel editor's viewport.
 *
 *   <sac-pixel-canvas style="height: 480px"></sac-pixel-canvas>
 *   canvas.image = imageData;          // or a canvas / <img> / {width,height,data}
 *   canvas.addEventListener("sac:pixel-down", (e) => paint(e.detail.x, e.detail.y));
 *   // …after mutating the pixels:
 *   canvas.render();
 *
 * A VIEW, not an editor: it shows pixels and reports which pixel the pointer
 * is on. The document, the tools and undo stay in the app (a headless
 * PixelDoc is the intended partner). What it owns is everything a generic
 * pan-zoom gets wrong for pixel art:
 *
 *   - Zoom is an INTEGER (CSS px per image pixel) and walks a fixed ladder
 *     (1 2 3 4 6 8 12 16 24 32 48 64), so every pixel is the same size and
 *     edges never blur. Drawn nearest-neighbour at device resolution.
 *   - The transparency checker is drawn IN the canvas and locked to the pixel
 *     grid (a pixel subdivides into 2, 3, 4 … squares as you zoom in), so it
 *     never swims against the art. Colors: --checker-a / --checker-b.
 *   - A pixel grid (--pixel-grid) appears from zoom 8, and an optional
 *     stronger tile grid every N pixels (--border-strong).
 *   - Onion-skin underlays, a floating selection overlay, a marquee and a
 *     brush-footprint hover box — the layers a sprite editor stacks.
 *
 * The canvas fills the element; give the element a size (a workspace
 * viewport, a flex child, an explicit height). The sprite floats inside it
 * and pans freely.
 *
 * Attributes:
 *   zoom       — integer CSS px per image pixel. Reflected on every change.
 *                Omit it and the view fits the image on first show. Values
 *                off the ladder (1 2 3 4 6 8 12 16 24 32 48 64 96 128, within
 *                min/max-zoom) snap to the nearest step, a tie going down —
 *                5 becomes 4, 10 becomes 8. A STATIC canvas has no ladder:
 *                any integer within min/max-zoom is taken as is (a 5× preview
 *                is 5×), and a zoom change re-sizes the element.
 *   min-zoom / max-zoom — ladder bounds, default 1 / 64.
 *   grid       — "auto" (default: pixel grid from zoom 8), "on", "off".
 *   tile-grid  — N: a stronger line every N image pixels (8, 16 …). Measured
 *                from the region's origin, so a frame of a strip gets its own.
 *   brush      — size of the hover box in image pixels (default 1; "0" hides
 *                it). Centered like a square brush: size 3 covers x-1 … x+1.
 *   static     — a preview: no drawing, no own pan, and the element sizes ITSELF to
 *                region × zoom (so <sac-pixel-canvas static zoom="3"> is the
 *                small live preview next to the big one). Larger than its box
 *                (a scrolling window, a panel), it pans that box on a middle-
 *                drag — the editor's gesture; touch scrolls natively.
 *
 * Properties (setting any of them redraws):
 *   image      — the pixels: ImageData, {width, height, data}, an
 *                HTMLCanvasElement / OffscreenCanvas, an <img> or ImageBitmap.
 *                Pixel buffers are uploaded on set and on render().
 *   region     — {x, y, w, h}: the part of the image being edited (one frame
 *                of a strip). Default: the whole image. Everything else —
 *                events, selection, overlays — speaks ABSOLUTE image coords.
 *   underlays  — [{ image?, region?, opacity }]: drawn under the image, above
 *                the checker, scaled onto the region. Onion skin = the
 *                neighbour frames' regions at 0.3. `image` defaults to the
 *                main image.
 *   overlays   — [{ image, x, y, opacity? }]: drawn over the image at
 *                absolute coords, clipped to the region. A floating
 *                selection's lifted pixels.
 *   selection  — {x, y, w, h} or null: the marquee, a two-tone dashed
 *                outline in --sink/--lift (readable over any pixel color).
 *   zoom       — get/set, snapped onto the ladder.
 *
 * Methods:
 *   render()        — re-upload the pixel buffers and redraw. Call after you
 *                     mutate the pixels. Cheap: sprite-sized buffers.
 *   fit()           — largest ladder zoom that shows the whole region; centers.
 *   center()        — center the region, zoom unchanged.
 *   zoomIn(anchor?) / zoomOut(anchor?) — one ladder step; anchor {clientX,
 *                     clientY} keeps that point still (default: the center).
 *   cellAt(clientX, clientY) — {x, y, lx, ly, inside} for any screen point.
 *
 * Events (bubble, not composed; detail = a CELL, see below):
 *   sac:pixel-down  — a press on the canvas (any button but the pan ones).
 *   sac:pixel-move  — the pressed pointer entered ANOTHER pixel. One event per
 *                     pixel change, not per mouse move; fast strokes skip
 *                     pixels, so connect them (Bresenham) in the app.
 *   sac:pixel-up    — the press ended (also outside the element: captured).
 *   sac:pixel-cancel— the press was taken over (a second finger began a
 *                     pinch). Roll the stroke back.
 *   sac:pixel-hover — the hovered pixel changed; detail is null on leave.
 *   sac:zoom        — detail { zoom }, after the zoom changed for any reason.
 *
 *   A cell: { x, y (absolute image px), lx, ly (region-local), inside
 *   (within the region), button, buttons, shiftKey, altKey, ctrlKey, metaKey,
 *   pointerType, pressure }. Coordinates OUTSIDE the region are reported too
 *   (inside:false) — a line dragged past the edge still has an end; clamp
 *   in the app if the tool needs it.
 *
 * Input:
 *   Wheel zooms around the cursor. Middle-drag, or Space held + drag, pans.
 *   Right-click is not consumed: listen for "contextmenu" on the element and
 *   open a <sac-menu> there with menu.openAt(event). Double-click is left to
 *   the app too.
 *
 * Compact / touch: one finger draws (sac:pixel-* as with a mouse). A second
 * finger cancels that stroke (sac:pixel-cancel) and pinches: zoom snaps to
 * the ladder around the fingers' midpoint, both fingers pan.
 * `touch-action: none` keeps the gesture inside the element.
 *
 * Theming: the checker, grid and stage ground are tokens (--checker-a,
 * --checker-b, --pixel-grid, --border-strong, --bg); they are re-read when
 * the theme flips. The marquee and hover box are --sink/--lift — the two
 * poles, visible over any art. The pixels themselves are data.
 */
(function () {
    const LADDER = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];
    const PAD = 24;                 // fit() leaves this much ground around the sprite
    const KEEP = 32;                // a pan always leaves this much sprite on screen

    /** Anything drawImage takes directly. */
    const isDrawable = (v) =>
        (typeof HTMLCanvasElement !== "undefined" && v instanceof HTMLCanvasElement) ||
        (typeof OffscreenCanvas !== "undefined" && v instanceof OffscreenCanvas) ||
        (typeof HTMLImageElement !== "undefined" && v instanceof HTMLImageElement) ||
        (typeof ImageBitmap !== "undefined" && v instanceof ImageBitmap);

    const dims = (v) => v ? { w: v.width || v.naturalWidth || 0, h: v.height || v.naturalHeight || 0 } : { w: 0, h: 0 };

    class SacPixelCanvas extends HTMLElement {
        static get observedAttributes() {
            return ["zoom", "min-zoom", "max-zoom", "grid", "tile-grid", "brush", "static"];
        }

        constructor() {
            super();
            this.attachShadow({ mode: "open" });
            this._image = null;
            this._region = null;
            this._underlays = [];
            this._overlays = [];
            this._selection = null;
            this._zoom = 0;             // 0 = not yet shown
            this._needFit = true;       // fit on the next draw (new document size)
            this._ox = 0; this._oy = 0; // CSS px: where region (0,0) sits in the stage
            this._moved = false;        // the user panned/zoomed — stop auto-fitting
            this._hover = null;         // last hovered cell (for the hover box)
            this._press = null;         // { pointerId, last } while a stroke runs
            this._pan = null;           // { pointerId, x, y, ox, oy } while panning
            this._touches = new Map();  // pointerId → {x, y} for pinch
            this._pinch = null;
            this._space = false;
            this._inside = false;
            this._sources = new WeakMap();  // pixel buffer → its upload canvas
            this._colors = null;
        }

        /* ---------------------------------------------------- properties --- */

        get image() { return this._image; }
        set image(v) {
            const before = this._regionRect();
            this._image = v || null;
            this._sources = new WeakMap();
            const after = this._regionRect();
            // A different size is a different document: fit again.
            if (before.w !== after.w || before.h !== after.h) this._needFit = true;
            this.render();
        }

        get region() { return this._region; }
        set region(r) {
            const before = this._regionRect();
            this._region = r ? { x: r.x | 0, y: r.y | 0, w: r.w | 0, h: r.h | 0 } : null;
            const after = this._regionRect();
            if (before.w !== after.w || before.h !== after.h) this._needFit = true;
            this._draw();
        }

        get underlays() { return this._underlays; }
        set underlays(v) { this._underlays = Array.isArray(v) ? v : []; this._draw(); }

        get overlays() { return this._overlays; }
        set overlays(v) { this._overlays = Array.isArray(v) ? v : []; this._sources = new WeakMap(); this._draw(); }

        get selection() { return this._selection; }
        set selection(s) { this._selection = s && s.w > 0 && s.h > 0 ? { ...s } : null; this._drawTop(); }

        get zoom() { return this._zoom || 1; }
        set zoom(z) { this._needFit = false; this._pinned = true; this._setZoom(this._snap(z), null); }

        /* ----------------------------------------------------- lifecycle --- */

        connectedCallback() {
            if (!this.shadowRoot.firstChild) {
                this._build();
                // An author-given zoom wins over the first fit.
                const z = this._attrZoom();
                if (z) { this._zoom = z; this._needFit = false; this._pinned = true; }
            }
            this._ro = new ResizeObserver(() => this._resize());
            this._ro.observe(this._stage);
            // Theme flips re-read the token colors. data-theme lives on <html>;
            // "auto" follows the OS, so the media query counts too.
            this._mo = new MutationObserver(() => { this._colors = null; this._draw(); });
            this._mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
            this._mq = matchMedia("(prefers-color-scheme: dark)");
            this._onScheme = () => { this._colors = null; this._draw(); };
            this._mq.addEventListener("change", this._onScheme);
            this._onKey = (e) => this._key(e);
            window.addEventListener("keydown", this._onKey);
            window.addEventListener("keyup", this._onKey);
            this._resize();
        }

        disconnectedCallback() {
            if (this._ro) this._ro.disconnect();
            if (this._mo) this._mo.disconnect();
            if (this._mq) this._mq.removeEventListener("change", this._onScheme);
            window.removeEventListener("keydown", this._onKey);
            window.removeEventListener("keyup", this._onKey);
        }

        attributeChangedCallback(name) {
            if (!this._stage) return;
            if (name === "zoom") {
                const z = this._attrZoom();
                if (z && z !== this._zoom) { this._needFit = false; this._pinned = true; this._setZoom(z, null, true); }
                return;
            }
            if (name === "static") this._resize();
            this._draw();
        }

        _build() {
            this.shadowRoot.innerHTML = `
                <style>
                    :host {
                        display: block;
                        position: relative;
                        min-height: 120px;
                        overflow: hidden;
                        background: var(--bg);
                        cursor: crosshair;
                        -webkit-user-select: none;
                        user-select: none;
                        -webkit-touch-callout: none;
                    }
                    :host([static]) {
                        display: inline-block;
                        min-height: 0;
                        background: transparent;
                        cursor: default;
                    }
                    .stage {
                        position: absolute;
                        inset: 0;
                        touch-action: none;
                    }
                    :host([static]) .stage { position: relative; inset: auto; touch-action: auto; }
                    canvas {
                        position: absolute;
                        left: 0;
                        top: 0;
                        width: 100%;
                        height: 100%;
                        image-rendering: pixelated;
                    }
                    .top { cursor: inherit; }
                    :host(.panning) .top { cursor: grab; }
                    :host(.grabbing) .top { cursor: grabbing; }
                    /* Token probes: computed once per theme, fed to the 2D
                       context (a canvas cannot read custom properties). */
                    .probe { position: absolute; width: 0; height: 0; overflow: hidden; }
                </style>
                <div class="stage">
                    <canvas class="base" aria-hidden="true"></canvas>
                    <canvas class="top" role="img"></canvas>
                </div>
                <span class="probe" data-token="--checker-a" style="color: var(--checker-a)"></span>
                <span class="probe" data-token="--checker-b" style="color: var(--checker-b)"></span>
                <span class="probe" data-token="--pixel-grid" style="color: var(--pixel-grid)"></span>
                <span class="probe" data-token="--border-strong" style="color: var(--border-strong)"></span>
                <span class="probe" data-token="--sink" style="color: var(--sink)"></span>
                <span class="probe" data-token="--lift" style="color: var(--lift)"></span>
            `;
            this._stage = this.shadowRoot.querySelector(".stage");
            this._base = this.shadowRoot.querySelector(".base");
            this._top = this.shadowRoot.querySelector(".top");
            this._top.setAttribute("aria-label", "Pixel canvas");

            const top = this._top;
            top.addEventListener("pointerdown", (e) => this._down(e));
            top.addEventListener("pointermove", (e) => this._move(e));
            top.addEventListener("pointerup", (e) => this._up(e));
            top.addEventListener("pointercancel", (e) => this._up(e, true));
            top.addEventListener("pointerenter", () => { this._inside = true; });
            top.addEventListener("pointerleave", (e) => {
                this._inside = false;
                if (!this._press && e.pointerType === "mouse") this._setHover(null);
            });
            this._stage.addEventListener("wheel", (e) => this._wheel(e), { passive: false });
            // Middle-click autoscroll would fight the pan.
            top.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
        }

        /* ---------------------------------------------------- geometry ----- */

        _attrZoom() {
            const z = parseInt(this.getAttribute("zoom"), 10);
            return z > 0 ? this._snap(z) : 0;
        }
        _bounds() {
            const min = parseInt(this.getAttribute("min-zoom"), 10) || 1;
            const max = parseInt(this.getAttribute("max-zoom"), 10) || 64;
            return { min: Math.max(1, min), max: Math.max(min, max) };
        }
        /** Snap any number onto the ladder, inside the bounds. */
        _snap(z) {
            const { min, max } = this._bounds();
            // A static preview is sized by the app to an exact multiple — no
            // wheel or pinch steps it, so any integer is taken as is.
            if (this.hasAttribute("static")) return Math.max(min, Math.min(max, Math.round(z) || min));
            const steps = LADDER.filter((s) => s >= min && s <= max);
            if (!steps.length) return min;
            let best = steps[0];
            for (const s of steps) if (Math.abs(s - z) < Math.abs(best - z)) best = s;
            return best;
        }
        _step(dir) {
            const { min, max } = this._bounds();
            const steps = LADDER.filter((s) => s >= min && s <= max);
            const z = this.zoom;
            if (dir > 0) return steps.find((s) => s > z) || steps[steps.length - 1];
            return [...steps].reverse().find((s) => s < z) || steps[0];
        }
        _regionRect() {
            if (this._region) return this._region;
            const d = this._image ? dims(this._image) : { w: 0, h: 0 };
            return { x: 0, y: 0, w: d.w, h: d.h };
        }
        _size() { return { w: this._stage.clientWidth, h: this._stage.clientHeight }; }

        cellAt(clientX, clientY) {
            const r = this._stage.getBoundingClientRect();
            const reg = this._regionRect(), z = this.zoom;
            const lx = Math.floor((clientX - r.left - this._ox) / z);
            const ly = Math.floor((clientY - r.top - this._oy) / z);
            return {
                x: reg.x + lx, y: reg.y + ly, lx, ly,
                inside: lx >= 0 && ly >= 0 && lx < reg.w && ly < reg.h,
            };
        }

        fit() {
            const reg = this._regionRect();
            const { w, h } = this._size();
            // Nothing to fit, or not laid out yet (hidden tab, display:none):
            // keep the fit pending for the first real size.
            if (!reg.w || !reg.h || !w || !h) return;
            const raw = Math.floor(Math.min((w - 2 * PAD) / reg.w, (h - 2 * PAD) / reg.h));
            const { min, max } = this._bounds();
            // Largest ladder step that still fits — never round UP past the edge.
            const steps = LADDER.filter((s) => s >= min && s <= max && s <= Math.max(min, raw));
            this._zoom = steps.length ? steps[steps.length - 1] : min;
            this._moved = false;
            this._needFit = false;
            this._pinned = false;
            this.center();
            this._reflect();
        }

        center() {
            const reg = this._regionRect(), { w, h } = this._size(), z = this.zoom;
            this._ox = Math.round((w - reg.w * z) / 2);
            this._oy = Math.round((h - reg.h * z) / 2);
            this._draw();
        }

        zoomIn(anchor)  { this._setZoom(this._step(+1), anchor); }
        zoomOut(anchor) { this._setZoom(this._step(-1), anchor); }

        /** Change zoom keeping the anchor's image point under it. */
        _setZoom(nz, anchor, fromAttr) {
            if (!nz) return;
            // A static preview sizes itself to region × zoom: a new zoom is a
            // new size, not a pan around an anchor. Reflect first, so
            // _resize() reads the new attribute.
            if (this.hasAttribute("static")) {
                if (nz === this._zoom) return;
                this._zoom = nz;
                this._reflect(fromAttr);
                this._resize();
                return;
            }
            const old = this.zoom;
            if (!this._zoom) { this._zoom = nz; this.center(); this._reflect(fromAttr); return; }
            if (nz === old) return;
            const r = this._stage.getBoundingClientRect();
            const px = anchor ? anchor.clientX - r.left : r.width / 2;
            const py = anchor ? anchor.clientY - r.top : r.height / 2;
            const ix = (px - this._ox) / old, iy = (py - this._oy) / old;
            this._zoom = nz;
            this._ox = Math.round(px - ix * nz);
            this._oy = Math.round(py - iy * nz);
            this._moved = true;
            this._clampPan();
            this._draw();
            this._reflect(fromAttr);
        }

        _reflect(fromAttr) {
            // Reflect; attributeChangedCallback sees the same zoom and stops.
            if (!fromAttr && String(this._zoom) !== this.getAttribute("zoom")) this.setAttribute("zoom", String(this._zoom));
            this.dispatchEvent(new CustomEvent("sac:zoom", { detail: { zoom: this._zoom }, bubbles: true, composed: false }));
        }

        /** Never lose the sprite: at least KEEP px of it stays on screen. */
        _clampPan() {
            const reg = this._regionRect(), z = this.zoom, { w, h } = this._size();
            const sw = reg.w * z, sh = reg.h * z;
            const kx = Math.min(KEEP, sw), ky = Math.min(KEEP, sh);
            this._ox = Math.min(w - kx, Math.max(kx - sw, this._ox));
            this._oy = Math.min(h - ky, Math.max(ky - sh, this._oy));
        }

        _resize() {
            if (!this._stage) return;
            if (this.hasAttribute("static")) {
                const reg = this._regionRect(), z = this._attrZoom() || this._zoom || 1;
                this._zoom = z;
                this._stage.style.width = reg.w * z + "px";
                this._stage.style.height = reg.h * z + "px";
                this._ox = 0; this._oy = 0;
            } else {
                this._stage.style.width = this._stage.style.height = "";
            }
            const { w, h } = this._size();
            const dpr = window.devicePixelRatio || 1;
            for (const c of [this._base, this._top]) {
                c.width = Math.max(1, Math.round(w * dpr));
                c.height = Math.max(1, Math.round(h * dpr));
            }
            if (!this.hasAttribute("static")) {
                // An untouched view keeps fitting as the element resizes (a
                // layout settling, a split dragged); once the user zoomed or
                // panned, the view stays where they put it (clamped).
                // A zoom the author set (attribute / property) is kept and
                // re-centered instead.
                if (this._needFit || !this._zoom || (!this._moved && !this._pinned)) this.fit();
                else if (!this._moved) this.center();
                else this._clampPan();
            }
            this._draw();
        }

        /* ---------------------------------------------------- drawing ------ */

        /** The drawable for any accepted pixel source; buffers are uploaded once per render(). */
        _source(v) {
            if (!v) return null;
            if (isDrawable(v)) return v;
            if (!v.data || !v.width || !v.height) return null;
            let c = this._sources.get(v);
            if (!c) {
                c = document.createElement("canvas");
                c.width = v.width; c.height = v.height;
                const data = v.data instanceof Uint8ClampedArray ? v.data : new Uint8ClampedArray(v.data);
                c.getContext("2d").putImageData(v instanceof ImageData ? v : new ImageData(data, v.width, v.height), 0, 0);
                this._sources.set(v, c);
            }
            return c;
        }

        _readColors() {
            if (this._colors) return this._colors;
            const out = {};
            for (const p of this.shadowRoot.querySelectorAll(".probe")) out[p.dataset.token] = getComputedStyle(p).color;
            return (this._colors = out);
        }

        render() {
            // Buffers may have been mutated in place: drop every upload.
            this._sources = new WeakMap();
            if (this.hasAttribute("static") && this._stage) this._resize();
            else this._draw();
        }

        _draw() {
            if (!this._stage || !this._base.width) return;
            if (!this.hasAttribute("static") && (this._needFit || !this._zoom)) {
                const reg = this._regionRect(), { w } = this._size();
                if (reg.w && w) { this.fit(); return; }   // fit() draws
            }
            const ctx = this._base.getContext("2d");
            const dpr = this._base.width / Math.max(1, this._size().w);
            const col = this._readColors();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this._base.width, this._base.height);
            const reg = this._regionRect(), z = this.zoom;
            if (!reg.w || !reg.h) { this._drawTop(); return; }

            // Device-space edges of image pixel i (rounded → every pixel crisp).
            const X = (i) => Math.round((this._ox + i * z) * dpr);
            const Y = (j) => Math.round((this._oy + j * z) * dpr);
            const x0 = X(0), y0 = Y(0), x1 = X(reg.w), y1 = Y(reg.h);

            // Checker, locked to the pixel grid: `n` squares per pixel side
            // once pixels are big, one square per `k` pixels while small.
            ctx.fillStyle = col["--checker-a"];
            ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
            ctx.fillStyle = col["--checker-b"];
            const unit = z >= 16 ? 1 / Math.max(2, Math.floor(z / 8)) : Math.max(1, Math.round(8 / z));
            const cols = Math.ceil(reg.w / unit), rows = Math.ceil(reg.h / unit);
            const W = this._base.width, H = this._base.height;
            for (let j = 0; j < rows; j++) {
                const ya = Y(j * unit), yb = Y(Math.min(reg.h, (j + 1) * unit));
                if (yb < 0 || ya > H) continue;
                for (let i = (j & 1); i < cols; i += 2) {
                    const xa = X(i * unit), xb = X(Math.min(reg.w, (i + 1) * unit));
                    if (xb < 0 || xa > W) continue;
                    ctx.fillRect(xa, ya, xb - xa, yb - ya);
                }
            }

            ctx.imageSmoothingEnabled = false;
            const main = this._source(this._image);
            // Underlays: other regions of an image scaled onto this one (onion skin).
            for (const u of this._underlays) {
                const src = this._source(u.image || this._image);
                if (!src) continue;
                const r = u.region || { x: 0, y: 0, ...(() => { const d = dims(u.image || this._image); return { w: d.w, h: d.h }; })() };
                ctx.globalAlpha = u.opacity == null ? 0.3 : u.opacity;
                ctx.drawImage(src, r.x, r.y, r.w, r.h, x0, y0, x1 - x0, y1 - y0);
            }
            ctx.globalAlpha = 1;
            if (main) ctx.drawImage(main, reg.x, reg.y, reg.w, reg.h, x0, y0, x1 - x0, y1 - y0);

            // Overlays (a floating selection), clipped to the region.
            if (this._overlays.length) {
                ctx.save();
                ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
                for (const o of this._overlays) {
                    const src = this._source(o.image);
                    if (!src) continue;
                    const d = dims(o.image), lx = o.x - reg.x, ly = o.y - reg.y;
                    ctx.globalAlpha = o.opacity == null ? 1 : o.opacity;
                    ctx.drawImage(src, 0, 0, d.w, d.h, X(lx), Y(ly), X(lx + d.w) - X(lx), Y(ly + d.h) - Y(ly));
                }
                ctx.restore();
            }

            // Pixel grid + tile grid, as 1-device-pixel hairlines.
            const mode = this.getAttribute("grid") || "auto";
            const showGrid = mode === "on" || (mode === "auto" && z >= 8);
            const tile = parseInt(this.getAttribute("tile-grid"), 10) || 0;
            const lines = (step, color) => {
                ctx.fillStyle = color;
                for (let i = step; i < reg.w; i += step) ctx.fillRect(X(i), y0, 1, y1 - y0);
                for (let j = step; j < reg.h; j += step) ctx.fillRect(x0, Y(j), x1 - x0, 1);
            };
            if (showGrid) lines(1, col["--pixel-grid"]);
            if (tile > 0 && tile * z >= 4) lines(tile, col["--border-strong"]);

            // The sprite's edge: a hairline so a transparent sprite on the
            // checker still has a shape (static previews go without).
            if (!this.hasAttribute("static")) {
                ctx.strokeStyle = col["--border-strong"];
                ctx.lineWidth = 1;
                ctx.strokeRect(x0 - 0.5, y0 - 0.5, x1 - x0 + 1, y1 - y0 + 1);
            }
            this._drawTop();
        }

        /** Marquee + hover box: redrawn on hover without touching the pixels. */
        _drawTop() {
            if (!this._top || !this._top.width) return;
            const ctx = this._top.getContext("2d");
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this._top.width, this._top.height);
            if (this.hasAttribute("static")) return;
            const col = this._readColors();
            const dpr = this._top.width / Math.max(1, this._size().w);
            const reg = this._regionRect(), z = this.zoom;
            const X = (i) => Math.round((this._ox + i * z) * dpr);
            const Y = (j) => Math.round((this._oy + j * z) * dpr);
            const ring = (lx, ly, w, h, dashed) => {
                const x = X(lx) + 0.5, y = Y(ly) + 0.5, ww = X(lx + w) - X(lx) - 1, hh = Y(ly + h) - Y(ly) - 1;
                ctx.lineWidth = 1;
                ctx.setLineDash([]);
                ctx.strokeStyle = col["--sink"];
                ctx.strokeRect(x, y, ww, hh);
                ctx.strokeStyle = col["--lift"];
                if (dashed) { ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.strokeRect(x, y, ww, hh); }
                else ctx.strokeRect(x + 1, y + 1, ww - 2, hh - 2);
                ctx.setLineDash([]);
            };
            const s = this._selection;
            if (s) ring(s.x - reg.x, s.y - reg.y, s.w, s.h, true);
            const size = this.hasAttribute("brush") ? parseInt(this.getAttribute("brush"), 10) : 1;
            const h = this._hover;
            if (h && size > 0 && !this._pan && !this._pinch) {
                const o = Math.floor((size - 1) / 2);
                ring(h.lx - o, h.ly - o, size, size, false);
            }
        }

        /* ---------------------------------------------------- input -------- */

        _cell(e) {
            const c = this.cellAt(e.clientX, e.clientY);
            return Object.assign(c, {
                button: e.button, buttons: e.buttons,
                shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
                pointerType: e.pointerType, pressure: e.pressure,
            });
        }
        _emit(type, detail) {
            this.dispatchEvent(new CustomEvent("sac:pixel-" + type, { detail, bubbles: true, composed: false }));
        }
        _setHover(c) {
            const same = (a, b) => a === b || (a && b && a.x === b.x && a.y === b.y);
            if (same(this._hover, c)) return;
            this._hover = c;
            this._drawTop();
            this._emit("hover", c);
        }

        _down(e) {
            if (this.hasAttribute("static")) {
                // A preview larger than its box sits in a scroller (a window,
                // a panel). Middle-drag moves THAT, the way the editor pans —
                // same hand, same gesture.
                if (e.button !== 1) return;
                const el = this._scroller();
                if (!el) return;
                e.preventDefault();
                try { this._top.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
                this._scrollPan = { pointerId: e.pointerId, x: e.clientX, y: e.clientY,
                                    sl: el.scrollLeft, st: el.scrollTop, el };
                this.classList.add("grabbing");
                return;
            }
            if (e.pointerType === "touch") {
                this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
                if (this._touches.size === 2) { this._startPinch(); return; }
                if (this._touches.size > 2) return;
            }
            if (e.button === 1 || (this._space && e.button === 0)) {
                e.preventDefault();
                try { this._top.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
                this._pan = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, ox: this._ox, oy: this._oy };
                this.classList.add("grabbing");
                this._drawTop();
                return;
            }
            if (this._press) return;
            try { this._top.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
            const c = this._cell(e);
            this._press = { pointerId: e.pointerId, last: c };
            this._hover = c;
            this._drawTop();
            this._emit("down", c);
        }

        _move(e) {
            const sp = this._scrollPan;
            if (sp && e.pointerId === sp.pointerId) {
                sp.el.scrollLeft = sp.sl - (e.clientX - sp.x);
                sp.el.scrollTop = sp.st - (e.clientY - sp.y);
                return;
            }
            if (e.pointerType === "touch" && this._touches.has(e.pointerId)) {
                this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
                if (this._pinch) { this._pinchMove(); return; }
            }
            if (this._pan && e.pointerId === this._pan.pointerId) {
                this._ox = this._pan.ox + Math.round(e.clientX - this._pan.x);
                this._oy = this._pan.oy + Math.round(e.clientY - this._pan.y);
                this._moved = true;
                this._clampPan();
                this._draw();
                return;
            }
            const c = this._cell(e);
            if (this._press && e.pointerId === this._press.pointerId) {
                const l = this._press.last;
                if (l.x !== c.x || l.y !== c.y) { this._press.last = c; this._hover = c; this._drawTop(); this._emit("move", c); }
                return;
            }
            if (e.pointerType === "mouse" || e.pointerType === "pen") this._setHover(c);
        }

        _up(e, cancelled) {
            if (this._scrollPan && e.pointerId === this._scrollPan.pointerId) {
                this._scrollPan = null;
                this.classList.remove("grabbing");
                return;
            }
            if (e.pointerType === "touch") {
                this._touches.delete(e.pointerId);
                if (this._pinch) { if (this._touches.size < 2) { this._pinch = null; this._drawTop(); } return; }
            }
            if (this._pan && e.pointerId === this._pan.pointerId) {
                this._pan = null;
                this.classList.remove("grabbing");
                this._drawTop();
                return;
            }
            if (this._press && e.pointerId === this._press.pointerId) {
                const c = this._cell(e);
                this._press = null;
                this._emit(cancelled ? "cancel" : "up", c);
                if (e.pointerType === "touch") this._setHover(null);
            }
        }

        /** The nearest ancestor that actually scrolls — across shadow roots
         *  (a canvas slotted into a <sac-window> scrolls its content box). */
        _scroller() {
            let node = this;
            while (node) {
                node = node.assignedSlot || node.parentElement
                    || (node.getRootNode && node.getRootNode().host) || null;
                if (!node || node.nodeType !== 1) break;
                const cs = getComputedStyle(node);
                const sx = /(auto|scroll)/.test(cs.overflowX) && node.scrollWidth > node.clientWidth;
                const sy = /(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight;
                if (sx || sy) return node;
            }
            const doc = document.scrollingElement;
            return doc && (doc.scrollHeight > doc.clientHeight || doc.scrollWidth > doc.clientWidth) ? doc : null;
        }

        _startPinch() {
            // The first finger's stroke was really the start of a gesture.
            if (this._press) { const c = this._press.last; this._press = null; this._emit("cancel", c); }
            const [a, b] = [...this._touches.values()];
            const r = this._stage.getBoundingClientRect();
            const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
            this._pinch = {
                d: Math.hypot(b.x - a.x, b.y - a.y) || 1, z: this.zoom,
                ix: (mx - this._ox) / this.zoom, iy: (my - this._oy) / this.zoom,
            };
            this._hover = null;
            this._drawTop();
        }

        _pinchMove() {
            const [a, b] = [...this._touches.values()];
            if (!b) return;
            const p = this._pinch, r = this._stage.getBoundingClientRect();
            const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
            const nz = this._snap(p.z * Math.hypot(b.x - a.x, b.y - a.y) / p.d);
            const changed = nz !== this._zoom;
            this._zoom = nz;
            // The image point that started under the midpoint stays under it.
            this._ox = Math.round(mx - p.ix * nz);
            this._oy = Math.round(my - p.iy * nz);
            this._moved = true;
            this._clampPan();
            this._draw();
            if (changed) this._reflect();
        }

        _wheel(e) {
            if (this.hasAttribute("static")) return;
            e.preventDefault();
            // Trackpads fire a burst of tiny deltas per gesture; one ladder
            // step per ~60px of travel keeps a flick from racing to 64×.
            this._wheelAcc = (this._wheelAcc || 0) + e.deltaY * (e.deltaMode === 1 ? 20 : 1);
            if (Math.abs(this._wheelAcc) < 50) return;
            const dir = this._wheelAcc < 0 ? 1 : -1;
            this._wheelAcc = 0;
            this._setZoom(this._step(dir), e);
            this._setHover(this.cellAt(e.clientX, e.clientY));
        }

        /** Space held over the canvas = pan mode (the painter's convention). */
        _key(e) {
            if (e.key !== " " || this.hasAttribute("static")) return;
            if (e.type === "keydown") {
                if (!this._inside || this._press) return;
                // Never steal Space from a focused control or a text field.
                const t = e.composedPath ? e.composedPath()[0] : e.target;
                if (t && t !== document.body && t !== this && /^(input|textarea|select|button)$/i.test(t.localName || "")) return;
                if (t && t.isContentEditable) return;
                e.preventDefault();
                if (!this._space) { this._space = true; this.classList.add("panning"); }
            } else if (this._space) {
                this._space = false;
                this.classList.remove("panning");
            }
        }
    }

    if (!customElements.get("sac-pixel-canvas")) customElements.define("sac-pixel-canvas", SacPixelCanvas);
})();
