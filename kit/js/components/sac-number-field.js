/**
 * <sac-number-field value="1234.5" label="Price" decimals="2" min="0" step="0.5">
 *
 * A text input for numbers, shown in the page-wide sac.regional number
 * format ("1,234.50", "1.234,50", "1 234,50", "1'234.50") and re-shown live
 * when that format changes. The keyboard steps it; there are no ± buttons
 * (that is <sac-stepper>). Same row family as <sac-date-field>.
 *
 * Usage:
 *   <sac-number-field label="Price" value="1234.5" decimals="2"></sac-number-field>
 *   field.addEventListener("sac:change", e => save(e.detail.value));   // number | null
 *   field.value = 99;     // programmatic — updates the UI, fires nothing
 *
 * Attributes:
 *   value       — a plain JS number string ("1234.5", "-0.25"), REFLECTED so.
 *                 Empty or absent = no value (null). Garbage is rejected and
 *                 the last valid value put back.
 *   min / max   — inclusive bounds. A typed number outside them is invalid
 *                 and never commits ("At most 100"); stepping clamps into
 *                 them.
 *   step        — what ↑ / ↓ add (default 1); Shift steps 10×.
 *   decimals    — fraction digits: the committed value is rounded to them
 *                 and the text always shows exactly that many. Absent = as
 *                 many as the number has.
 *   label       — text above the row (kit form-label); also the accessible name.
 *   placeholder — the input's placeholder.
 *   disabled    — greys the row out and blocks the input.
 *   size        — "compact" (default, the sac-date-field compact row),
 *                 "regular" (a plain kit <input>'s metrics) or "cell" (the
 *                 cell-editor contract — style guide → Cell editors).
 *
 * Properties:
 *   value — get/set, a number or null. Setting is programmatic: no event.
 *   focus({ select }) — focuses the input; select: true selects its text.
 *
 * Events:
 *   sac:change — detail { value } (number | null), on a USER commit that
 *                moved the value: Enter, or focus leaving. Bubbles, not composed.
 *   sac:commit / sac:cancel — size="cell" only, see Cell editors.
 *
 * Keyboard: ↑ / ↓ step (Shift ×10, clamped), Enter commits, Escape reverts
 * to the last valid value. Typing is tolerant: both "," and "." are
 * understood (sac.regional.parseNumber).
 *
 * Invalid text (style guide → CSS Patterns → Field errors): while typing it
 * shows --danger and the input gets aria-invalid="true". Enter or focus
 * leaving with invalid text shows a line under the field that says what is
 * expected — "Not a number – e.g. 1,234.5", "At least 0", "At most 100"
 * (bounds in the sac.regional number format) — wired to the input with
 * aria-describedby and announced politely. The text and the line STAY
 * (before 2.36 the text silently reverted on blur): `value` keeps the last
 * valid number and no sac:change fires for invalid text. Correcting the
 * text clears the error, Escape goes back to the last valid value, and a
 * programmatic value set while the field is not focused replaces the text.
 * size="cell" sets aria-invalid only — no line, and blur / Tab still revert
 * (the host grid owns commit and cancel there).
 *
 * The input also carries the expected format as its accessible description
 * ("Number format: 1,234.5"), so a screen reader hears it before typing.
 *
 * Compact/touch: inputmode="decimal" brings up the number pad. Under
 * (pointer: coarse) the input is 44px tall with 16px type.
 *
 * CSS parts: label, input, error (the message line).
 */
(function () {

    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

    const reg = () => (window.sac && sac.regional && sac.regional.parseNumber) ? sac.regional : null;

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

    /** Fraction digits a number needs ("0.25" → 2). */
    const fracDigits = (n) => {
        const s = String(n);
        const e = /e-(\d+)$/.exec(s);
        if (e) return +e[1];
        const i = s.indexOf(".");
        return i < 0 ? 0 : s.length - i - 1;
    };
    const roundTo = (n, d) => Number(n.toFixed(Math.min(20, d)));

class SacNumberField extends HTMLElement {
    static get observedAttributes() {
        return ["value", "min", "max", "step", "decimals", "label", "placeholder", "disabled", "size"];
    }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._value = null;
        this._dirty = false;
        this._reflecting = false;
        this._snapshot = null;      // value when focus entered (cell cancel)
        this._inside = false;
        this._errorShown = false;   // the message line is up (form mode)
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) {
            this._render();
            if (Object.prototype.hasOwnProperty.call(this, "value")) {
                const v = this.value; delete this.value; this.value = v;
            }
            this._adopt();
        }
        if (window.sac && sac.lang && !this._offLang) {
            this._offLang = sac.lang.onChange(() => {
                this._syncLabel();
                this._syncHint();
                if (this._dirty) this._markValidity();      // the message in the new language
            });
        }
        if (window.sac && sac.regional && !this._offRegional) {
            this._offRegional = sac.regional.onChange(() => { this._syncUI(); this._syncHint(); });
        }
    }

    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
        if (this._offRegional) { this._offRegional(); this._offRegional = null; }
    }

    attributeChangedCallback(name) {
        if (!this.shadowRoot.firstChild) return;
        switch (name) {
            case "value":       this._onValueAttr(); break;
            case "decimals":    this._syncUI(); this._syncHint(); break;
            case "min":
            case "max":
                this._syncAria();
                if (this._dirty) this._markValidity();
                break;
            case "label":       this._syncLabel(); break;
            case "placeholder": this._input.placeholder = this.getAttribute("placeholder") || ""; break;
            case "disabled":    this._input.disabled = this.disabled; break;
        }
    }

    /* ---------------------------------------------------------------- API */

    get value() { return this._value; }
    /** "" while the typed text can commit, else the words the line under the
     *  field shows ("At most 100"). The field keeps invalid text and `value`
     *  keeps the last valid number — a form holds its Save on this. */
    get validationMessage() { return this._input ? (this._judge().error || "") : ""; }
    set value(v) {
        if (v == null || v === "") { this.setAttribute("value", ""); return; }
        const n = typeof v === "number" ? v : Number(String(v).trim());
        if (!Number.isFinite(n)) return;                 // garbage in → nothing changes
        this.setAttribute("value", String(n));
    }

    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { this.toggleAttribute("disabled", !!v); }

    focus(opts) {
        if (!this._input) return super.focus(opts);
        this._input.focus(opts);
        if (opts && opts.select) this._input.select();
    }

    /* ------------------------------------------------------------- state */

    _cell() { return this.getAttribute("size") === "cell"; }

    _num(name) {
        const raw = this.getAttribute(name);
        if (raw == null || raw.trim() === "") return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    }

    _decimals() {
        const d = this._num("decimals");
        return d == null ? null : Math.max(0, Math.min(20, Math.round(d)));
    }

    /** Round to `decimals` when set. */
    _round(n) {
        const d = this._decimals();
        return d == null ? n : roundTo(n, d);
    }

    _inRange(n) {
        const min = this._num("min"), max = this._num("max");
        return !(min != null && n < min) && !(max != null && n > max);
    }

    _parse(text) {
        const r = reg();
        if (r) return r.parseNumber(text);
        const s = String(text).trim();
        return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
    }

    _format(n) {
        if (n == null) return "";
        const d = this._decimals();
        const opts = d == null ? {} : { decimals: d };
        const r = reg();
        return r ? r.formatNumber(n, opts) : (d == null ? String(n) : n.toFixed(d));
    }

    _adopt() {
        const raw = this.getAttribute("value");
        const n = raw == null || raw.trim() === "" ? null : Number(raw);
        this._value = n != null && Number.isFinite(n) ? this._round(n) : null;
        this._syncLabel();
        this._input.placeholder = this.getAttribute("placeholder") || "";
        this._input.disabled = this.disabled;
        this._reflect();
        this._syncUI();
        this._syncHint();
    }

    _reflect() {
        const s = this._value == null ? "" : String(this._value);
        if (s === "" && !this.hasAttribute("value")) return;
        if (this.getAttribute("value") === s) return;
        this._reflecting = true;
        this.setAttribute("value", s);
        this._reflecting = false;
    }

    _onValueAttr() {
        if (this._reflecting) return;
        const raw = this.getAttribute("value");
        const n = raw == null || raw.trim() === "" ? null : Number(raw);
        if (n != null && !Number.isFinite(n)) { this._reflect(); return; }
        // Invalid text left standing after blur is replaced by an app's
        // value (a form reset, the next record); typing in progress is not.
        if (this._dirty && this.shadowRoot.activeElement !== this._input) this._dirty = false;
        this._apply(n == null ? null : this._round(n), false);
    }

    _apply(n, fire) {
        const before = this._value;
        this._value = n;
        this._reflect();
        this._syncUI();
        if (fire && n !== before) {
            this.dispatchEvent(new CustomEvent("sac:change", {
                detail: { value: n }, bubbles: true, composed: false,
            }));
        }
    }

    _syncUI() {
        if (!this._input) return;
        if (!this._dirty) {
            const shown = this._format(this._value);
            if (this._input.value !== shown) this._input.value = shown;
            this._setInvalid(false);
            this._showError(null);
        } else {
            this._markValidity();          // the format or a bound moved under the typed text
        }
        this._syncAria();
    }

    /** The expected format as the input's accessible description. */
    _syncHint() {
        if (!this._hintEl) return;
        this._hintEl.textContent = t("number-field.format-hint", "Number format: {example}")
            .replace("{example}", () => this._format(1234.5));
    }

    _syncAria() {
        const i = this._input;
        const set = (a, v) => (v == null ? i.removeAttribute(a) : i.setAttribute(a, String(v)));
        set("aria-valuenow", this._value);
        set("aria-valuemin", this._num("min"));
        set("aria-valuemax", this._num("max"));
        set("aria-valuetext", this._value == null ? null : this._format(this._value));
    }

    _syncLabel() {
        const text = this.getAttribute("label") || "";
        this._labelEl.textContent = text;
        this._labelEl.hidden = !text;
        this._input.setAttribute("aria-label", text || t("number-field.number", "Number"));
    }

    /* ------------------------------------------------------------- render */

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                *, *::before, *::after { box-sizing: border-box; }
                :host {
                    display: inline-block;
                    max-width: 100%;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    color: var(--text);
                }
                :host([disabled]) { opacity: 0.5; }
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

                /* The sac-date-field compact input: same padding, type,
                   border and radius, so the two sit in one row. */
                .num {
                    display: block;
                    width: 12ch;
                    max-width: 100%;
                    margin: 0;
                    padding: 0.35rem 0.5rem;
                    font-family: var(--font-mono);
                    font-size: 0.78rem;
                    font-variant-numeric: tabular-nums;
                    color: var(--text);
                    background: var(--field);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-m);
                    transition: border-color 150ms var(--ease-smooth), color 150ms var(--ease-smooth);
                }
                .num::placeholder { color: var(--text-dim); }
                .num:hover:not(:disabled) { border-color: var(--border-strong); }
                .num:focus {
                    outline: none;
                    border-color: var(--accent);
                    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 10%, transparent);
                }
                .num:disabled { cursor: not-allowed; }
                .num.invalid { color: var(--danger-text); border-bottom-color: var(--danger); }
                .num.invalid:focus { border-color: var(--accent); border-bottom-color: var(--danger); }

                /* The field-error line (ui.css .field-error, re-stated):
                   always in the tree so the polite live region announces,
                   empty — and so nothing — while the text is valid. It
                   wraps inside the field's width instead of widening the
                   field (contain: inline-size), so a row never shifts
                   sideways when a message appears. */
                .error {
                    contain: inline-size;
                    font-size: 0.75rem;
                    line-height: 1.35;
                    color: var(--danger-text);
                }
                .error:not(:empty) { margin-top: 0.3rem; }

                :host([size="regular"]) .num {
                    padding: 0.6rem;
                    font-family: inherit;
                    font-size: 13.3333px;
                    line-height: normal;
                    width: 14ch;
                }
                :host([size="regular"]) .error { font-size: 0.8rem; }

                @media (pointer: coarse) {
                    .num, :host([size="regular"]) .num { min-height: 44px; font-size: max(16px, 1rem); }
                }

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
                :host([size="cell"]) .num,
                :host([size="cell"]) .num:focus,
                :host([size="cell"]) .num:hover {
                    width: 100%;
                    height: 100%;
                    min-height: 0;
                    padding: 0 var(--cell-padding-inline, 8px);
                    font: inherit;
                    font-variant-numeric: tabular-nums;
                    color: inherit;
                    text-align: right;
                    background: transparent;
                    border: 0;
                    border-radius: 0;
                    box-shadow: none;
                }
                :host([size="cell"]) .num.invalid { color: var(--danger-text); }
                @media (pointer: coarse) {
                    :host([size="cell"]) .num { font-size: max(16px, 1em); }
                }
                @media (prefers-reduced-motion: reduce) { .num { transition: none; } }
            </style>
            <label class="label" part="label" for="num" hidden></label>
            <input class="num" part="input" id="num" type="text" inputmode="decimal" role="spinbutton"
                   spellcheck="false" autocomplete="off" autocapitalize="off" aria-describedby="error hint">
            <div class="error" part="error" id="error" aria-live="polite"></div>
            <span id="hint" hidden></span>
        `;
        this._labelEl = this.shadowRoot.querySelector(".label");
        this._input = this.shadowRoot.getElementById("num");
        this._errorEl = this.shadowRoot.getElementById("error");
        this._hintEl = this.shadowRoot.getElementById("hint");

        this._input.addEventListener("input", (e) => {
            e.stopPropagation();
            this._dirty = true;
            this._markValidity();
        });
        this._input.addEventListener("change", (e) => e.stopPropagation());
        this._input.addEventListener("keydown", (e) => this._onKeydown(e));
        this._input.addEventListener("blur", () => this._commit(true));

        // Cell contract: remember the value focus arrived with.
        this.addEventListener("focusin", (e) => {
            if (this._inside) return;
            this._inside = true;
            this._snapshot = this._value;
        });
        this.addEventListener("focusout", (e) => {
            if (e.relatedTarget !== this) this._inside = false;
        });
    }

    /* ------------------------------------------------------------ editing */

    /** The typed text judged: { n } — a number, or null for empty — when it
     *  can commit, else { error } — the message saying what is expected. */
    _judge() {
        const s = this._input.value.trim();
        if (s === "") return { n: null };
        const raw = this._parse(s);
        if (!Number.isFinite(raw)) {
            return { error: t("number-field.error-nan", "Not a number – e.g. {example}")
                .replace("{example}", () => this._format(1234.5)) };
        }
        const n = this._round(raw);
        const min = this._num("min"), max = this._num("max");
        // Bounds as they are, in the page's number format ("At least 0",
        // not the decimals-padded "0.00").
        const bound = (b) => { const r = reg(); return r ? r.formatNumber(b) : String(b); };
        if (min != null && n < min) {
            return { error: t("number-field.error-min", "At least {min}").replace("{min}", () => bound(min)) };
        }
        if (max != null && n > max) {
            return { error: t("number-field.error-max", "At most {max}").replace("{max}", () => bound(max)) };
        }
        return { n };
    }

    /** Text → number, null for empty, NaN for invalid / out of range. */
    _typed() {
        const j = this._judge();
        return j.error ? NaN : j.n;
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

    _onKeydown(e) {
        if (this.disabled) return;
        const cell = this._cell();
        switch (e.key) {
            case "ArrowUp":
            case "ArrowDown":
                e.preventDefault();
                this._step((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1));
                break;
            case "Enter": {
                e.preventDefault();
                const ok = this._commit(false);
                if (cell) {
                    e.stopPropagation();
                    if (ok) this._emit("sac:commit", this._value, e.shiftKey);
                }
                break;
            }
            case "Escape":
                if (cell) {
                    e.preventDefault();
                    e.stopPropagation();
                    this._cancel();
                } else if (this._dirty) {
                    e.stopPropagation();
                    this._revert();
                }
                break;
            case "Tab":
                if (cell) this._commit(true);        // never swallowed: no preventDefault
                break;
        }
    }

    /** Step from the typed text (or the value); empty starts at 0 / min. */
    _step(dir) {
        const typed = this._dirty ? this._typed() : this._value;
        let base = typed;
        if (typed == null) base = null;
        else if (Number.isNaN(typed)) {
            const loose = this._parse(this._input.value);   // out of range still steps
            if (!Number.isFinite(loose)) return;
            base = loose;
        }
        const step = Math.abs(this._num("step") || 1);
        const min = this._num("min"), max = this._num("max");
        let n;
        if (base == null) n = min != null && min > 0 ? min : (max != null && max < 0 ? max : 0);
        else n = base + dir * step;
        const d = Math.max(fracDigits(step), base == null ? 0 : fracDigits(base), this._decimals() || 0);
        n = roundTo(n, d);
        if (min != null) n = Math.max(min, n);
        if (max != null) n = Math.min(max, n);
        n = this._round(n);
        this._dirty = true;
        this._input.value = this._format(n);
        this._setInvalid(false);
        this._showError(null);
        this._input.setAttribute("aria-valuenow", String(n));
    }

    /**
     * @param {boolean} revertOnInvalid — size="cell" only: true on blur /
     *   Tab (the cell contract reverts), false on Enter (the editor stays
     *   open, marked). In form mode invalid text never reverts: it stays,
     *   with the message line saying what is expected.
     * @returns true when the text is a valid value (committed or unchanged).
     */
    _commit(revertOnInvalid) {
        if (!this._dirty) return true;
        const j = this._judge();
        if (j.error) {
            if (this._cell()) {
                if (revertOnInvalid) this._revert();
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
        this._apply(j.n, true);
        return true;
    }

    _revert() {
        this._dirty = false;
        this._syncUI();                  // the last valid value; clears the error
    }

    _cancel() {
        this._dirty = false;
        this._apply(this._snapshot, false);
        this._setInvalid(false);
        this._showError(null);
        this._emit("sac:cancel", this._value);
    }

    _emit(type, value, shiftKey) {
        const detail = type === "sac:commit" ? { value, shiftKey: !!shiftKey } : { value };
        this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    }
}

customElements.define("sac-number-field", SacNumberField);
})();
