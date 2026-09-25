/**
 * <sac-color-field value="#3b82f6" label="Accent" alpha disabled>
 *
 * The compact form-row color input: an optional label, a small color WELL and
 * a hex text field. Clicking the well drops a <sac-color-picker> popover below
 * it — the field is what sits in a sidebar or a settings form, the picker is
 * the surface you only see while choosing.
 *
 * Requires kit/js/lib/color.js (the parse/format math) AND
 * kit/js/components/sac-color-picker.js (the popover body) to be loaded.
 * kit/js/all.js pulls both in the right order.
 *
 * Usage:
 *   <sac-color-field label="Accent" value="#3b82f6"></sac-color-field>
 *   <sac-color-field label="Glow" value="#f9731688" alpha></sac-color-field>
 *
 *   field.addEventListener("sac:change", e => paint(e.detail.value));
 *   field.value = "#22c55e";        // programmatic — updates the UI, fires nothing
 *
 * Attributes:
 *   value    — hex, tolerant on the way in (`f00`, `#F00`, `ff0000`, `#ff0000cc`),
 *              REFLECTED normalized: `#rrggbb`, or `#rrggbbaa` with [alpha].
 *              An unparseable value is rejected: the last valid one is put back.
 *   alpha    — presence adds the alpha channel (picker gets an alpha strip,
 *              value reflects 8 digits). Removing it forces the color opaque.
 *   label    — text above the row, kit form-label styling. Absent/empty = no
 *              label line at all. Also becomes the hex input's accessible name.
 *   disabled — greys the row out, blocks both the well and the input, and
 *              closes the popover if it was open.
 *
 * Properties:
 *   value — get/set, normalized lowercase hex. Setting is programmatic: the
 *           well, the hex input and an open popover update in place and NO
 *           event is fired (events mean "the user did this").
 *
 * Events:
 *   sac:change — detail { value } — the normalized hex, on USER changes
 *                      only: a committed hex entry, or any picker interaction.
 *                      Bubbles + composed. The picker's own event is stopped at
 *                      the boundary, so apps see exactly one.
 *
 * Keyboard:
 *   on the well     — Enter / Space / ArrowDown open the popover, focus moves
 *                     into the picker; Escape closes it and comes back.
 *   in the hex input— Enter commits, Escape reverts to the last valid value.
 *                     Blurring with unparseable text reverts too.
 *
 * CSS custom properties:
 *   --picker-width — set on this field, forwarded to the popover's
 *                    <sac-color-picker>. Default 240px.
 *
 * Compact/touch:
 *   The popover is never wider than the viewport minus 8px a side
 *   (max-width: calc(100vw - 16px)); the picker inside caps itself at the
 *   popover's width, so the 8px viewport clamp holds on a 360px phone. Under
 *   (pointer: coarse) the well is 44 x 44px and the hex input 44px tall with
 *   16px type (no iOS focus zoom); the picker brings its own 44px targets.
 *   Nothing is hover-only — hover only tints borders.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacColorField extends HTMLElement {
    static get observedAttributes() { return ["value", "alpha", "label", "disabled"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });

        this._rgba = { r: 59, g: 130, b: 246, a: 1 };  // = SacColorField.DEFAULT
        this._open = false;
        this._dirty = false;       // hex input carries uncommitted text
        this._reflecting = false;  // guards the value-attribute round trip
        this._forwarding = false;  // guards the picker → field → picker echo
        this._popover = null;
        this._picker = null;
        this._lowerTimer = null;   // top-layer exit, delayed past the fade

        this._onDocPointer = this._onDocPointer.bind(this);
        this._onDocKeydown = this._onDocKeydown.bind(this);
        this._onReposition = this._onReposition.bind(this);
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) {
            this._render();
            this._upgradeProperty("value");   // .value set before this file loaded
            this._adopt();
        }
        document.addEventListener("pointerdown", this._onDocPointer, true);
        document.addEventListener("keydown", this._onDocKeydown, true);
        window.addEventListener("scroll", this._onReposition, true);
        window.addEventListener("resize", this._onReposition);
        // Runtime language switch: relabel in place (the popover picker
        // relabels itself); typing, value and an open popover survive.
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
        this._closePopover(false);            // never leave a popover anchored to nothing
        if (this._lowerTimer != null) {
            clearTimeout(this._lowerTimer);
            this._lowerTimer = null;
        }
        document.removeEventListener("pointerdown", this._onDocPointer, true);
        document.removeEventListener("keydown", this._onDocKeydown, true);
        window.removeEventListener("scroll", this._onReposition, true);
        window.removeEventListener("resize", this._onReposition);
    }

    attributeChangedCallback(name) {
        if (!this.shadowRoot.firstChild) return;   // pre-upgrade attrs — _adopt() reads them all
        switch (name) {
            case "value":    this._onValueAttr();  break;
            case "alpha":    this._onAlphaAttr();  break;
            case "label":    this._syncLabel();    break;
            case "disabled": this._syncDisabled(); break;
        }
    }

    /* ---------------------------------------------------------------- API */

    get value() { return this._format(); }
    set value(v) { this.setAttribute("value", v == null ? "" : String(v)); }

    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }

    /* ------------------------------------------------------------ color math */

    /** The shared library, or null when lib/color.js was not loaded. */
    _lib() {
        return (window.sac && sac.color) || null;
    }

    /** Always a fresh object — the field mutates .a when [alpha] is dropped,
     *  and must never write through to something the library still holds. */
    _parse(str) {
        const lib = this._lib();
        if (!lib || str == null) return null;
        const c = lib.parse(str);
        return c ? { r: c.r, g: c.g, b: c.b, a: c.a } : null;
    }

    /** Current color as the field publishes it: 6 digits, 8 with [alpha]. */
    _format(rgba) {
        const lib = this._lib();
        if (!lib) return "";
        return lib.format(rgba || this._rgba, { alpha: this.hasAttribute("alpha") });
    }

    /** Always 8 digits — what the swatch paints, so the checker shows through. */
    _formatFull() {
        const lib = this._lib();
        if (!lib) return "";
        return lib.format(this._rgba, { alpha: true });
    }

    /* ------------------------------------------------------------- state */

    /** First read of every attribute, once the shadow DOM exists. */
    _adopt() {
        if (!this._lib()) {
            console.warn("<sac-color-field> needs kit/js/lib/color.js — load it before the components.");
        }
        const parsed = this._parse(this.getAttribute("value")) || this._parse(SacColorField.DEFAULT);
        if (parsed) this._rgba = parsed;
        if (!this.hasAttribute("alpha")) this._rgba.a = 1;
        this._syncLabel();
        this._syncDisabled();
        this._reflect();
        this._syncUI();
    }

    /** Write the normalized hex back to the attribute without re-entering. */
    _reflect() {
        const hex = this._format();
        if (!hex || this.getAttribute("value") === hex) return;
        this._reflecting = true;
        this.setAttribute("value", hex);
        this._reflecting = false;
    }

    /**
     * Adopt a color. `fire` = the user caused it, so an event goes out — but
     * only when the normalized value actually moved.
     */
    _apply(rgba, fire) {
        const before = this._format();
        this._rgba = rgba;
        const after = this._format();
        this._reflect();
        this._syncUI();
        if (fire && after !== before) {
            this.dispatchEvent(new CustomEvent("sac:change", {
                detail: { value: after },
                bubbles: true,
                composed: false,   // native change semantics (value control)
            }));
        }
    }

    _onValueAttr() {
        if (this._reflecting) return;
        const parsed = this._parse(this.getAttribute("value"));
        if (!parsed) { this._reflect(); return; }   // garbage in → last valid back out
        if (!this.hasAttribute("alpha")) parsed.a = 1;
        this._apply(parsed, false);
    }

    _onAlphaAttr() {
        const on = this.hasAttribute("alpha");
        if (!on) this._rgba.a = 1;                  // no alpha channel = opaque
        if (this._picker) {
            if (on) this._picker.setAttribute("alpha", "");
            else this._picker.removeAttribute("alpha");
        }
        this._reflect();
        this._syncUI();
    }

    /* ------------------------------------------------------------ in-place UI */

    _syncUI() {
        if (!this._fill) return;
        this._fill.style.background = this._formatFull();   /* data, not theme */
        if (!this._dirty) {
            const hex = this._format();
            if (this._input.value !== hex) this._input.value = hex;
            this._input.classList.remove("invalid");
        }
        // Seed an open popover too — but never mid-drag, when the picker is
        // the one talking (writing back would fight its own thumb).
        if (this._open && this._picker && !this._forwarding) {
            const hex = this._format();
            if (hex) this._picker.setAttribute("value", hex);
        }
    }

    _syncLabel() {
        const text = this.getAttribute("label") || "";
        this._labelEl.textContent = text;
        this._labelEl.hidden = !text;
        this._input.setAttribute("aria-label", text || t("color-field.hex-color", "Hex color"));
    }

    /** Kit strings in the current language, on the existing nodes. */
    _relabel() {
        if (!this._input) return;
        this._syncLabel();
        this._well.setAttribute("aria-label", t("color-field.choose-color", "Choose color"));
        if (this._popover) this._popover.setAttribute("aria-label", t("color-field.color-picker", "Color picker"));
    }

    _syncDisabled() {
        const off = this.hasAttribute("disabled");
        this._well.disabled = off;
        this._input.disabled = off;
        if (off) this._closePopover(false);
    }

    _upgradeProperty(name) {
        if (Object.prototype.hasOwnProperty.call(this, name)) {
            const v = this[name];
            delete this[name];
            this[name] = v;
        }
    }

    /* ------------------------------------------------------------- render */

    _render() {
        // Kit strings for the attribute positions of the template below.
        const esc = (s) => String(s).replace(/"/g, "&quot;");
        const L = {
            choose: esc(t("color-field.choose-color", "Choose color")),
            hex:    esc(t("color-field.hex-color", "Hex color")),
        };
        this.shadowRoot.innerHTML = `
            <style>
                *, *::before, *::after { box-sizing: border-box; }

                :host {
                    --picker-width: 240px;   /* mirrors the picker's own default */
                    display: inline-block;
                    max-width: 100%;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    color: var(--text);
                }
                :host([disabled]) { opacity: 0.5; }

                /* The global form-label recipe, re-stated inside the shadow
                   root (ui.css's element rules do not pierce the boundary). */
                .label {
                    display: block;
                    font-size: 0.7rem;
                    text-transform: uppercase;
                    color: var(--text-muted);
                    margin-bottom: 0.4rem;
                    font-weight: 700;
                    letter-spacing: 0.05em;
                }
                .label[hidden] { display: none; }

                .row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                /* 32px is the kit's control-row height (the .toolbar measure;
                   sac-stepper lands on it too) — a color and a quantity on
                   one line sit flush. */
                .well {
                    position: relative;
                    flex: none;
                    width: 32px;
                    height: 32px;
                    padding: 0;
                    border: 1px solid var(--border-strong);
                    border-radius: var(--radius-m);
                    background: var(--field);
                    overflow: hidden;
                    cursor: pointer;
                    transition: border-color 150ms var(--ease-smooth);
                }
                .well:hover:not(:disabled) { border-color: var(--accent); }
                .well:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                }
                .well:disabled { cursor: not-allowed; }

                /* Transparency checker — the --checker token, so it reads
                   correctly on light and dark ground alike. The fill sits on
                   top and simply hides it when the color is opaque. */
                .checker {
                    position: absolute;
                    inset: 0;
                    background-image:
                        linear-gradient(45deg, var(--checker) 25%, transparent 25%, transparent 75%, var(--checker) 75%),
                        linear-gradient(45deg, var(--checker) 25%, transparent 25%, transparent 75%, var(--checker) 75%);
                    background-size: 8px 8px;
                    background-position: 0 0, 4px 4px;
                }
                .fill {
                    position: absolute;
                    inset: 0;
                }

                .hex {
                    flex: 1 1 auto;
                    min-width: 0;
                    width: 11ch;
                    height: 32px;              /* control-row height, see .well */
                    box-sizing: border-box;
                    padding: 0.35rem 0.5rem;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                    font-size: 0.78rem;
                    color: var(--text);
                    background: var(--field);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-m);
                    transition: border-color 150ms var(--ease-smooth),
                                color 150ms var(--ease-smooth);
                }
                .hex:hover:not(:disabled) { border-color: var(--border-strong); }
                .hex:focus {
                    outline: none;
                    border-color: var(--accent);
                    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 10%, transparent);
                }
                .hex:disabled { cursor: not-allowed; }

                /* Unparseable entry: red text and a 1px hairline underline.
                   Never a thick colored border (kit rule: no thick colored
                   borders on rounded surfaces). */
                .hex.invalid {
                    color: var(--danger-text);
                    border-bottom-color: var(--danger);
                }
                .hex.invalid:focus {
                    border-color: var(--accent);
                    border-bottom-color: var(--danger);
                }

                /* Dropdown level — same layer and behavior family as sac-menu:
                   position: fixed, shown in the top layer (popover), so neither
                   an overflow: hidden sidebar nor a transformed ancestor can
                   clip or re-anchor it. */
                .popover {
                    position: fixed;
                    inset: auto;                   /* the UA pins popovers to all four sides… */
                    margin: 0;                     /* …and centres them with auto margins */
                    display: block;                /* beats the UA's popover display: none */
                    z-index: 9999;
                    box-sizing: border-box;
                    /* Never wider than the viewport minus the 8px clamp margin
                       a side; the picker inside caps itself at 100%. */
                    max-width: calc(100vw - 16px);
                    padding: 10px;
                    background: var(--glass-strong);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border: 1px solid var(--border-strong);
                    border-radius: var(--radius-l);
                    box-shadow: var(--shadow-2);

                    opacity: 0;
                    visibility: hidden;   /* keeps the picker out of the tab order while closed */
                    transform: translateY(-4px);
                    transition: opacity 120ms var(--ease-smooth),
                                transform 120ms var(--ease-smooth),
                                visibility 120ms var(--ease-smooth);
                }
                .popover.open {
                    opacity: 1;
                    visibility: visible;
                    transform: translateY(0);
                }
                /* Out of the top layer = out of layout (as sac-menu): a closed
                   popover parked at its last anchor must not widen a phone
                   page. It leaves the layer only after the close fade. */
                .popover:not(:popover-open) { display: none; }
                /* Back from display: none there is no "before" style for the
                   open transition to start from — supply the closed look. */
                @starting-style {
                    .popover.open {
                        opacity: 0;
                        transform: translateY(-4px);
                    }
                }

                /* Touch: a 44px row — a 44 x 44 well beside a 44px field with
                   16px type (below 16px iOS zooms the page on focus). */
                @media (pointer: coarse) {
                    .well { width: 44px; height: 44px; }
                    .hex {
                        height: 44px;
                        font-size: max(16px, 1rem);
                    }
                }

                /* The picker's own :host default would beat a value inherited
                   from outside (a declaration on the host outranks
                   inheritance), so re-point it at the chain: this outer-tree
                   rule wins over the picker's :host, and inherit walks up to
                   this field's :host — whose mirror default keeps the unset
                   case at 240px. */
                .popover sac-color-picker { --picker-width: inherit; }

                @media (prefers-reduced-motion: reduce) {
                    .popover,
                    .popover.open {
                        transition: none;
                        transform: none;
                    }
                    .well, .hex { transition: none; }
                }
            </style>
            <label class="label" for="hex" hidden></label>
            <div class="row">
                <button class="well" id="well" type="button"
                        aria-label="${L.choose}" aria-haspopup="dialog" aria-expanded="false">
                    <span class="checker"></span><span class="fill"></span>
                </button>
                <input class="hex" id="hex" type="text" aria-label="${L.hex}"
                       spellcheck="false" autocomplete="off" autocapitalize="off">
            </div>
        `;

        this._labelEl = this.shadowRoot.querySelector(".label");
        this._well    = this.shadowRoot.getElementById("well");
        this._fill    = this.shadowRoot.querySelector(".fill");
        this._input   = this.shadowRoot.getElementById("hex");

        // Enter/Space already arrive as a click on a native button; ArrowDown
        // is the extra combobox-style opener.
        this._well.addEventListener("click", () => this._toggle());
        this._well.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                this._openPopover();
            }
        });

        // Native input/change events are composed: without this they would
        // surface on the host as untyped form noise (same guard as sac-slider).
        this._input.addEventListener("input", (e) => {
            e.stopPropagation();
            this._onInput();
        });
        this._input.addEventListener("change", (e) => e.stopPropagation());
        this._input.addEventListener("keydown", (e) => this._onInputKeydown(e));
        this._input.addEventListener("blur", () => this._commit(true));
    }

    /* ---------------------------------------------------------- hex input */

    _onInput() {
        this._dirty = true;
        const raw = this._input.value;
        const bad = raw.trim() !== "" && !this._parse(raw);
        this._input.classList.toggle("invalid", bad);
    }

    _onInputKeydown(e) {
        if (e.key === "Enter") {
            e.preventDefault();
            this._commit(false);
        } else if (e.key === "Escape" && !this._open) {
            e.stopPropagation();                  // popover Escape wins when it is open
            this._revertInput();
        }
    }

    /** @param {boolean} revertOnInvalid — true on blur, false on Enter (the
     *  user is still editing; leave the red text standing). */
    _commit(revertOnInvalid) {
        if (!this._dirty) return;                 // nothing typed → never re-fire the old value
        const parsed = this._parse(this._input.value);
        if (!parsed) {
            if (revertOnInvalid) this._revertInput();
            return;
        }
        if (!this.hasAttribute("alpha")) parsed.a = 1;
        this._dirty = false;
        this._input.classList.remove("invalid");
        this._apply(parsed, true);
    }

    _revertInput() {
        this._dirty = false;
        this._input.classList.remove("invalid");
        this._input.value = this._format();
    }

    /* ------------------------------------------------------------ popover */

    /** Built once, on the first open — a field that is never opened costs a
     *  button and an input. */
    _ensurePopover() {
        if (this._popover) return;

        const pop = document.createElement("div");
        pop.className = "popover";
        pop.setAttribute("popover", "manual");
        pop.setAttribute("role", "dialog");
        pop.setAttribute("aria-label", t("color-field.color-picker", "Color picker"));

        const picker = document.createElement("sac-color-picker");
        picker.addEventListener("sac:change", (e) => {
            e.stopPropagation();                  // apps listen to the FIELD, not the picker
            const parsed = this._parse(e.detail && e.detail.value);
            if (!parsed) return;
            if (!this.hasAttribute("alpha")) parsed.a = 1;
            this._forwarding = true;
            this._dirty = false;                  // the picker wins over half-typed text
            this._apply(parsed, true);
            this._forwarding = false;
        });

        pop.appendChild(picker);
        this.shadowRoot.appendChild(pop);
        this._popover = pop;
        this._picker = picker;
    }

    _toggle() {
        if (this._open) this._closePopover(true);
        else this._openPopover();
    }

    _openPopover() {
        if (this._open || this.hasAttribute("disabled")) return;
        this._ensurePopover();

        if (this.hasAttribute("alpha")) this._picker.setAttribute("alpha", "");
        else this._picker.removeAttribute("alpha");
        const seed = this._format();                          // seed: no event comes back
        if (seed) this._picker.setAttribute("value", seed);

        this._open = true;
        this._raise();                                        // top layer, then measure
        this._popover.classList.add("open");
        this._well.setAttribute("aria-expanded", "true");
        this._position();

        // The picker decides the popover's height, and it may still be
        // upgrading — settle the placement and hand over focus once there is
        // real layout to measure.
        requestAnimationFrame(() => {
            if (!this._open) return;
            this._position();
            this._picker.focus();
        });
    }

    /** @param {boolean} restoreFocus — put focus back on the well, but only if
     *  it still lives inside this component (never yank it from elsewhere). */
    _closePopover(restoreFocus) {
        if (!this._open) return;
        this._open = false;
        this._popover.classList.remove("open");
        this._lower();
        this._well.setAttribute("aria-expanded", "false");
        if (restoreFocus && document.activeElement === this) this._well.focus();
    }

    /* Top layer, exactly as sac-menu: a transformed or clipping ancestor would
       otherwise catch this fixed panel. Leaving the layer waits for the fade. */
    _raise() {
        if (this._lowerTimer != null) {
            clearTimeout(this._lowerTimer);
            this._lowerTimer = null;
        }
        const p = this._popover;
        if (!p || typeof p.showPopover !== "function" || p.matches(":popover-open")) return;
        try { p.showPopover(); } catch (err) { /* already shown */ }
    }

    _lower() {
        const p = this._popover;
        if (!p || typeof p.hidePopover !== "function") return;
        if (this._lowerTimer != null) clearTimeout(this._lowerTimer);
        this._lowerTimer = setTimeout(() => {
            this._lowerTimer = null;
            if (this._open || !p.isConnected || !p.matches(":popover-open")) return;
            try { p.hidePopover(); } catch (err) { /* already hidden */ }
        }, 160);
    }

    _onReposition() {
        this._position();
    }

    /** Anchor the fixed popover under the well: left edges aligned, flipped
     *  above when there is no room below, clamped 8px inside the viewport. */
    _position() {
        if (!this._open || !this._popover) return;
        const rect = this._well.getBoundingClientRect();
        const pop  = this._popover.getBoundingClientRect();
        const margin = 8;
        const gap = 6;

        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        const openUp = spaceBelow < pop.height + gap + margin && spaceAbove > spaceBelow;

        let top = openUp ? rect.top - pop.height - gap : rect.bottom + gap;
        top = Math.max(margin, Math.min(top, window.innerHeight - pop.height - margin));

        let left = rect.left;
        left = Math.max(margin, Math.min(left, window.innerWidth - pop.width - margin));

        this._popover.style.top = `${top}px`;
        this._popover.style.left = `${left}px`;
    }

    /* ---------------------------------------------------------- listeners */

    _onDocPointer(e) {
        if (!this._open) return;
        if (e.composedPath().includes(this)) return;   // well + popover both sit under the host
        this._closePopover(true);
    }

    _onDocKeydown(e) {
        if (!this._open) return;
        // Tab is deliberately NOT handled: it moves between the picker's own
        // controls (SV thumb, strips, RGB rows, hex).
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            this._closePopover(true);
        }
    }
}

/** Fallback when `value` is absent or unparseable — the kit's accent seed. */
SacColorField.DEFAULT = "#3b82f6";

customElements.define("sac-color-field", SacColorField);
})();
