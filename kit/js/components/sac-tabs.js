/**
 * <sac-tab-group active="one">
 *     <sac-tab name="one">First</sac-tab>
 *     <sac-tab name="two">Second</sac-tab>
 *     <sac-tab-panel name="one">…any content…</sac-tab-panel>
 *     <sac-tab-panel name="two">…</sac-tab-panel>
 * </sac-tab-group>
 *
 * Three elements, one file — they are useless apart.
 *
 * The group owns the state: a single `active` attribute holding a tab NAME.
 * Everything else is derived from it, in place: the group toggles [active] on
 * the matching <sac-tab> and <sac-tab-panel> children, and those two style
 * themselves off :host([active]). No panel is ever moved, re-rendered or
 * re-parented — switching tabs is two attribute flips, so panel content
 * (a canvas, a scroll position, a half-filled form) survives every switch.
 *
 * Tabs auto-assign themselves to the group's "tab" slot (`slot="tab"` is set
 * in connectedCallback), so authors never write slot attributes by hand;
 * panels stay in the default slot. Order in the light DOM is free: tabs and
 * panels may be interleaved or grouped, the slots sort them out.
 *
 * Keyboard (WAI-ARIA tabs pattern, focus follows activation):
 *   ArrowLeft / ArrowRight — previous / next tab, wrapping at both ends
 *   Home / End             — first / last tab
 *   Tab                    — leaves the strip (roving tabindex: only the
 *                            active tab is in the tab order)
 * Disabled tabs are skipped by the keyboard walk and are not clickable.
 *
 * sac-tab-group
 *   Attributes: active — name of the active tab; observed, applied in place.
 *                        Absent on connect → the first tab is activated.
 *               overflow — what happens when the tabs outgrow the strip:
 *                        "wrap" folds them into extra rows (sidebars — every
 *                        choice stays visible). "scroll" keeps the strip one
 *                        row tall and pans it like an editor's tab bar: the
 *                        mouse wheel pans while the pointer is over the strip,
 *                        ‹ › buttons appear at the ends while there is more
 *                        strip in that direction, never a scrollbar — and the
 *                        active tab is panned into view whenever `active`
 *                        changes (a deep link must not select a tab nobody
 *                        can see). Absent → the strip is a single unwrapped
 *                        row, as before — except on a compact screen
 *                        (ui.css §15), where it pans like "scroll".
 *   Properties: active — get/set, reflects the attribute. Setting it does NOT
 *                        fire sac:tab-show (the caller already knows); user
 *                        interaction does.
 *   Events:     sac:tab-show — detail { name }, bubbles + composed, fired only
 *                        when the active tab actually changes.
 *
 * sac-tab
 *   Attributes: name     — the key matching a panel's name.
 *               active   — set BY THE GROUP, not by hand.
 *               disabled — greyed out, unclickable, skipped by the keyboard.
 *   Methods:    focus()  — forwards to the shadow-internal <button>.
 *
 * sac-tab-panel
 *   Attributes: name   — the key matching a tab's name.
 *               active — set BY THE GROUP, not by hand. Hidden unless present.
 *
 * Compact/touch: a panning strip is an ordinary scroll container, so a finger
 * swipes it natively (overscroll-behavior-x: contain keeps the swipe from
 * becoming browser back/forward); the ‹ › buttons are plain clicks. Under
 * (pointer: coarse) tabs are 44px tall and the ‹ › buttons 44px wide. Under (hover: none) no hover
 * wash stays stuck on a tapped tab. overflow="wrap" is unchanged — every
 * tab stays visible, on as many rows as it takes.
 *
 * Accessibility note: the strip is role="tablist" and each tab's internal
 * button is role="tab" with aria-selected kept in sync; panels are
 * role="tabpanel". aria-controls / aria-labelledby are deliberately NOT wired:
 * IDREF relationships cannot cross a shadow boundary (the button lives in the
 * tab's shadow root, the panel in the light DOM), and inventing ids on the
 * consumer's markup would be worse than the relationship is worth.
 */
(function () {

    const TAB_TAG   = "sac-tab";
    const PANEL_TAG = "sac-tab-panel";

    /* The kit's `compact` breakpoint (ui.css section 15). A strip with no
       `overflow` attribute pans like overflow="scroll" below it — on a phone
       an unwrapped row of tabs would otherwise run off the screen. */
    const COMPACT = matchMedia("(max-width: 768px), (max-height: 480px) and (pointer: coarse)");

    /* ====================================================================
       <sac-tab-group>
       ==================================================================== */
    class SacTabGroup extends HTMLElement {
        static get observedAttributes() { return ["active", "overflow"]; }

        constructor() {
            super();
            this.attachShadow({ mode: "open" });
            this._syncing = false;
            this._onClick = this._onClick.bind(this);
            this._onKeyDown = this._onKeyDown.bind(this);
            this._onWheel = this._onWheel.bind(this);
            this._onPanClick = this._onPanClick.bind(this);
            this._ro = null;
            this._onCompact = () => { this._scrollActiveTab(); this._updatePan(); };
        }

        /** Does the strip pan? overflow="scroll", or no overflow attribute on
         *  a compact screen. "wrap" never pans. */
        _pans() {
            const mode = this.getAttribute("overflow");
            return mode === "scroll" || (mode == null && COMPACT.matches);
        }

        connectedCallback() {
            if (!this.shadowRoot.firstChild) {
                this._render();
                // One-time wiring — the shadow DOM is rendered exactly once.
                // Children are usually not parsed yet when this runs, so the
                // slots do the waking up: every tab/panel that arrives (now
                // or later, statically or via JS) re-runs the sync.
                for (const slot of this.shadowRoot.querySelectorAll("slot")) {
                    slot.addEventListener("slotchange", () => {
                        this._sync();
                        this._updatePan();
                    });
                }
                const strip = this.shadowRoot.querySelector(".strip");
                strip.addEventListener("keydown", this._onKeyDown);
                // passive:false — the handler preventDefaults so a pan over
                // the strip doesn't also scroll the page.
                strip.addEventListener("wheel", this._onWheel, { passive: false });
                strip.addEventListener("scroll", () => this._updatePan());
                for (const btn of this.shadowRoot.querySelectorAll(".pan")) {
                    btn.addEventListener("click", this._onPanClick);
                }
            }
            this.addEventListener("click", this._onClick);
            // Overflow is a function of available width, so it must track
            // resizes (a sidebar drag, a window resize), not just content.
            this._ro = new ResizeObserver(() => this._updatePan());
            this._ro.observe(this.shadowRoot.querySelector(".strip"));
            COMPACT.addEventListener("change", this._onCompact);
            this._sync();
        }

        disconnectedCallback() {
            this.removeEventListener("click", this._onClick);
            COMPACT.removeEventListener("change", this._onCompact);
            if (this._ro) { this._ro.disconnect(); this._ro = null; }
        }

        attributeChangedCallback() {
            if (this.shadowRoot.firstChild) {
                this._sync();
                this._updatePan();
            }
        }

        get active() { return this.getAttribute("active") || ""; }
        set active(v) {
            if (v == null) this.removeAttribute("active");
            else this.setAttribute("active", String(v));
        }

        _tabs()   { return Array.from(this.querySelectorAll(`:scope > ${TAB_TAG}`)); }
        _panels() { return Array.from(this.querySelectorAll(`:scope > ${PANEL_TAG}`)); }

        /**
         * The single source of truth, applied IN PLACE. Never re-renders the
         * shadow root — it only toggles attributes on the light-DOM children.
         */
        _sync() {
            if (this._syncing) return;
            const tabs = this._tabs();
            if (!tabs.length) return;

            let name = this.getAttribute("active");
            if (name == null) {
                // No choice made: the first tab wins. Writing the attribute
                // re-enters this method via attributeChangedCallback, hence
                // the guard — this call carries on and does the toggling.
                const first = tabs.find(t => !t.hasAttribute("disabled")) || tabs[0];
                const firstName = first.getAttribute("name");
                if (firstName == null) return;
                this._syncing = true;
                this.setAttribute("active", firstName);
                this._syncing = false;
                name = firstName;
            }

            for (const tab of tabs) {
                tab.toggleAttribute("active", tab.getAttribute("name") === name);
            }
            for (const panel of this._panels()) {
                panel.toggleAttribute("active", panel.getAttribute("name") === name);
            }
            this._scrollActiveTab();
        }

        /**
         * overflow="scroll" only: pan the strip until the active tab is in
         * view. Runs on every sync (a no-op when the tab is already visible)
         * so a deep link or a programmatic `active` change can never select
         * a tab nobody can see. Only the strip's own scrollLeft is touched —
         * scrollIntoView() would also scroll every ancestor and yank the
         * page around on load.
         */
        _scrollActiveTab() {
            if (!this._pans()) return;
            const tab = this._tabs().find(t => t.hasAttribute("active"));
            if (!tab) return;
            const strip = this.shadowRoot.querySelector(".strip");
            const s = strip.getBoundingClientRect();
            const t = tab.getBoundingClientRect();
            if (t.left < s.left)        strip.scrollLeft += t.left - s.left;
            else if (t.right > s.right) strip.scrollLeft += t.right - s.right;
        }

        /**
         * Editor-style wheel panning: the wheel pans the strip while the
         * pointer is over it. Vertical wheel motion maps to horizontal pan —
         * the strip has no vertical axis of its own.
         */
        _onWheel(e) {
            if (!this._pans()) return;
            const strip = this.shadowRoot.querySelector(".strip");
            if (strip.scrollWidth <= strip.clientWidth) return;
            let delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
            if (!delta) return;
            if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 24;
            e.preventDefault();
            strip.scrollLeft += delta;
        }

        /** ‹ › click: two thirds of the viewport per step — enough to move,
            small enough to keep context. A discrete click gets a per-call SMOOTH
            scroll (scrollBy with an explicit behavior): unlike the CSS
            scroll-behavior the strip deliberately omits, a per-call behavior is
            not the programmatic-scroll case Chromium drops, and it never reaches
            _scrollActiveTab()/_onWheel(), which keep writing scrollLeft and stay
            instant. prefers-reduced-motion falls back to an instant jump. */
        _onPanClick(e) {
            const strip = this.shadowRoot.querySelector(".strip");
            const dir = Number(e.currentTarget.dataset.dir);
            const by = dir * Math.max(strip.clientWidth * 0.66, 60);
            const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
            strip.scrollBy({ left: by, behavior: reduce ? "auto" : "smooth" });
        }

        /** Show the pan buttons only while there is somewhere to pan, and
            disable the end the strip is already at. */
        _updatePan() {
            const strip = this.shadowRoot.querySelector(".strip");
            const bar   = this.shadowRoot.querySelector(".bar");
            if (!strip || !bar) return;
            const over = this._pans()
                      && strip.scrollWidth > strip.clientWidth + 1;
            bar.classList.toggle("overflowing", over);
            if (!over) return;
            const [prev, next] = bar.querySelectorAll(".pan");
            prev.disabled = strip.scrollLeft <= 0;
            next.disabled = strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 1;
        }

        /** Set + sync + announce. `moveFocus` for the keyboard walk. */
        _activate(tab, moveFocus) {
            const name = tab.getAttribute("name");
            if (name == null || tab.hasAttribute("disabled")) return;
            const changed = name !== this.getAttribute("active");
            this.setAttribute("active", name);      // → attributeChangedCallback → _sync()
            this._sync();                            // idempotent; covers the unchanged case
            if (moveFocus) tab.focus();
            if (!changed) return;
            this.dispatchEvent(new CustomEvent("sac:tab-show", {
                detail:   { name },
                bubbles:  true,
                composed: true,
            }));
        }

        _onClick(e) {
            // composedPath() so a click on whatever the author slotted INTO
            // the tab (an icon, a <strong>) still resolves to the tab itself.
            const tab = e.composedPath().find(
                n => n && n.nodeType === 1 && n.localName === TAB_TAG && n.parentElement === this
            );
            if (tab) this._activate(tab, false);
        }

        _onKeyDown(e) {
            const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
            if (!keys.includes(e.key)) return;
            const tabs = this._tabs().filter(t => !t.hasAttribute("disabled"));
            if (!tabs.length) return;

            const current = Math.max(tabs.findIndex(t => t.hasAttribute("active")), 0);
            let next = current;
            if (e.key === "ArrowLeft")       next = (current - 1 + tabs.length) % tabs.length;
            else if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
            else if (e.key === "Home")       next = 0;
            else                             next = tabs.length - 1;

            e.preventDefault();
            this._activate(tabs[next], true);
        }

        _render() {
            this.shadowRoot.innerHTML = `
                <style>
                    :host { display: block; }
                    /* The closing hairline lives on .bar, not .strip, so in
                       scroll mode it also runs under the pan buttons. The
                       tabs' 2px underline hangs 1px below the row and paints
                       over it (see the tab button's margin-bottom: -1px). */
                    .bar {
                        display: flex;
                        align-items: stretch;
                        border-bottom: 1px solid var(--border);
                    }
                    .strip {
                        flex: 1 1 auto;
                        min-width: 0;
                        display: flex;
                        gap: 2px;
                    }

                    /* overflow="wrap": tabs fold into extra rows. The hairline
                       stays under the LAST row only — intended: it closes the
                       strip as a whole, not each row. */
                    :host([overflow="wrap"]) .strip { flex-wrap: wrap; }

                    /* overflow="scroll": one row, panned like an editor's tab
                       bar — mouse wheel over the strip, ‹ › buttons at the
                       ends, and NEVER a scrollbar (kit rule: no horizontal
                       scrollbars, anywhere). No scroll-snap either: snap-align
                       pins tab STARTS to the strip's left edge, which fights
                       _scrollActiveTab()'s right-edge targets. And no
                       scroll-behavior:smooth — Chromium silently drops smooth
                       programmatic scrolls on this strip, so the pan-into-view
                       would randomly not happen; instant is what the browser's
                       own focus-scrolling does anyway. The ‹ › buttons opt into
                       smooth per call instead (scrollBy with an explicit
                       behavior, in _onPanClick) — that composes and is not
                       dropped, so a deliberate click glides while the
                       programmatic pan stays instant.
                       The 1px bottom padding: the tabs' underline hangs 1px
                       below the row, which would otherwise count as vertical
                       overflow inside a scroll container and be clipped. */
                    :host([overflow="scroll"]) .strip {
                        overflow-x: auto;
                        overflow-y: hidden;
                        padding-bottom: 1px;
                        scrollbar-width: none;
                    }
                    :host([overflow="scroll"]) .strip::-webkit-scrollbar { display: none; }
                    :host([overflow="scroll"]) ::slotted(*) {
                        flex: none;               /* keep natural width — pan, don't squeeze */
                    }
                    /* A finger pans the strip natively (it is an ordinary
                       scroll container); contain stops a sideways swipe that
                       hits the end from turning into browser back/forward. */
                    :host([overflow="scroll"]) .strip { overscroll-behavior-x: contain; }

                    /* No overflow attribute on a compact screen: the same
                       panning strip (see COMPACT / _pans()). */
                    @media (max-width: 768px), (max-height: 480px) and (pointer: coarse) {
                        :host(:not([overflow])) .strip {
                            overflow-x: auto;
                            overflow-y: hidden;
                            padding-bottom: 1px;
                            scrollbar-width: none;
                            overscroll-behavior-x: contain;
                        }
                        :host(:not([overflow])) .strip::-webkit-scrollbar { display: none; }
                        :host(:not([overflow])) ::slotted(*) { flex: none; }
                    }

                    /* Pan buttons: only in scroll mode, only while there is
                       somewhere to pan (.overflowing, kept up by _updatePan).
                       aria-hidden + tabindex=-1: the WAI-ARIA keyboard walk
                       already reaches every tab, so for keyboard and AT the
                       buttons are redundant chrome. */
                    .pan { display: none; }
                    .bar.overflowing .pan {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        flex: none;
                        width: 22px;
                        padding: 0;
                        color: var(--text-muted);
                        background: none;
                        border: none;
                        border-radius: var(--radius-m) var(--radius-m) 0 0;
                        cursor: pointer;
                        transition: background 0.15s, color 0.15s;
                    }
                    .pan:hover:not(:disabled) {
                        color: var(--text);
                        background: var(--hover);
                    }
                    .pan:disabled { opacity: 0.3; cursor: default; }
                    .pan sac-icon { --icon-size: 14px; }

                    /* Touch: the strip is 44px tall (the tabs grow) and the pan
                       buttons are 44px wide. Not a halo: past the bar's ends it
                       would widen the page (a horizontal scroll on a phone),
                       inward it would sit over the edge tabs. They only show
                       while the strip overflows, and a swipe pans it anyway. */
                    @media (pointer: coarse) {
                        .bar.overflowing .pan { width: 44px; }
                    }
                    @media (hover: none) {
                        .pan:hover:not(:disabled) { color: var(--text-muted); background: none; }
                    }

                    @media (prefers-reduced-motion: reduce) {
                        .pan { transition: none; }
                    }
                </style>
                <div class="bar">
                    <button class="pan" type="button" data-dir="-1" tabindex="-1" aria-hidden="true"><sac-icon name="chevron-left"></sac-icon></button>
                    <div class="strip" role="tablist"><slot name="tab"></slot></div>
                    <button class="pan" type="button" data-dir="1" tabindex="-1" aria-hidden="true"><sac-icon name="chevron-right"></sac-icon></button>
                </div>
                <div class="body"><slot></slot></div>
            `;
        }
    }

    /* ====================================================================
       <sac-tab>
       ==================================================================== */
    class SacTab extends HTMLElement {
        static get observedAttributes() { return ["active", "disabled"]; }

        constructor() {
            super();
            this.attachShadow({ mode: "open" });
        }

        connectedCallback() {
            if (!this.shadowRoot.firstChild) this._render();
            this._btn = this.shadowRoot.querySelector("button");
            // Auto-assign to the group's strip slot so authors never write
            // slot="tab" by hand. An explicit slot (someone re-slotting the
            // tab elsewhere) is respected.
            if (!this.slot) this.slot = "tab";
            this._sync();
        }

        attributeChangedCallback() {
            if (this._btn) this._sync();
        }

        /** The host is not focusable — forward to the real button. */
        focus(options) {
            if (this._btn) this._btn.focus(options);
            else super.focus(options);
        }

        _sync() {
            const active = this.hasAttribute("active");
            const disabled = this.hasAttribute("disabled");
            this._btn.setAttribute("aria-selected", active ? "true" : "false");
            // Roving tabindex: exactly one tab of a group is in the tab order.
            this._btn.tabIndex = active && !disabled ? 0 : -1;
            if (disabled) this._btn.setAttribute("aria-disabled", "true");
            else this._btn.removeAttribute("aria-disabled");
        }

        _render() {
            this.shadowRoot.innerHTML = `
                <style>
                    :host { display: block; }
                    :host([disabled]) {
                        opacity: 0.4;
                        pointer-events: none;
                    }
                    /* Shadow-internal button: ui.css's global button rule
                       cannot reach in here, so this is the whole style — and
                       no !important is needed (unlike ::slotted() buttons,
                       see sac-segmented-control). */
                    button {
                        display: block;
                        width: 100%;
                        padding: 0.5rem 0.95rem;
                        font-family: inherit;
                        font-size: 0.85rem;
                        font-weight: 500;
                        color: color-mix(in srgb, var(--fg) 72%, var(--bg));
                        background: none;
                        border: none;
                        /* Sits ON the group's 1px strip border: the -1px pulls
                           the 2px underline down over that line. */
                        border-bottom: 2px solid transparent;
                        margin-bottom: -1px;
                        border-radius: var(--radius-m) var(--radius-m) 0 0;
                        cursor: pointer;
                        transition: color 0.15s, border-color 0.15s, background 0.15s;
                    }
                    button:hover {
                        color: var(--text);
                        background: var(--hover);
                    }
                    button:focus-visible {
                        outline: 2px solid var(--accent);
                        outline-offset: -2px;
                    }
                    :host([active]) button {
                        color: var(--accent);
                        border-bottom-color: var(--accent);
                    }
                    :host([disabled]) button { cursor: default; }

                    /* Touch: a 44px tall tab; no hover wash left stuck on the
                       tab a finger just tapped. */
                    @media (pointer: coarse) {
                        button { min-height: 44px; }
                    }
                    @media (hover: none) {
                        button:hover {
                            color: color-mix(in srgb, var(--fg) 72%, var(--bg));
                            background: none;
                        }
                        :host([active]) button:hover { color: var(--accent); }
                    }

                    @media (prefers-reduced-motion: reduce) {
                        button { transition: none; }
                    }
                </style>
                <button type="button" role="tab"><slot></slot></button>
            `;
        }
    }

    /* ====================================================================
       <sac-tab-panel>
       ==================================================================== */
    class SacTabPanel extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: "open" });
        }

        connectedCallback() {
            if (!this.shadowRoot.firstChild) this._render();
            if (!this.hasAttribute("role")) this.setAttribute("role", "tabpanel");
        }

        _render() {
            this.shadowRoot.innerHTML = `
                <style>
                    :host {
                        display: none;
                        padding-top: 1rem;
                    }
                    :host([active]) { display: block; }
                </style>
                <slot></slot>
            `;
        }
    }

    customElements.define("sac-tab-group", SacTabGroup);
    customElements.define(TAB_TAG, SacTab);
    customElements.define(PANEL_TAG, SacTabPanel);
})();
