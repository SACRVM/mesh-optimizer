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
 *   format      — how the date is SHOWN and typed: "iso" (2026-09-25),
 *                 "dmy." (25.09.2026), "dmy/" (25/09/2026), "mdy/"
 *                 (09/25/2026). Absent = the page-wide sac.regional date
 *                 format (default by language: "dmy." in German, else
 *                 "iso"), followed live. `value`, min/max and
 *                 sac:change stay ISO whatever the format. Typing is
 *                 tolerant: single-digit day/month, a two-digit year
 *                 (00–68 → 20xx, 69–99 → 19xx), any of . / - as separator,
 *                 and an ISO date is always accepted — the rules of
 *                 sac.regional.parseDate / formatDate, which show and read
 *                 dates the same way outside a field. Formats other than
 *                 ISO need lib/globals.js (sac.regional); without it the
 *                 field is ISO-only.
 *   label       — text above the row, kit form-label styling. Absent/empty =
 *                 no label line at all. Also becomes the input's accessible name.
 *   placeholder — the input's placeholder. Default follows the format
 *                 ("yyyy-mm-dd", "dd.mm.yyyy", …, translated).
 *   disabled    — greys the row out, blocks both the input and the button,
 *                 and closes the popover if it was open.
 *   size        — "compact" (default: 28px row, small monospace — sidebars,
 *                 settings panels) or "regular" (the metrics of a plain kit
 *                 <input>: 0.6rem padding, the UI font with tabular digits,
 *                 a calendar button as tall as the field) for a normal form.
 *                 sac-time-field takes the same attribute, so a date + time
 *                 pair stays one family. Touch sizing is the same for both.
 *                 "cell" = the cell-editor contract (borderless, fills its
 *                 container, no label; Alt+↓ opens the calendar; Enter /
 *                 Escape / Tab per style guide → Cell editors).
 *
 * Properties:
 *   value — get/set, normalized ISO or "". Setting is programmatic: the input
 *           and an open popover update in place and NO event is fired (events
 *           mean "the user did this"). Never overwrites text mid-typing.
 *   focus({ select }) — focuses the input; select: true selects its text.
 *
 * Events:
 *   sac:change — detail { value } — the normalized ISO (or "" when the
 *                     user cleared the input), on USER changes only: a
 *                     committed typed date, or a day picked in the calendar.
 *                     Bubbles + composed. The calendar's own event is stopped
 *                     at the boundary, so apps see exactly one.
 *   sac:commit / sac:cancel — size="cell" only (style guide → Cell editors).
 *
 * Keyboard:
 *   on the button — Enter / Space / ArrowDown open the popover, focus moves
 *                   into the calendar; Escape closes it and comes back.
 *   in the input  — Enter commits and normalizes, Escape reverts to the last
 *                   valid value.
 *
 * Invalid text (style guide → CSS Patterns → Field errors): while typing it
 * shows --danger with a 1px underline and the input gets
 * aria-invalid="true". Enter or focus leaving with invalid text shows a line
 * under the field that says what is expected — "Not a valid date – e.g.
 * 25.09.2026" (the example in the field's current format, inside min/max),
 * "No earlier than {min}", "No later than {max}" — wired with
 * aria-describedby and announced politely. The text and the line STAY
 * (before 2.36 the text silently reverted on blur): `value` keeps the last
 * valid date and no sac:change fires for invalid text. Correcting the text,
 * picking a day or Escape clears it; a programmatic value set while the
 * input is not focused replaces the text. size="cell" sets aria-invalid
 * only — no line, and blur / Tab still revert (the host grid owns commit
 * and cancel there).
 *
 * The input also carries the expected format as its accessible description
 * ("Format: dd.mm.yyyy, e.g. 25.09.2026"), so a screen reader hears it
 * before typing; no visible helper line (it would change every layout).
 *
 * CSS parts: label, input (the text box), well (the calendar button),
 * error (the message line).
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

class SacDateField extends HTMLElement {
    static get observedAttributes() {
        return ["value", "min", "max", "week-start", "format", "label", "placeholder", "disabled", "size"];
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
        this._snapshot = "";       // value when focus entered (size="cell" cancel)
        this._inside = false;
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
        // Runtime language switch: relabel in place (the popover calendar
        // relabels itself); typing, value and an open popover survive.
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
        // Page-wide format switch: re-show in place (unless the field has its own).
        if (window.sac && sac.regional && !this._offRegional) {
            this._offRegional = sac.regional.onChange(() => {
                if (!this.hasAttribute("format")) this._syncFormat();
            });
        }
    }

    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
        if (this._offRegional) { this._offRegional(); this._offRegional = null; }
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
                this._forward(name);
                this._syncHint();                  // the example stays inside the bounds
                if (this._dirty) this._markValidity();
                break;
            case "week-start":  this._forward(name);       break;
            case "label":       this._syncLabel();         break;
            case "placeholder": this._syncPlaceholder();   break;
            case "format":      this._syncFormat();        break;
            case "disabled":    this._syncDisabled();      break;
            case "size":        this._syncSize();          break;
        }
    }

    /* ---------------------------------------------------------------- API */

    get value() { return this._value; }
    set value(v) { this.setAttribute("value", v == null ? "" : String(v)); }
    /** "" while the typed text can commit, else the words the line under the
     *  field shows. `value` keeps the last valid date meanwhile — a form
     *  holds its Save on this. */
    get validationMessage() { return this._input ? (this._judge().error || "") : ""; }

get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }

    focus(opts) {
        if (!this._input) return super.focus(opts);
        this._input.focus(opts);
        if (opts && opts.select) this._input.select();
    }

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

    /** The active display format: own attribute, else sac.regional, else iso. */
    _fmt() {
        const own = this.getAttribute("format");
        if (SacDateField.FORMATS.includes(own)) return own;
        const reg = window.sac && sac.regional && sac.regional.get().date;
        return SacDateField.FORMATS.includes(reg) ? reg : "iso";
    }

    /** Typed text → normalized ISO, "" or null. The rules are
     *  sac.regional.parseDate's (one source for every date the kit reads);
     *  without globals.js only ISO is understood. */
    _parseTyped(str) {
        const reg = window.sac && sac.regional && sac.regional.parseDate;
        return reg ? sac.regional.parseDate(str, { format: this._fmt() }) : SacDateField._normalize(str);
    }

    /** ISO → the text shown in the input (sac.regional.formatDate). */
    _display(iso) {
        if (!iso) return "";
        const reg = window.sac && sac.regional && sac.regional.formatDate;
        return reg ? sac.regional.formatDate(iso, { format: this._fmt() }) : iso;
    }

    /** Format changed: re-show value and placeholder; half-typed text stays
     *  (and is judged anew — a message names the new format). */
    _syncFormat() {
        if (!this._input) return;
        this._syncPlaceholder();
        this._syncHint();
        this._syncUI();
    }

    /** A date the field accepts, as it is typed here: 25 September of this
     *  year (a day above 12, so the order of day and month shows), moved
     *  inside min / max when it falls outside. */
    _example() {
        let iso = `${String(new Date().getFullYear()).padStart(4, "0")}-09-25`;
        const min = SacDateField._normalize(this.getAttribute("min"));
        const max = SacDateField._normalize(this.getAttribute("max"));
        if (min && iso < min) iso = min;
        if (max && iso > max) iso = max;
        return this._display(iso);
    }

    /** The format's pattern in words: "dd.mm.yyyy", "yyyy-mm-dd" … (translated). */
    _pattern() {
        const fmt = this._fmt();
        return fmt === "dmy." ? t("date-field.placeholder-dmy-dot",   "dd.mm.yyyy") :
               fmt === "dmy/" ? t("date-field.placeholder-dmy-slash", "dd/mm/yyyy") :
               fmt === "mdy/" ? t("date-field.placeholder-mdy-slash", "mm/dd/yyyy") :
                                t("date-field.placeholder",           "yyyy-mm-dd");
    }

    /** The expected format as the input's accessible description. */
    _syncHint() {
        if (!this._hintEl) return;
        this._hintEl.textContent = t("date-field.format-hint", "Format: {pattern}, e.g. {example}")
            .replace("{pattern}", () => this._pattern())
            .replace("{example}", () => this._example());
    }

    /* ------------------------------------------------------------- state */

    /** First read of every attribute, once the shadow DOM exists. */
    _adopt() {
        const iso = SacDateField._normalize(this.getAttribute("value"));
        this._value = iso == null ? "" : iso;      // absent or garbage → no selection
        this._syncLabel();
        this._syncPlaceholder();
        this._syncDisabled();
        this._syncSize();
        this._reflect();
        this._syncUI();
        this._syncHint();
    }

    _cell() { return this.getAttribute("size") === "cell"; }

    /** Cell editors keep the calendar button out of the tab order: Tab
     *  leaves the field (Alt+↓ and the mouse still open the calendar). */
    _syncSize() {
        if (this._cell()) this._well.tabIndex = -1;
        else this._well.removeAttribute("tabindex");
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
        const iso = raw == null ? "" : SacDateField._normalize(raw);   // attribute removed = cleared
        if (iso == null) { this._reflect(); return; }          // garbage in → last valid back out
        // Invalid text left standing after blur is replaced by an app's
        // value (a form reset, the next record); typing in progress is not.
        if (this._dirty && this.shadowRoot.activeElement !== this._input) this._dirty = false;
        this._apply(iso, false);
    }

    /* ------------------------------------------------------------ in-place UI */

    _syncUI() {
        if (!this._input) return;
        if (!this._dirty) {
            const shown = this._display(this._value);
            if (this._input.value !== shown) this._input.value = shown;
            this._setInvalid(false);
            this._showError(null);
        } else {
            this._markValidity();          // the format moved under the typed text
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
        const own = this.getAttribute("placeholder");
        this._input.placeholder = own || this._pattern();
    }

    /** Kit strings in the current language, on the existing nodes. */
    _relabel() {
        if (!this._input) return;
        this._syncLabel();
        this._syncPlaceholder();
        this._syncHint();
        if (this._dirty) this._markValidity();      // the message in the new language
        this._well.setAttribute("aria-label", t("date-field.choose-date", "Choose date"));
        if (this._popover) this._popover.setAttribute("aria-label", t("date-field.calendar", "Calendar"));
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

                /* size="regular": the plain kit <input> metrics (ui.css:
                   0.6rem padding, the UI font at the input's UA size), the
                   well one field-height square. 1lh = the field's line box. */
                :host([size="regular"]) .date {
                    padding: 0.6rem;
                    font-family: inherit;
                    font-size: 13.3333px;
                    line-height: normal;
                    font-variant-numeric: tabular-nums;
                    width: 14ch;
                }
                :host([size="regular"]) .well {
                    font-family: inherit;
                    font-size: 13.3333px;
                    line-height: normal;
                    width: calc(1lh + 1.2rem + 2px);
                    height: calc(1lh + 1.2rem + 2px);
                    --icon-size: 17px;
                }

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
                    font-family: var(--font-mono);
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
                :host([size="regular"]) .error { font-size: 0.8rem; }

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
                                color 150ms var(--ease-smooth),
                                transform 0.2s var(--ease-smooth);
                }
                .well:hover:not(:disabled) {
                    border-color: var(--accent);
                    color: var(--accent);
                }
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
                    .date, :host([size="regular"]) .date {
                        min-height: 44px;
                        font-size: max(16px, 1rem);
                    }
                    .well, :host([size="regular"]) .well { width: 44px; height: 44px; }
                }

                /* The calendar's own :host default would beat a value
                   inherited from outside (a declaration on the host outranks
                   inheritance), so re-point it at the chain: this outer-tree
                   rule wins over the calendar's :host, and inherit walks up
                   to this field's :host — whose mirror default keeps the
                   unset case at 280px. */
                .popover sac-calendar { --calendar-width: inherit; }

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
                :host([size="cell"]) .row { height: 100%; gap: 0; }
                :host([size="cell"]) .date,
                :host([size="cell"]) .date:hover,
                :host([size="cell"]) .date:focus {
                    width: 100%;
                    height: 100%;
                    min-height: 0;
                    padding: 0 0 0 var(--cell-padding-inline, 8px);
                    font: inherit;
                    font-variant-numeric: tabular-nums;
                    color: inherit;
                    background: transparent;
                    border: 0;
                    border-radius: 0;
                    box-shadow: none;
                }
                :host([size="cell"]) .date.invalid { color: var(--danger-text); }
                :host([size="cell"]) .well {
                    width: auto;
                    height: 100%;
                    aspect-ratio: 1;
                    max-width: 32px;
                    background: transparent;
                    border: 0;
                    border-radius: 0;
                    --icon-size: 14px;
                }
                :host([size="cell"]) .well:focus-visible { outline: none; color: var(--accent); }
                @media (pointer: coarse) {
                    :host([size="cell"]) .date { font-size: max(16px, 1em); }
                    :host([size="cell"]) .well { width: auto; height: 100%; }
                }

                @media (prefers-reduced-motion: reduce) {
                    .popover,
                    .popover.open {
                        transition: none;
                        transform: none;
                    }
                    .date, .well { transition: none; }
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
            <label class="label" part="label" for="date" hidden></label>
            <div class="row">
                <input class="date" part="input" id="date" type="text" aria-label="${L.date}"
                       placeholder="${L.placeholder}" spellcheck="false"
                       autocomplete="off" autocapitalize="off" aria-describedby="error hint">
                <button class="well" part="well" id="well" type="button"
                        aria-label="${L.choose}" aria-haspopup="dialog" aria-expanded="false">
                    <sac-icon name="calendar"></sac-icon>
                </button>
            </div>
            <div class="error" part="error" id="error" aria-live="polite"></div>
            <span id="hint" hidden></span>
        `;

        this._labelEl = this.shadowRoot.querySelector(".label");
        this._row     = this.shadowRoot.querySelector(".row");
        this._input   = this.shadowRoot.getElementById("date");
        this._well    = this.shadowRoot.getElementById("well");
        this._errorEl = this.shadowRoot.getElementById("error");
        this._hintEl  = this.shadowRoot.getElementById("hint");

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
            this._snapshot = this._value;
        });
        this.addEventListener("focusout", (e) => {
            if (e.relatedTarget !== this) this._inside = false;
        });
        this.addEventListener("keydown", (e) => this._onCellKeydown(e));
    }

    /** size="cell", on the host (after the inner handlers ran). Enter/Escape
     *  from the input are handled in _onInputKeydown; here: the button and
     *  the popover's keys, and Tab from anywhere. */
    _onCellKeydown(e) {
        if (!this._cell()) return;
        const path = e.composedPath();
        const inPopover = this._popover && path.includes(this._popover);
        if (e.key === "Tab") {                    // never swallowed
            this._closePopover(false);
            this._commit(true);
        } else if (e.key === "Enter" && (inPopover || path.includes(this._well))) {
            e.stopPropagation();                  // the popover / button took it; the NEXT Enter commits
        } else if (e.key === "Escape" && path.includes(this._well)) {
            e.preventDefault();
            e.stopPropagation();
            this._cancel();
        }
    }

    _cancel() {
        this._dirty = false;
        this._closePopover(false);
        this._apply(this._snapshot, false);
        this._setInvalid(false);
        this._showError(null);
        this._input.focus();
        this.dispatchEvent(new CustomEvent("sac:cancel", {
            detail: { value: this._value }, bubbles: true, composed: true,
        }));
    }

    /* ----------------------------------------------------------- text input */

    _onInput() {
        this._dirty = true;
        this._markValidity();
    }

    /** The typed text judged: { iso } — normalized, or "" for empty — when
     *  it can commit, else { error } — the message saying what is expected. */
    _judge() {
        const text = this._input.value.trim();
        if (text === "") return { iso: "" };
        const iso = this._parseTyped(text);
        if (iso == null) {
            return { error: t("date-field.error-invalid", "Not a valid date – e.g. {example}")
                .replace("{example}", () => this._example()) };
        }
        const min = SacDateField._normalize(this.getAttribute("min"));
        const max = SacDateField._normalize(this.getAttribute("max"));
        if (min && iso < min) {
            return { error: t("date-field.error-min", "No earlier than {min}").replace("{min}", () => this._display(min)) };
        }
        if (max && iso > max) {
            return { error: t("date-field.error-max", "No later than {max}").replace("{max}", () => this._display(max)) };
        }
        return { iso };
    }

    /** Live while typing: the invalid look + aria-invalid; a message that
     *  is already showing follows the text (and goes once it is valid).
     *  A NEW message waits for Enter or blur — not every keystroke. */
    _markValidity() {
        const j = this._judge();
        this._setInvalid(!!j.error);
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
                        detail: { value: this._value, shiftKey: e.shiftKey }, bubbles: true, composed: true,
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
        const j = this._judge();                  // "" = cleared by hand, a real user change
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
        this._dirty = false;
        this._setInvalid(false);
        this._showError(null);
        this._apply(j.iso, true);                 // _syncUI rewrites the text normalized
        return true;
    }

    _revertInput() {
        this._dirty = false;
        this._setInvalid(false);
        this._showError(null);
        this._input.value = this._display(this._value);
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
                // Re-picking the current day over invalid text left
                // standing: the pick wins, the text shows that day again.
                if (this._dirty) { this._dirty = false; this._syncUI(); }
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

SacDateField.FORMATS = ["iso", "dmy.", "dmy/", "mdy/"];

customElements.define("sac-date-field", SacDateField);
})();
