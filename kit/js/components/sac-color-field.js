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
 *   size     — absent = the form row above; "cell" = the cell-editor
 *              contract (borderless, fills its container, no label; a
 *              small swatch + the hex text; Alt+↓ opens the picker; Enter /
 *              Escape / Tab per style guide → Cell editors).
 *
 * Properties:
 *   value — get/set, normalized lowercase hex. Setting is programmatic: the
 *           well, the hex input and an open popover update in place and NO
 *           event is fired (events mean "the user did this").
 *   focus({ select }) — focuses the hex input; select: true selects its text.
 *
 * Events:
 *   sac:change — detail { value } — the normalized hex, on USER changes
 *                      only: a committed hex entry, or any picker interaction
 *                      (live while dragging), and once more when Escape takes
 *                      the popover's changes back. Bubbles, not composed. The
 *                      picker's own event is stopped at the boundary, so apps
 *                      see exactly one.
 *   sac:commit / sac:cancel — size="cell" only (style guide → Cell editors).
 *
 * Keyboard:
 *   on the well     — Enter / Space / ArrowDown open the popover, focus moves
 *                     into the picker. Escape closes it and comes back AND
 *                     restores the colour the field had when it opened (one
 *                     sac:change if that differs); an outside click or a
 *                     re-click on the well keeps the new colour. Under
 *                     size="cell" Escape only closes (the cell's own Escape
 *                     restores — sac:cancel).
 *   in the hex input— Enter commits, Escape reverts to the last valid value.
 *
 * Invalid text (style guide → CSS Patterns → Field errors): while typing,
 * unparseable text shows --danger and the input gets aria-invalid="true".
 * Enter or focus leaving with it (or with the input emptied) shows a line
 * under the field — "Not a color – e.g. #3b82f6" — wired with
 * aria-describedby and announced politely. The text and the line STAY
 * (before 2.36 the text silently reverted on blur): `value` keeps the last
 * valid colour and no sac:change fires. Correcting the text, a picker
 * change or Escape clears it; a programmatic value set while the input is
 * not focused replaces the text. size="cell" sets aria-invalid only — no
 * line, and blur / Tab still revert (the host grid owns commit and cancel).
 *
 * CSS parts: error (the message line).
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

    /* The blur of a click elsewhere fires on pointer-down. A message line
       shown right then grows the field and can pull the click's target (a
       Save button below) out from under the pointer before pointer-up —
       the click is lost. So while a pointer is down, the line waits until
       that click has landed. */
    let pressed = false;
    document.addEventListener("pointerdown", () => { pressed = true; }, true);
    document.addEventListener("pointerup", () => { pressed = false; }, true);
    document.addEventListener("pointercancel", () => { pressed = false; }, true);
    function whenReleased(fn) {
        if (!pressed) { fn(); return; }
        const go = () => {
            document.removeEventListener("pointerup", go, true);
            document.removeEventListener("pointercancel", go, true);
            setTimeout(fn, 0);                 // after the click that follows pointer-up
        };
        document.addEventListener("pointerup", go, true);
        document.addEventListener("pointercancel", go, true);
    }

class SacColorField extends HTMLElement {
    static get observedAttributes() { return ["value", "alpha", "label", "disabled", "size"]; }

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
        this._snapshot = "";       // value when focus entered (size="cell" cancel)
        this._inside = false;
        this._openSnapshot = "";   // value when the popover opened (Escape restores it)
        this._errorShown = false;  // the message line is up (form mode)

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
            case "size":     this._syncSize();     break;
        }
    }

    /* ---------------------------------------------------------------- API */

    get value() { return this._format(); }
    set value(v) { this.setAttribute("value", v == null ? "" : String(v)); }
    /** "" while the hex text can commit, else the words the line under the
     *  field shows. An emptied input counts only once a commit was refused
     *  (mid-typing it is a fresh start). `value` keeps the last valid colour
     *  meanwhile — a form holds its Save on this. */
    get validationMessage() {
        if (!this._input) return "";
        if (this._input.value.trim() === "" && !this._errorShown) return "";
        return this._judge().error || "";
    }

    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }

    focus(opts) {
        if (!this._input) return super.focus(opts);
        this._input.focus(opts);
        if (opts && opts.select) this._input.select();
    }

    _cell() { return this.getAttribute("size") === "cell"; }

    /** Cell editors keep the well out of the tab order: Tab leaves the field. */
    _syncSize() {
        if (this._cell()) this._well.tabIndex = -1;
        else this._well.removeAttribute("tabindex");
    }

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
        this._syncSize();
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
        // Invalid text left standing after blur is replaced by an app's
        // value (a form reset, the next record); typing in progress is not.
        if (this._dirty && this.shadowRoot.activeElement !== this._input) this._dirty = false;
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
            this._setInvalid(false);
            this._showError(null);
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
        if (this._dirty) this._markValidity();      // the message in the new language
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
                    transition: border-color 150ms var(--ease-smooth),
                                transform 0.2s var(--ease-smooth);
                }
                .well:hover:not(:disabled) { border-color: var(--accent); }
                /* Press: answers the moment it goes down. */
                .well:active:not(:disabled) {
                    transform: scale(0.97);
                    transition-duration: 0.1s;
                }
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
                    font-family: var(--font-mono);
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

                /* The field-error line (ui.css .field-error, re-stated):
                   always in the tree so the polite live region announces,
                   empty — and so nothing — while the text is valid. It
                   wraps inside the field's width instead of widening it
                   (contain: inline-size). */
                .error {
                    contain: inline-size;
                    font-size: 0.75rem;
                    line-height: 1.35;
                    color: var(--danger-text);
                }
                .error:not(:empty) { margin-top: 0.3rem; }

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

                /* size="cell" — the cell-editor contract: borderless, fills
                   the cell, the cell's font, no label, no own focus ring. */
                :host([size="cell"]) {
                    display: block;
                    width: 100%;
                    height: 100%;
                    font: inherit;
                    color: inherit;
                }
                :host([size="cell"]) .label,
                :host([size="cell"]) .error { display: none; }
                :host([size="cell"]) .row {
                    height: 100%;
                    gap: 6px;
                    padding-left: var(--cell-padding-inline, 8px);
                }
                :host([size="cell"]) .well,
                :host([size="cell"]) .well:hover {
                    width: 1.15em;
                    height: 1.15em;
                    border-color: var(--border-strong);
                    border-radius: var(--radius-s);
                }
                :host([size="cell"]) .well:focus-visible { outline-offset: 1px; }
                :host([size="cell"]) .hex,
                :host([size="cell"]) .hex:hover,
                :host([size="cell"]) .hex:focus {
                    width: 100%;
                    height: 100%;
                    padding: 0 var(--cell-padding-inline, 8px) 0 0;
                    font: inherit;
                    font-family: var(--font-mono);
                    color: inherit;
                    background: transparent;
                    border: 0;
                    border-radius: 0;
                    box-shadow: none;
                }
                :host([size="cell"]) .hex.invalid { color: var(--danger-text); }
                @media (pointer: coarse) {
                    :host([size="cell"]) .well { width: 1.15em; height: 1.15em; }
                    :host([size="cell"]) .hex { height: 100%; font-size: max(16px, 1em); }
                }

                @media (prefers-reduced-motion: reduce) {
                    .popover,
                    .popover.open {
                        transition: none;
                        transform: none;
                    }
                    .well, .hex { transition: none; }
                }

                /* Reduced transparency / more contrast: the blurred popover
                   turns solid; under more contrast its edge shows clearly. */
                @media (prefers-reduced-transparency: reduce) {
                    .popover { background: var(--glass-solid); backdrop-filter: none; -webkit-backdrop-filter: none; }
                }
                @media (prefers-contrast: more) {
                    .popover { background: var(--glass-solid); backdrop-filter: none; -webkit-backdrop-filter: none; border-color: var(--border-contrast); }
                }
            </style>
            <label class="label" for="hex" hidden></label>
            <div class="row">
                <button class="well" id="well" type="button"
                        aria-label="${L.choose}" aria-haspopup="dialog" aria-expanded="false">
                    <span class="checker"></span><span class="fill"></span>
                </button>
                <input class="hex" id="hex" type="text" aria-label="${L.hex}"
                       spellcheck="false" autocomplete="off" autocapitalize="off" aria-describedby="error">
            </div>
            <div class="error" part="error" id="error" aria-live="polite"></div>
        `;

        this._labelEl = this.shadowRoot.querySelector(".label");
        this._well    = this.shadowRoot.getElementById("well");
        this._fill    = this.shadowRoot.querySelector(".fill");
        this._input   = this.shadowRoot.getElementById("hex");
        this._errorEl = this.shadowRoot.getElementById("error");

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

        // Cell contract: remember the value focus arrived with, and stop
        // the keys the field acted on at the boundary.
        this.addEventListener("focusin", () => {
            if (this._inside) return;
            this._inside = true;
            this._snapshot = this._format();
        });
        this.addEventListener("focusout", (e) => {
            if (e.relatedTarget !== this) this._inside = false;
        });
        this.addEventListener("keydown", (e) => this._onCellKeydown(e));
    }

    /** size="cell", on the host (after the inner handlers ran). Enter/Escape
     *  from the hex input are handled in _onInputKeydown; here: the well and
     *  the popover's keys, and Tab from anywhere. */
    _onCellKeydown(e) {
        if (!this._cell()) return;
        const path = e.composedPath();
        const inPopover = this._popover && path.includes(this._popover);
        if (e.key === "Tab") {                    // never swallowed
            this._closePopover(false);
            this._commit(true);
        } else if (e.key === "Enter" && inPopover) {
            e.stopPropagation();                  // the picker took it — close; the NEXT Enter commits
            this._closePopover(false);
            this._input.focus();
        } else if (e.key === "Enter" && path.includes(this._well)) {
            e.stopPropagation();                  // the well's click toggled the popover
        } else if (e.key === "Escape" && path.includes(this._well)) {
            e.preventDefault();
            e.stopPropagation();
            this._cancel();
        }
    }

    _cancel() {
        this._dirty = false;
        this._closePopover(false);
        const parsed = this._parse(this._snapshot);
        if (parsed) this._apply(parsed, false);
        this._setInvalid(false);
        this._showError(null);
        this._input.value = this._format();
        this._input.focus();
        this.dispatchEvent(new CustomEvent("sac:cancel", {
            detail: { value: this._format() }, bubbles: true, composed: true,
        }));
    }

    /* ---------------------------------------------------------- hex input */

    _onInput() {
        this._dirty = true;
        this._markValidity();
    }

    /** The typed text judged: { rgba } when it can commit, else { error }
     *  — the message saying what is expected. Empty text is not a colour. */
    _judge() {
        const parsed = this._parse(this._input.value);
        if (parsed) return { rgba: parsed };
        return { error: t("color-field.error-invalid", "Not a color – e.g. {example}")
            .replace("{example}", SacColorField.DEFAULT) };
    }

    /** Live while typing: the invalid look + aria-invalid (an emptied input
     *  only once a commit was refused — mid-typing it is just a fresh
     *  start); a message that is already showing follows the text, and goes
     *  once it is valid. A NEW message waits for Enter or blur. */
    _markValidity() {
        const j = this._judge();
        const empty = this._input.value.trim() === "";
        this._setInvalid(!!j.error && (!empty || this._errorShown));
        if (this._errorShown) this._showError(j.error || null);
    }

    _setInvalid(bad) {
        this._input.classList.toggle("invalid", bad);
        if (bad) this._input.setAttribute("aria-invalid", "true");
        else this._input.removeAttribute("aria-invalid");
    }

    /** The message line — form mode only; null clears it. */
    _showError(msg) {
        const text = msg && !this._cell() ? String(msg) : "";
        this._errorShown = !!text;
        if (this._errorEl && this._errorEl.textContent !== text) this._errorEl.textContent = text;
    }

    _onInputKeydown(e) {
        if (this._cell()) {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                if (this._commit(false)) {
                    this.dispatchEvent(new CustomEvent("sac:commit", {
                        detail: { value: this._format(), shiftKey: e.shiftKey }, bubbles: true, composed: true,
                    }));
                }
            } else if (e.key === "Escape" && !this._open) {
                e.preventDefault();
                e.stopPropagation();
                this._cancel();
            } else if (e.key === "ArrowDown" && e.altKey) {
                e.preventDefault();
                this._openPopover();
            }
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            this._commit(false);
        } else if (e.key === "Escape" && !this._open) {
            e.stopPropagation();                  // popover Escape wins when it is open
            this._revertInput();
        }
    }

    /**
     * @param {boolean} revertOnInvalid — size="cell" only: true on blur /
     *   Tab (the cell contract reverts), false on Enter (the editor stays
     *   open, marked). In form mode invalid text never reverts: it stays,
     *   with the message line saying what is expected.
     * @returns true when the text is a valid value (committed or unchanged).
     */
    _commit(revertOnInvalid) {
        if (!this._dirty) return true;            // nothing typed → never re-fire the old value
        const j = this._judge();
        if (j.error) {
            if (this._cell()) {
                if (revertOnInvalid) this._revertInput();
                else this._setInvalid(true);
            } else {
                this._setInvalid(true);
                whenReleased(() => {                     // judged again: the click may have fixed it
                    const now = this._dirty ? this._judge().error : null;
                    if (now) this._showError(now);
                });
            }
            return false;
        }
        const parsed = j.rgba;
        if (!this.hasAttribute("alpha")) parsed.a = 1;
        this._dirty = false;
        this._setInvalid(false);
        this._showError(null);
        this._apply(parsed, true);
        return true;
    }

    _revertInput() {
        this._dirty = false;
        this._setInvalid(false);
        this._showError(null);
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
        this._openSnapshot = seed;                            // what Escape goes back to

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
        if (restoreFocus && document.activeElement === this) (this._cell() ? this._input : this._well).focus();
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
            // Escape takes back what the popover changed (every drag already
            // committed live): the colour it opened with returns, with one
            // sac:change when it differs. size="cell" keeps its own contract
            // — the cell's Escape (sac:cancel) restores the whole edit.
            if (!this._cell()) {
                const back = this._parse(this._openSnapshot);
                if (back && this._format() !== this._openSnapshot) {
                    if (!this.hasAttribute("alpha")) back.a = 1;
                    this._dirty = false;
                    this._apply(back, true);
                }
            }
        }
    }
}

/** Fallback when `value` is absent or unparseable — the kit's accent seed. */
SacColorField.DEFAULT = "#3b82f6";

customElements.define("sac-color-field", SacColorField);
})();
