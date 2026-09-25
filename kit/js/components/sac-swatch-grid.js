/**
 * <sac-swatch-grid columns="8" selectable>
 *     <sac-swatch value="#f2c500" label="Cadmium Yellow" count="3"></sac-swatch>
 *     <sac-swatch value="transparent" label="No color"></sac-swatch>
 *     …
 * </sac-swatch-grid>
 *
 * Two elements, one file (same pairing as <sac-tab-group>/<sac-tab>): the
 * grid owns layout, selection and keyboard navigation; each <sac-swatch> is
 * a self-contained square color button that also works stand-alone — a
 * "recent colors" strip built from raw markup with no grid wrapper is a
 * valid use.
 *
 * <sac-swatch> — attributes (all synced in place):
 *   value    — any CSS color string (hex/rgb/hsl/named). Swatch colors are
 *              DATA — a user's palette, a picked color — not theme, so raw
 *              values are the point, not a violation. The literal value
 *              "transparent" is special-cased: instead of a flat fill (which
 *              would just look like an empty cell) it renders the token
 *              checkerboard plus a thin, neutral 1px diagonal line — "no
 *              color", not an error, so it is never tinted with --danger.
 *   label    — sets the internal button's aria-label + title. Falls back to
 *              `value` when absent, so a swatch is never nameless.
 *   count    — small corner pill (e.g. "3 layers use this color"). It is the
 *              ATTRIBUTE'S PRESENCE that shows the pill — count="0" still
 *              renders "0"; omit the attribute entirely for no pill. A count,
 *              nothing else: naming a cell with it is misuse — that is what
 *              `caption` is for.
 *   caption  — quiet label under the cell (a ramp step "500", a legend
 *              entry, a scale mark). Muted text that is part of the swatch,
 *              not a badge on top of it. When no `label` is set, the caption
 *              joins the accessible name ("500 · #64748b").
 *   tooltip  — presence opts the cell into the KIT tooltip bubble (styled,
 *              keyboard-visible, no 1s OS delay) instead of the native `title`.
 *              Text is the attribute value, falling back to the label /
 *              accessible name. Uses sac-tooltip's ATTACH mode (sac.tooltip.
 *              attach), so it reaches a swatch a wrapper cannot and survives the
 *              grid's data-driven `.colors` rebuild. Replaces the native title
 *              while active so the two never double up.
 *   selected — boolean, reflected. Draws a 2px accent OUTLINE (2px offset) —
 *              a focus-ring-style outline, not a border, per kit rule. Set
 *              by the grid in selectable mode, or directly by an app using
 *              a swatch outside a grid.
 *   disabled — boolean, reflected. Unclickable, unfocusable, skipped by the
 *              grid's keyboard navigation and excluded from roving tabindex.
 * <sac-swatch> properties: value/label/count/caption/tooltip (string get/set;
 *   "" clears label/count/caption; tooltip also takes true/false), selected/
 *   disabled (boolean get/set).
 * <sac-swatch> method: focus() — forwards to the shadow-internal <button>
 *   (the host itself is not focusable, same convention as <sac-tab>).
 *
 * <sac-swatch-grid> — attributes:
 *   columns    — grid-template-columns count, default 8. Applied as a CSS
 *                custom property (--sac-swatch-columns) so changing it is a
 *                style recalculation only, never a re-render — and the same
 *                number doubles as the stride for 2D arrow-key navigation.
 *   selectable — presence turns on click-to-select (single selection: giving
 *                one swatch `selected` clears it from the rest) and switches
 *                the grid's role to listbox/option (plain "group" otherwise).
 * <sac-swatch-grid> property:
 *   colors — get/set. The setter accepts an array of
 *            { value, label?, count?, caption?, tooltip?, selected?, disabled? } and REBUILDS the light-DOM
 *            <sac-swatch> children from scratch — the ONE sanctioned bulk
 *            rebuild in this file, meant for JS-driven data (a palette
 *            loaded from a file, a computed ramp). The getter reads the
 *            current children back into the same shape.
 * <sac-swatch-grid> event:
 *   sac:change — detail { value, swatch }, bubbles (not composed). Fires only when the user
 *            clicks (or keyboard-activates) a different, non-disabled swatch
 *            than the one already selected — never for programmatic
 *            `selected` changes (direct attribute writes, the `.colors`
 *            setter, or a swatch used stand-alone outside a grid). Bubbles
 *            + composed.
 *
 * Keyboard on the grid (always on, independent of `selectable`):
 *   ArrowRight / ArrowLeft — move the roving tabindex one cell.
 *   ArrowDown / ArrowUp    — move it one row (± the current `columns` count).
 *   Home / End             — jump to the first / last non-disabled swatch.
 *   (All four skip disabled cells and simply stop — no wrap — at the edge.)
 *   Enter / Space          — native <button> activation; when `selectable`
 *                            this is what actually selects. Arrow keys only
 *                            move focus, exactly like a WAI-ARIA listbox.
 * Roving tabindex follows whichever swatch last had focus — click, arrow-nav
 * and Tab-in all update it — so Tab always resumes where the user left off.
 *
 * Compact/touch: no dragging anywhere — tap selects, arrows walk. Columns
 * stay at `columns` (it is also the keyboard stride, and a palette's rows
 * often mean something), cells shrink with the container, and a long caption
 * ellipsizes instead of widening its column. Under (pointer: coarse) each
 * button's hit area is the cell plus half the 8px gap on every side (hit
 * areas tile the grid; 44px once a cell is ~36px wide) — pick fewer columns
 * for touch-first palettes. Under (hover: none) no swatch stays lifted after
 * a tap. The `title`/`tooltip` name is a nicety, never the only label.
 *
 * Accessibility: role="listbox"/"group" lives on the grid's HOST element;
 * role="option" (+ aria-selected) lives on each swatch's shadow-internal
 * <button> — the actually-focusable node — and only while the grid is
 * `selectable`. Same reasoning as <sac-tabs>' note on IDREFs not crossing
 * shadow boundaries: containment relationships (ancestor role → descendant
 * role) survive the flattened accessibility tree fine, so listbox/option
 * works here even though the two roles live in different shadow roots.
 */
(function () {

    const GRID_TAG   = "sac-swatch-grid";
    const SWATCH_TAG = "sac-swatch";

    /* ====================================================================
       <sac-swatch>
       ==================================================================== */
    class SacSwatch extends HTMLElement {
        static get observedAttributes() { return ["value", "label", "count", "caption", "tooltip", "selected", "disabled"]; }

        constructor() {
            super();
            this.attachShadow({ mode: "open" });
            // Grid-managed state — not reflected as attributes (not part of
            // the public API above), set only via the private methods below
            // by the sibling <sac-swatch-grid> defined in this same file.
            this._tabbable   = false;
            this._optionRole = false;
            this._tip        = null;   // attach-mode tooltip handle (opt-in)
        }

        connectedCallback() {
            if (!this.shadowRoot.firstChild) this._render();
            this._refresh();
        }

        disconnectedCallback() {
            // The attach-mode bubble lives on document.body — release it when
            // the swatch leaves the DOM (the grid's `.colors` rebuild removes
            // and recreates swatches, so this runs on every data-driven update).
            if (this._tip) { this._tip.destroy(); this._tip = null; }
        }

        attributeChangedCallback() {
            if (this.shadowRoot.firstChild) this._refresh();
        }

        /* --------------------------------------------------------- API */

        get value() { return this.getAttribute("value") || ""; }
        set value(v) { this.setAttribute("value", v == null ? "" : String(v)); }

        get label() { return this.getAttribute("label") || ""; }
        set label(v) {
            if (v == null || v === "") this.removeAttribute("label");
            else this.setAttribute("label", String(v));
        }

        get count() { return this.getAttribute("count"); }
        set count(v) {
            if (v == null || v === "") this.removeAttribute("count");
            else this.setAttribute("count", String(v));
        }

        get caption() { return this.getAttribute("caption"); }
        set caption(v) {
            if (v == null || v === "") this.removeAttribute("caption");
            else this.setAttribute("caption", String(v));
        }

        get tooltip() { return this.getAttribute("tooltip"); }
        set tooltip(v) {
            // Presence opts in; `true` opts in with the label fallback, a string
            // sets the text, null/false/"" turns it off.
            if (v == null || v === false) this.removeAttribute("tooltip");
            else this.setAttribute("tooltip", v === true ? "" : String(v));
        }

        get selected() { return this.hasAttribute("selected"); }
        set selected(v) {
            if (v) this.setAttribute("selected", "");
            else this.removeAttribute("selected");
        }

        get disabled() { return this.hasAttribute("disabled"); }
        set disabled(v) {
            if (v) this.setAttribute("disabled", "");
            else this.removeAttribute("disabled");
        }

        /** The host is not focusable — forward to the real button. */
        focus(options) {
            if (this._btn) this._btn.focus(options);
            else super.focus(options);
        }

        /* -------------------------------------------- grid-internal API
           Called only by <sac-swatch-grid> (same file). Not part of the
           documented public surface — no corresponding HTML attribute. */

        _setTabbable(flag) {
            this._tabbable = Boolean(flag);
            if (this.shadowRoot.firstChild) this._refresh();
        }

        _setOptionRole(flag) {
            this._optionRole = Boolean(flag);
            if (this.shadowRoot.firstChild) this._refresh();
        }

        /* ------------------------------------------------------ render */

        _render() {
            this.shadowRoot.innerHTML = `
                <style>
                    :host {
                        display: block;
                        position: relative;
                        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    }
                    button {
                        box-sizing: border-box;
                        display: block;
                        width: 100%;
                        aspect-ratio: 1;
                        padding: 0;
                        margin: 0;
                        border: 1px solid var(--border-strong);
                        border-radius: var(--radius-m);
                        background-color: transparent;
                        cursor: pointer;
                        transition: transform 120ms var(--ease-smooth);
                    }
                    button:hover:not(:disabled) {
                        transform: translateY(-1px);
                    }
                    /* Selection = an outline (a focus ring), never a border —
                       the kit's no-thick-colored-border rule targets borders
                       specifically; this is the explicitly allowed exception.
                       Same ring for :focus-visible, so a selected+focused
                       swatch does not double up on rings. */
                    button:focus-visible,
                    :host([selected]) button {
                        outline: 2px solid var(--accent);
                        outline-offset: 2px;
                    }
                    button:disabled {
                        cursor: not-allowed;
                        opacity: 0.45;
                        transform: none;
                    }

                    /* "transparent" is DATA an app can pass (e.g. "no fill"),
                       not the CSS keyword rendered flat — a flat transparent
                       square is indistinguishable from an empty grid cell.
                       Checker squares are token-derived (adapts to
                       light/dark); the diagonal is a plain --border-strong
                       hairline, never --danger — this is "no color", not an
                       error state. */
                    button.transparent {
                        background-color: transparent;
                        background-image:
                            linear-gradient(to top right,
                                transparent calc(50% - 0.5px),
                                var(--border-strong) calc(50% - 0.5px),
                                var(--border-strong) calc(50% + 0.5px),
                                transparent calc(50% + 0.5px)),
                            conic-gradient(var(--checker) 90deg,
                                transparent 90deg 180deg,
                                var(--checker) 180deg 270deg,
                                transparent 270deg);
                        background-size: 100% 100%, 10px 10px;
                        /* Keep the pattern off the border ring: --border-strong
                           is semi-transparent, and checker squares shimmering
                           through the 1px line read as a dashed border. */
                        background-clip: padding-box;
                    }

                    /* Corner pill — the ui.css .badge-count recipe, re-
                       implemented in the shadow root: the 2px ring is the
                       GROUND color (--bg) showing through, not a colored
                       border, so it separates from the swatch underneath
                       without violating the no-thick-border rule. */
                    .count {
                        position: absolute;
                        top: -6px;
                        right: -6px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-width: 16px;
                        height: 16px;
                        padding: 0 4px;
                        border-radius: 999px;
                        background: var(--accent-fill);
                        color: var(--on-accent);
                        font-size: 0.65rem;
                        font-weight: 700;
                        /* Digits have no descenders; trim the line box to cap
                           height so the count sits in the pill's optical
                           middle. */
                        text-box: trim-both cap alphabetic;
                        line-height: 1;
                        box-shadow: 0 0 0 2px var(--bg);
                        pointer-events: none;
                    }
                    .count[hidden] { display: none; }

                    /* Scale caption — part of the swatch, not a badge on it:
                       quiet muted text under the cell (a ramp step "500", a
                       legend entry). Ellipsized, so a long caption never
                       widens its grid column. */
                    .caption {
                        display: block;
                        margin-top: 3px;
                        font-size: 0.65rem;
                        font-weight: 500;
                        color: var(--text-muted);
                        text-align: center;
                        font-variant-numeric: tabular-nums;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .caption[hidden] { display: none; }

                    /* Touch: a halo grows a small cell's hit area toward 44px —
                       but only by up to 4px a side, HALF the grid's 8px gap. A
                       bigger halo would reach into the neighbouring cell, and
                       the later swatch's halo paints (and hits) on top, so a
                       tap on the right half of one colour would pick the next.
                       Capped, the hit areas tile the grid with no dead gaps and
                       no stealing: cell + gap, which is 44px from a ~36px cell
                       up. Dense grids on a phone should use fewer columns.
                       manipulation: rapid taps select instead of zooming. */
                    @media (pointer: coarse) {
                        button {
                            position: relative;
                            touch-action: manipulation;
                        }
                        button::after {
                            content: "";
                            position: absolute;
                            inset: max(-4px, min(0px, calc((100% - 44px) / 2)));
                        }
                    }
                    /* A tap leaves :hover stuck — no lifted swatch. */
                    @media (hover: none) {
                        button:hover:not(:disabled) { transform: none; }
                    }
                    @media (prefers-reduced-motion: reduce) {
                        button { transition: none; }
                        button:hover:not(:disabled) { transform: none; }
                    }
                </style>
                <button type="button"></button>
                <span class="count" aria-hidden="true" hidden></span>
                <span class="caption" aria-hidden="true" hidden></span>
            `;
            this._btn       = this.shadowRoot.querySelector("button");
            this._countEl   = this.shadowRoot.querySelector(".count");
            this._captionEl = this.shadowRoot.querySelector(".caption");
        }

        _refresh() {
            if (!this._btn) return;

            const value = this.value;
            const isTransparent = value.trim().toLowerCase() === "transparent";
            this._btn.classList.toggle("transparent", isTransparent);
            /* data, not theme: `value` is an arbitrary CSS color string
               supplied by the app/user, never a kit token. An invalid string
               is simply rejected by the CSSOM setter (background stays at
               the base rule's transparent). */
            this._btn.style.backgroundColor = isTransparent ? "" : value;

            const caption = this.caption;
            const hasCaption = caption != null && caption !== "";
            this._captionEl.textContent = hasCaption ? caption : "";
            this._captionEl.hidden = !hasCaption;

            // The caption is aria-hidden (like the pill), so it folds into
            // the button's name instead: "500 · #64748b". An explicit label
            // still wins outright.
            const label = this.label;
            const accessibleName =
                label || (hasCaption ? `${caption} · ${value}` : value);
            if (accessibleName) {
                this._btn.setAttribute("aria-label", accessibleName);
                this._btn.title = accessibleName;
            } else {
                this._btn.removeAttribute("aria-label");
                this._btn.removeAttribute("title");
            }

            // Opt-in kit tooltip bubble: the attribute's PRESENCE turns it on,
            // its value is the text (falling back to the accessible name, which
            // is label-first). It uses sac-tooltip's attach mode, so it reaches
            // the swatch a wrapper never could, and it REPLACES the native title
            // while active so the two do not double up. Kept in sync in place.
            const wantsTip = this.hasAttribute("tooltip");
            const tipText  = (this.getAttribute("tooltip") || accessibleName || "").trim();
            if (wantsTip && tipText && window.sac && sac.tooltip && sac.tooltip.attach) {
                this._btn.removeAttribute("title");
                if (this._tip) this._tip.update(tipText);
                else this._tip = sac.tooltip.attach(this._btn, tipText);
            } else if (this._tip) {
                this._tip.destroy();
                this._tip = null;
            }

            const count = this.count;
            const hasCount = count != null && count !== "";
            this._countEl.textContent = hasCount ? count : "";
            this._countEl.hidden = !hasCount;

            const disabled = this.disabled;
            this._btn.disabled = disabled;
            // Roving tabindex: only the grid-designated swatch is tabbable,
            // and never a disabled one regardless of what the grid asked for.
            this._btn.tabIndex = (this._tabbable && !disabled) ? 0 : -1;

            const selected = this.selected;
            if (this._optionRole) {
                this._btn.setAttribute("role", "option");
                this._btn.setAttribute("aria-selected", selected ? "true" : "false");
            } else {
                this._btn.removeAttribute("role");
                this._btn.removeAttribute("aria-selected");
            }
        }
    }

    /* ====================================================================
       <sac-swatch-grid>
       ==================================================================== */
    class SacSwatchGrid extends HTMLElement {
        static get observedAttributes() { return ["columns", "selectable"]; }

        constructor() {
            super();
            this.attachShadow({ mode: "open" });
            this._onClick     = this._onClick.bind(this);
            this._onKeyDown   = this._onKeyDown.bind(this);
            this._onFocusIn   = this._onFocusIn.bind(this);
            this._onSlotChange = this._onSlotChange.bind(this);
        }

        connectedCallback() {
            if (!this.shadowRoot.firstChild) this._render();
            this.addEventListener("click", this._onClick);
            this.addEventListener("keydown", this._onKeyDown);
            this.addEventListener("focusin", this._onFocusIn);
            this._applyColumns();
            this._syncMode();
            this._syncRoving();
        }

        disconnectedCallback() {
            this.removeEventListener("click", this._onClick);
            this.removeEventListener("keydown", this._onKeyDown);
            this.removeEventListener("focusin", this._onFocusIn);
        }

        attributeChangedCallback(name) {
            if (!this.shadowRoot.firstChild) return;   // pre-upgrade attribute
            if (name === "columns") this._applyColumns();
            else if (name === "selectable") this._syncMode();
        }

        /* --------------------------------------------------------- API */

        /**
         * [{ value, label?, count?, caption?, tooltip?, selected?, disabled? }] — get reads the current
         * <sac-swatch> children back into this shape; set REBUILDS them.
         * The one sanctioned bulk rebuild — for JS-driven data only, never
         * used internally for selection or attribute sync.
         */
        get colors() {
            return this._swatches().map((s) => {
                const item = { value: s.getAttribute("value") || "" };
                if (s.hasAttribute("label")) item.label = s.getAttribute("label");
                if (s.hasAttribute("count")) item.count = s.getAttribute("count");
                if (s.hasAttribute("caption")) item.caption = s.getAttribute("caption");
                if (s.hasAttribute("tooltip")) item.tooltip = s.getAttribute("tooltip") || true;
                if (s.hasAttribute("selected")) item.selected = true;
                if (s.hasAttribute("disabled")) item.disabled = true;
                return item;
            });
        }

        set colors(list) {
            const frag = document.createDocumentFragment();
            for (const item of Array.isArray(list) ? list : []) {
                const el = document.createElement(SWATCH_TAG);
                el.setAttribute("value", item && item.value != null ? String(item.value) : "");
                if (item && item.label != null && item.label !== "") el.setAttribute("label", String(item.label));
                if (item && item.count != null && item.count !== "") el.setAttribute("count", String(item.count));
                if (item && item.caption != null && item.caption !== "") el.setAttribute("caption", String(item.caption));
                if (item && item.tooltip != null && item.tooltip !== false) el.setAttribute("tooltip", item.tooltip === true ? "" : String(item.tooltip));
                if (item && item.selected) el.setAttribute("selected", "");
                if (item && item.disabled) el.setAttribute("disabled", "");
                frag.appendChild(el);
            }
            this.replaceChildren(frag);   // → slotchange → _syncMode() + _syncRoving()
        }

        /* ------------------------------------------------------- render */

        _render() {
            this.shadowRoot.innerHTML = `
                <style>
                    :host { display: block; }
                    .grid {
                        display: grid;
                        grid-template-columns: repeat(var(--sac-swatch-columns, 8), 1fr);
                        gap: 8px;
                    }
                    /* A cell may shrink below its caption's text width (the
                       caption ellipsizes) — otherwise one long caption on a
                       narrow screen blows its column up and the grid past the
                       container's edge. */
                    ::slotted(*) { min-width: 0; }
                </style>
                <div class="grid"><slot></slot></div>
            `;
            this.shadowRoot.querySelector("slot").addEventListener("slotchange", this._onSlotChange);
        }

        /* -------------------------------------------------------- sync */

        _columnCount() {
            const n = parseInt(this.getAttribute("columns"), 10);
            return Number.isFinite(n) && n > 0 ? n : 8;
        }

        _applyColumns() {
            this.style.setProperty("--sac-swatch-columns", String(this._columnCount()));
        }

        /** role + per-swatch option role, kept current on mode change and
         *  whenever the slotted set of swatches changes. */
        _syncMode() {
            const selectable = this.hasAttribute("selectable");
            this.setAttribute("role", selectable ? "listbox" : "group");
            for (const s of this._swatches()) {
                if (typeof s._setOptionRole === "function") s._setOptionRole(selectable);
            }
        }

        /** Exactly one non-disabled swatch is tabbable at a time. Prefers
         *  whichever one already held that role; falls back to the selected
         *  swatch, then the first enabled one, then nothing (all disabled). */
        _syncRoving() {
            const swatches = this._swatches();
            if (!swatches.length) return;
            let target = swatches.find((s) => s._tabbable && !s.hasAttribute("disabled"));
            if (!target) target = swatches.find((s) => s.hasAttribute("selected") && !s.hasAttribute("disabled"));
            if (!target) target = swatches.find((s) => !s.hasAttribute("disabled"));
            this._setRoving(target || null);
        }

        _setRoving(swatch) {
            for (const s of this._swatches()) {
                if (typeof s._setTabbable === "function") s._setTabbable(s === swatch);
            }
        }

        _onSlotChange() {
            this._syncMode();
            this._syncRoving();
        }

        /* ------------------------------------------------------- items */

        _swatches() {
            return Array.from(this.querySelectorAll(`:scope > ${SWATCH_TAG}`));
        }

        _swatchFromEvent(e) {
            return e.composedPath().find(
                (n) => n && n.nodeType === 1 && n.localName === SWATCH_TAG && n.parentElement === this
            ) || null;
        }

        /* ---------------------------------------------------- selection */

        _onClick(e) {
            if (!this.hasAttribute("selectable")) return;
            const swatch = this._swatchFromEvent(e);
            if (!swatch || swatch.hasAttribute("disabled")) return;
            this._selectUser(swatch);
        }

        _selectUser(swatch) {
            if (swatch.hasAttribute("selected")) return;   // unchanged — no event, same rule as <sac-tab-group>
            for (const s of this._swatches()) {
                s.toggleAttribute("selected", s === swatch);
            }
            this.dispatchEvent(new CustomEvent("sac:change", {
                detail:   { value: swatch.getAttribute("value") || "", swatch },
                bubbles:  true,
                composed: false,   // native change semantics (value control)
            }));
        }

        /* ---------------------------------------------------- keyboard */

        /** Walk from fromIndex in `step` increments, skipping disabled
         *  swatches, returning the first valid index or -1 at the edge. */
        _stepIndex(swatches, fromIndex, step) {
            let i = fromIndex + step;
            while (i >= 0 && i < swatches.length) {
                if (!swatches[i].hasAttribute("disabled")) return i;
                i += step;
            }
            return -1;
        }

        _onKeyDown(e) {
            const NAV_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
            if (!NAV_KEYS.includes(e.key)) return;

            const swatches = this._swatches();
            if (!swatches.length) return;
            const current = this._swatchFromEvent(e);
            if (!current) return;
            const currentIndex = swatches.indexOf(current);
            if (currentIndex === -1) return;

            const columns = this._columnCount();
            let target = -1;
            switch (e.key) {
                case "ArrowRight": target = this._stepIndex(swatches, currentIndex, 1); break;
                case "ArrowLeft":  target = this._stepIndex(swatches, currentIndex, -1); break;
                case "ArrowDown":  target = this._stepIndex(swatches, currentIndex, columns); break;
                case "ArrowUp":    target = this._stepIndex(swatches, currentIndex, -columns); break;
                case "Home":       target = this._stepIndex(swatches, -1, 1); break;
                case "End":        target = this._stepIndex(swatches, swatches.length, -1); break;
            }
            if (target === -1 || target === currentIndex) return;   // no wrap: stop at the edge
            e.preventDefault();
            swatches[target].focus();   // → focusin → _onFocusIn updates the roving swatch
        }

        _onFocusIn(e) {
            const swatch = this._swatchFromEvent(e);
            if (swatch && !swatch.hasAttribute("disabled")) this._setRoving(swatch);
        }
    }

    customElements.define(GRID_TAG, SacSwatchGrid);
    customElements.define(SWATCH_TAG, SacSwatch);
})();
