/**
 * <sac-date-field value="2026-08-15" label="Due" min="2026-01-01" max="2026-12-31">
 *
 * The compact form-row date input: an optional label, a text field taking ISO
 * dates and a calendar button. Clicking the button drops a <sac-calendar>
 * popover below it — the field is what sits in a sidebar or a settings form,
 * the calendar is the surface you only see while choosing.
 *
 * Requires kit/js/components/sac-calendar.js (the popover body) to be loaded.
 * kit/js/all.js pulls both in the right order.
 *
 * Usage:
 *   <sac-date-field label="Due" value="2026-08-15"></sac-date-field>
 *   <sac-date-field label="Start" min="2026-01-01" max="2026-12-31"></sac-date-field>
 *
 *   field.addEventListener("sac:change", e => plan(e.detail.value));
 *   field.value = "2026-09-01";     // programmatic — updates the UI, fires nothing
 *
 * Attributes:
 *   value       — ISO date `yyyy-mm-dd`, tolerant on the way in (whitespace,
 *                 single-digit month/day: `2026-8-5`), REFLECTED normalized
 *                 zero-padded. Empty or absent = no selection. An unparseable
 *                 or impossible date (2026-02-31) is rejected: the last valid
 *                 value is put back.
 *   min / max   — ISO bounds, inclusive, forwarded to the popover calendar
 *                 (days outside render disabled there). A typed date outside
 *                 the bounds counts as invalid and never commits.
 *   week-start  — "1" (Monday, the calendar's default) or "0" (Sunday),
 *                 forwarded to the popover calendar.
 *   label       — text above the row, kit form-label styling. Absent/empty =
 *                 no label line at all. Also becomes the input's accessible name.
 *   placeholder — the input's placeholder. Default "yyyy-mm-dd".
 *   disabled    — greys the row out, blocks both the input and the button,
 *                 and closes the popover if it was open.
 *
 * Properties:
 *   value — get/set, normalized ISO or "". Setting is programmatic: the input
 *           and an open popover update in place and NO event is fired (events
 *           mean "the user did this"). Never overwrites text mid-typing.
 *
 * Events:
 *   sac:change — detail { value } — the normalized ISO (or "" when the
 *                     user cleared the input), on USER changes only: a
 *                     committed typed date, or a day picked in the calendar.
 *                     Bubbles + composed. The calendar's own event is stopped
 *                     at the boundary, so apps see exactly one.
 *
 * Keyboard:
 *   on the button — Enter / Space / ArrowDown open the popover, focus moves
 *                   into the calendar; Escape closes it and comes back.
 *   in the input  — Enter commits and normalizes, Escape reverts to the last
 *                   valid value. Blurring with invalid text reverts too; while
 *                   invalid the text shows --danger with a 1px underline.
 *
 * CSS custom properties:
 *   --calendar-width — set on this field, forwarded to the popover's
 *                      <sac-calendar>. Default 280px (320px under
 *                      (pointer: coarse), mirroring the calendar).
 *
 * Compact/touch:
 *   The popover is never wider than the viewport minus 8px a side
 *   (max-width: calc(100vw - 16px)); the calendar inside caps itself at the
 *   popover's width and shrinks its columns, so the 8px viewport clamp holds
 *   on a 360px phone. Under (pointer: coarse) the input and the calendar
 *   button are 44px tall (the button 44 x 44), the input uses 16px type (no
 *   iOS focus zoom), and the calendar grows to 44px day cells. Nothing is
 *   hover-only — hover only tints borders.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacDateField extends HTMLElement {
    static get observedAttributes() {
        return ["value", "min", "max", "week-start", "label", "placeholder", "disabled"];
    }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });

        this._value = "";          // normalized ISO, "" = no selection
        this._open = false;
        this._dirty = false;       // input carries uncommitted text
        this._reflecting = false;  // guards the value-attribute round trip
        this._forwarding = false;  // guards the calendar → field → calendar echo
        this._popover = null;
        this._calendar = null;
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
    }

    disconnectedCallback() {
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
            case "value":       this._onValueAttr();       break;
            case "min":
            case "max":
            case "week-start":  this._forward(name);       break;
            case "label":       this._syncLabel();         break;
            case "placeholder": this._syncPlaceholder();   break;
            case "disabled":    this._syncDisabled();      break;
        }
    }

    /* ---------------------------------------------------------------- API */

    get value() { return this._value; }
    set value(v) { this.setAttribute("value", v == null ? "" : String(v)); }

    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }

    /* ----------------------------------------------------------- date math */

    /** Tolerant ISO parse: trims, pads single digits, insists on a REAL local
     *  calendar date. Returns {y, m, d} or null. Local Date math only — the
     *  ISO-string Date constructor parses as UTC and shifts days. */
    static _parse(str) {
        if (str == null) return null;
        const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(str).trim());
        if (!m) return null;
        const y = +m[1], mo = +m[2], d = +m[3];
        const dt = new Date(y, mo - 1, d);
        if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
        return { y, m: mo, d };
    }

    /** null = unparseable, "" = empty (no selection), else zero-padded ISO. */
    static _normalize(str) {
        if (str == null) return null;
        const t = String(str).trim();
        if (t === "") return "";
        const p = SacDateField._parse(t);
        if (!p) return null;
        const pad = (n, w) => String(n).padStart(w, "0");
        return `${pad(p.y, 4)}-${pad(p.m, 2)}-${pad(p.d, 2)}`;
    }

    /** Inclusive bounds check. Zero-padded ISO compares correctly as strings;
     *  an absent or unparseable bound simply does not constrain. */
    _inRange(iso) {
        const min = SacDateField._normalize(this.getAttribute("min"));
        const max = SacDateField._normalize(this.getAttribute("max"));
        if (min && iso < min) return false;
        if (max && iso > max) return false;
        return true;
    }

    /* ------------------------------------------------------------- state */

    /** First read of every attribute, once the shadow DOM exists. */
    _adopt() {
        const iso = SacDateField._normalize(this.getAttribute("value"));
        this._value = iso == null ? "" : iso;      // absent or garbage → no selection
        this._syncLabel();
        this._syncPlaceholder();
        this._syncDisabled();
        this._reflect();
        this._syncUI();
    }

    /** Write the normalized ISO back to the attribute without re-entering.
     *  "" with no attribute stays no attribute — both mean "no selection". */
    _reflect() {
        if (this._value === "" && !this.hasAttribute("value")) return;
        if (this.getAttribute("value") === this._value) return;
        this._reflecting = true;
        this.setAttribute("value", this._value);
        this._reflecting = false;
    }

    /**
     * Adopt a date. `fire` = the user caused it, so an event goes out — but
     * only when the normalized value actually moved.
     */
    _apply(iso, fire) {
        const before = this._value;
        this._value = iso;
        this._reflect();
        this._syncUI();
        if (fire && iso !== before) {
            this.dispatchEvent(new CustomEvent("sac:change", {
                detail: { value: iso },
                bubbles: true,
                composed: false,   // native change semantics (value control)
            }));
        }
    }

    _onValueAttr() {
        if (this._reflecting) return;
        const raw = this.getAttribute("value");
        if (raw == null) { this._apply("", false); return; }   // attribute removed = cleared
        const iso = SacDateField._normalize(raw);
        if (iso == null) { this._reflect(); return; }          // garbage in → last valid back out
        this._apply(iso, false);
    }

    /* ------------------------------------------------------------ in-place UI */

    _syncUI() {
        if (!this._input) return;
        if (!this._dirty) {
            if (this._input.value !== this._value) this._input.value = this._value;
            this._input.classList.remove("invalid");
        }
        // Seed an open popover too — but never while the calendar is the one
        // talking (writing back would fight its own selection walk).
        if (this._open && this._calendar && !this._forwarding) this._seedValue();
    }

    _syncLabel() {
        const text = this.getAttribute("label") || "";
        this._labelEl.textContent = text;
        this._labelEl.hidden = !text;
        this._input.setAttribute("aria-label", text || t("date-field.date", "Date"));
    }

    _syncPlaceholder() {
        this._input.placeholder = this.getAttribute("placeholder") || t("date-field.placeholder", "yyyy-mm-dd");
    }

    _syncDisabled() {
        const off = this.hasAttribute("disabled");
        this._well.disabled = off;
        this._input.disabled = off;
        if (off) this._closePopover(false);
    }

    /** Mirror one of the pass-through attributes onto the inner calendar. */
    _forward(name) {
        if (!this._calendar) return;
        const v = this.getAttribute(name);
        if (v == null) this._calendar.removeAttribute(name);
        else this._calendar.setAttribute(name, v);
    }

    /** Seed the calendar's selection — programmatic on its side, so silent. */
    _seedValue() {
        if (!this._calendar) return;
        if (this._value) this._calendar.setAttribute("value", this._value);
        else this._calendar.removeAttribute("value");
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
            date:        esc(t("date-field.date", "Date")),
            placeholder: esc(t("date-field.placeholder", "yyyy-mm-dd")),
            choose:      esc(t("date-field.choose-date", "Choose date")),
        };
        this.shadowRoot.innerHTML = `
            <style>
                *, *::before, *::after { box-sizing: border-box; }

                :host {
                    --calendar-width: 280px;   /* mirrors the calendar's own default */
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

                .date {
                    flex: 1 1 auto;
                    min-width: 0;
                    width: 13ch;
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
                .date::placeholder { color: var(--text-dim); }
                .date:hover:not(:disabled) { border-color: var(--border-strong); }
                .date:focus {
                    outline: none;
                    border-color: var(--accent);
                    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 10%, transparent);
                }
                .date:disabled { cursor: not-allowed; }

                /* Invalid entry: red text and a 1px hairline underline.
                   Never a thick colored border (kit rule: no thick colored
                   borders on rounded surfaces). */
                .date.invalid {
                    color: var(--danger-text);
                    border-bottom-color: var(--danger);
                }
                .date.invalid:focus {
                    border-color: var(--accent);
                    border-bottom-color: var(--danger);
                }

                .well {
                    flex: none;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 28px;
                    height: 28px;
                    padding: 0;
                    color: var(--text-muted);
                    border: 1px solid var(--border-strong);
                    border-radius: var(--radius-m);
                    background: var(--field);
                    cursor: pointer;
                    --icon-size: 15px;
                    transition: border-color 150ms var(--ease-smooth),
                                color 150ms var(--ease-smooth);
                }
                .well:hover:not(:disabled) {
                    border-color: var(--accent);
                    color: var(--accent);
                }
                .well:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                }
                .well:disabled { cursor: not-allowed; }

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
                       a side; the calendar inside caps itself at 100%. */
                    max-width: calc(100vw - 16px);
                    padding: 10px;
                    background: var(--glass-strong);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border: 1px solid var(--border-strong);
                    border-radius: var(--radius-l);
                    box-shadow: var(--shadow-2);

                    opacity: 0;
                    visibility: hidden;   /* keeps the calendar out of the tab order while closed */
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

                /* Touch: 44px row (the input and a 44 x 44 button), 16px
                   type so iOS does not zoom on focus, and the calendar's own
                   coarse default mirrored here (see --calendar-width). */
                @media (pointer: coarse) {
                    :host { --calendar-width: 320px; }
                    .date {
                        min-height: 44px;
                        font-size: max(16px, 1rem);
                    }
                    .well { width: 44px; height: 44px; }
                }

                /* The calendar's own :host default would beat a value
                   inherited from outside (a declaration on the host outranks
                   inheritance), so re-point it at the chain: this outer-tree
                   rule wins over the calendar's :host, and inherit walks up
                   to this field's :host — whose mirror default keeps the
                   unset case at 280px. */
                .popover sac-calendar { --calendar-width: inherit; }

                @media (prefers-reduced-motion: reduce) {
                    .popover,
                    .popover.open {
                        transition: none;
                        transform: none;
                    }
                    .date, .well { transition: none; }
                }
            </style>
            <label class="label" for="date" hidden></label>
            <div class="row">
                <input class="date" id="date" type="text" aria-label="${L.date}"
                       placeholder="${L.placeholder}" spellcheck="false"
                       autocomplete="off" autocapitalize="off">
                <button class="well" id="well" type="button"
                        aria-label="${L.choose}" aria-haspopup="dialog" aria-expanded="false">
                    <sac-icon name="calendar"></sac-icon>
                </button>
            </div>
        `;

        this._labelEl = this.shadowRoot.querySelector(".label");
        this._row     = this.shadowRoot.querySelector(".row");
        this._input   = this.shadowRoot.getElementById("date");
        this._well    = this.shadowRoot.getElementById("well");

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

    /* ----------------------------------------------------------- text input */

    _onInput() {
        this._dirty = true;
        const t = this._input.value.trim();
        const iso = SacDateField._normalize(t);
        const bad = t !== "" && (iso == null || !this._inRange(iso));
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
        const t = this._input.value.trim();
        if (t === "") {                           // cleared by hand = a real user change
            this._dirty = false;
            this._input.classList.remove("invalid");
            this._apply("", true);
            return;
        }
        const iso = SacDateField._normalize(t);
        if (iso == null || !this._inRange(iso)) {
            if (revertOnInvalid) this._revertInput();
            return;
        }
        this._dirty = false;
        this._input.classList.remove("invalid");
        this._apply(iso, true);                   // _syncUI rewrites the text normalized
    }

    _revertInput() {
        this._dirty = false;
        this._input.classList.remove("invalid");
        this._input.value = this._value;
    }

    /* ------------------------------------------------------------ popover */

    /** Built once, on the first open — a field that is never opened costs an
     *  input and a button. */
    _ensurePopover() {
        if (this._popover) return;

        const pop = document.createElement("div");
        pop.className = "popover";
        pop.setAttribute("popover", "manual");
        pop.setAttribute("role", "dialog");
        pop.setAttribute("aria-label", t("date-field.calendar", "Calendar"));

        const cal = document.createElement("sac-calendar");
        cal.addEventListener("sac:change", (e) => {
            e.stopPropagation();                  // apps listen to the FIELD, not the calendar
            const iso = SacDateField._normalize(e.detail && e.detail.value);
            if (!iso) return;                     // a pick always carries a date
            this._forwarding = true;
            this._dirty = false;                  // the calendar wins over half-typed text
            this._apply(iso, true);
            this._forwarding = false;
            this._closePopover(true);             // commit → close → focus back on the button
        });

        // Close-on-pick must not depend on the value changing: re-picking the
        // already-selected day fires no sac:change (the calendar stays
        // quiet when nothing moved), but the popover still has to close.
        // gridcell + aria-disabled are the calendar's documented surface.
        cal.addEventListener("click", (e) => {
            const day = e.composedPath().find((n) =>
                n.getAttribute && n.getAttribute("role") === "gridcell");
            if (day && day.getAttribute("aria-disabled") !== "true") {
                this._closePopover(true);
            }
        });

        pop.appendChild(cal);
        this.shadowRoot.appendChild(pop);
        this._popover = pop;
        this._calendar = cal;
    }

    _toggle() {
        if (this._open) this._closePopover(true);
        else this._openPopover();
    }

    _openPopover() {
        if (this._open || this.hasAttribute("disabled")) return;
        this._ensurePopover();

        this._forward("min");
        this._forward("max");
        this._forward("week-start");
        this._seedValue();                        // seed: no event comes back

        this._open = true;
        this._raise();                                        // top layer, then measure
        this._popover.classList.add("open");
        this._well.setAttribute("aria-expanded", "true");
        this._position();

        // The calendar decides the popover's height, and it may still be
        // upgrading — settle the placement and hand over focus once there is
        // real layout to measure.
        requestAnimationFrame(() => {
            if (!this._open) return;
            this._position();
            this._calendar.focus();
        });
    }

    /** @param {boolean} restoreFocus — put focus back on the button, but only
     *  if it still lives inside this component (never yank it from elsewhere). */
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

    /** Anchor the fixed popover under the row: left edges aligned, flipped
     *  above when there is no room below, clamped 8px inside the viewport. */
    _position() {
        if (!this._open || !this._popover) return;
        const rect = this._row.getBoundingClientRect();
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
        if (e.composedPath().includes(this)) return;   // row + popover both sit under the host
        this._closePopover(true);
    }

    _onDocKeydown(e) {
        if (!this._open) return;
        // Tab is deliberately NOT handled: it moves between the calendar's own
        // controls (prev/next month, the day grid).
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            this._closePopover(true);
        }
    }
}

customElements.define("sac-date-field", SacDateField);
})();
