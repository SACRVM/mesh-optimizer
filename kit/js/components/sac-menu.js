/**
 * <sac-menu>
 *   <button slot="trigger" class="btn" style="width:auto">Actions</button>
 *   <button data-action="rename"><sac-icon name="pencil"></sac-icon> Rename</button>
 *   <button data-action="duplicate"><sac-icon name="copy"></sac-icon> Duplicate</button>
 *   <hr>
 *   <button data-action="delete" data-danger><sac-icon name="trash"></sac-icon> Delete</button>
 * </sac-menu>
 *
 * Dropdown menu — the `.floating-menu` CSS recipe with behavior attached.
 * Trigger and items both live in the light DOM (slotted) so apps can put any
 * markup inside them; the component only positions, styles and wires them.
 *
 * The panel is `position: fixed`, shown in the top layer (`popover`) and
 * anchored to the trigger's viewport rect on open — so neither an
 * `overflow: hidden` ancestor nor a transformed one (`.tile` is both) can clip
 * or re-anchor it. It flips
 * above the trigger when there is no room below, is clamped 8px inside the
 * viewport, and re-anchors on scroll/resize while open.
 *
 * Items are plain <button data-action="…"> elements — an <hr> between them
 * draws a separator, `data-danger` tints the hover state red. Anything else
 * you slot (headers, spans) is left alone.
 *
 * Attributes:
 *   open — presence = panel visible. Reflected by open()/close()/toggle();
 *          settable directly (the panel positions itself either way).
 *
 * Methods:
 *   open() / close() / toggle() — show, hide, flip.
 *   openAt(point) — open at a viewport point instead of under the trigger:
 *          a right-click context menu. `point` is the contextmenu/pointer
 *          event itself or any { clientX, clientY }. The panel's top-left
 *          sits at the point; it flips left / up when there is no room and
 *          stays clamped 8px inside the viewport. No trigger needed — a
 *          <sac-menu> with only items is a context menu. Scrolling closes a
 *          point-anchored menu (the point no longer means anything), and
 *          Escape returns focus to whatever had it before.
 *
 *            canvas.addEventListener("contextmenu", (e) => {
 *                e.preventDefault();
 *                menu.openAt(e);
 *            });
 *
 * Events:
 *   sac:select — detail { action } — the clicked item's data-action.
 *                     Bubbles + composed. The menu closes right after.
 *
 * Slots:
 *   trigger — the element that opens the menu (a .btn, an icon button, …).
 *             Gets aria-haspopup / aria-expanded kept in sync.
 *   (default) — menu items and separators.
 *
 * Keyboard (while open):
 *   ArrowDown / ArrowUp — move focus between items (wraps, skips [disabled])
 *   Enter               — activates the focused item (native button click)
 *   Escape              — closes and returns focus to the trigger
 *   Tab                 — closes and lets focus move on
 *
 * Compact/touch:
 *   The panel is never wider than the viewport minus 8px a side
 *   (min(180px, 100vw - 16px) minimum, 100vw - 16px maximum), so the 8px
 *   clamp holds on a 360px phone. Under (pointer: coarse) every item is at
 *   least 44px tall. Nothing is hover-only: the trigger opens on tap and the
 *   hover highlight is decoration (the menu closes on the tap anyway). A
 *   closed panel takes no layout at all, so a menu at the right edge of a
 *   phone page never adds horizontal scroll.
 */
class SacMenu extends HTMLElement {
    static get observedAttributes() { return ["open"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._lowerTimer = null;
        this._point = null;          // { x, y } while opened by openAt()
        this._onDocPointer = this._onDocPointer.bind(this);
        this._onDocKeydown = this._onDocKeydown.bind(this);
        this._onReposition = this._onReposition.bind(this);
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
        document.addEventListener("pointerdown", this._onDocPointer, true);
        document.addEventListener("keydown", this._onDocKeydown, true);
        window.addEventListener("scroll", this._onReposition, true);
        window.addEventListener("resize", this._onReposition);
        this._syncTrigger();
        if (this.hasAttribute("open")) { this._raise(); this._position(); }
    }

    disconnectedCallback() {
        if (this._lowerTimer != null) {
            clearTimeout(this._lowerTimer);
            this._lowerTimer = null;
        }
        document.removeEventListener("pointerdown", this._onDocPointer, true);
        document.removeEventListener("keydown", this._onDocKeydown, true);
        window.removeEventListener("scroll", this._onReposition, true);
        window.removeEventListener("resize", this._onReposition);
    }

    attributeChangedCallback() {
        if (!this.shadowRoot.firstChild) return;   // pre-upgrade attribute
        this._syncTrigger();
        if (this.hasAttribute("open")) {
            this._raise();                         // top layer first: it must be
            this._position();                      // measurable before anchoring
        } else {
            this._lower();
            this._clearHighlight();
            this._point = null;
        }
    }

    /* ---------------------------------------------------------------- API */

    open() {
        if (this.hasAttribute("open")) return;
        this.setAttribute("open", "");             // → attributeChangedCallback positions
    }

    close() {
        if (!this.hasAttribute("open")) return;
        this.removeAttribute("open");
    }

    toggle() {
        if (this.hasAttribute("open")) this.close();
        else this.open();
    }

    openAt(point) {
        const x = Number(point && point.clientX), y = Number(point && point.clientY);
        if (!Number.isFinite(x) || !Number.isFinite(y)) { this.open(); return; }
        if (!this.hasAttribute("open")) this._restoreFocus = document.activeElement;
        this._point = { x, y };
        if (this.hasAttribute("open")) this._position();   // re-open elsewhere
        else this.setAttribute("open", "");
    }

    /* ------------------------------------------------------------- render */

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: inline-flex;
                }
                .trigger {
                    display: inline-flex;
                }
                /* The .floating-menu recipe, re-implemented in the shadow root
                   (global classes do not pierce shadow boundaries).

                   The popover attribute is load-bearing, not decoration: a
                   fixed panel is only viewport-anchored while no ancestor
                   establishes a containing block for it — and transform,
                   will-change, filter and backdrop-filter all do. .tile sets
                   three of them, so a menu inside a tile is positioned against
                   the tile and then clipped away by its overflow: hidden —
                   invisible, with nothing in the console. The top layer is
                   outside that chain entirely.

                   The panel leaves layout only once it has left the top layer
                   (see .panel:not(:popover-open) below) — after the close
                   fade, not at the start of it — so it keeps its own
                   opacity/visibility transition instead of snapping. */
                .panel {
                    position: fixed;
                    inset: auto;                   /* the UA pins popovers to all four sides… */
                    margin: 0;                     /* …and centres them with auto margins */
                    z-index: 9999;                 /* same layer as sac-chip-input's dropdown */
                    box-sizing: border-box;
                    /* Never wider than the viewport minus the 8px clamp margin
                       a side — a 360px phone still gets the full clamp. */
                    min-width: min(180px, 100vw - 16px);
                    max-width: calc(100vw - 16px);
                    background: var(--glass-strong);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border: 1px solid var(--border-strong);
                    border-radius: var(--radius-l);
                    padding: 6px;
                    box-shadow: var(--shadow-2);
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    user-select: none;
                    /* Custom properties inherit through the flattened tree, so
                       this sizes <sac-icon> inside slotted items. */
                    --icon-size: 16px;

                    opacity: 0;
                    visibility: hidden;            /* keeps items out of the tab order while closed */
                    transform: translateY(-4px);
                    transition: opacity 120ms var(--ease-smooth),
                                transform 120ms var(--ease-smooth),
                                visibility 120ms var(--ease-smooth);
                }
                :host([open]) .panel {
                    opacity: 1;
                    visibility: visible;
                    transform: translateY(0);
                }
                /* Out of the top layer = out of layout. A closed panel that
                   stays laid out sits at its static position (or wherever it
                   was last anchored) and, under a transformed ancestor, can
                   push the page into horizontal scroll on a phone. While it
                   is still :popover-open (the 160ms close fade, see _lower)
                   it stays displayed, so the fade-out runs untouched. Browsers
                   without popover drop this rule (unknown pseudo-class) and
                   keep the old always-laid-out panel. */
                .panel:not(:popover-open) { display: none; }
                /* Coming back from display: none has no "before" style to
                   transition from — @starting-style supplies the closed look
                   so the open fade still plays. */
                @starting-style {
                    :host([open]) .panel {
                        opacity: 0;
                        transform: translateY(-4px);
                    }
                }
                @media (prefers-reduced-motion: reduce) {
                    .panel,
                    :host([open]) .panel {
                        transition: none;
                        transform: none;
                    }
                }

                /* NOTE: document styles beat ::slotted() styles for slotted
                   light-DOM children regardless of specificity (CSS scoping
                   cascade order) — ui.css's global button rule would wipe
                   these. !important is the intended mechanism here. */
                ::slotted(button) {
                    display: flex !important;
                    align-items: center;
                    gap: 0.6rem;
                    width: 100%;
                    padding: 8px 10px !important;
                    border: none !important;
                    background: none !important;
                    border-radius: var(--radius-m);
                    color: color-mix(in srgb, var(--fg) 82%, var(--bg)) !important;
                    font-size: 0.88rem;
                    font-family: inherit;
                    text-align: left;
                    cursor: pointer;
                }
                ::slotted(button:hover),
                ::slotted(button.hl) {
                    background: var(--hover) !important;
                    color: var(--text) !important;
                }
                ::slotted(button[data-danger]:hover),
                ::slotted(button[data-danger].hl) {
                    background: color-mix(in srgb, var(--danger) 14%, transparent) !important;
                    color: var(--danger-text) !important;
                }
                ::slotted(button[disabled]) {
                    opacity: 0.3;
                    cursor: not-allowed;
                }
                ::slotted(hr) {
                    border: none;
                    border-top: 1px solid var(--border);
                    margin: 4px 2px;
                    width: auto;
                }

                /* Touch: a 44px row per item. The look stays a menu row — only
                   the height grows. */
                @media (pointer: coarse) {
                    ::slotted(button) { min-height: 44px; }
                }
            </style>
            <span class="trigger"><slot name="trigger"></slot></span>
            <div class="panel" role="menu" popover="manual"><slot></slot></div>
        `;

        this._triggerBox  = this.shadowRoot.querySelector(".trigger");
        this._panel       = this.shadowRoot.querySelector(".panel");
        this._triggerSlot = this.shadowRoot.querySelector('slot[name="trigger"]');
        this._itemSlot    = this.shadowRoot.querySelector("slot:not([name])");

        // Trigger click — delegated on the slot wrapper, so any markup works.
        this._triggerBox.addEventListener("click", () => this.toggle());
        this._triggerSlot.addEventListener("slotchange", () => this._syncTrigger());
        // A role="menu" needs role="menuitem" children — give the slotted
        // buttons their role as they arrive (and for the initial set).
        this._itemSlot.addEventListener("slotchange", () => this._syncItems());
        this._syncItems();

        // Item click — light DOM, so listen on the host and walk composedPath.
        this.addEventListener("click", (e) => this._onItemClick(e));
    }

    /* ------------------------------------------------------------ top layer */

    /** Show the panel in the top layer, where no transformed or clipping
     *  ancestor can reach it. Browsers without popover support keep the plain
     *  fixed panel — correct everywhere except inside a transformed ancestor. */
    _raise() {
        if (this._lowerTimer != null) {
            clearTimeout(this._lowerTimer);
            this._lowerTimer = null;
        }
        const panel = this._panel;
        if (!panel || typeof panel.showPopover !== "function") return;
        if (panel.matches(":popover-open")) return;
        try { panel.showPopover(); } catch (err) { /* already shown elsewhere */ }
    }

    /** Leave the top layer only after the close transition has run — dropping
     *  out of it is instant, and would cut the fade. */
    _lower() {
        const panel = this._panel;
        if (!panel || typeof panel.hidePopover !== "function") return;
        if (this._lowerTimer != null) clearTimeout(this._lowerTimer);
        this._lowerTimer = setTimeout(() => {
            this._lowerTimer = null;
            if (this.hasAttribute("open")) return;          // reopened meanwhile
            if (!panel.matches(":popover-open")) return;
            try { panel.hidePopover(); } catch (err) { /* already hidden */ }
        }, 160);
    }

    /* ---------------------------------------------------------- positioning */

    _triggerEl() {
        return this._triggerSlot.assignedElements({ flatten: true })[0] || null;
    }

    _syncTrigger() {
        const el = this._triggerEl();
        if (!el) return;
        el.setAttribute("aria-haspopup", "true");
        el.setAttribute("aria-expanded", this.hasAttribute("open") ? "true" : "false");
    }

    _onReposition(e) {
        // A point has no meaning once the page under it moved: close, as a
        // native context menu does. Resizes still just re-clamp.
        if (this._point && e && e.type === "scroll") { this.close(); return; }
        this._position();
    }

    /** Anchor the fixed-position panel to the trigger's viewport rect: left
     *  edges aligned, below when there's room, flipped above otherwise, and
     *  clamped 8px inside the viewport on both axes. */
    _position() {
        if (!this.hasAttribute("open") || !this._panel) return;
        if (this._point) { this._positionAt(this._point); return; }
        const anchor = this._triggerEl() || this._triggerBox;
        const rect   = anchor.getBoundingClientRect();
        const panel  = this._panel.getBoundingClientRect();
        const margin = 8;
        const gap    = 4;

        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        const openUp = spaceBelow < panel.height + gap + margin && spaceAbove > spaceBelow;

        let top = openUp ? rect.top - panel.height - gap : rect.bottom + gap;
        top = Math.max(margin, Math.min(top, window.innerHeight - panel.height - margin));

        let left = rect.left;
        left = Math.max(margin, Math.min(left, window.innerWidth - panel.width - margin));

        this._panel.style.top  = `${top}px`;
        this._panel.style.left = `${left}px`;
    }

    /** Context-menu placement: top-left at the point, flipped left / up
     *  when the panel would leave the viewport, then clamped 8px inside. */
    _positionAt({ x, y }) {
        const panel  = this._panel.getBoundingClientRect();
        const margin = 8;
        let left = x + panel.width + margin > window.innerWidth ? x - panel.width : x;
        let top  = y + panel.height + margin > window.innerHeight ? y - panel.height : y;
        left = Math.max(margin, Math.min(left, window.innerWidth - panel.width - margin));
        top  = Math.max(margin, Math.min(top, window.innerHeight - panel.height - margin));
        this._panel.style.top  = `${top}px`;
        this._panel.style.left = `${left}px`;
    }

    /* -------------------------------------------------------------- items */

    /** Slotted, enabled action buttons — the keyboard navigation set. */
    _items() {
        if (!this._itemSlot) return [];
        return this._itemSlot.assignedElements({ flatten: true })
            .filter(el => el.matches("button:not([disabled])"));
    }

    /** Tag slotted buttons as menuitems so role="menu" is complete for AT. */
    _syncItems() {
        if (!this._itemSlot) return;
        for (const el of this._itemSlot.assignedElements({ flatten: true })) {
            if (el.matches("button")) el.setAttribute("role", "menuitem");
        }
    }

    _clearHighlight() {
        for (const el of this.querySelectorAll("button.hl")) el.classList.remove("hl");
    }

    _highlight(el) {
        this._clearHighlight();
        if (el) el.classList.add("hl");
    }

    _moveFocus(delta) {
        const items = this._items();
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement);
        const next = current === -1
            ? (delta > 0 ? 0 : items.length - 1)
            : (current + delta + items.length) % items.length;
        items[next].focus();
        this._highlight(items[next]);
    }

    _focusTrigger() {
        const el = this._triggerEl() || this._restoreFocus;
        this._restoreFocus = null;
        if (el && el.isConnected && typeof el.focus === "function") el.focus({ preventScroll: true });
    }

    _onItemClick(e) {
        if (!this.hasAttribute("open")) return;
        const path = e.composedPath();
        const stop = path.indexOf(this);                       // ignore anything above the host
        const btn = path.slice(0, stop === -1 ? path.length : stop).find(n =>
            n.nodeType === 1 &&
            n.matches("button[data-action]") &&
            n.getAttribute("slot") !== "trigger"
        );
        if (!btn || btn.disabled) return;
        this.dispatchEvent(new CustomEvent("sac:select", {
            detail: { action: btn.dataset.action },
            bubbles: true,
            composed: true,
        }));
        this.close();
    }

    /* ----------------------------------------------------------- listeners */

    _onDocPointer(e) {
        if (!this.hasAttribute("open")) return;
        if (e.composedPath().includes(this)) return;           // trigger + panel both sit under the host
        this.close();
    }

    _onDocKeydown(e) {
        if (!this.hasAttribute("open")) return;
        switch (e.key) {
            case "Escape":
                e.preventDefault();
                e.stopPropagation();
                this.close();
                this._focusTrigger();
                break;
            case "ArrowDown":
                e.preventDefault();
                this._moveFocus(1);
                break;
            case "ArrowUp":
                e.preventDefault();
                this._moveFocus(-1);
                break;
            case "Tab":
                this.close();                                  // no preventDefault: focus moves on
                break;
        }
    }
}

customElements.define("sac-menu", SacMenu);
