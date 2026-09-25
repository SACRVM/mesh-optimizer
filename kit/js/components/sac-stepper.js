/**
 * <sac-stepper value="3" min="1" max="99" step="1" unit="parts" label="Parts">
 *
 * Discrete −/value/+ control for small numeric quantities — paint-part
 * counts, brush sizes, anything better dialed than typed into a bare
 * <input type="number"> (whose native spinners this deliberately avoids —
 * the value field is type="text" underneath).
 *
 * One compact pill: a minus button, an editable value (+ optional unit
 * word), a plus button. The `value` attribute is the single source of
 * truth and is ALWAYS clamped into [min, max] and snapped to the nearest
 * valid step measured from `min` — every path that changes it (button,
 * held repeat, keyboard step, typed commit, or a programmatic
 * .value/attribute set) runs through the same clamp, so the reflected
 * attribute never carries an out-of-range or off-grid number.
 *
 * IMPORTANT implementation constraint: attribute changes update the shadow
 * DOM IN PLACE — never re-render it (same rule as sac-slider; re-rendering
 * would drop focus/selection out of the value field mid-edit).
 *
 * Attributes (all observed):
 *   value    — current number, reflected, clamped/snapped on every change.
 *   min      — default 0.
 *   max      — default 100.
 *   step     — default 1. Fractional steps (e.g. "0.1") are supported; the
 *              displayed/reflected value keeps that many decimal places.
 *   unit     — optional word shown dim next to the value ("parts", "px").
 *   label    — accessible name for the value field (its aria-label).
 *   disabled — presence disables both buttons and the value field.
 *
 * Properties:
 *   value    — get/set (number). Setting it updates everything in place
 *              and fires nothing — same contract as setting the attribute
 *              by hand.
 *   disabled — get/set (boolean), reflects the attribute.
 *
 * Events:
 *   sac:change — detail { value } (number), bubbles + composed. Fired on
 *                every USER-driven change: a click, a held-repeat tick
 *                (once per tick, live — consumers want to react as it
 *                moves), a keyboard step, or a typed commit that actually
 *                changed the value. Never fired by a programmatic set.
 *
 * Interaction:
 *   - Click ± steps by `step`. Press and hold: after 400ms, repeats every
 *     60ms until release (pointerup/leave/cancel) or the value reaches its
 *     bound (the button disables itself and the repeat stops on its own).
 *   - The value field accepts digits, a leading "-" and one "." while
 *     typing; Enter or blur commits (parses, clamps, snaps to the step
 *     grid); Escape reverts the displayed text to the last committed value
 *     without committing.
 *   - ArrowUp/ArrowDown on the value field step by `step`; Shift steps by
 *     10× that.
 *
 * Compact/touch: the ± buttons are pointer-event driven (press-and-hold works
 * with a finger; a long press never opens the context menu). Under
 * (pointer: coarse) the pill is 44px tall with 38px buttons whose hit halo
 * reaches 44 x 44, the value field is a 44px target with 16px type (no iOS
 * focus zoom), and
 * touch-action: manipulation lets quick taps step without a double-tap zoom.
 * A vertical swipe starting on a button still scrolls the page (it cancels
 * the press). Nothing is hover-only.
 *
 * Accessibility: the value field is role="spinbutton" with
 * aria-valuemin/max/now (+ aria-valuetext "3 parts" once a unit is set)
 * and aria-label from `label`. The ± buttons carry their own
 * aria-label ("Decrease"/"Increase") over an aria-hidden glyph.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacStepper extends HTMLElement {
    static get observedAttributes() {
        return ["value", "min", "max", "step", "unit", "label", "disabled"];
    }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._holdTimeout = null;
        this._holdInterval = null;
        this._pointerActive = false;   // true between a button's pointerdown and its own trailing click
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) {
            this._render();
            this._attach();
        }
        this._syncAll();
        // Runtime language switch: relabel the ± buttons in place.
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    disconnectedCallback() {
        this._clearHold();
        if (this._offLang) { this._offLang(); this._offLang = null; }
    }

    /** Kit strings in the current language, on the existing buttons. */
    _relabel() {
        if (!this._minusBtn || !this._plusBtn) return;
        this._minusBtn.setAttribute("aria-label", t("stepper.decrease", "Decrease"));
        this._plusBtn.setAttribute("aria-label", t("stepper.increase", "Increase"));
    }

    attributeChangedCallback(name) {
        if (!this.shadowRoot.firstChild) return;   // pre-upgrade attribute; connectedCallback's _syncAll() covers it
        switch (name) {
            case "value":
            case "min":
            case "max":
            case "step":
                this._applyValue();
                break;
            case "unit":
                this._syncUnitText();
                break;
            case "label":
                this._syncLabelAttr();
                break;
            case "disabled":
                this._syncDisabledState();
                break;
        }
    }

    /* ---------------------------------------------------------------- API */

    get value() { return this._numValue(); }
    set value(v) {
        this.setAttribute("value", this._format(this._clamp(Number(v))));
    }

    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) {
        if (v) this.setAttribute("disabled", "");
        else this.removeAttribute("disabled");
    }

    /* ------------------------------------------------------------ numbers */

    _minAttr() {
        const v = parseFloat(this.getAttribute("min"));
        return Number.isFinite(v) ? v : 0;
    }
    _maxAttr() {
        const v = parseFloat(this.getAttribute("max"));
        return Number.isFinite(v) ? v : 100;
    }
    _stepAttr() {
        const v = parseFloat(this.getAttribute("step"));
        return Number.isFinite(v) && v > 0 ? v : 1;
    }
    /** Decimal places carried by `step` (e.g. "0.1" → 1), derived from the
     *  parsed numeric step so oddly-formatted attribute text ("0.10") still
     *  yields a clean count. */
    _stepDecimals() {
        const s = String(this._stepAttr());
        const i = s.indexOf(".");
        return i === -1 ? 0 : s.length - i - 1;
    }

    /** Clamp into [min, max] AND snap to the nearest valid step measured
     *  from min — the one place every value in this component passes
     *  through, so the reflected attribute is always on-grid and in-range. */
    _clamp(n) {
        const min = this._minAttr();
        const max = this._maxAttr();
        const step = this._stepAttr();
        const decimals = this._stepDecimals();
        let v = Number.isFinite(n) ? n : min;
        v = min + Math.round((v - min) / step) * step;
        v = Math.min(max, Math.max(min, v));
        return decimals > 0 ? parseFloat(v.toFixed(decimals)) : Math.round(v);
    }

    /** Current value, always defensively clamped regardless of what the
     *  `value` attribute literally contains right now. */
    _numValue() {
        const raw = this.getAttribute("value");
        return this._clamp(raw == null ? NaN : parseFloat(raw));
    }

    _format(n) {
        const decimals = this._stepDecimals();
        return decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
    }

    /* ---------------------------------------------------------- rendering */

    _render() {
        // Kit strings for the attribute positions of the template below.
        const esc = (s) => String(s).replace(/"/g, "&quot;");
        const L = {
            decrease: esc(t("stepper.decrease", "Decrease")),
            increase: esc(t("stepper.increase", "Increase")),
        };
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: inline-flex;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                }
                :host([disabled]) {
                    opacity: 0.4;
                    pointer-events: none;
                }
                /* 26px buttons + 2px padding + 1px border = 32px — the kit's
                   control-row height (the .toolbar measure; sac-color-field
                   lands on it too). Explicit, not content-derived: at
                   fractional page zoom an auto height rounds to device
                   pixels and drifts off the shared row. */
                .stepper {
                    box-sizing: border-box;
                    height: 32px;
                    display: inline-flex;
                    align-items: center;
                    gap: 2px;
                    padding: 2px;
                    background: var(--field);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-m);
                }
                .btn {
                    flex: none;
                    width: 26px;
                    height: 26px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                    border: none;
                    border-radius: var(--radius-s);
                    background: transparent;
                    color: var(--text-dim);
                    font-size: 15px;
                    line-height: 1;
                    font-family: inherit;
                    cursor: pointer;
                    user-select: none;
                    transition: background 120ms var(--ease-smooth), color 120ms var(--ease-smooth);
                }
                .btn:hover:not(:disabled) {
                    background: var(--hover);
                    color: var(--text);
                }
                .btn:active:not(:disabled) {
                    background: var(--hover-strong);
                }
                .btn:disabled {
                    opacity: 0.35;
                    cursor: default;
                    pointer-events: none;
                }
                .btn:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 1px;
                }
                .glyph { pointer-events: none; }

                .center {
                    display: inline-flex;
                    align-items: baseline;
                    justify-content: center;
                    gap: 4px;
                    padding: 0 2px;
                }
                .value-input {
                    width: 3ch;
                    box-sizing: content-box;
                    border: none;
                    background: transparent;
                    padding: 0;
                    margin: 0;
                    color: var(--text);
                    font: inherit;
                    font-weight: 600;
                    font-size: 0.95em;
                    font-variant-numeric: tabular-nums;
                    text-align: center;
                }
                .value-input:focus {
                    outline: none;
                }
                .value-input::selection {
                    background: var(--accent-tint);
                }
                .value-input:disabled {
                    cursor: default;
                }

                .unit {
                    color: var(--text-muted);
                    font-size: 0.8em;
                    white-space: nowrap;
                }
                .unit:empty {
                    display: none;
                }

                /* Touch: a 44px pill — 38px buttons, each with a halo out to
                   44 x 44 — and 16px type in the field (below 16px iOS zooms
                   the page on focus). touch-action: manipulation drops the
                   double-tap-to-zoom wait, so quick taps step instead of
                   zooming; a vertical swipe that starts on a button still
                   scrolls the page (it cancels the press — no stray repeat). */
                @media (pointer: coarse) {
                    .stepper { height: 44px; }
                    .btn {
                        position: relative;
                        width: 38px;
                        height: 38px;
                        font-size: 18px;
                        touch-action: manipulation;
                        -webkit-touch-callout: none;
                    }
                    .btn::after {
                        content: "";
                        position: absolute;
                        inset: -3px;
                    }
                    /* Padding (the field is transparent) makes the value itself
                       a 44 x 44 tap target between the two buttons. */
                    .value-input {
                        font-size: max(16px, 1rem);
                        padding: 10px 8px;
                    }
                }
                /* A tap leaves :hover stuck — no wash left on the button. */
                @media (hover: none) {
                    .btn:hover:not(:disabled) { background: transparent; color: var(--text-dim); }
                    .btn:active:not(:disabled) { background: var(--hover-strong); }
                }
                @media (prefers-reduced-motion: reduce) {
                    .btn { transition: none; }
                }
            </style>
            <div class="stepper">
                <button type="button" class="btn minus" aria-label="${L.decrease}"><span class="glyph" aria-hidden="true">−</span></button>
                <span class="center">
                    <input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" class="value-input" role="spinbutton" />
                    <span class="unit"></span>
                </span>
                <button type="button" class="btn plus" aria-label="${L.increase}"><span class="glyph" aria-hidden="true">+</span></button>
            </div>
        `;
    }

    _attach() {
        this._input = this.shadowRoot.querySelector(".value-input");
        this._unitEl = this.shadowRoot.querySelector(".unit");
        this._minusBtn = this.shadowRoot.querySelector(".minus");
        this._plusBtn = this.shadowRoot.querySelector(".plus");

        this._bindHoldButton(this._minusBtn, -1);
        this._bindHoldButton(this._plusBtn, 1);

        this._input.addEventListener("input", () => this._filterTyping());
        this._input.addEventListener("keydown", (e) => this._onInputKeydown(e));
        this._input.addEventListener("blur", () => this._commitTyped());
    }

    /* --------------------------------------------------------- sync (all) */

    _syncAll() {
        this._applyValue();
        this._syncUnitText();
        this._syncLabelAttr();
        this._syncDisabledState();
    }

    /** Re-clamp the `value` attribute if it isn't already canonical, then
     *  sync the display/aria/buttons in place. Called for value/min/max/step
     *  changes — bounds changing can push the current value out of range. */
    _applyValue() {
        const clamped = this._numValue();
        const formatted = this._format(clamped);
        if (this.getAttribute("value") !== formatted) {
            this.setAttribute("value", formatted);   // re-enters via attributeChangedCallback, now canonical
            return;
        }
        this._syncDisplay();
        this._syncAria();
        this._syncButtons();
    }

    /** Never clobbers text the user is actively typing. */
    _syncDisplay() {
        if (!this._input) return;
        if (this.shadowRoot.activeElement === this._input) return;
        this._input.value = this._format(this._numValue());
    }

    _syncAria() {
        if (!this._input) return;
        const clamped = this._numValue();
        this._input.setAttribute("aria-valuemin", String(this._minAttr()));
        this._input.setAttribute("aria-valuemax", String(this._maxAttr()));
        this._input.setAttribute("aria-valuenow", String(clamped));
        const unit = this.getAttribute("unit");
        if (unit) this._input.setAttribute("aria-valuetext", `${this._format(clamped)} ${unit}`);
        else this._input.removeAttribute("aria-valuetext");
    }

    _syncButtons() {
        if (!this._minusBtn || !this._plusBtn) return;
        const off = this.disabled;
        const clamped = this._numValue();
        this._minusBtn.disabled = off || clamped <= this._minAttr();
        this._plusBtn.disabled = off || clamped >= this._maxAttr();
    }

    _syncUnitText() {
        if (this._unitEl) this._unitEl.textContent = this.getAttribute("unit") || "";
        this._syncAria();   // unit changes aria-valuetext too
    }

    _syncLabelAttr() {
        if (!this._input) return;
        const label = this.getAttribute("label");
        if (label) this._input.setAttribute("aria-label", label);
        else this._input.removeAttribute("aria-label");
    }

    _syncDisabledState() {
        if (this._input) this._input.disabled = this.disabled;
        this._syncButtons();
    }

    /* -------------------------------------------------------- user commit */

    /** The one path every USER-driven change funnels through: clamps,
     *  reflects the attribute, and fires sac:change iff the value actually
     *  moved. `forceDisplay` bypasses the "don't clobber active typing"
     *  guard for the cases where the input itself is the actor (Enter,
     *  Arrow keys) and must see its own result immediately. */
    _commitUser(rawNumber, { forceDisplay = false } = {}) {
        const previous = this._numValue();
        const clamped = this._clamp(rawNumber);
        this.setAttribute("value", this._format(clamped));
        if (forceDisplay && this._input) this._input.value = this._format(clamped);
        if (clamped !== previous) {
            this.dispatchEvent(new CustomEvent("sac:change", {
                detail: { value: clamped },
                bubbles: true,
                composed: false,   // native change semantics (value control)
            }));
        }
    }

    /* ------------------------------------------------------------ buttons */

    _clearHold() {
        if (this._holdTimeout != null) { clearTimeout(this._holdTimeout); this._holdTimeout = null; }
        if (this._holdInterval != null) { clearInterval(this._holdInterval); this._holdInterval = null; }
    }

    _bindHoldButton(btn, dir) {
        const tick = () => {
            if (this.disabled) { this._clearHold(); return; }
            const before = this._numValue();
            this._commitUser(before + dir * this._stepAttr());
            if (this._numValue() === before) this._clearHold();   // hit the bound — nothing left to repeat
        };

        btn.addEventListener("pointerdown", (e) => {
            if (btn.disabled || this.disabled) return;
            if (e.pointerType === "mouse" && e.button !== 0) return;
            e.preventDefault();
            this._pointerActive = true;
            try { btn.setPointerCapture(e.pointerId); } catch (err) { /* not capturable, ignore */ }
            this._clearHold();
            tick();
            this._holdTimeout = setTimeout(() => {
                this._holdInterval = setInterval(tick, 60);
            }, 400);
        });

        const stop = (e) => {
            this._clearHold();
            if (e && e.pointerId != null && btn.hasPointerCapture && btn.hasPointerCapture(e.pointerId)) {
                try { btn.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
            }
            // Deferred: a real click follows pointerup synchronously and
            // must still see _pointerActive === true to swallow itself; this
            // is only a safety net for pointercancel/leave paths with no
            // trailing click, so the flag doesn't stay stuck true forever.
            setTimeout(() => { this._pointerActive = false; }, 0);
        };
        // A long press on touch is the hold-to-repeat gesture, not a request
        // for the context menu. Only while OUR press is live — a mouse
        // right-click never sets _pointerActive, so desktop keeps its menu.
        btn.addEventListener("contextmenu", (e) => {
            if (this._pointerActive) e.preventDefault();
        });
        btn.addEventListener("pointerup", stop);
        btn.addEventListener("pointerleave", stop);
        btn.addEventListener("pointercancel", stop);

        btn.addEventListener("click", () => {
            if (this._pointerActive) { this._pointerActive = false; return; }   // already handled by pointerdown
            tick();   // keyboard activation (Enter/Space) — no preceding pointerdown
        });
    }

    /* -------------------------------------------------------- value field */

    _filterTyping() {
        const input = this._input;
        const before = input.value;
        const pos = input.selectionStart;

        let cleaned = before.replace(/[^0-9.\-]/g, "");
        cleaned = cleaned[0] === "-" ? "-" + cleaned.slice(1).replace(/-/g, "") : cleaned.replace(/-/g, "");
        const dot = cleaned.indexOf(".");
        if (dot !== -1) cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");

        if (cleaned !== before) {
            input.value = cleaned;
            const newPos = Math.max(0, pos - (before.length - cleaned.length));
            try { input.setSelectionRange(newPos, newPos); } catch (err) { /* input may not support it */ }
        }
    }

    _onInputKeydown(e) {
        if (e.key === "Enter") {
            e.preventDefault();
            this._commitTyped();
        } else if (e.key === "Escape") {
            e.preventDefault();
            this._input.value = this._format(this._numValue());   // revert display only — no commit
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const dir = e.key === "ArrowUp" ? 1 : -1;
            const mult = e.shiftKey ? 10 : 1;
            this._commitUser(this._numValue() + dir * mult * this._stepAttr(), { forceDisplay: true });
        }
    }

    _commitTyped() {
        const parsed = parseFloat(this._input.value);
        if (Number.isFinite(parsed)) {
            this._commitUser(parsed, { forceDisplay: true });
        } else {
            this._input.value = this._format(this._numValue());   // garbage typed — revert, no event
        }
    }
}

customElements.define("sac-stepper", SacStepper);
})();
