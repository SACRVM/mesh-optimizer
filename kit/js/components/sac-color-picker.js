/**
 * <sac-color-picker value="#3b82f6"></sac-color-picker>
 * <sac-color-picker value="#3b82f680" alpha></sac-color-picker>
 *
 * The full color surface: a saturation/value field, a hue strip, an optional
 * alpha strip, three RGB rows and a hex field — all of them views onto ONE
 * state, all editable, all updated in place.
 *
 * Internally the state is HSV + alpha, not RGB. That is the difference between
 * a picker that behaves and one that fights you: hue has no meaning at s=0 or
 * v=0, so a picker that stores RGB loses it the moment a drag touches the
 * white edge or the black floor, and the field snaps back to red. Here the hue
 * is remembered and only replaced when the incoming color actually has one.
 * `value` is the flattened hex the outside world sees.
 *
 * Attributes:
 *   value — hex, reflected, default #3b82f6. Reads tolerantly through
 *           sac.color.parse (#rgb, #rgba, #rrggbb, #rrggbbaa, with or without
 *           the "#", any casing) and reflects back NORMALIZED lowercase, so
 *           the attribute and the property never disagree. Setting it
 *           programmatically updates every part in place and fires NOTHING —
 *           the caller already knows. An unparseable value is ignored and the
 *           attribute is healed back to the current color.
 *   alpha — boolean. Presence adds the alpha strip and makes `value` reflect
 *           as #rrggbbaa. Removing it at runtime resets opacity to 100% (a
 *           transparency you cannot see or edit is a trap, not a feature).
 *
 * Properties:
 *   value — get/set, normalized lowercase hex. Readable before connect.
 *
 * Methods:
 *   focus(options) — focuses the SV thumb (the picker's primary control).
 *
 * Events:
 *   sac:change — detail { value }, bubbles + composed. Fired on USER
 *           changes only (drag, arrow key, valid typing), and only when the
 *           resulting hex actually differs from the last one — a drag that
 *           moves two pixels inside the same color stays quiet.
 *
 * CSS custom properties:
 *   --picker-width — width of the whole stack. Default 240px; the layout is
 *           sound from 200px to 360px. Never wider than its container.
 *
 * Keyboard:
 *   SV thumb    — arrows move saturation/value by 1%, Shift by 5%,
 *                 Home/End jump saturation to 0% / 100%.
 *   Hue strip   — arrows ±1°, Shift ±10°, Home/End 0° / 360°.
 *   Alpha strip — arrows ±1%, Shift ±10%, Home/End 0% / 100%.
 *   RGB rows    — native range and number inputs, so the platform's own
 *                 keyboard handling applies.
 *   Hex field   — Enter normalizes (or reverts if unparseable), Escape and
 *                 blur revert to the current color. While the text is
 *                 unparseable it is marked with --danger text and a 1px
 *                 --danger underline; the color itself does not move.
 *
 * Notes:
 *   - The rainbow, the SV gradients and the swatch fills are DATA, not theme —
 *     the only raw colors in the file, each marked, all carried by private
 *     custom properties (--h, --c, --ca) that JS updates in place. Every piece
 *     of chrome around them is tokens.
 *   - The transparency checker is the --checker token, so it adapts to light and
 *     dark instead of being a baked-in gray.
 *   - Whatever the user is currently typing in is never overwritten by a sync
 *     (the guard is shadowRoot.activeElement), so a half-typed hex survives a
 *     simultaneous change from anywhere else.
 *   - Requires kit/js/lib/color.js.
 *
 * Compact/touch:
 *   The picker caps itself at 100% of its container (max-width), so it never
 *   overflows a 360px phone or a narrow popover. Under (pointer: coarse) the
 *   hue/alpha strips grow to 24px with an invisible halo making each a 44px
 *   target (the stack gap widens so the halos meet, never overlap), the RGB
 *   sliders get a 44px tall hit box around the same 4px track, and the
 *   number/hex fields are 44px tall with 16px type (no iOS focus zoom).
 *   Every surface is a pointer-captured drag with touch-action: none, so a
 *   finger drag never scrolls the page. Nothing is hover-only.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

    /** Kit-labelled elements: id → [key, English]. The aria-labels, set at
     *  render and again on a language switch. */
    const LABELS = {
        "root":        ["color-picker.title", "Color picker"],
        "sv-thumb":    ["color-picker.saturation-value", "Saturation and value"],
        "hue-thumb":   ["color-picker.hue", "Hue"],
        "alpha-thumb": ["color-picker.opacity", "Opacity"],
        "r-range":     ["color-picker.red", "Red"],
        "r-num":       ["color-picker.red", "Red"],
        "g-range":     ["color-picker.green", "Green"],
        "g-num":       ["color-picker.green", "Green"],
        "b-range":     ["color-picker.blue", "Blue"],
        "b-num":       ["color-picker.blue", "Blue"],
        "hex":         ["color-picker.hex-color", "Hex color"],
    };

    /** Fallback when no (valid) value attribute is given. Data, not theme. */
    const DEFAULT_VALUE = "#3b82f6";

    function clamp01(n) {
        return n < 0 ? 0 : (n > 1 ? 1 : n);
    }

    /** Keeps 1%-steps from drifting into 0.7000000000000001 territory. */
    function tidy(n) {
        return Math.round(n * 1000) / 1000;
    }

    class SacColorPicker extends HTMLElement {
        static get observedAttributes() { return ["value", "alpha"]; }

        constructor() {
            super();
            this.attachShadow({ mode: "open" });
            // Real state. Replaced from the value attribute on connect.
            this._h = 0;
            this._s = 0;
            this._v = 0;
            this._a = 1;
            this._ready      = false;   // connected at least once
            this._reflecting = false;   // our own setAttribute("value") is in flight
            this._lastHex    = "";
        }

        connectedCallback() {
            if (!this.shadowRoot.firstChild) {
                this._render();
                this._attach();
            }
            // Adopt the attribute (which may have been set before upgrade) or
            // fall back to the default, then normalize it. Silent either way.
            this._adopt(this.getAttribute("value"), true);
            this._ready = true;
            this._reflect();
            this._syncAll();
            // Runtime language switch: relabel in place — drags, typing and
            // focus are untouched.
            if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
        }

        disconnectedCallback() {
            if (this._offLang) { this._offLang(); this._offLang = null; }
        }

        /** aria-labels + the SV value text in the current language. */
        _relabel() {
            for (const id in LABELS) {
                const el = this.shadowRoot.getElementById(id);
                if (el) el.setAttribute("aria-label", t(LABELS[id][0], LABELS[id][1]));
            }
            if (this._ready) this._syncThumbs();
        }

        attributeChangedCallback(name) {
            if (!this._ready) return;          // connectedCallback does the first adopt
            if (name === "value") {
                if (this._reflecting) return;  // our own normalization, not an author's set
                this._adopt(this.getAttribute("value"), false);
            } else if (!this.hasAttribute("alpha")) {
                this._a = 1;                   // no strip → no invisible transparency
            }
            this._reflect();
            this._syncAll();
        }

        /* ------------------------------------------------------------- API */

        get value() {
            if (this._ready) return this._hex();
            // Before the first connect there is no state yet — answer from the
            // attribute so a script can read .value straight after createElement.
            const rgba = sac.color.parse(this.getAttribute("value"));
            return sac.color.format(rgba || sac.color.parse(DEFAULT_VALUE),
                                    { alpha: this.hasAttribute("alpha") });
        }

        set value(v) {
            this.setAttribute("value", v == null ? "" : String(v));
        }

        focus(options) {
            const thumb = this.shadowRoot.getElementById("sv-thumb");
            if (thumb) thumb.focus(options);
            else super.focus(options);
        }

        /* ----------------------------------------------------------- state */

        /** @returns {boolean} true if `raw` was parseable and adopted. */
        _adopt(raw, useDefault) {
            const rgba = sac.color.parse(raw);
            if (rgba) { this._applyRgba(rgba); return true; }
            if (useDefault) this._applyRgba(sac.color.parse(DEFAULT_VALUE));
            return false;
        }

        _applyRgba(rgba) {
            const hsv = sac.color.rgbToHsv(rgba);
            // Gray (s=0) and black (v=0) carry no hue — keep the one we have,
            // or the SV field would snap to red mid-drag.
            if (hsv.s > 0 && hsv.v > 0) this._h = hsv.h;
            this._s = hsv.s;
            this._v = hsv.v;
            this._a = this.hasAttribute("alpha") ? (rgba.a == null ? 1 : clamp01(rgba.a)) : 1;
        }

        _rgb() {
            return sac.color.hsvToRgb({ h: this._h, s: this._s, v: this._v });
        }

        _hex() {
            const rgb = this._rgb();
            return sac.color.format(
                { r: rgb.r, g: rgb.g, b: rgb.b, a: this._a },
                { alpha: this.hasAttribute("alpha") }
            );
        }

        /** Write the state back to the attribute. Silent — never fires. */
        _reflect() {
            const hex = this._hex();
            if (this.getAttribute("value") !== hex) {
                this._reflecting = true;
                this.setAttribute("value", hex);
                this._reflecting = false;
            }
            this._lastHex = hex;
            return hex;
        }

        /** The user-change path: reflect, repaint, announce if it moved. */
        _commit() {
            const before = this._lastHex;
            const hex = this._reflect();
            this._syncAll();
            if (hex === before) return;
            this.dispatchEvent(new CustomEvent("sac:change", {
                detail:   { value: hex },
                bubbles:  true,
                composed: false,   // native change semantics (value control)
            }));
        }

        /* ------------------------------------------------------------ sync */

        _syncAll() {
            this._syncColors();
            this._syncThumbs();
            this._syncInputs();
        }

        /** The three private data properties every gradient and fill reads. */
        _syncColors() {
            const rgb = this._rgb();
            const style = this._root.style;
            style.setProperty("--h", String(Math.round(this._h * 10) / 10));
            style.setProperty("--c", sac.color.format(rgb));
            style.setProperty("--ca", sac.color.format(
                { r: rgb.r, g: rgb.g, b: rgb.b, a: this._a }, { alpha: true }
            ));
        }

        _syncThumbs() {
            const sPct = Math.round(this._s * 100);
            const vPct = Math.round(this._v * 100);
            this._svThumb.style.left = (this._s * 100) + "%";
            this._svThumb.style.top  = ((1 - this._v) * 100) + "%";
            this._svThumb.setAttribute("aria-valuenow", String(sPct));
            this._svThumb.setAttribute("aria-valuetext",
                t("color-picker.saturation-value-text", "saturation {s}%, value {v}%")
                    .replace("{s}", String(sPct)).replace("{v}", String(vPct)));

            const deg = Math.round(this._h);
            this._hueThumb.style.left = (this._h / 3.6) + "%";
            this._hueThumb.setAttribute("aria-valuenow", String(deg));
            this._hueThumb.setAttribute("aria-valuetext", `${deg}°`);

            const aPct = Math.round(this._a * 100);
            this._alphaThumb.style.left = (this._a * 100) + "%";
            this._alphaThumb.setAttribute("aria-valuenow", String(aPct));
            this._alphaThumb.setAttribute("aria-valuetext", `${aPct}%`);
        }

        /**
         * RGB rows + hex field. The element the user is typing in is skipped:
         * rewriting it would eat keystrokes and jump the caret.
         */
        _syncInputs() {
            const rgb = this._rgb();
            const active = this.shadowRoot.activeElement;
            for (const key of ["r", "g", "b"]) {
                const text = String(rgb[key]);
                const range = this._range[key];
                const num   = this._num[key];
                if (range !== active && range.value !== text) range.value = text;
                if (num   !== active && num.value   !== text) num.value   = text;
            }
            const hex = this._hex();
            if (this._hexInput !== active && this._hexInput.value !== hex) this._hexInput.value = hex;
        }

        /* ------------------------------------------------------- interaction */

        _fraction(e, el, axis) {
            const rect = el.getBoundingClientRect();
            if (axis === "y") {
                return rect.height ? clamp01((e.clientY - rect.top) / rect.height) : 0;
            }
            return rect.width ? clamp01((e.clientX - rect.left) / rect.width) : 0;
        }

        /**
         * Pointer capture, so a drag that leaves the element (or the window)
         * keeps feeding the same surface until the button comes up.
         */
        _bindDrag(surface, thumb, apply) {
            surface.addEventListener("pointerdown", (e) => {
                if (e.button) return;                  // primary button / touch only
                e.preventDefault();                    // no text selection, no focus steal
                surface.setPointerCapture(e.pointerId);
                surface._dragging = true;
                thumb.focus({ preventScroll: true });  // the drag continues on the keyboard
                apply(e);
            });
            surface.addEventListener("pointermove", (e) => {
                if (!surface._dragging) return;
                e.preventDefault();
                apply(e);
            });
            const end = (e) => {
                if (!surface._dragging) return;
                surface._dragging = false;
                try { surface.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
            };
            surface.addEventListener("pointerup", end);
            surface.addEventListener("pointercancel", end);
            surface.addEventListener("lostpointercapture", () => { surface._dragging = false; });
        }

        _onSvKey(e) {
            const step = (e.shiftKey ? 5 : 1) / 100;
            let s = this._s;
            let v = this._v;
            switch (e.key) {
                case "ArrowLeft":  s -= step; break;
                case "ArrowRight": s += step; break;
                case "ArrowUp":    v += step; break;
                case "ArrowDown":  v -= step; break;
                case "Home":       s = 0; break;
                case "End":        s = 1; break;
                default: return;
            }
            e.preventDefault();
            this._s = tidy(clamp01(s));
            this._v = tidy(clamp01(v));
            this._commit();
        }

        _onHueKey(e) {
            const step = e.shiftKey ? 10 : 1;
            let h = this._h;
            switch (e.key) {
                case "ArrowLeft":
                case "ArrowDown":  h -= step; break;
                case "ArrowRight":
                case "ArrowUp":    h += step; break;
                case "Home":       h = 0; break;
                case "End":        h = 360; break;
                default: return;
            }
            e.preventDefault();
            // Clamped, not wrapped: 0° and 360° look identical, but a thumb
            // that teleports across the strip does not.
            this._h = Math.min(360, Math.max(0, h));
            this._commit();
        }

        _onAlphaKey(e) {
            const step = (e.shiftKey ? 10 : 1) / 100;
            let a = this._a;
            switch (e.key) {
                case "ArrowLeft":
                case "ArrowDown":  a -= step; break;
                case "ArrowRight":
                case "ArrowUp":    a += step; break;
                case "Home":       a = 0; break;
                case "End":        a = 1; break;
                default: return;
            }
            e.preventDefault();
            this._a = tidy(clamp01(a));
            this._commit();
        }

        /** One RGB channel changed — rebuild HSV around it, keeping alpha. */
        _setChannel(key, value) {
            const rgb = this._rgb();
            rgb[key] = value;
            this._applyRgba({ r: rgb.r, g: rgb.g, b: rgb.b, a: this._a });
            this._commit();
        }

        _attach() {
            const $ = (id) => this.shadowRoot.getElementById(id);
            this._root       = $("root");
            this._sv         = $("sv");
            this._svThumb    = $("sv-thumb");
            this._hue        = $("hue");
            this._hueThumb   = $("hue-thumb");
            this._alpha      = $("alpha");
            this._alphaThumb = $("alpha-thumb");
            this._hexInput   = $("hex");
            this._range = { r: $("r-range"), g: $("g-range"), b: $("b-range") };
            this._num   = { r: $("r-num"),   g: $("g-num"),   b: $("b-num")   };

            /* --- SV field ------------------------------------------------- */
            this._bindDrag(this._sv, this._svThumb, (e) => {
                this._s = tidy(this._fraction(e, this._sv, "x"));
                this._v = tidy(1 - this._fraction(e, this._sv, "y"));
                this._commit();
            });
            this._svThumb.addEventListener("keydown", (e) => this._onSvKey(e));

            /* --- Hue strip ------------------------------------------------ */
            this._bindDrag(this._hue, this._hueThumb, (e) => {
                this._h = tidy(this._fraction(e, this._hue, "x") * 360);
                this._commit();
            });
            this._hueThumb.addEventListener("keydown", (e) => this._onHueKey(e));

            /* --- Alpha strip ---------------------------------------------- */
            this._bindDrag(this._alpha, this._alphaThumb, (e) => {
                this._a = tidy(this._fraction(e, this._alpha, "x"));
                this._commit();
            });
            this._alphaThumb.addEventListener("keydown", (e) => this._onAlphaKey(e));

            /* --- RGB rows -------------------------------------------------- */
            for (const key of ["r", "g", "b"]) {
                const range = this._range[key];
                const num   = this._num[key];

                range.addEventListener("input", (e) => {
                    e.stopPropagation();      // the native composed event stays inside
                    this._setChannel(key, Math.round(Number(range.value) || 0));
                });
                range.addEventListener("change", (e) => e.stopPropagation());

                num.addEventListener("input", (e) => {
                    e.stopPropagation();
                    const raw = num.value.trim();
                    if (raw === "") return;                       // mid-edit, not a value
                    const n = Number(raw);
                    if (!Number.isFinite(n) || n < 0 || n > 255) return;  // blur will clamp
                    this._setChannel(key, Math.round(n));
                });
                num.addEventListener("change", (e) => e.stopPropagation());
                // On blur write the canonical value straight in: during the
                // blur event the field may still be shadowRoot.activeElement,
                // so _syncInputs would politely skip it.
                num.addEventListener("blur", () => { num.value = String(this._rgb()[key]); });
            }

            /* --- Hex field -------------------------------------------------- */
            this._hexInput.addEventListener("input", (e) => {
                e.stopPropagation();
                const rgba = sac.color.parse(this._hexInput.value);
                this._markHex(!!rgba);
                if (!rgba) return;
                this._applyRgba({ r: rgba.r, g: rgba.g, b: rgba.b, a: this._typedAlpha(rgba) });
                this._commit();
            });
            this._hexInput.addEventListener("change", (e) => e.stopPropagation());
            this._hexInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    this._hexInput.value = this._hex();   // normalize, or revert if it was junk
                    this._markHex(true);
                } else if (e.key === "Escape") {
                    this._revertHex();
                }
            });
            this._hexInput.addEventListener("blur", () => this._revertHex());
        }

        /** A typed #rgb/#rrggbb keeps the current alpha; #rgba/#rrggbbaa sets it. */
        _typedAlpha(rgba) {
            if (!this.hasAttribute("alpha")) return 1;
            const digits = this._hexInput.value.trim().replace(/^#/, "").length;
            return (digits === 4 || digits === 8) ? rgba.a : this._a;
        }

        _markHex(valid) {
            this._hexInput.classList.toggle("invalid", !valid);
            if (valid) this._hexInput.removeAttribute("aria-invalid");
            else this._hexInput.setAttribute("aria-invalid", "true");
        }

        _revertHex() {
            this._hexInput.value = this._hex();
            this._markHex(true);
        }

        /* ---------------------------------------------------------- render */

        _render() {
            // Kit strings for the attribute positions of the template below.
            const esc = (s) => String(s).replace(/"/g, "&quot;");
            const L = {};
            for (const id in LABELS) L[id] = esc(t(LABELS[id][0], LABELS[id][1]));
            this.shadowRoot.innerHTML = `
                <style>
                    :host {
                        --picker-width: 240px;
                        display: inline-block;
                        width: var(--picker-width);
                        max-width: 100%;          /* shrink before the page scrolls */
                        box-sizing: border-box;
                        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                        color: var(--text);
                        -webkit-user-select: none;
                        user-select: none;
                    }

                    .root {
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                        /* Private data properties, overwritten in place by JS
                           on every change — these values are the first paint
                           only. data, not theme. */
                        --h: 217;
                        --c: #3b82f6;
                        --ca: #3b82f6ff;
                    }

                    /* --- shared bits ------------------------------------- */
                    .checker {
                        background-image:
                            linear-gradient(45deg, var(--checker) 25%, transparent 25%,
                                            transparent 75%, var(--checker) 75%),
                            linear-gradient(45deg, var(--checker) 25%, transparent 25%,
                                            transparent 75%, var(--checker) 75%);
                        background-size: 8px 8px;
                        background-position: 0 0, 4px 4px;
                        /* Keep the checker off the border ring: the hairline
                           tokens are semi-transparent, and squares shimmering
                           through a 1px line read as a dashed border. */
                        background-clip: padding-box;
                    }

                    /* Two rings, no border: the inner ring is the panel color,
                       the outer a foreground hairline — so a thumb stays
                       visible over black, white and everything between, in
                       both themes. */
                    .thumb {
                        position: absolute;
                        box-sizing: border-box;
                        box-shadow:
                            0 0 0 2px var(--surface),
                            0 0 0 3px color-mix(in srgb, var(--fg) 45%, transparent),
                            var(--shadow-1);
                    }
                    .thumb:focus-visible {
                        outline: 2px solid var(--accent);
                        outline-offset: 4px;
                    }

                    /* --- saturation / value field ------------------------ */
                    /* Split into hit surface and paint layer: the pick math
                       maps the surface's full bounding rect 1:1 onto the
                       gradient, so the surface must stay a borderless,
                       square-cornered rectangle (a border or radius here
                       would offset the math and punch dead click zones into
                       the corners). Only the inner paint layer is rounded,
                       matching the kit's shape scale — the corner EXTREMES
                       (pure white, full black) stay reachable via drag
                       overshoot, keyboard and the inputs. */
                    .sv {
                        position: relative;
                        width: 100%;
                        aspect-ratio: 1 / 1;
                        cursor: crosshair;
                        touch-action: none;
                    }
                    .sv-paint {
                        position: absolute;
                        inset: 0;
                        border-radius: var(--radius-m);
                        pointer-events: none;
                        /* data, not theme: the field IS the data */
                        background:
                            linear-gradient(to top, #000000, transparent),
                            linear-gradient(to right, #ffffff, hsl(var(--h) 100% 50%));
                    }
                    .sv-thumb {
                        width: 14px;
                        height: 14px;
                        border-radius: 50%;
                        transform: translate(-50%, -50%);
                        background: var(--c);          /* data, not theme */
                    }

                    /* --- strips ------------------------------------------ */
                    .strip {
                        position: relative;
                        height: 12px;
                        border-radius: var(--radius-s);
                        border: 1px solid var(--border);
                        box-sizing: border-box;
                        cursor: pointer;
                        touch-action: none;
                    }
                    .hue {
                        /* data, not theme */
                        background: linear-gradient(to right,
                            #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000);
                    }
                    .alpha { display: none; }
                    :host([alpha]) .alpha { display: block; }
                    .alpha-grad {
                        position: absolute;
                        inset: 0;
                        border-radius: inherit;
                        /* data, not theme */
                        background: linear-gradient(to right, transparent, var(--c));
                    }
                    .strip-thumb {
                        top: 50%;
                        width: 10px;
                        height: 16px;
                        border-radius: var(--radius-s);
                        transform: translate(-50%, -50%);
                    }
                    .hue-thumb   { background: hsl(var(--h) 100% 50%); }  /* data, not theme */
                    .alpha-thumb { background: var(--ca); }               /* data, not theme */

                    /* --- RGB rows ---------------------------------------- */
                    .rgb {
                        display: flex;
                        flex-direction: column;
                        gap: 6px;
                    }
                    .rgb-row {
                        display: grid;
                        grid-template-columns: 12px minmax(0, 1fr) 46px;
                        align-items: center;
                        gap: 8px;
                    }
                    .ch {
                        font-size: 0.72rem;
                        font-weight: 600;
                        color: var(--text-dim);
                        text-align: center;
                    }

                    /* Same track/thumb recipe as <sac-slider>, re-implemented
                       here — global and sibling styles do not cross a shadow
                       boundary. */
                    input[type="range"] {
                        -webkit-appearance: none;
                        appearance: none;
                        width: 100%;
                        height: 4px;
                        margin: 0;
                        padding: 0;
                        background: color-mix(in srgb, var(--fg) 10%, transparent);
                        border: none;
                        border-radius: var(--radius-s);
                        outline: none;
                        cursor: pointer;
                    }
                    input[type="range"]::-webkit-slider-thumb {
                        -webkit-appearance: none;
                        width: 14px;
                        height: 14px;
                        border-radius: 50%;
                        background: var(--accent);
                        cursor: pointer;
                    }
                    input[type="range"]::-moz-range-thumb {
                        width: 14px;
                        height: 14px;
                        border: none;
                        border-radius: 50%;
                        background: var(--accent);
                        cursor: pointer;
                    }
                    input[type="range"]:focus-visible {
                        outline: 2px solid var(--accent);
                        outline-offset: 4px;
                    }

                    /* --- text fields ------------------------------------- */
                    input[type="number"],
                    .hex {
                        box-sizing: border-box;
                        width: 100%;
                        min-width: 0;
                        font-family: inherit;
                        font-size: 0.78rem;
                        color: var(--text);
                        background: var(--field);
                        border: 1px solid var(--border);
                        border-radius: var(--radius-m);
                        padding: 5px 6px;
                        transition: border-color 0.15s var(--ease-smooth);
                    }
                    input[type="number"] { text-align: center; }
                    input[type="number"]:hover,
                    .hex:hover { border-color: var(--border-strong); }
                    /* Same focus signal as the global field style in ui.css:
                       accent hairline plus a soft ring, no outline. */
                    input[type="number"]:focus,
                    .hex:focus {
                        outline: none;
                        border-color: var(--accent);
                        box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 10%, transparent);
                    }
                    /* Spinners would fight the range slider for the same job. */
                    input[type="number"]::-webkit-outer-spin-button,
                    input[type="number"]::-webkit-inner-spin-button {
                        -webkit-appearance: none;
                        margin: 0;
                    }
                    input[type="number"] {
                        -moz-appearance: textfield;
                        appearance: textfield;
                    }

                    /* --- preview well + hex ------------------------------ */
                    .bottom {
                        display: grid;
                        grid-template-columns: 30px minmax(0, 1fr);
                        align-items: center;
                        gap: 8px;
                    }
                    .well {
                        position: relative;
                        height: 30px;
                        border-radius: var(--radius-m);
                        border: 1px solid var(--border-strong);
                        box-sizing: border-box;
                        overflow: hidden;
                    }
                    .well-fill {
                        position: absolute;
                        inset: 0;
                        background: var(--ca);        /* data, not theme */
                    }
                    .hex {
                        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                        letter-spacing: 0.02em;
                        padding: 7px 8px;
                    }
                    /* Unparseable text: say so in the text and one hairline —
                       never a fat colored border. The color does not move. */
                    .hex.invalid,
                    .hex.invalid:focus {
                        color: var(--danger-text);
                        border-color: var(--border);
                        border-bottom-color: var(--danger);
                    }
                    /* The focus ring follows the state, so the field never
                       glows accent while it is telling you it is unreadable. */
                    .hex.invalid:focus {
                        box-shadow: 0 0 0 2px color-mix(in srgb, var(--danger) 10%, transparent);
                    }

                    /* Touch: 44px targets. Strips: 24px look + 10px halo above
                       and below = 44px; the 20px stack gap lets neighbouring
                       halos meet without overlapping. Range inputs: a 44px
                       box whose background is clipped to the 4px content
                       strip, so the track looks the same and the thumb stays
                       centred on it. */
                    @media (pointer: coarse) {
                        .root { gap: 20px; }
                        .strip { height: 24px; }
                        .strip::after {
                            content: "";
                            position: absolute;
                            inset: -10px 0;
                        }
                        .strip-thumb { width: 14px; height: 28px; }
                        .rgb { gap: 0; }
                        input[type="range"] {
                            box-sizing: border-box;
                            height: 44px;
                            padding: 20px 0;
                            background-clip: content-box;
                        }
                        input[type="range"]::-webkit-slider-thumb { width: 22px; height: 22px; }
                        input[type="range"]::-moz-range-thumb { width: 22px; height: 22px; }
                        .rgb-row { grid-template-columns: 12px minmax(0, 1fr) 56px; }
                        input[type="number"],
                        .hex {
                            min-height: 44px;
                            font-size: max(16px, 1rem);
                        }
                        .bottom { grid-template-columns: 44px minmax(0, 1fr); }
                        .well { height: 44px; }
                    }

                    @media (prefers-reduced-motion: reduce) {
                        input[type="number"],
                        .hex { transition: none; }
                    }
                </style>
                <div class="root" id="root" role="group" aria-label="${L.root}">
                    <div class="sv" id="sv">
                        <div class="sv-paint"></div>
                        <div class="sv-thumb thumb" id="sv-thumb" tabindex="0" role="slider"
                             aria-label="${L["sv-thumb"]}"
                             aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div>
                    </div>

                    <div class="strip hue" id="hue">
                        <div class="strip-thumb hue-thumb thumb" id="hue-thumb" tabindex="0" role="slider"
                             aria-label="${L["hue-thumb"]}" aria-orientation="horizontal"
                             aria-valuemin="0" aria-valuemax="360" aria-valuenow="0"></div>
                    </div>

                    <div class="strip alpha checker" id="alpha">
                        <div class="alpha-grad"></div>
                        <div class="strip-thumb alpha-thumb thumb" id="alpha-thumb" tabindex="0" role="slider"
                             aria-label="${L["alpha-thumb"]}" aria-orientation="horizontal"
                             aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"></div>
                    </div>

                    <div class="rgb">
                        <div class="rgb-row">
                            <span class="ch" aria-hidden="true">R</span>
                            <input type="range" id="r-range" min="0" max="255" step="1" aria-label="${L["r-range"]}">
                            <input type="number" id="r-num" min="0" max="255" step="1"
                                   inputmode="numeric" autocomplete="off" aria-label="${L["r-num"]}">
                        </div>
                        <div class="rgb-row">
                            <span class="ch" aria-hidden="true">G</span>
                            <input type="range" id="g-range" min="0" max="255" step="1" aria-label="${L["g-range"]}">
                            <input type="number" id="g-num" min="0" max="255" step="1"
                                   inputmode="numeric" autocomplete="off" aria-label="${L["g-num"]}">
                        </div>
                        <div class="rgb-row">
                            <span class="ch" aria-hidden="true">B</span>
                            <input type="range" id="b-range" min="0" max="255" step="1" aria-label="${L["b-range"]}">
                            <input type="number" id="b-num" min="0" max="255" step="1"
                                   inputmode="numeric" autocomplete="off" aria-label="${L["b-num"]}">
                        </div>
                    </div>

                    <div class="bottom">
                        <div class="well checker"><div class="well-fill"></div></div>
                        <input class="hex" id="hex" type="text" spellcheck="false"
                               autocomplete="off" autocapitalize="off" aria-label="${L.hex}">
                    </div>
                </div>
            `;
        }
    }

    customElements.define("sac-color-picker", SacColorPicker);
})();
