/**
 * <sac-split direction="horizontal" position="30%" min-start="150px" min-end="200px">
 *     <div slot="start">…left panel…</div>
 *     <div slot="end">…right panel…</div>
 * </sac-split>
 *
 * Two panels and a draggable divider. The host is the flex container, the two
 * slot wrappers are the panels: the START panel is sized (flex-basis from
 * `position`), the END panel takes whatever is left (flex: 1). Nothing is ever
 * re-rendered — dragging writes one flex-basis and one attribute, so a canvas,
 * a scroll position or a half-filled form in either panel survives every drag.
 *
 * `position` is the START panel's share of the space MINUS the divider, as a
 * percentage — and it is REFLECTED: after a drag the attribute holds the live
 * value, so `el.getAttribute("position")` is what you persist, and writing the
 * attribute back moves the divider. Percent, not pixels, is what makes the
 * split survive a window resize with its proportions intact.
 *
 * The divider is a 1px hairline — the only pixel it takes from the layout —
 * with a ~9px invisible hit area laid over the panels beside it — thin to
 * look at, comfortable to grab. It is focusable and fully keyboard-operable.
 *
 * Nesting works: put a vertical <sac-split> in the `end` slot of a horizontal
 * one. Nothing here is document-scoped — no shared ids, no document-level
 * pointer listeners (the drag runs on pointer capture).
 *
 * Attributes:
 *   direction  — "horizontal" (default; start = left, the divider is a
 *                VERTICAL separator, dragging moves x) | "vertical"
 *                (start = top, horizontal separator, dragging moves y).
 *   position   — start panel size as a percentage, e.g. "30%" (default "50%").
 *                Bare numbers count as percent. Reflected: drag/keyboard
 *                updates it, and an out-of-range value is written back
 *                clamped, so the attribute never lies about the layout.
 *   min-start  — CSS length clamping the drag on the start side (default "0").
 *   min-end    — same for the end side. px and bare numbers; rem is resolved.
 *                If the two minimums cannot both hold (container too small),
 *                min-start wins.
 *   dragging   — set BY THE COMPONENT while a drag is in progress, not by
 *                hand. Styling hook (`sac-split[dragging] …`).
 *
 *   LIST/DETAIL ON A PHONE — one panel at a time:
 *   collapse   — when the split's OWN width drops to this or below, it shows
 *                one panel at a time: "compact" (768px — also the value of a
 *                bare `collapse`), "narrow" (480px) or a px length ("600px").
 *                The split measures itself, not the page, so it also
 *                collapses inside a narrow sac-window on a wide screen.
 *                Absent = never collapses (the pre-2.6 behaviour).
 *   show       — "start" (default) | "end": which panel a collapsed split
 *                shows. Set it to "end" when the user opens an item; the
 *                built-in back bar sets it back to "start". Ignored while the
 *                split is not collapsed. Nothing re-renders or moves: the
 *                hidden panel keeps its scroll position, form state, canvas.
 *                Focus follows (2.36): when focus was in the panel that
 *                goes (the row that opened the item, the Back button) or
 *                nowhere, "end" moves it onto the end panel itself (no
 *                field: no phone keyboard), and "start" returns it to the
 *                element that had it before — else the selected row
 *                ([aria-current] / [aria-selected="true"]), else the start
 *                panel. Focus put elsewhere (by the user, or by the app
 *                right after setting `show`) stays where it is.
 *   collapsed  — set BY THE COMPONENT while collapsed. Styling hook; the
 *                divider is hidden.
 *   rail-start — set BY THE COMPONENT when the start slot holds a rail that
 *                sac-nav adopted (see the recipe below). While the page is
 *                compact that rail IS a drawer, so the split collapses
 *                whatever its width or `collapse` say — otherwise an empty
 *                start panel would stand where the rail used to be (a phone
 *                held sideways is 844px wide).
 *                Opening an item slides it in from the right; the back bar
 *                slides it back out; and a finger or a pen can pull it off
 *                to the right (the back swipe: 1:1, past half its width or
 *                flicked = back, else it springs back — sac:split-back is
 *                asked first, as for the bar). Never from a field, a slider,
 *                [data-no-swipe], a surface with touch-action: none (a canvas,
 *                a pan-zoom viewport) or one that scrolls sideways. Needs sac.motion; without it,
 *                or under reduced motion, the panels swap at once.
 *   no-back    — hide the built-in back bar (draw your own and set `show`).
 *   back-label — the back bar's text (default "Back", i18n key split.back).
 *
 * Properties:
 *   position — get/set, normalized to one decimal ("34.2%"). Setting it does
 *              NOT fire sac:resize (the caller already knows); user
 *              interaction does.
 *   show     — get/set "start" | "end" (the attribute).
 *   collapsed — read-only boolean.
 *
 * Methods:
 *   back() — what the back bar does: show "start" (after sac:split-back).
 *
 * Events:
 *   sac:resize — detail { position } (the percent string), bubbles +
 *              composed. Fired live during a drag, on every keyboard move, on
 *              a double-click reset, and when a container resize forces the
 *              position to change — but only when the value actually changed.
 *   sac:split-back — the back bar was used (or back() called). Bubbles +
 *              composed, CANCELABLE: preventDefault() keeps the end panel
 *              (e.g. to confirm unsaved changes first).
 *   sac:collapse — detail { collapsed } — the split entered or left the
 *              one-panel mode. Bubbles + composed.
 *
 * Slots:
 *   start — left (horizontal) / top (vertical) panel.
 *   end   — right / bottom panel.
 *   Both wrappers scroll their own overflow (`overflow: auto`).
 *
 * Keyboard (divider focused, WAI-ARIA window-splitter pattern):
 *   ArrowLeft / ArrowRight — horizontal split: -1% / +1%
 *   ArrowUp / ArrowDown    — vertical split:   -1% / +1%
 *   Shift + arrow          — 5% steps
 *   Home / End             — jump to the clamped extremes
 * Double-clicking the divider resets it to the INITIAL position — the value it
 * had when the element first connected.
 *
 * Accessibility note: the divider is a focusable separator (window splitter) —
 * role="separator", aria-orientation naming the SEPARATOR (a left/right split
 * is separated by a vertical bar), aria-valuenow/min/max in percent, kept in
 * sync on every move and every resize. An `aria-label` on the host names it;
 * without one it announces as "Resize panels". aria-controls is deliberately
 * NOT wired: IDREF relationships cannot cross a shadow boundary (the divider
 * lives in the shadow root, the panels are slotted light DOM), and inventing
 * ids on the consumer's markup would be worse than the relationship is worth.
 *
 * CSS custom properties:
 *   --split-divider — hit-area thickness of the divider (default 9px). The
 *                     hairline stays 1px; this is the grab zone.
 *
 * Sizing: the host is width/height 100% and does not scroll — give it a parent
 * with a real size (a flex child, a fixed-height box, .main-layout, …).
 *
 * RECIPE — resizable sidebar. The workspace layout (fixed 50px nav + sidebar +
 * viewport) becomes resizable by wrapping the sidebar and the viewport in one
 * split; `min-start` keeps the sidebar usable, `min-end` protects the canvas.
 * The sidebar's own 260px width is handed over to the panel, hence width:100%:
 *
 *   <div class="main-layout">
 *       <sac-split style="flex:1" position="20%" min-start="180px" min-end="320px" collapse>
 *           <aside class="sidebar fill" slot="start">…</aside>
 *           <section class="viewport" slot="end">…</section>
 *       </sac-split>
 *   </div>
 *
 * On a phone the page's <sac-nav> adopts the sidebar as its drawer; with
 * `collapse` the split then gives the whole width to the viewport and leaves
 * the drawer alone (the `rail-start` attribute, set by the split).
 * `.sidebar.fill` (ui.css) hands the sidebar's width to the panel and
 * yields to the drawer's own size on compact.
 *
 *   // Persist it — the attribute is already the truth:
 *   split.addEventListener("sac:resize", e => localStorage.setItem("sidebar", e.detail.position));
 *   split.position = localStorage.getItem("sidebar") || "20%";
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

    /** sac.motion when lib/motion.js is loaded; without it the panels swap
     *  at once and there is no back swipe — the back bar still works. */
    const motion = () => (window.sac && window.sac.motion) || null;

    /** A back swipe never starts in these (they drag or type themselves). */
    const NO_SWIPE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), ' +
        'sac-slider, [role="slider"], [role="separator"], [data-no-swipe]';

    /** The focused element itself, down through every open shadow root. */
    const deepActive = () => {
        let a = document.activeElement;
        while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
        return a;
    };

    /** `node` sits inside `box` as rendered: slots followed, shadow roots
     *  left through their host. */
    const within = (node, box) => {
        for (let n = node; n; n = n.assignedSlot || n.parentNode || n.host) if (n === box) return true;
        return false;
    };

class SacSplit extends HTMLElement {
    static get observedAttributes() {
        return ["direction", "position", "min-start", "min-end", "aria-label", "collapse", "back-label", "show"];
    }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._current  = null;      // numeric percent actually applied
        this._initial  = null;      // percent at first connect — the dblclick target
        this._internal = false;     // guards the attribute write-back
        this._drag     = null;      // { vertical, origin, available, grab }
        this._ro       = null;
        this._lastDown = -Infinity; // manual double-click detection, see _onPointerDown
        this._lastX    = 0;
        this._lastY    = 0;
        // Page-level compact (ui.css §15): a drawer rail in the start slot
        // collapses the split. Same query as sac-nav's.
        this._compactMQ = window.matchMedia("(max-width: 768px), (max-height: 480px) and (pointer: coarse)");
        this._onCompact = () => this._syncCollapse();
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
        if (this._initial === null) this._initial = this._parse(this.getAttribute("position"));
        // Container resizes change what the px minimums mean in percent, so the
        // clamp has to re-run — otherwise a narrowed window leaves a sidebar
        // below its min-start.
        this._ro = new ResizeObserver(() => { this._syncCollapse(); this._reclamp(); });
        this._ro.observe(this);
        this._syncLabel();
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
        this._compactMQ.addEventListener("change", this._onCompact);
        this._syncCollapse();
        this._set(this._current === null ? this._parse(this.getAttribute("position")) : this._current,
                  { emit: false, reflect: this.hasAttribute("position") });
    }

    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
        this._compactMQ.removeEventListener("change", this._onCompact);
        this._ro?.disconnect();
        this._ro = null;
        this._endDrag();
        this._settleSlide();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (!this.shadowRoot.firstChild) return;   // pre-upgrade attribute
        if (this._internal) return;                // our own write-back
        if (name === "aria-label" || name === "back-label") { this._syncLabel(); return; }
        if (name === "show") { this._onShow(oldValue, newValue); this._handFocus(oldValue, newValue); return; }
        if (name === "collapse") { this._syncCollapse(); return; }
        if (name === "position") {
            this._set(this._parse(newValue), { emit: false, reflect: this.hasAttribute("position") });
            return;
        }
        // direction / min-start / min-end: keep the percent, re-clamp, re-aria.
        this._set(this._current === null ? this._parse(this.getAttribute("position")) : this._current,
                  { emit: false, reflect: this.hasAttribute("position") });
    }

    /* ---------------------------------------------------------------- API */

    get position() {
        return this._fmt(this._current === null ? this._parse(this.getAttribute("position")) : this._current);
    }

    set position(v) {
        this.setAttribute("position", String(v));
    }

    get show() { return this.getAttribute("show") === "end" ? "end" : "start"; }
    set show(v) { this.setAttribute("show", v === "end" ? "end" : "start"); }

    get collapsed() { return this.hasAttribute("collapsed"); }

    back() {
        const ev = new CustomEvent("sac:split-back", { bubbles: true, composed: true, cancelable: true });
        if (this.dispatchEvent(ev)) this.show = "start";
    }

    /* ------------------------------------------------------------ internals */

    _vertical() { return this.getAttribute("direction") === "vertical"; }

    /** Percent from an attribute value. Anything unreadable means "half". */
    _parse(v) {
        const n = parseFloat(v);
        return isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
    }

    /** One decimal is enough to be exact on any screen and stay readable. */
    _fmt(pct) { return `${Math.round(pct * 10) / 10}%`; }

    /** A clamp length → px. px and bare numbers pass through; rem resolves. */
    _lenPx(v) {
        const n = parseFloat(v);
        if (!isFinite(n) || n <= 0) return 0;
        if (/rem\s*$/i.test(String(v))) {
            return n * parseFloat(getComputedStyle(document.documentElement).fontSize);
        }
        return n;
    }

    /**
     * Main-axis space the two panels share = both panel boxes, measured. Taken
     * from the panels rather than the host so host padding/borders and the
     * divider are all accounted for without a second computed-style read.
     */
    _measure() {
        const s = this._start.getBoundingClientRect();
        const e = this._end.getBoundingClientRect();
        return this._vertical() ? s.height + e.height : s.width + e.width;
    }

    /** [lo, hi] percent allowed by min-start / min-end at this size. */
    _bounds(available) {
        if (!(available > 0)) return [0, 100];
        const lo = Math.max(0, Math.min(100, this._lenPx(this.getAttribute("min-start")) / available * 100));
        const hi = Math.max(0, Math.min(100, 100 - this._lenPx(this.getAttribute("min-end")) / available * 100));
        return [lo, hi];
    }

    /**
     * THE single write path: clamp → round → reflect → lay out → announce.
     * `available` may be passed in to reuse the geometry cached at pointerdown
     * (re-measuring after every flex-basis write would force a layout flush on
     * each pointermove).
     */
    _set(pct, { emit = false, reflect = true, available } = {}) {
        // Collapsed: no geometry to clamp against — keep the value as given.
        const size = this.hasAttribute("collapsed") ? 0
            : available === undefined ? this._measure() : available;
        const [lo, hi] = this._bounds(size);
        // Upper bound first, lower bound last: when the container is too small
        // for both minimums, min-start wins.
        let p = Math.min(isFinite(pct) ? pct : 50, hi);
        p = Math.max(p, lo);
        p = Math.round(Math.max(0, Math.min(100, p)) * 10) / 10;

        const changed = p !== this._current;
        this._current = p;

        const text = this._fmt(p);
        if (reflect && this.getAttribute("position") !== text) {
            this._internal = true;
            this.setAttribute("position", text);
            this._internal = false;
        }

        // The divider is a real flex item, so the start panel gets its share of
        // the space MINUS the divider — which is exactly what `position` means.
        this._start.style.flexBasis = `calc((100% - 1px) * ${p / 100})`;
        this._syncAria(p, lo, hi);

        if (changed && emit) {
            this.dispatchEvent(new CustomEvent("sac:resize", {
                detail:   { position: text },
                bubbles:  true,
                composed: true,
            }));
        }
    }

    _reclamp() {
        // Collapsed, one panel is hidden and the measured space means nothing:
        // a clamp now would rewrite `position` for good. Wait for the expand.
        if (this._current === null || this.hasAttribute("collapsed")) return;
        this._set(this._current, { emit: true, reflect: this.hasAttribute("position") });
    }

    _syncAria(pct, lo, hi) {
        const d = this._divider;
        // A LEFT/RIGHT split is separated by a VERTICAL bar — the orientation
        // names the separator, not the split.
        d.setAttribute("aria-orientation", this._vertical() ? "horizontal" : "vertical");
        d.setAttribute("aria-valuenow", String(pct));
        d.setAttribute("aria-valuemin", String(Math.round(lo * 10) / 10));
        d.setAttribute("aria-valuemax", String(Math.round(hi * 10) / 10));
        d.setAttribute("aria-valuetext", this._fmt(pct));
    }

    /** An aria-label on the host names the divider — no extra attribute. */
    _syncLabel() {
        this._divider.setAttribute("aria-label",
            this.getAttribute("aria-label") || t("split.resize-panels", "Resize panels"));
        this._backText.textContent = this.getAttribute("back-label") || t("split.back", "Back");
    }

    /** Language switch: divider name + back label, in place (a running
     *  drag, position and collapse state are untouched). */
    _relabel() { this._syncLabel(); }

    /** The collapse threshold in px; 0 = never collapses. */
    _collapseAt() {
        const v = this.getAttribute("collapse");
        if (v === null) return 0;
        if (v === "" || v === "compact") return 768;
        if (v === "narrow") return 480;
        const n = parseFloat(v);
        return isFinite(n) && n > 0 ? n : 768;
    }

    /** A rail the nav turned into a drawer sits in the start slot (the
     *  resizable-sidebar recipe): collapsed, the split must not hide it with
     *  its panel — it lives off-canvas now, and the end panel is the page. */
    _syncRailStart() {
        const slot = this.shadowRoot.querySelector('slot[name="start"]');
        const rail = slot && slot.assignedElements().some((el) => el.hasAttribute("drawer"));
        this.toggleAttribute("rail-start", !!rail);
        this._syncCollapse();
    }

    _syncCollapse() {
        const at = this._collapseAt();
        const w = this.getBoundingClientRect().width;
        const railDrawer = this.hasAttribute("rail-start") && this._compactMQ.matches;
        const next = (at > 0 && w > 0 && w <= at) || railDrawer;
        if (next === this.hasAttribute("collapsed")) return;
        this.toggleAttribute("collapsed", next);
        if (!next) this._settleSlide();
        if (!next) this._reclamp();   // the clamp skipped while collapsed
        this.dispatchEvent(new CustomEvent("sac:collapse", {
            detail: { collapsed: next }, bubbles: true, composed: true,
        }));
    }

    /* ------------------------------------------------- collapsed: the slide */

    /*
     * One model for every way between the two collapsed panels: x = how far
     * the end panel is pushed off to the right, 0 (it shows) … its width
     * (gone), with the start panel beneath drifting in from -25% (depth).
     * Opening an item, the back bar and the back swipe all move x with a
     * spring, so any of them can catch another mid-flight. Reduced motion or
     * no sac.motion: the panels swap at once.
     */

    /** The panels may slide at all: collapsed into two, motion allowed. */
    _canSlide() {
        return this.hasAttribute("collapsed") && !this.hasAttribute("rail-start") && !!motion();
    }

    /** `show` changed: slide to it — unless a swipe moves it already. */
    _onShow(oldValue, newValue) {
        const was = oldValue === "end" ? "end" : "start";
        const now = newValue === "end" ? "end" : "start";
        if (was === now || this._swipeOwns || !this.isConnected || !this._canSlide()) return;
        const w = this._end.getBoundingClientRect().width || this.getBoundingClientRect().width;
        const from = this._slide ? this._slideX : (now === "end" ? w : 0);
        this._slideTo(from, now === "end" ? 0 : w, 0);
    }

    /** Collapsed, one panel replaces the other: focus must not stay on the
     *  one that goes (the row that opened the item, the Back button) and
     *  fall to <body>. To "end": the end panel takes it, and the element
     *  that had it in the start panel is kept. Back to "start": focus
     *  returns to that element — else to the selected row
     *  ([aria-current] / [aria-selected="true"]), else to the start panel.
     *  Only when focus was in the panel that goes, or nowhere: focus the
     *  user (or the app) has put elsewhere stays there. */
    _handFocus(oldValue, newValue) {
        const was = oldValue === "end" ? "end" : "start";
        const now = newValue === "end" ? "end" : "start";
        if (was === now || !this.isConnected) return;
        if (!this.hasAttribute("collapsed") || this.hasAttribute("rail-start")) return;
        const act = deepActive();
        const lost = !act || act === document.body || act === document.documentElement;
        if (!lost && !within(act, now === "end" ? this._start : this._end)) return;
        if (now === "end") {
            this._focusBack = lost ? null : act;
            this._focusPane(this._end);
            return;
        }
        const back = this._focusBack;
        this._focusBack = null;
        const take = (el) => {
            if (!el || !el.isConnected || !within(el, this._start)) return false;
            el.focus({ preventScroll: true });
            const a = deepActive();
            return !!a && within(a, el);
        };
        if (take(back)) return;
        const sel = '[aria-current]:not([aria-current="false"]), [aria-selected="true"]';
        const slot = this.shadowRoot.querySelector('slot[name="start"]');
        for (const el of slot.assignedElements({ flatten: true })) {
            if (take(el.matches(sel) ? el : el.querySelector(sel))) return;
        }
        this._focusPane(this._start);
    }

    /** Focus a panel itself: tabindex -1 only while it holds the focus, so
     *  a scrolling panel keeps the browser's own Tab behaviour otherwise. */
    _focusPane(pane) {
        if (pane.hasAttribute("tabindex")) { pane.focus({ preventScroll: true }); return; }
        pane.setAttribute("tabindex", "-1");
        const drop = () => pane.removeAttribute("tabindex");
        pane.focus({ preventScroll: true });
        if (this.shadowRoot.activeElement === pane) pane.addEventListener("blur", drop, { once: true });
        else drop();
    }

    /** The colour behind the split, for the sliding panel to carry. */
    _ground() {
        for (let n = this; n; n = n.parentNode || n.host) {
            if (n.nodeType !== 1) continue;
            const bg = getComputedStyle(n).backgroundColor;
            if (bg && bg !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(bg)) return bg;
        }
        return "var(--bg)";
    }

    /** Both panels rendered, the end one x px off to the right. */
    _placeSlide(x) {
        if (!this.hasAttribute("sliding")) {
            this._end.style.background = this._ground();
            this.setAttribute("sliding", "");
        }
        this._slideX = x;
        const w = this._end.getBoundingClientRect().width || 1;
        this._end.style.transform = `translateX(${x}px)`;
        this._start.style.transform = `translateX(${-0.25 * Math.max(0, w - x)}px)`;
    }

    /** Spring x to `to`; arriving at the right edge, the start panel stays. */
    _slideTo(from, to, velocity, damping = 1) {
        const m = motion();
        if (this._slide) this._slide.stop();
        this._placeSlide(from);
        const s = this._slide = m.spring({
            from, to, velocity, damping, response: 0.35,
            onUpdate: (x) => this._placeSlide(x),
            onDone: () => { if (this._slide === s) this._settleSlide(); },
        });
    }

    /** End any slide: inline styles off, each panel back to the stylesheet. */
    _settleSlide() {
        if (this._slide) { this._slide.stop(); this._slide = null; }
        if (!this.hasAttribute("sliding")) return;
        this.removeAttribute("sliding");
        for (const el of [this._start, this._end]) { el.style.transform = ""; el.style.background = ""; }
    }

    /** The back swipe: a finger or a pen pulls the open item off to the
     *  right, 1:1 after 10px that are clearly sideways. Never from a field,
     *  a slider, [data-no-swipe] or anything that scrolls sideways itself. */
    _swipeDown(e) {
        if (e.pointerType === "mouse" || this._swipe || e.__sacSwipe) return;
        if (this.show !== "end" || !this._canSlide()) return;
        const path = e.composedPath();
        const stop = path.indexOf(this._end);
        for (let i = 0; i < stop; i++) {
            const n = path[i];
            if (n.nodeType !== 1) continue;
            if (n.matches(NO_SWIPE)) return;
            const cs = getComputedStyle(n);
            // A surface that takes the finger itself — a canvas someone paints
            // on, a pan-zoom viewport (touch-action: none) — or one that
            // scrolls sideways keeps its gesture.
            if (cs.touchAction === "none") return;
            if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(cs.overflowX)) return;
        }
        e.__sacSwipe = true;                       // an outer split leaves it to this one
        const caught = !!this._slide;
        if (caught) { this._slide.stop(); this._slide = null; }
        this._swipe = {
            id: e.pointerId, x0: e.clientX, y0: e.clientY,
            decided: caught, base: caught ? this._slideX : 0, x: caught ? this._slideX : 0,
            track: motion().tracker(),
        };
    }

    _swipeMove(e) {
        const s = this._swipe;
        if (!s || e.pointerId !== s.id) return;
        if (!s.decided) {
            const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
            if (Math.hypot(dx, dy) < 10) return;
            if (dx <= 0 || Math.abs(dx) <= Math.abs(dy) * 1.2) { this._swipe = null; return; }
            s.decided = true;
            s.x0 = e.clientX;                      // 1:1 from here — no jump by the slop
        }
        const m = motion();
        const raw = s.base + e.clientX - s.x0;
        s.x = raw < 0 ? m.rubberband(raw, this._end.getBoundingClientRect().width) : raw;
        this._placeSlide(s.x);
        s.track.add(s.x, e.timeStamp);
    }

    _swipeUp(e) {
        const s = this._swipe;
        if (!s || e.pointerId !== s.id) return;
        this._swipe = null;
        if (!s.decided) return;
        const m = motion();
        const w = this._end.getBoundingClientRect().width;
        const v = e.type === "pointerup" ? s.track.velocity(e.timeStamp) : 0;
        let leave = s.x + m.project(v) > w / 2;
        if (leave) {
            // The same question the back bar asks: an app may keep the item.
            const ev = new CustomEvent("sac:split-back", { bubbles: true, composed: true, cancelable: true });
            leave = this.dispatchEvent(ev);
        }
        if (leave) {
            this._swipeOwns = true;
            this.show = "start";
            this._swipeOwns = false;
        }
        this._slideTo(s.x, leave ? w : 0, v, !leave && Math.abs(v) > 400 ? 0.8 : 1);
    }

    /* -------------------------------------------------------------- pointer */

    _onPointerDown(e) {
        if (!e.isPrimary || e.button !== 0) return;

        // Double-click, detected by hand: the pointerdown below is
        // preventDefault()ed (that is what stops the browser from starting a
        // text selection across the panels), and canceling pointerdown makes
        // the native dblclick unreliable across engines.
        const near = Math.abs(e.clientX - this._lastX) < 6 && Math.abs(e.clientY - this._lastY) < 6;
        const isDouble = near && e.timeStamp - this._lastDown < 400;
        this._lastDown = e.timeStamp;
        this._lastX = e.clientX;
        this._lastY = e.clientY;

        e.preventDefault();
        // preventDefault() also suppressed the native focus — take it by hand.
        this._divider.focus({ preventScroll: true });

        if (isDouble) {
            this._lastDown = -Infinity;   // a third click starts a fresh pair
            this._set(this._initial === null ? 50 : this._initial, { emit: true });
            return;
        }

        const vertical = this._vertical();
        const s = this._start.getBoundingClientRect();
        const en = this._end.getBoundingClientRect();
        const d = this._divider.getBoundingClientRect();
        this._drag = {
            vertical,
            origin:    vertical ? s.top : s.left,
            available: vertical ? s.height + en.height : s.width + en.width,
            // Keep the grab point inside the divider — no jump on the first pixel.
            grab:      vertical ? e.clientY - d.top : e.clientX - d.left,
        };
        this._divider.setPointerCapture(e.pointerId);
        this.setAttribute("dragging", "");
    }

    _onPointerMove(e) {
        const d = this._drag;
        if (!d || !(d.available > 0)) return;
        const pos = d.vertical ? e.clientY : e.clientX;
        this._set((pos - d.grab - d.origin) / d.available * 100,
                  { emit: true, available: d.available });
    }

    _endDrag(e) {
        if (!this._drag) return;
        this._drag = null;
        this.removeAttribute("dragging");
        if (e && this._divider.hasPointerCapture(e.pointerId)) {
            this._divider.releasePointerCapture(e.pointerId);
        }
    }

    /* ------------------------------------------------------------- keyboard */

    _onKeyDown(e) {
        const vertical = this._vertical();
        const down = vertical ? "ArrowUp" : "ArrowLeft";
        const up   = vertical ? "ArrowDown" : "ArrowRight";
        const step = e.shiftKey ? 5 : 1;
        const cur  = this._current === null ? this._parse(this.getAttribute("position")) : this._current;

        let next;
        if (e.key === down)      next = cur - step;
        else if (e.key === up)   next = cur + step;
        else if (e.key === "Home") next = 0;      // _set clamps to the extreme
        else if (e.key === "End")  next = 100;
        else return;                              // the other axis still scrolls

        e.preventDefault();
        this._set(next, { emit: true });
    }

    /* --------------------------------------------------------------- render */

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    /* Grab zone. The hairline inside stays 1px whatever this is. */
                    --split-divider: 9px;

                    display: flex;
                    flex-direction: row;
                    box-sizing: border-box;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                }
                :host([direction="vertical"]) { flex-direction: column; }

                /* The cursor is on the host so it survives the pointer leaving
                   the 9px divider mid-drag (cursor inherits into the panels). */
                :host([dragging]) {
                    cursor: col-resize;
                    -webkit-user-select: none;
                    user-select: none;
                }
                :host([dragging][direction="vertical"]) { cursor: row-resize; }

                .pane {
                    /* min-*: 0 — without it a flex item refuses to go below its
                       content size and the divider stops halfway. */
                    min-width: 0;
                    min-height: 0;
                    overflow: auto;
                }
                /* A panel focused by script on a collapsed switch (_handFocus)
                   is a container: no ring. */
                .pane[tabindex="-1"]:focus { outline: none; }
                /* Sized panel: flex-basis is written by _set(), never grows or
                   shrinks on its own. */
                .start { flex: 0 0 auto; }
                /* Everything the start panel and the divider leave over. */
                .end   { flex: 1 1 0; }

                /* Scrollbar — the kit recipe (ui.css §5), re-stated because
                   ::-webkit-scrollbar does not pierce a shadow root. Firefox, which has
                   no ::-webkit-scrollbar, gets the standard pair instead. */
                .pane::-webkit-scrollbar { width: var(--scrollbar-size); height: var(--scrollbar-size); }
                .pane::-webkit-scrollbar-track { background: transparent; }
                .pane::-webkit-scrollbar-thumb {
                    background: var(--scrollbar-thumb);
                    background-clip: content-box;
                    border: var(--scrollbar-gap) solid transparent;
                    border-radius: 999px;
                }
                .pane::-webkit-scrollbar-thumb:hover {
                    background: var(--scrollbar-thumb-hover);
                    background-clip: content-box;
                }
                .pane::-webkit-scrollbar-corner { background: transparent; }
                @supports not selector(::-webkit-scrollbar) {
                    .pane { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) transparent; }
                }

                /* The divider takes ONE pixel of layout — the hairline
                   itself. Its grab zone (--split-divider) is an invisible
                   ::after laid OVER both panels, so no empty strip ever
                   stands between a panel's edge (or its scrollbar) and the
                   line. */
                .divider {
                    position: relative;
                    z-index: 1;              /* the grab zone overlays the end panel */
                    flex: 0 0 1px;
                    align-self: stretch;
                    box-sizing: border-box;
                    cursor: col-resize;
                    touch-action: none;      /* a touch drag resizes, never scrolls */
                }
                :host([direction="vertical"]) .divider { cursor: row-resize; }

                /* 1px hairline. A 1px accent line on hover/drag is the whole
                   feedback — no thick colored edge. */
                .divider::before {
                    content: "";
                    position: absolute;
                    inset: 0;
                    background: var(--border-strong);
                    transition: background 120ms var(--ease-smooth);
                }
                .divider::after {
                    content: "";
                    position: absolute;
                    inset: 0 calc((1px - var(--split-divider)) / 2);
                }
                :host([direction="vertical"]) .divider::after {
                    inset: calc((1px - var(--split-divider)) / 2) 0;
                }

                .divider:hover::before,
                .divider:focus-visible::before,
                :host([dragging]) .divider::before { background: var(--accent); }

                .divider:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 1px;
                }

                /* Collapsed: one panel at a time, full size. !important beats
                   the inline flex-basis _set() keeps writing. */
                :host([collapsed]) .divider { display: none; }
                :host([collapsed]) .pane { flex: 1 1 0 !important; }
                :host([collapsed]:not([show="end"])) .end { display: none; }
                :host([collapsed][show="end"]) .start { display: none; }

                /* Collapsed with a drawer rail in the start slot: the start
                   panel shrinks to nothing but stays rendered (a display:none
                   ancestor would hide the drawer too), the end panel is shown
                   whatever \`show\` says, and there is nothing to go back to. */
                :host([collapsed][rail-start]) .start {
                    display: block;
                    flex: 0 0 0 !important;
                    overflow: visible;
                }
                :host([collapsed][rail-start]) .end { display: block; }
                :host([collapsed][rail-start]) .back { display: none !important; }

                /* A slide between the two (opening an item, the back bar, the
                   back swipe): both stay rendered, the end panel above the
                   start one on the ground it hides, a shadow on its edge. */
                :host([collapsed][sliding]) { position: relative; overflow: hidden; }
                :host([collapsed][sliding]) .start { display: block; }
                :host([collapsed][sliding]) .end {
                    display: block;
                    position: absolute;
                    inset: 0;
                    z-index: 2;
                    box-shadow: var(--shadow-2);
                }
                /* Scrolls up and down natively; a sideways finger is the
                   back swipe (see _swipeDown). */
                :host([collapsed][show="end"]) .end { touch-action: pan-y pinch-zoom; }

                .back { display: none; }
                :host([collapsed][show="end"]:not([no-back])) .back {
                    display: flex;
                    position: sticky;
                    top: 0;
                    z-index: 1;
                    align-items: center;
                    padding: 0.35rem 0.5rem;
                    background: var(--glass-strong);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border-bottom: 1px solid var(--border);
                }
                .back button {
                    display: inline-flex;
                    align-items: center;
                    gap: 0.25rem;
                    min-height: 36px;
                    padding: 0 0.6rem 0 0.25rem;
                    border: none;
                    border-radius: var(--radius-m);
                    background: none;
                    color: var(--accent-text);
                    font: 600 0.85rem 'Inter', sans-serif;
                    cursor: pointer;
                    --icon-size: 18px;
                }
                .back button:hover { background: var(--hover); }
                /* Press: answers the moment it goes down. */
                .back button:active { background: var(--hover-strong); transition-duration: 0s; }
                .back button:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: -2px;
                }
                @media (pointer: coarse) {
                    .back button { min-height: 44px; }
                    /* A finger needs more than 9px: an invisible halo widens
                       the grab zone without moving the layout math. */
                    .divider::after { content: ""; position: absolute; inset: 0 -12px; }
                    :host([direction="vertical"]) .divider::after { inset: -12px 0; }
                }

                @media (prefers-reduced-motion: reduce) {
                    .divider::before { transition: none; }
                }
                /* Reduced transparency / more contrast: the blurred back bar
                   turns solid (same hue), its edge a clearly visible line. */
                @media (prefers-reduced-transparency: reduce) {
                    :host([collapsed][show="end"]:not([no-back])) .back {
                        background: var(--glass-solid);
                        backdrop-filter: none;
                        -webkit-backdrop-filter: none;
                    }
                }
                @media (prefers-contrast: more) {
                    :host([collapsed][show="end"]:not([no-back])) .back {
                        background: var(--glass-solid);
                        backdrop-filter: none;
                        -webkit-backdrop-filter: none;
                        border-bottom-color: var(--border-contrast);
                    }
                }
            </style>
            <div class="pane start"><slot name="start"></slot></div>
            <div class="divider" tabindex="0" role="separator"></div>
            <div class="pane end">
                <div class="back" part="back">
                    <button type="button"><sac-icon name="chevron-left"></sac-icon><span class="back-text"></span></button>
                </div>
                <slot name="end"></slot>
            </div>
        `;

        this._start   = this.shadowRoot.querySelector(".start");
        this._end     = this.shadowRoot.querySelector(".end");
        this._divider = this.shadowRoot.querySelector(".divider");
        this._backText = this.shadowRoot.querySelector(".back-text");
        // [drawer] is set on the rail by sac-nav after the fact: watch for it.
        this.shadowRoot.querySelector('slot[name="start"]')
            .addEventListener("slotchange", () => this._syncRailStart());
        new MutationObserver(() => this._syncRailStart())
            .observe(this, { attributes: true, subtree: true, attributeFilter: ["drawer", "slot"] });
        this.shadowRoot.querySelector(".back button").addEventListener("click", () => this.back());
        this._end.addEventListener("pointerdown", (e) => this._swipeDown(e));
        this._end.addEventListener("pointermove", (e) => this._swipeMove(e));
        this._end.addEventListener("pointerup", (e) => this._swipeUp(e));
        this._end.addEventListener("pointercancel", (e) => this._swipeUp(e));

        // Listeners live on the shadow-internal divider, so they die with the
        // shadow root: no document-level pointer handlers to leak, and nested
        // splits never see each other's drags.
        this._divider.addEventListener("pointerdown", (e) => this._onPointerDown(e));
        this._divider.addEventListener("pointermove", (e) => this._onPointerMove(e));
        this._divider.addEventListener("pointerup", (e) => this._endDrag(e));
        this._divider.addEventListener("pointercancel", (e) => this._endDrag(e));
        this._divider.addEventListener("lostpointercapture", (e) => this._endDrag(e));
        this._divider.addEventListener("keydown", (e) => this._onKeyDown(e));
    }
}

customElements.define("sac-split", SacSplit);
})();
