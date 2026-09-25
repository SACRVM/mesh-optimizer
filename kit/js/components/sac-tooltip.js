/**
 * <sac-tooltip content="Explains the thing" placement="top">
 *     <button class="btn">Hover me</button>
 * </sac-tooltip>
 *
 * Wraps any trigger (the default slot) and shows a small glass bubble next to
 * it on hover / focus. The host is inline-block, so wrapping an existing
 * control does not change the layout around it.
 *
 * ATTACH MODE — for an element a wrapper cannot survive on (a component that
 * OWNS and REBUILDS its children, e.g. a swatch inside sac-swatch-grid, where
 * any wrapper is discarded on the next render): `sac.tooltip.attach(el, text,
 * opts)` hangs the same bubble off `el` directly, listening to its hover/focus
 * and anchoring to its rect. Returns { update, destroy }; call destroy() when
 * `el` leaves the DOM. See the helper + attachTo() below.
 *
 * The bubble is `position: fixed` and shown in the top layer (`popover`), so
 * it escapes every `overflow: hidden` ancestor AND every transformed one — a
 * transform/filter/backdrop-filter ancestor would otherwise become its
 * containing block and anchor the bubble to that panel instead of the
 * viewport. It is positioned against the host's viewport rect on each show,
 * clamped to the viewport (8px margins) and flipped to the opposite side when
 * the preferred side has no room.
 *
 * Show / hide:
 *   - pointerenter  → show after 400ms (cancelled by pointerleave) — mouse
 *                     and pen only; touch has its own path, below
 *   - focusin       → show immediately (keyboard users get no delay)
 *   - hide on pointerleave, focusout, Escape, window scroll (capture), resize
 *   Scroll/resize HIDE rather than reposition — cheap and never leaves a
 *   bubble stranded next to a moved trigger. (A tooltip forced visible with
 *   [open] can't be dismissed, so that one re-anchors on scroll/resize.)
 *
 * Attributes (all observed, all applied in place):
 *   content   — the tooltip text. Set as textContent, never as HTML.
 *   placement — top | bottom | left | right (default "top").
 *   distance  — px gap between trigger and bubble (default 8).
 *   open      — presence forces the bubble visible (docs, demos, debugging).
 *   disabled  — presence means it never shows.
 *
 * Compact/touch:
 *   There is no hover on a touch screen, so a touch press gets its own path:
 *   LONG-PRESS the trigger (~500ms, finger held still) to show the bubble;
 *   the next tap anywhere hides it. A normal tap is untouched — it never
 *   shows the bubble (not even through the focus a tap gives a button) and
 *   its click goes through. Only the click that ends a long-press that DID
 *   show the bubble is swallowed, and while a press is held the native
 *   context menu and the text-selection callout are suppressed. Moving the
 *   finger (a scroll) cancels the press. The bubble is never wider than
 *   the viewport minus 8px a side (min(280px, 100vw - 16px)).
 *
 *   A tooltip must NEVER be the only way to reach information: a long-press
 *   is undiscoverable, and keyboard and screen-reader users may not get the
 *   bubble either (see Accessibility). Put anything essential in the page —
 *   a label, a caption, help text — and treat the tooltip as a shortcut.
 *
 * Accessibility:
 *   ARIA references cannot cross a shadow boundary — a light-DOM trigger
 *   cannot point `aria-describedby` at a bubble living in this element's
 *   shadow root. So treat this tooltip as a VISUAL affordance only: it never
 *   carries information a screen-reader user needs. Icon-only triggers MUST
 *   keep their own `aria-label` (or visually-hidden text). The bubble is
 *   marked role="tooltip" regardless, for the assistive tech that does walk
 *   shadow roots.
 */
class SacTooltip extends HTMLElement {
    static get observedAttributes() { return ["content", "placement", "distance", "open", "disabled"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._visible = false;
        this._timer = null;
        this._lowerTimer = null;
        // The element the bubble listens to and anchors against. Defaults to
        // the host (wrapper mode); attachTo() points it at an external element.
        this._anchorEl = this;
        this._onPointerEnter = this._onPointerEnter.bind(this);
        this._onPointerLeave = this._onPointerLeave.bind(this);
        this._onFocusIn = this._onFocusIn.bind(this);
        this._onFocusOut = this._onFocusOut.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onDismiss = this._onDismiss.bind(this);
        this._onReanchor = this._onReanchor.bind(this);
        // Touch long-press (see "Compact/touch" in the header).
        this._press = null;          // { id, x, y, timer } while a touch press is held
        this._lastTouch = -Infinity; // time of the last touch pointerdown on the anchor
        this._swallowClick = false;  // the click ending a long-press that showed the bubble
        this._touchShown = false;    // shown by long-press → the next tap anywhere hides it
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPressMove = this._onPressMove.bind(this);
        this._onPressEnd = this._onPressEnd.bind(this);
        this._onAnchorClick = this._onAnchorClick.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
        this._onSelectStart = this._onSelectStart.bind(this);
        this._onDocTap = this._onDocTap.bind(this);
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
        this._bindAnchor();
        this._sync();
    }

    disconnectedCallback() {
        this._unbindAnchor();
        this._cancelPress();
        this._teardownGlobals();
        this._teardownPinned();
        this._clearTimer();
        if (this._lowerTimer != null) {
            clearTimeout(this._lowerTimer);
            this._lowerTimer = null;
        }
        this._visible = false;
    }

    /* Anchor wiring. Wrapper mode listens on the host (events bubble up from
       the slotted trigger); attach mode listens on the external element. */
    _bindAnchor() {
        const a = this._anchorEl;
        a.addEventListener("pointerenter", this._onPointerEnter);
        a.addEventListener("pointerleave", this._onPointerLeave);
        a.addEventListener("focusin", this._onFocusIn);
        a.addEventListener("focusout", this._onFocusOut);
        a.addEventListener("pointerdown", this._onPointerDown);
        a.addEventListener("click", this._onAnchorClick, true);
        a.addEventListener("contextmenu", this._onContextMenu);
        a.addEventListener("selectstart", this._onSelectStart);
    }

    _unbindAnchor() {
        const a = this._anchorEl;
        a.removeEventListener("pointerenter", this._onPointerEnter);
        a.removeEventListener("pointerleave", this._onPointerLeave);
        a.removeEventListener("focusin", this._onFocusIn);
        a.removeEventListener("focusout", this._onFocusOut);
        a.removeEventListener("pointerdown", this._onPointerDown);
        a.removeEventListener("click", this._onAnchorClick, true);
        a.removeEventListener("contextmenu", this._onContextMenu);
        a.removeEventListener("selectstart", this._onSelectStart);
    }

    /** Attach mode: anchor the bubble to an EXTERNAL element instead of
     *  wrapping a trigger. The host then wraps nothing (collapsed to 0×0) and
     *  the bubble follows `el`'s hover/focus and viewport rect — the answer for
     *  a component that owns and rebuilds its children, where a wrapper cannot
     *  survive. Usually reached through sac.tooltip.attach(). */
    attachTo(el) {
        if (!el || el === this._anchorEl) return this;
        if (this.isConnected) this._unbindAnchor();
        this._cancelPress();
        this._anchorEl = el;
        this.toggleAttribute("data-attached", el !== this);
        if (this.isConnected) this._bindAnchor();
        if (this._isShown()) this._position();
        return this;
    }

    attributeChangedCallback(name) {
        if (!this.shadowRoot.firstChild) return;
        if (name === "disabled" && this.hasAttribute("disabled")) { this.hide(); return; }
        this._sync();
    }

    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }

    /** Imperative API — same effect as the pointer/focus triggers. */
    show() {
        if (this.hasAttribute("disabled") || !this._text()) return;
        this._clearTimer();
        this._visible = true;
        this._setupGlobals();
        this._sync();
    }

    hide() {
        this._clearTimer();
        this._visible = false;
        this._touchShown = false;
        this._teardownGlobals();
        this._sync();
    }

    _text() { return this.getAttribute("content") || ""; }

    _isShown() { return this._visible || this.hasAttribute("open"); }

    _clearTimer() {
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    }

    _onPointerEnter(e) {
        // A touch "enters" on pointerdown and "leaves" on lift — that is a
        // tap, not a hover. Touch goes through the long-press path instead.
        if (e.pointerType === "touch") return;
        if (this.hasAttribute("disabled") || !this._text()) return;
        this._clearTimer();
        this._timer = setTimeout(() => { this._timer = null; this.show(); }, 400);
    }

    _onPointerLeave(e) {
        if (e.pointerType === "touch") return;
        this.hide();
    }

    _onFocusIn() {
        // A tap focuses the button it lands on (after the pointer events, via
        // the compat mousedown) — that focus is the tap, not a keyboard user
        // arriving, and must not pop the bubble on every tap.
        if (performance.now() - this._lastTouch < 1000) return;
        this.show();
    }

    _onFocusOut() { this.hide(); }

    _onKeyDown(e) {
        if (e.key === "Escape") this.hide();
    }

    _onDismiss() { this.hide(); }

    /* ------------------------------------------------------ touch long-press */

    _onPointerDown(e) {
        if (e.pointerType !== "touch") return;
        this._lastTouch = performance.now();
        this._swallowClick = false;
        this._cancelPress();
        if (this.hasAttribute("disabled") || !this._text()) return;
        const press = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: null };
        press.timer = setTimeout(() => {
            press.timer = null;
            if (this._press !== press) return;
            this.show();
            this._touchShown = true;
            this._swallowClick = true;           // the lift must not also activate the trigger
            // Registered 500ms after the pointerdown that started this press,
            // so only a NEW tap reaches _onDocTap.
            document.addEventListener("pointerdown", this._onDocTap, true);
        }, 500);
        this._press = press;
        window.addEventListener("pointermove", this._onPressMove, true);
        window.addEventListener("pointerup", this._onPressEnd, true);
        window.addEventListener("pointercancel", this._onPressEnd, true);
    }

    /** A finger that travels is scrolling or dragging, not pressing. */
    _onPressMove(e) {
        const p = this._press;
        if (!p || e.pointerId !== p.id) return;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) this._cancelPress();
    }

    _onPressEnd(e) {
        const p = this._press;
        if (!p || e.pointerId !== p.id) return;
        this._cancelPress();
        // The click (if any) follows the pointerup straight away; one that
        // never comes must not eat a later, unrelated tap.
        if (this._swallowClick) setTimeout(() => { this._swallowClick = false; }, 400);
    }

    _cancelPress() {
        const p = this._press;
        if (!p) return;
        if (p.timer != null) clearTimeout(p.timer);
        this._press = null;
        window.removeEventListener("pointermove", this._onPressMove, true);
        window.removeEventListener("pointerup", this._onPressEnd, true);
        window.removeEventListener("pointercancel", this._onPressEnd, true);
    }

    /** Capture phase on the anchor: runs before the trigger's own handlers. */
    _onAnchorClick(e) {
        if (!this._swallowClick) return;
        this._swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
    }

    /** A held touch press would open the native context menu / callout. */
    _onContextMenu(e) {
        if (this._press || this._touchShown) e.preventDefault();
    }

    _onSelectStart(e) {
        if (this._press || this._touchShown) e.preventDefault();
    }

    /** The next tap anywhere after a long-press hides the bubble. */
    _onDocTap() {
        document.removeEventListener("pointerdown", this._onDocTap, true);
        this._swallowClick = false;
        if (this._touchShown) this.hide();
    }

    /** [open] can't be dismissed by scrolling — it re-anchors instead. */
    _onReanchor() { if (this._isShown()) this._position(); }

    _setupPinned() {
        if (this._pinned) return;
        this._pinned = true;
        window.addEventListener("scroll", this._onReanchor, true);
        window.addEventListener("resize", this._onReanchor);
    }

    _teardownPinned() {
        if (!this._pinned) return;
        this._pinned = false;
        window.removeEventListener("scroll", this._onReanchor, true);
        window.removeEventListener("resize", this._onReanchor);
    }

    _setupGlobals() {
        if (this._globals) return;
        this._globals = true;
        document.addEventListener("keydown", this._onKeyDown);
        window.addEventListener("scroll", this._onDismiss, true);
        window.addEventListener("resize", this._onDismiss);
    }

    _teardownGlobals() {
        document.removeEventListener("pointerdown", this._onDocTap, true);
        if (!this._globals) return;
        this._globals = false;
        document.removeEventListener("keydown", this._onKeyDown);
        window.removeEventListener("scroll", this._onDismiss, true);
        window.removeEventListener("resize", this._onDismiss);
    }

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: inline-block;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                }
                /* iOS: a held press on the trigger would raise the link /
                   selection callout over the bubble (contextmenu and
                   selectstart are handled in JS; this is the part JS cannot
                   reach). Attach mode leaves the external element alone. */
                @media (hover: none) {
                    :host(:not([data-attached])) { -webkit-touch-callout: none; }
                }

                /* Attach mode: the host wraps nothing — take it out of flow
                   entirely so it never adds a stray line box. The bubble is a
                   popover in the top layer, so it is unaffected by this. */
                :host([data-attached]) {
                    position: absolute;
                    width: 0;
                    height: 0;
                    overflow: hidden;
                }

                .bubble {
                    position: fixed;
                    inset: auto;                   /* the UA pins popovers to all four sides… */
                    margin: 0;                     /* …and centres them with auto margins */
                    /* Laid out while in the top layer, shown or fading (see
                       _position, which measures it still hidden); out of
                       layout once it leaves — see :not(:popover-open) below. */
                    display: block;
                    z-index: 25000;
                    box-sizing: border-box;
                    /* Never wider than the viewport minus the 8px clamp margin
                       a side. */
                    max-width: min(280px, 100vw - 16px);
                    width: max-content;
                    padding: 5px 10px;
                    border: 1px solid var(--border-strong);
                    border-radius: var(--radius-l);
                    background: color-mix(in srgb, var(--glass-hue) 96%, transparent);
                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                    box-shadow: var(--shadow-1);
                    color: var(--text);
                    font-size: 12px;
                    line-height: 1.45;
                    pointer-events: none;
                    opacity: 0;
                    visibility: hidden;
                    transform: translateY(4px);
                    transition: opacity 120ms var(--ease-smooth), transform 120ms var(--ease-smooth);
                }

                /* Hidden state slides slightly TOWARD the trigger, so the
                   reveal reads as "growing out of" the control. */
                .bubble[data-side="bottom"] { transform: translateY(-4px); }
                .bubble[data-side="left"]   { transform: translateX(4px); }
                .bubble[data-side="right"]  { transform: translateX(-4px); }

                .bubble.shown {
                    opacity: 1;
                    visibility: visible;
                    transform: translate(0, 0);
                }

                /* Out of the top layer = out of layout: a hidden bubble parked
                   at its static position must not widen a phone page (under
                   a transformed ancestor it would count as overflow). _raise
                   runs before _position, so it is always laid out when
                   measured. Browsers without popover drop this rule. */
                .bubble:not(:popover-open) { display: none; }

                /* Pinned bubble whose anchor is entirely outside the viewport:
                   the position clamp would otherwise park it over unrelated
                   content. Must come after .shown (same specificity). */
                .bubble.offscreen {
                    opacity: 0;
                    visibility: hidden;
                }

                @media (prefers-reduced-motion: reduce) {
                    .bubble {
                        transition: none;
                        transform: none;
                    }
                    .bubble[data-side="bottom"],
                    .bubble[data-side="left"],
                    .bubble[data-side="right"] { transform: none; }
                    .bubble.shown { transform: none; }
                }
            </style>
            <slot></slot>
            <div class="bubble" role="tooltip" part="bubble" popover="manual"></div>
        `;
        this._bubble = this.shadowRoot.querySelector(".bubble");
    }

    /** Single place where state (visible / open / disabled / content) becomes
     *  DOM. Never re-renders the shadow root — text and classes in place. */
    _sync() {
        if (!this._bubble) return;
        this._bubble.textContent = this._text();
        const shown = this._isShown() && !this.hasAttribute("disabled") && !!this._text();
        if (shown) {
            this._raise();                  // top layer first — _position measures
            this._position();
            this._bubble.classList.add("shown");
        } else {
            this._bubble.classList.remove("shown");
            this._lower();
        }
        // A forced-open bubble follows its trigger; a hover/focus one is
        // dismissed by scrolling (see _setupGlobals).
        if (shown && this.hasAttribute("open")) this._setupPinned();
        else this._teardownPinned();
    }

    /* Top layer. A fixed panel is only viewport-anchored while no ancestor
       establishes a containing block for it — transform, will-change, filter
       and backdrop-filter all do, and a .tile sets three of them. Shown as a
       popover, the bubble is outside that chain (and outside any
       overflow: hidden) entirely. Same treatment as sac-menu. */
    _raise() {
        if (this._lowerTimer != null) {
            clearTimeout(this._lowerTimer);
            this._lowerTimer = null;
        }
        const b = this._bubble;
        if (!b || typeof b.showPopover !== "function" || b.matches(":popover-open")) return;
        try { b.showPopover(); } catch (err) { /* already shown */ }
    }

    /** Leave the top layer after the fade, not during it. */
    _lower() {
        const b = this._bubble;
        if (!b || typeof b.hidePopover !== "function") return;
        if (this._lowerTimer != null) clearTimeout(this._lowerTimer);
        this._lowerTimer = setTimeout(() => {
            this._lowerTimer = null;
            if (!b.isConnected || !b.matches(":popover-open")) return;
            if (b.classList.contains("shown")) return;          // shown again meanwhile
            try { b.hidePopover(); } catch (err) { /* already hidden */ }
        }, 160);
    }

    /** Anchor the fixed bubble to the host's viewport rect: preferred side,
     *  flip if it does not fit, then clamp into the viewport. */
    _position() {
        if (!this._bubble) return;
        const gap = Number(this.getAttribute("distance")) || 8;
        const margin = 8;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const t = this._anchorEl.getBoundingClientRect();

        // An anchor entirely outside the viewport gets no bubble — the clamp
        // at the end would otherwise pin it to a viewport edge, detached.
        const offscreen = t.bottom < 0 || t.top > vh || t.right < 0 || t.left > vw;
        this._bubble.classList.toggle("offscreen", offscreen);
        if (offscreen) return;

        // The bubble is `visibility: hidden`, not `display: none`, so it is
        // already laid out and measurable — no flash, no measuring pass. The
        // hidden-state translate does not affect width/height.
        const b = this._bubble.getBoundingClientRect();
        const w = b.width;
        const h = b.height;

        let side = this.getAttribute("placement") || "top";
        if (!["top", "bottom", "left", "right"].includes(side)) side = "top";

        // Flip to the opposite side when the preferred one has no room.
        const room = {
            top: t.top,
            bottom: vh - t.bottom,
            left: t.left,
            right: vw - t.right,
        };
        const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" };
        const need = (side === "top" || side === "bottom") ? h + gap + margin : w + gap + margin;
        if (room[side] < need && room[opposite[side]] > room[side]) side = opposite[side];

        let top, left;
        if (side === "top") {
            top = t.top - h - gap;
            left = t.left + (t.width - w) / 2;
        } else if (side === "bottom") {
            top = t.bottom + gap;
            left = t.left + (t.width - w) / 2;
        } else if (side === "left") {
            top = t.top + (t.height - h) / 2;
            left = t.left - w - gap;
        } else {
            top = t.top + (t.height - h) / 2;
            left = t.right + gap;
        }

        // Clamp into the viewport (margin on all four edges).
        left = Math.min(Math.max(left, margin), Math.max(margin, vw - w - margin));
        top = Math.min(Math.max(top, margin), Math.max(margin, vh - h - margin));

        this._bubble.dataset.side = side;
        this._bubble.style.top = `${Math.round(top)}px`;
        this._bubble.style.left = `${Math.round(left)}px`;
        // Flush so the hidden-state transform for THIS side is the snapshot the
        // upcoming .shown transition starts from (otherwise the first reveal
        // slides along the previous side's axis).
        void this._bubble.offsetWidth;
    }
}

customElements.define("sac-tooltip", SacTooltip);

/* Attach mode helper. Give the kit bubble to an element that a <sac-tooltip>
   cannot wrap — the one place the wrapper shape breaks down: a component that
   OWNS and REBUILDS its children (a swatch in a grid, a cell in a virtual list)
   would discard any wrapper on the next render. Instead, hang the bubble off
   the element itself. */
(window.sac = window.sac || {}).tooltip = {
    /**
     * attach(el, text, opts?) → { el, update(text), destroy() }
     *
     * Creates a detached <sac-tooltip> on document.body that follows `el`'s
     * hover/focus and rect. `opts`: { placement, distance } (same as the
     * attributes). The bubble does NOT clean itself up — call destroy() when
     * the target leaves the DOM (a component does this in disconnectedCallback).
     */
    attach(el, text, opts = {}) {
        if (!el) return null;
        const tip = document.createElement("sac-tooltip");
        if (opts.placement) tip.setAttribute("placement", opts.placement);
        if (opts.distance != null) tip.setAttribute("distance", String(opts.distance));
        tip.setAttribute("content", text == null ? "" : String(text));
        document.body.appendChild(tip);
        tip.attachTo(el);
        return {
            el: tip,
            update(t) { tip.setAttribute("content", t == null ? "" : String(t)); },
            destroy() { try { tip.hide(); } catch (e) { /* not shown */ } tip.remove(); },
        };
    },
};
