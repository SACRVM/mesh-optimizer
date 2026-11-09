/**
 * <sac-collapsible max-height="82px">
 *   …any children…
 * </sac-collapsible>
 *
 * Clamps its slotted content to a max-height, and when the content would
 * overflow, renders a thin separator line underneath with a small tab
 * hanging from it (labelled "more"/"less"). Click the tab to expand,
 * click again to collapse. The clamped region has a short gradient fade
 * at the bottom so the clipped edge doesn't feel hard.
 *
 * Why it's a component:
 * The separator-line + hanging-tab + fade + overflow-detection combo recurs
 * wherever we want "show the first bit, reveal the rest on demand". Keeping
 * all four pieces together means consumers don't reinvent the measurement
 * dance or get the fade vs. border layering wrong.
 *
 * Attributes:
 *   max-height  — CSS length for the clamped state (default 82px)
 *   more-label  — tab text when collapsed (default "more")
 *   less-label  — tab text when expanded (default "less")
 *   expanded    — presence = start expanded / currently expanded
 *
 * Events:
 *   sac:toggle — detail { expanded: boolean }, bubbles + composed.
 *
 * Compact/touch: the tab is a plain click target; under (pointer: coarse) it
 * gets an invisible 44 x 44 hit halo, under (hover: none) no hover tint
 * sticks after a tap. The clamp and the ResizeObserver re-measure cover a
 * phone rotating or a panel narrowing.
 *
 * Imperative API:
 *   .expanded — get/set, reflects the attribute
 *   .measure() — re-run overflow detection (slotchange, a change anywhere
 *                in the content and a ResizeObserver cover the common cases
 *                already; this is an escape hatch)
 *
 * Keyboard and assistive tech (2.36):
 *   - The tab is a button with aria-expanded and aria-controls (the content).
 *   - What the clamp hides cannot be reached either: while collapsed,
 *     everything in the content that is not wholly above the clip line is
 *     inert — no Tab stop, no screen-reader cursor, no click in the faded
 *     edge. A box cut by the line is opened up and its children judged one
 *     by one, so a visible chip in a wrapper that runs on stays live; plain
 *     text is never touched. Expanding gives it all back (only what the
 *     component set — elements inert already are left alone). Collapsing
 *     with focus inside a part that goes inert moves focus to the tab.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

    /** A control on its own: inert as a whole when the clip line cuts it. */
    const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex], ' +
        '[contenteditable]:not([contenteditable="false"])';

    /** The focused element itself, down through every open shadow root. */
    const deepActive = () => {
        let a = document.activeElement;
        while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
        return a;
    };

    /** `node` sits inside `box` as rendered (slots followed, shadow roots
     *  left through their host). */
    const within = (node, box) => {
        for (let n = node; n; n = n.assignedSlot || n.parentNode || n.host) if (n === box) return true;
        return false;
    };

class SacCollapsible extends HTMLElement {
    static get observedAttributes() {
        return ["max-height", "more-label", "less-label", "expanded"];
    }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._overflow = false;
        this._ro = null;
        this._inerted = [];       // what _syncInert() made inert — and only that
        this._frame = 0;
    }

    connectedCallback() {
        this.render();
        this._content = this.shadowRoot.querySelector(".content");
        this._toggle  = this.shadowRoot.querySelector(".toggle");
        this._toggle.addEventListener("click", () => this.toggle());
        const slot = this.shadowRoot.querySelector("slot");
        slot.addEventListener("slotchange", () => this._measure());
        // ResizeObserver catches pane width changes that make the flex
        // content wrap to a different row count. Without this the content
        // could silently overflow (or stop overflowing) after a window
        // resize and the tab state would be stale.
        this._ro = new ResizeObserver(() => this._measure());
        this._ro.observe(this._content);
        // A change deeper than slotchange sees (chips added inside a
        // wrapper): clamped, the box keeps its size, so the observer above
        // stays quiet — but the new parts may need to go inert.
        this._mo = new MutationObserver(() => this._measure());
        this._mo.observe(this, { childList: true, subtree: true });
        // A clamp shows the top, never a middle slice — not even when
        // something focuses a clipped part the inert pass cannot reach (a
        // control inside another component's shadow root).
        this._content.addEventListener("scroll", () => {
            if (this._content.classList.contains("clamped") && this._content.scrollTop) this._content.scrollTop = 0;
        }, { passive: true });
        this._measure();
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    disconnectedCallback() {
        this._ro?.disconnect();
        this._ro = null;
        this._mo?.disconnect();
        this._mo = null;
        cancelAnimationFrame(this._frame);
        this._frame = 0;
        this._releaseInert();
        if (this._offLang) { this._offLang(); this._offLang = null; }
    }

    /** Language switch: the more/less tab text, in place (state untouched). */
    _relabel() { this._apply(); }

    attributeChangedCallback(name) {
        if (!this._content) return;
        if (name === "max-height") {
            this._applyMaxHeight();
            this._measure();
        } else {
            // labels or expanded state — just re-apply, no measurement.
            this._apply();
        }
    }

    get expanded() { return this.hasAttribute("expanded"); }
    set expanded(v) {
        if (v) this.setAttribute("expanded", "");
        else   this.removeAttribute("expanded");
    }

    toggle() {
        this.expanded = !this.expanded;
        this.dispatchEvent(new CustomEvent("sac:toggle", {
            detail:   { expanded: this.expanded },
            bubbles:  true,
            composed: true,
        }));
    }

    measure() { this._measure(); }

    _measure() {
        if (!this._content || this._frame) return;
        // Layout on the next frame so slotted custom elements have finished
        // connecting and their shadow content is sized. One pass per frame,
        // however many changes asked for it.
        this._frame = requestAnimationFrame(() => {
            this._frame = 0;
            if (!this._content) return;
            this._content.classList.remove("clamped");
            const natural = this._content.scrollHeight;
            this._content.classList.add("clamped");
            const clamped = this._content.clientHeight;
            this._content.classList.remove("clamped");
            this._overflow = natural > clamped + 1;
            this._apply();
        });
    }

    _apply() {
        if (!this._content) return;
        const expanded = this.expanded;
        const more = this.getAttribute("more-label") || t("collapsible.more", "more");
        const less = this.getAttribute("less-label") || t("collapsible.less", "less");
        this._toggle.textContent = expanded ? less : more;
        this._toggle.hidden = !this._overflow;
        this._toggle.setAttribute("aria-expanded", String(expanded));
        this._content.classList.toggle("clamped", this._overflow && !expanded);
        this._syncInert();
    }

    /** Give back what _syncInert() set — nothing else. */
    _releaseInert() {
        this._inerted.forEach((el) => { el.inert = false; });
        this._inerted = [];
    }

    /** Collapsed: everything not wholly above the clip line turns inert (see
     *  the header). A box cut by the line is opened up and its children
     *  judged one by one; a control (or a component with no light children)
     *  cut by it goes inert whole; plain text is left alone. */
    _syncInert() {
        const focused = deepActive();
        this._releaseInert();
        if (!this._content.classList.contains("clamped")) return;
        this._content.scrollTop = 0;
        const clip = this._content.getBoundingClientRect().bottom;
        const visit = (el) => {
            if (el.inert) return;                          // inert already: not ours to touch
            const r = el.getBoundingClientRect();
            const box = r.width > 0 || r.height > 0;       // none: display contents / none
            if (box && r.bottom <= clip + 0.5) return;     // wholly visible: live
            const kids = el.children.length > 0;
            const control = el.matches(FOCUSABLE);
            if (kids && !control && (!box || r.top < clip - 0.5)) {
                Array.from(el.children).forEach(visit);
                return;
            }
            if (!kids && !control && !el.shadowRoot) return;   // plain text: nothing to reach
            el.inert = true;
            this._inerted.push(el);
        };
        this.shadowRoot.querySelector("slot").assignedElements({ flatten: true }).forEach(visit);
        // Collapsed with focus in a part that just went inert: it would
        // fall to <body>. The tab that collapsed it takes it.
        if (focused && this._inerted.some((el) => within(focused, el))) {
            this._toggle.focus({ preventScroll: true });
        }
    }

    _applyMaxHeight() {
        const mh = this.getAttribute("max-height") || "82px";
        this._content.style.setProperty("--sac-collapsible-max-height", mh);
    }

    render() {
        const mh = this.getAttribute("max-height") || "82px";
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; }
                .content {
                    --sac-collapsible-max-height: ${mh};
                    position: relative;
                }
                .content.clamped {
                    max-height: var(--sac-collapsible-max-height);
                    overflow: hidden;
                }
                /* Air between the last content row and the divider line —
                 * except while clamped, where the fade runs right into the
                 * line by design ("it continues below"). margin, not padding:
                 * margins stay out of scrollHeight, so the overflow
                 * measurement is unaffected. */
                .content:not(.clamped) { margin-bottom: 6px; }
                /* Short fade into the panel colour so the clipped row doesn't
                 * end in a hard line. Sits inside the padding box, so it
                 * softens the content without touching the divider below. */
                .content.clamped::after {
                    content: "";
                    position: absolute;
                    inset: auto 0 0 0;
                    height: 6px;
                    background: linear-gradient(to bottom, transparent, var(--panel));
                    pointer-events: none;
                }
                .divider {
                    display: flex;
                    justify-content: center;
                    border-top: 1px solid var(--border);
                    transition: border-top-color 0.1s;
                }
                /* Hovering the tab tints the full separator line so the
                 * tab + line read as one affordance. */
                .divider:has(.toggle:hover) {
                    border-top-color: var(--text-muted);
                }
                /* The tab hangs from the divider line like a drawer pull:
                 * -1px top margin drops it onto the line, top border is
                 * suppressed (the divider's border-top serves), only the
                 * bottom corners are rounded. */
                .toggle {
                    margin-top: -1px;
                    margin-bottom: 6px;
                    background: var(--panel);
                    border: 1px solid var(--border);
                    border-top: none;
                    border-radius: 0 0 var(--radius-m) var(--radius-m);
                    padding: 2px 14px 3px;
                    color: var(--text-muted);
                    font: inherit;
                    font-size: 11px;
                    line-height: 1.3;
                    cursor: pointer;
                    transition: color 0.1s, border-color 0.1s, transform 0.2s var(--ease-smooth);
                    transform-origin: top;   /* the press keeps it on the line */
                }
                .toggle:hover {
                    color: var(--text);
                    border-color: var(--text-muted);
                }
                /* Press: the tab gives under the pointer the moment it goes down. */
                .toggle:active {
                    transform: scale(0.97);
                    transition-duration: 0.1s;
                }
                .toggle[hidden] { display: none !important; }

                /* Touch: the hanging tab keeps its small look; an invisible
                   halo takes it to 44 x 44 (min(): only a short axis grows).
                   It reaches ~12px up over the clamped content's last line —
                   that line is faded and not interactive, so nothing is lost. */
                @media (pointer: coarse) {
                    .toggle { position: relative; }
                    .toggle::after {
                        content: "";
                        position: absolute;
                        inset: min(0px, calc((100% - 44px) / 2));
                    }
                }
                @media (hover: none) {
                    .divider:has(.toggle:hover) { border-top-color: var(--border); }
                    .toggle:hover { color: var(--text-muted); border-color: var(--border); }
                }
                @media (prefers-reduced-motion: reduce) {
                    .toggle { transition: none; }
                }
            </style>
            <div class="content" id="content"><slot></slot></div>
            <div class="divider"><button type="button" class="toggle" aria-controls="content" aria-expanded="false" hidden>${t("collapsible.more", "more").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</button></div>
        `;
    }
}
customElements.define("sac-collapsible", SacCollapsible);
})();
