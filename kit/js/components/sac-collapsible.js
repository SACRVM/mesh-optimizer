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
 *   .measure() — re-run overflow detection (slotchange + ResizeObserver
 *                cover the common cases already; this is an escape hatch)
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacCollapsible extends HTMLElement {
    static get observedAttributes() {
        return ["max-height", "more-label", "less-label", "expanded"];
    }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._overflow = false;
        this._ro = null;
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
        this._measure();
    }

    disconnectedCallback() {
        this._ro?.disconnect();
        this._ro = null;
    }

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
        if (!this._content) return;
        // Layout on the next frame so slotted custom elements have finished
        // connecting and their shadow content is sized.
        requestAnimationFrame(() => {
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
        this._content.classList.toggle("clamped", this._overflow && !expanded);
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
                    transition: color 0.1s, border-color 0.1s;
                }
                .toggle:hover {
                    color: var(--text);
                    border-color: var(--text-muted);
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
            </style>
            <div class="content"><slot></slot></div>
            <div class="divider"><button type="button" class="toggle" hidden>${t("collapsible.more", "more").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</button></div>
        `;
    }
}
customElements.define("sac-collapsible", SacCollapsible);
})();
