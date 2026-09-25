/**
 * <sac-window title="..." width="500px" height="750px" top="..." left="..." [open]>
 *
 * Glassmorphic, draggable and resizable floating window. Hardened against
 * the classic window bugs: event-listener loss, drag/resize coordinate
 * drift, scroll bleeding into the workspace behind it, and a window dragged
 * (or a viewport shrunk) until the title bar is out of reach.
 *
 * Content = light-DOM children.
 *
 * Attributes: title, width, height, top, left, open,
 *             width / height — any CSS length; height="auto" sizes the
 *                         window to its content (until the user resizes).
 *             right / bottom — anchor to the viewport's right / bottom edge
 *                         instead of left / top (used only when left / top
 *                         is absent): right="16px" bottom="16px" keeps a
 *                         preview window in the corner as the browser
 *                         resizes. The first drag or resize by the user
 *                         turns the anchor into a plain left / top position
 *                         — where they put it is where it stays.
 *             minimized — collapsed to the title bar: body and resize handle
 *                         hidden, configured width kept. Still draggable,
 *                         no longer resizable.
 *             maximized — filled to the viewport with an 8px inset, the top
 *                         one clearing the fixed 50px nav ribbon. Neither
 *                         draggable nor resizable.
 *             The two states are mutually exclusive and both reflect, so
 *             `:host([minimized])` styling and an outside setAttribute()
 *             both work.
 *             controls  — space-separated subset of "min max close" deciding
 *                         which traffic lights render. Absent = all three.
 *                         Without "max", double-clicking the title bar does
 *                         nothing. Pure CSS token matching — changing the
 *                         attribute at runtime just works. The programmatic
 *                         methods stay callable regardless.
 *             no-resize — boolean; hides the resize handle and disables
 *                         resizing. Dragging is unaffected.
 *             no-compact — boolean; opts OUT of the compact rules below: on
 *                         a narrow screen the window stays a floating
 *                         window (draggable, its own size, pushed into
 *                         view) instead of maximizing. For tool palettes and
 *                         previews over a canvas — an app window that IS the
 *                         app keeps the default.
 *             snap      — edge snapping while dragging. Within 12px of a
 *                         viewport edge (the top edge = below the nav
 *                         ribbon) the window snaps to it, keeping a gap of
 *                         the attribute's value (snap="14" → 14px; bare
 *                         `snap` → 8px, the maximized inset). Dropped
 *                         snapped to the right and/or bottom edge, the
 *                         window is ANCHORED there again (right / bottom),
 *                         so it follows browser resizes like a freshly
 *                         placed one; snapped left / top it keeps left / top.
 *                         Dropped free, it is a plain position as before.
 * Methods:    open(), close(), toggle(), bringToFront()
 *             (z-index walk over all sac-windows, base 10000),
 *             minimize(), maximize(), restore()
 *             — restore() returns to the normal rect from either state.
 * Events:     sac:open / sac:close — detail { window }.
 *             sac:minimize / sac:maximize / sac:restore — detail { window }.
 *             All bubble + composed; the restore event covers the return from
 *             either minimized or maximized.
 *
 * Geometry:   leaving the normal state saves the inline rect (top/left/width/
 *             height); coming back re-applies it and clamps it, so a viewport
 *             that shrank in the meantime can't strand the window. The same
 *             clamp runs after every drag and on window resize: at least 40px
 *             of the window stays horizontally in view, and the title bar
 *             stays between the nav ribbon and the bottom edge.
 *
 * Showing a window (open) pushes it WHOLLY into view — below the nav
 * ribbon, inside the viewport; one larger than the viewport shows its
 * top-left, title bar first.
 *
 * Double-clicking the title bar toggles maximize / restore.
 *
 * CSS custom properties: --window-padding — the content's inner padding,
 *             default 20px (a tool palette wants ~8px; 0 for edge-to-edge
 *             content). Shadow part: content — the scrolling content box.
 *
 * Compact (ui.css §15 — ≤768px, or a phone held sideways): drag-and-resize is a desktop metaphor, so a
 * window is ALWAYS maximized there — an open window maximizes itself, the
 * maximize dot is hidden (there is nothing to restore to), dragging is off,
 * and minimize collapses it to its title bar at the top. The component sets
 * the `compact` attribute meanwhile (styling hook). Back on a wide screen, a
 * window the phone maximized returns to its normal rect; one the user had
 * maximized stays maximized. A window with `no-compact` skips all of this.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacWindow extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.isDragging = false;
        this.isResizing = false;
        this.startX = 0;
        this.startY = 0;
        this.startLeft = 0;
        this.startTop = 0;
        this.startWidth = 0;
        this.startHeight = 0;

        // 'normal' | 'minimized' | 'maximized'. The attributes mirror this
        // field, never the other way round: an outside setAttribute() is
        // reverted and replayed through _setState() so both stay in step.
        this._windowState = 'normal';
        this._normalRect = null;      // inline geometry saved on leaving 'normal'
        this._syncingState = false;   // re-entrancy guard for the reflection

        this._mq = window.matchMedia('(max-width: 768px), (max-height: 480px) and (pointer: coarse)');
        this._autoMax = false;        // maximized by compact, not by the user
        this._onCompactChange = () => this._syncCompact();

        this._onViewportResize = () => {
            if (this._windowState === 'maximized') this._applyMaximizedRect();
            else this._clampToViewport();
        };
    }

    /* The nav ribbon is a fixed 50px; maximized keeps an 8px inset from every
       edge; at least 40px of the window must stay inside the viewport for the
       title bar to remain grabbable. */
    static NAV_HEIGHT = 50;
    static MAX_INSET = 8;
    static MIN_VISIBLE = 40;
    static SNAP = 12;             // edge-snapping distance while dragging
    static Z_BASE = 10000;        // the window band: above the page …
    static Z_MAX = 18999;         // … below the open nav (19000) and dialogs (20000)

    static get observedAttributes() {
        return ['title', 'width', 'height', 'top', 'left', 'right', 'bottom', 'open', 'minimized', 'maximized', 'no-compact'];
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) {
            this.initStructure();
            this.setupEventListeners();
        }
        this.applyAttributes();
        this._updateControls();
        window.addEventListener('resize', this._onViewportResize);
        this._mq.addEventListener('change', this._onCompactChange);
        this._syncCompact();
        if (this.hasAttribute('open')) this._fitIntoView();
    }

    disconnectedCallback() {
        window.removeEventListener('resize', this._onViewportResize);
        this._mq.removeEventListener('change', this._onCompactChange);
        // Drop any in-flight drag/resize listeners on document.
        if (this.onMouseUp) this.onMouseUp();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue) return;

        if (name === 'minimized' || name === 'maximized') {
            if (this._syncingState) return;
            // Someone poked the attribute from outside. Put the attributes
            // back the way this element left them, then run the real
            // transition — which reflects them again, with geometry.
            const other = name === 'minimized' ? 'maximized' : 'minimized';
            const desired = newValue !== null
                ? name
                : (this.hasAttribute(other) ? other : 'normal');
            this._reflectState();
            this._setState(desired);
            return;
        }

        if (this.shadowRoot.innerHTML === '') return;

        if (name === 'open') {
            if (newValue !== null) { this._syncCompact(); this._fitIntoView(); }
            return;
        }
        if (name === 'no-compact') { this._syncCompact(); return; }

        // Geometry attributes are LIVE, not write-once: applyAttributes() only
        // FILLS an empty inline style (so it never fights a drag/resize), which
        // means it silently ignores a later setAttribute('left', …). An explicit
        // attribute change is a reposition request — apply it straight to the
        // inline style, but only in the normal state (min/max own the geometry).
        if (name === 'width' || name === 'height' || name === 'top' || name === 'left') {
            if (this._windowState === 'normal') this.style[name] = newValue || '';
            return;
        }
        // An edge anchor: set it and release the opposite side — unless an
        // explicit left / top is there, which wins.
        if (name === 'right' || name === 'bottom') {
            if (this._windowState !== 'normal') return;
            const near = name === 'right' ? 'left' : 'top';
            if (this.hasAttribute(near)) return;
            if (newValue) { this.style[name] = newValue; this.style[near] = 'auto'; }
            else { this.style[name] = ''; this.style[near] = '100px'; }
            return;
        }

        this.applyAttributes();   // title
    }

    open() {
        this.setAttribute('open', '');
        this.bringToFront();
        this.dispatchEvent(new CustomEvent('sac:open', { detail: { window: this }, bubbles: true, composed: true }));
    }

    close() {
        this.removeAttribute('open');
        this.dispatchEvent(new CustomEvent('sac:close', { detail: { window: this }, bubbles: true, composed: true }));
    }

    toggle() {
        if (this.hasAttribute('open')) this.close();
        else this.open();
    }

    /** Collapse to the title bar. Clears `maximized` (normal rect first). */
    minimize() {
        this._setState('minimized');
    }

    /** Fill the viewport below the nav ribbon. Clears `minimized`. */
    maximize() {
        this._setState('maximized');
    }

    /** Back to the saved rect, from either state. */
    restore() {
        this._setState('normal');
    }

    /**
     * Windows stack in their own band, 10000–18999: above the page, below
     * the open nav / rail drawer (19000+) and dialogs (20000). Reaching the
     * top of the band re-packs every window from the bottom in its current
     * order, so no amount of clicking climbs over the menu.
     */
    bringToFront() {
        const all = Array.from(document.querySelectorAll('sac-window'));
        const zOf = (w) => parseInt(window.getComputedStyle(w).zIndex, 10) || SacWindow.Z_BASE;
        let maxZ = SacWindow.Z_BASE;
        all.forEach((w) => { if (w !== this) maxZ = Math.max(maxZ, zOf(w)); });
        if (maxZ + 1 > SacWindow.Z_MAX) {
            const others = all.filter((w) => w !== this).sort((a, b) => zOf(a) - zOf(b));
            others.forEach((w, i) => { w.style.zIndex = SacWindow.Z_BASE + i; });
            maxZ = SacWindow.Z_BASE + others.length - 1;
        }
        this.style.zIndex = maxZ + 1;
    }

    initStructure() {
        // Control strings: tooltip and aria-label share one translation.
        const esc = (s) => String(s).replace(/"/g, '&quot;');
        const L = {
            minimize: esc(t('window.minimize', 'Minimize')),
            maximize: esc(t('window.maximize', 'Maximize')),
            close:    esc(t('window.close',    'Close')),
        };
        this.shadowRoot.innerHTML = `
        <style>
            :host {
                display: none;
                position: fixed;
                z-index: 10000;
                font-family: 'Inter', sans-serif;
                box-sizing: border-box;
            }

            :host([open]) {
                display: block;
            }

            /* Minimized / maximized geometry lives in inline styles (they win
               over any :host rule), so these blocks only carry the chrome:
               what disappears, what stops being grabbable, how the corners
               change. */
            :host([minimized]) .content,
            :host([minimized]) .resize-handle,
            :host([maximized]) .resize-handle,
            :host([no-resize]) .resize-handle {
                display: none;
            }

            :host([minimized]) .title-bar {
                border-bottom: none;
            }

            :host([minimized]) .window-container {
                /* No resize handle to make room for — full radius all round. */
                border-radius: var(--radius-l);
            }

            :host([maximized]) .window-container {
                border-radius: var(--radius-l);
            }

            :host([maximized]) .title-bar,
            :host([maximized]) .title-bar:active,
            :host([compact]) .title-bar,
            :host([compact]) .title-bar:active {
                cursor: default;
            }

            /* Compact: always maximized, so there is nothing to maximize. */
            :host([compact]) .max-btn { display: none !important; }
            /* Filling the phone screen, the see-through glass reads as
               noise over the page behind — go opaque (the glass hue, unblurred). */
            :host([compact]) .window-container {
                background: var(--glass-hue);
                backdrop-filter: none;
                -webkit-backdrop-filter: none;
            }
            :host([compact]) .content {
                padding-bottom: calc(var(--window-padding, 20px) + env(safe-area-inset-bottom, 0px));
            }

            .window-container {
                width: 100%;
                height: 100%;
                background: var(--tile);
                backdrop-filter: blur(20px) saturate(180%);
                -webkit-backdrop-filter: blur(20px) saturate(180%);
                border: 1px solid var(--border-strong);
                border-radius: var(--radius-l) var(--radius-l) var(--radius-s) var(--radius-l);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                box-shadow: 0 20px 50px color-mix(in srgb, var(--sink) 50%, transparent),
                            inset 0 0 0 1px color-mix(in srgb, var(--fg) 5%, transparent);
            }

            .title-bar {
                padding: 12px 16px;
                background: color-mix(in srgb, var(--fg) 5%, transparent);
                border-bottom: 1px solid var(--border-strong);
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: grab;
                user-select: none;
            }

            .title-bar:active {
                cursor: grabbing;
            }

            .title {
                font-family: 'Outfit', sans-serif;
                font-weight: 700;
                font-size: 0.8rem;
                color: var(--text);
                text-transform: uppercase;
                letter-spacing: 0.08em;
                pointer-events: none;
            }

            .controls {
                display: flex;
                gap: 8px;
            }

            /* Traffic lights: three plain colored dots, no glyphs — the color
               carries the meaning, the state-aware title/aria-label carries
               the words. */
            .ctrl-btn {
                --btn-color: var(--danger);
                width: 15px;
                height: 15px;
                border-radius: 50%;
                background: var(--btn-color);
                cursor: pointer;
                border: none;
                padding: 0;
                transition: transform 0.2s, background 0.2s;
                position: relative;
            }

            .ctrl-btn:hover {
                transform: scale(1.1);
                background: color-mix(in oklab, var(--btn-color) 80%, var(--lift));
            }

            .ctrl-btn:focus-visible {
                outline: 2px solid var(--accent);
                outline-offset: 2px;
            }

            .min-btn { --btn-color: var(--accent-warm); }
            .max-btn { --btn-color: var(--ok); }
            .close-btn { --btn-color: var(--danger); }

            /* [controls] opts into an explicit subset: hide all three, then
               re-show per space-separated token. No attribute = all three. */
            :host([controls]) .ctrl-btn { display: none; }
            :host([controls~="min"])   .min-btn   { display: inline-block; }
            :host([controls~="max"])   .max-btn   { display: inline-block; }
            :host([controls~="close"]) .close-btn { display: inline-block; }

            .content {
                flex: 1;
                overflow: auto;
                padding: var(--window-padding, 20px);
                color: color-mix(in srgb, var(--fg) 78%, var(--bg));
                font-size: 0.9rem;
                line-height: 1.6;
            }

            /* Scrollbar — the kit recipe (ui.css §5), re-stated because
               ::-webkit-scrollbar does not pierce a shadow root. Firefox, which has
               no ::-webkit-scrollbar, gets the standard pair instead. */
            .content::-webkit-scrollbar { width: 10px; height: 10px; }
            .content::-webkit-scrollbar-track { background: transparent; }
            .content::-webkit-scrollbar-thumb {
                background: var(--scrollbar-thumb);
                background-clip: content-box;
                border: 2px solid transparent;
                border-radius: 999px;
            }
            .content::-webkit-scrollbar-thumb:hover {
                background: var(--scrollbar-thumb-hover);
                background-clip: content-box;
            }
            .content::-webkit-scrollbar-corner { background: transparent; }
            @supports not selector(::-webkit-scrollbar) {
                .content { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) transparent; }
            }

            .resize-handle {
                position: absolute;
                bottom: 0;
                right: 0;
                width: 20px;
                height: 20px;
                cursor: nwse-resize;
                z-index: 10;
            }
            .resize-handle::after {
                content: '';
                position: absolute;
                bottom: 4px;
                right: 4px;
                width: 8px;
                height: 8px;
                border-right: 2px solid color-mix(in srgb, var(--fg) 30%, transparent);
                border-bottom: 2px solid color-mix(in srgb, var(--fg) 30%, transparent);
            }

            /* A 44px hit area per dot on touch: 20px dots, 24px apart, each
               with an invisible halo — the halos meet, never overlap. */
            @media (pointer: coarse) {
                .controls { gap: 24px; }
                .ctrl-btn { width: 20px; height: 20px; }
                .ctrl-btn::after { content: ''; position: absolute; inset: -12px; }
            }
            @media (hover: none) {
                .ctrl-btn:hover { transform: none; background: var(--btn-color); }
            }

            @media (prefers-reduced-motion: reduce) {
                .ctrl-btn {
                    transition: none;
                }
                .ctrl-btn:hover {
                    transform: none;
                }
            }
        </style>
        <div class="window-container">
            <div class="title-bar">
                <span class="title" id="window-title-text"></span>
                <div class="controls">
                    <button class="ctrl-btn min-btn" id="window-min-btn" type="button" title="${L.minimize}" aria-label="${L.minimize}"></button>
                    <button class="ctrl-btn max-btn" id="window-max-btn" type="button" title="${L.maximize}" aria-label="${L.maximize}"></button>
                    <button class="ctrl-btn close-btn" id="window-close-btn" title="${L.close}" aria-label="${L.close}"></button>
                </div>
            </div>
            <div class="content" id="window-content" part="content">
                <slot></slot>
            </div>
            <div class="resize-handle"></div>
        </div>
        `;
    }

    applyAttributes() {
        const titleText = this.shadowRoot.getElementById('window-title-text');
        if (titleText) titleText.textContent = this.getAttribute('title') || t('window.default-title', 'Window');

        if (this.style.width === '') this.style.width = this.getAttribute('width') || '400px';
        if (this.style.height === '') this.style.height = this.getAttribute('height') || '300px';
        // right / bottom anchor only where left / top is not given.
        const bottom = this.getAttribute('bottom');
        const right = this.getAttribute('right');
        if (this.style.top === '') {
            if (bottom && !this.hasAttribute('top')) { this.style.top = 'auto'; this.style.bottom = bottom; }
            else this.style.top = this.getAttribute('top') || '100px';
        }
        if (this.style.left === '') {
            if (right && !this.hasAttribute('left')) { this.style.left = 'auto'; this.style.right = right; }
            else this.style.left = this.getAttribute('left') || '100px';
        }
    }

    /** The gap a snapped window keeps from the edge: snap="14" → 14. */
    _snapGap() {
        const v = parseFloat(this.getAttribute('snap'));
        return Number.isFinite(v) && v >= 0 ? v : SacWindow.MAX_INSET;
    }

    /** While dragging: pull _dx/_dy onto an edge line within SNAP px. */
    _snapDrag() {
        const T = SacWindow.SNAP;
        const gap = this._snapGap();
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const nav = this._navBottom();
        const w = this._dragW, h = this._dragH;
        let left = this.startLeft + this._dx;
        let top = this.startTop + this._dy;
        const snap = {};
        if (Math.abs(left - gap) <= T) { left = gap; snap.x = 'left'; }
        else if (Math.abs(left + w - (vw - gap)) <= T) { left = vw - gap - w; snap.x = 'right'; }
        if (Math.abs(top - (nav + gap)) <= T) { top = nav + gap; snap.y = 'top'; }
        else if (Math.abs(top + h - (vh - gap)) <= T) { top = vh - gap - h; snap.y = 'bottom'; }
        this._dx = left - this.startLeft;
        this._dy = top - this.startTop;
        this._snapped = snap;
    }

    /** Is the window held by its right / bottom edge right now? */
    _anchoredX() { return this.style.right !== '' && this.style.right !== 'auto'; }
    _anchoredY() { return this.style.bottom !== '' && this.style.bottom !== 'auto'; }

    /** The user took the window: an edge anchor becomes a plain left / top
     *  at exactly where it is, so drag and resize work from there. */
    _detachAnchor() {
        if (!this._anchoredX() && !this._anchoredY()) return;
        const rect = this.getBoundingClientRect();
        if (this._anchoredX()) { this.style.left = `${Math.round(rect.left)}px`; this.style.right = ''; }
        if (this._anchoredY()) { this.style.top = `${Math.round(rect.top)}px`; this.style.bottom = ''; }
    }

    setupEventListeners() {
        const titleBar = this.shadowRoot.querySelector('.title-bar');
        const closeBtn = this.shadowRoot.getElementById('window-close-btn');
        const minBtn = this.shadowRoot.getElementById('window-min-btn');
        const maxBtn = this.shadowRoot.getElementById('window-max-btn');
        const resizeHandle = this.shadowRoot.querySelector('.resize-handle');

        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });

        minBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._windowState === 'minimized') this.restore();
            else this.minimize();
        });

        // From either non-normal state this button is the way back, so it
        // reads "Restore" whenever the window isn't in its normal rect.
        maxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._windowState === 'normal') this.maximize();
            else this.restore();
        });

        // Double-click the bar itself (not the dots) toggles maximize —
        // only while the max control is offered at all.
        titleBar.addEventListener('dblclick', (e) => {
            if (e.target.closest('button')) return;
            if (this.hasAttribute('controls') && !/(^|\s)max(\s|$)/.test(this.getAttribute('controls'))) return;
            if (this._windowState === 'normal') this.maximize();
            else this.restore();
        });

        // SCROLL ISOLATION: stop propagation so wheel events inside the
        // window never zoom/pan the workspace behind it; don't preventDefault
        // so the content itself still scrolls.
        this.addEventListener('wheel', (e) => {
            e.stopPropagation();
        }, { passive: true });

        // DRAG — works while minimized, never while maximized.
        titleBar.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            if (this._windowState === 'maximized' || this.hasAttribute('compact')) return;
            this._detachAnchor();
            this.isDragging = true;
            this.startX = e.clientX;
            this.startY = e.clientY;

            const rect = this.getBoundingClientRect();
            this.startLeft = rect.left;
            this.startTop = rect.top;
            this._dragW = rect.width;
            this._dragH = rect.height;
            this._snapped = null;
            // A drag is a compositor move: the window rides a transform on
            // its own layer — no layout, no repaint of the glass blur and
            // the big shadow per mouse event, which is what made it trail
            // the pointer. left/top are committed once, on release.
            this.style.willChange = 'transform';

            document.addEventListener('mousemove', this.onMouseMove);
            document.addEventListener('mouseup', this.onMouseUp);
            e.preventDefault();
        });

        // RESIZE — the handle is hidden in both states, the guard is belt
        // and braces for a programmatic dispatch.
        resizeHandle.addEventListener('mousedown', (e) => {
            if (this._windowState !== 'normal') return;
            this._detachAnchor();
            this.isResizing = true;
            this.startX = e.clientX;
            this.startY = e.clientY;
            this.startWidth = this.offsetWidth;
            this.startHeight = this.offsetHeight;

            document.addEventListener('mousemove', this.onMouseMove);
            document.addEventListener('mouseup', this.onMouseUp);
            e.preventDefault();
        });

        this.onMouseMove = (e) => {
            if (this.isDragging) {
                this._dx = e.clientX - this.startX;
                this._dy = e.clientY - this.startY;
                if (this.hasAttribute('snap')) this._snapDrag();
                this.style.transform = `translate3d(${this._dx}px, ${this._dy}px, 0)`;
            }
            if (this.isResizing) {
                const dx = e.clientX - this.startX;
                const dy = e.clientY - this.startY;
                this.style.width = `${Math.max(200, this.startWidth + dx)}px`;
                this.style.height = `${Math.max(150, this.startHeight + dy)}px`;
            }
        };

        this.onMouseUp = () => {
            const wasDragging = this.isDragging;
            if (wasDragging) {
                // Commit the transform to the real position, then drop it.
                // Snapped to the right / bottom edge = anchored there again.
                const snap = this._snapped || {};
                const gap = `${this._snapGap()}px`;
                if (snap.x === 'right') { this.style.left = 'auto'; this.style.right = gap; }
                else { this.style.left = `${Math.round(this.startLeft + (this._dx || 0))}px`; this.style.right = ''; }
                if (snap.y === 'bottom') { this.style.top = 'auto'; this.style.bottom = gap; }
                else { this.style.top = `${Math.round(this.startTop + (this._dy || 0))}px`; this.style.bottom = ''; }
                this._snapped = null;
                this.style.transform = '';
                this.style.willChange = '';
                this._dx = this._dy = 0;
            }
            this.isDragging = false;
            this.isResizing = false;
            document.removeEventListener('mousemove', this.onMouseMove);
            document.removeEventListener('mouseup', this.onMouseUp);
            if (wasDragging) this._clampToViewport();
        };
    }

    /* ---------------------------------------------------------------------
       State machine: normal <-> minimized <-> maximized.
       Every transition goes through here, so the attributes, the geometry,
       the button labels and the events can never drift apart.
       --------------------------------------------------------------------- */

    _setState(next) {
        // Compact has no normal rect: "restore" means back to maximized.
        if (next === 'normal' && this._isCompact()) next = 'maximized';
        if (next === 'normal') this._autoMax = false;
        const current = this._windowState;
        if (next === current) return;

        // Leaving the normal rect — remember it.
        if (current === 'normal') this._saveRect();

        this._windowState = next;
        this._reflectState();

        if (next === 'maximized') {
            this._applyMaximizedRect();
        } else if (current === 'maximized') {
            // Both maximized -> normal and maximized -> minimized land back
            // on the saved rect first (the viewport may have shrunk since).
            // But minimizing still owes a restore later, so KEEP the saved rect
            // in that case — consuming it here teleports the window to its
            // attribute defaults when it is finally un-minimized.
            this._restoreRect(next !== 'minimized');
            this._clampToViewport();
        }

        if (next === 'minimized') {
            // Compact: collapse in place at the top, full width.
            if (this._isCompact()) this._applyMaximizedRect();
            // Inline height wins over any :host rule, so the collapse is a
            // style swap; width, top and left stay as they were.
            this.style.height = 'auto';
        } else if (next === 'normal' && current === 'minimized') {
            this._restoreRect();
            this._clampToViewport();
        }

        this._updateControls();

        const eventName = next === 'minimized' ? 'sac:minimize'
            : next === 'maximized' ? 'sac:maximize'
                : 'sac:restore';
        this.dispatchEvent(new CustomEvent(eventName, {
            bubbles: true,
            composed: true,
            detail: { window: this }
        }));
    }

    /** Mirror _windowState onto the reflected attributes, guard on. */
    _reflectState() {
        this._syncingState = true;
        this.toggleAttribute('minimized', this._windowState === 'minimized');
        this.toggleAttribute('maximized', this._windowState === 'maximized');
        this._syncingState = false;
    }

    _saveRect() {
        this._normalRect = {
            top: this.style.top,
            left: this.style.left,
            width: this.style.width,
            height: this.style.height,
            right: this.style.right,
            bottom: this.style.bottom
        };
    }

    _restoreRect(consume = true) {
        const rect = this._normalRect;
        // Keep the saved rect when a caller still owes a restore (maximized ->
        // minimized: the un-minimize back to normal needs it).
        if (consume) this._normalRect = null;
        this.style.top = rect ? rect.top : '';
        this.style.left = rect ? rect.left : '';
        this.style.width = rect ? rect.width : '';
        this.style.height = rect ? rect.height : '';
        this.style.right = rect ? rect.right : '';
        this.style.bottom = rect ? rect.bottom : '';
        // Fills anything still blank from the attributes (a window that was
        // maximized straight out of the markup has no saved rect).
        this.applyAttributes();
    }

    /** Compact on/off: maximize on the phone, give the rect back after. */
    /** Compact rules apply: a narrow viewport, and the window did not opt out. */
    _isCompact() {
        return this._mq.matches && !this.hasAttribute('no-compact');
    }

    _syncCompact() {
        const compact = this._isCompact();
        this.toggleAttribute('compact', compact);
        if (!this.shadowRoot.firstChild) return;
        if (compact && this._windowState === 'normal' && this.hasAttribute('open')) {
            this._setState('maximized');
            this._autoMax = true;
        } else if (!compact && this._autoMax) {
            this._autoMax = false;
            if (this._windowState === 'maximized') this._setState('normal');
        }
    }

    /** Bottom of the fixed nav ribbon — 50px, or more under a notch. */
    _navBottom() {
        const nav = document.querySelector('sac-nav');
        const bottom = nav ? Math.round(nav.getBoundingClientRect().bottom) : 0;
        return Math.max(SacWindow.NAV_HEIGHT, bottom);
    }

    _applyMaximizedRect() {
        const inset = SacWindow.MAX_INSET;
        const nav = this._navBottom();
        // clientWidth/clientHeight, not vw/vh units: they exclude the
        // scrollbars, so the inset stays an inset.
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;

        this.style.top = `${nav + inset}px`;
        this.style.left = `${inset}px`;
        this.style.right = '';
        this.style.bottom = '';
        this.style.width = `${Math.max(200, vw - inset * 2)}px`;
        this.style.height = `${Math.max(150, vh - nav - inset * 2)}px`;
    }

    /**
     * Keep the title bar reachable: MIN_VISIBLE px of the window stays inside
     * the viewport horizontally, and the bar sits between the nav ribbon and
     * the bottom edge. Runs after every drag, on window resize, and whenever
     * a saved rect is put back.
     */
    _clampToViewport() {
        if (!this.isConnected || !this.hasAttribute('open')) return;
        if (this._windowState === 'maximized') return;

        const rect = this.getBoundingClientRect();
        if (!rect.width && !rect.height) return;

        const nav = this._navBottom();
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const titleBar = this.shadowRoot.querySelector('.title-bar');
        const titleH = titleBar ? titleBar.offsetHeight : 44;
        const keep = Math.min(SacWindow.MIN_VISIBLE, rect.width);

        const left = Math.min(Math.max(rect.left, keep - rect.width), vw - keep);
        const top = Math.min(Math.max(rect.top, nav), Math.max(nav, vh - titleH));

        // An anchored axis follows its edge by itself; it is only written
        // (and so released) when the window really left the viewport.
        if (!this._anchoredX() || Math.round(left) !== Math.round(rect.left)) {
            this.style.left = `${Math.round(left)}px`;
            this.style.right = '';
        }
        if (!this._anchoredY() || Math.round(top) !== Math.round(rect.top)) {
            this.style.top = `${Math.round(top)}px`;
            this.style.bottom = '';
        }

        // A minimized window can still be dragged (and clamped), so the rect
        // it will restore to has to follow it — otherwise restoring teleports
        // it back to where it was collapsed.
        if (this._normalRect) {
            this._normalRect.left = this.style.left;
            this._normalRect.top = this.style.top;
        }
    }

    /**
     * On show: the WHOLE window comes into view, not just the 40px the drag
     * clamp guarantees — a window placed for a bigger screen, or opened after
     * the browser shrank, is pushed in (below the nav ribbon). One larger
     * than the viewport shows its top-left, title bar first. An anchored
     * axis that already fits is left alone.
     */
    _fitIntoView() {
        if (!this.isConnected || this._windowState !== 'normal') return;
        const rect = this.getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        const nav = this._navBottom();
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const left = Math.max(0, Math.min(rect.left, vw - rect.width));
        const top = Math.max(nav, Math.min(rect.top, vh - rect.height));
        if (Math.round(left) !== Math.round(rect.left)) {
            this.style.left = `${Math.round(left)}px`;
            this.style.right = '';
        }
        if (Math.round(top) !== Math.round(rect.top)) {
            this.style.top = `${Math.round(top)}px`;
            this.style.bottom = '';
        }
    }

    /** Label the maximize dot for what it actually does right now. */
    _updateControls() {
        const minBtn = this.shadowRoot.getElementById('window-min-btn');
        const maxBtn = this.shadowRoot.getElementById('window-max-btn');
        if (!minBtn || !maxBtn) return;   // called before initStructure()

        const minLabel = this._windowState === 'minimized'
            ? t('window.restore', 'Restore') : t('window.minimize', 'Minimize');
        minBtn.setAttribute('aria-label', minLabel);
        minBtn.setAttribute('title', minLabel);

        const maxLabel = this._windowState === 'normal'
            ? t('window.maximize', 'Maximize') : t('window.restore', 'Restore');
        maxBtn.setAttribute('aria-label', maxLabel);
        maxBtn.setAttribute('title', maxLabel);
    }
}

customElements.define('sac-window', SacWindow);
})();
