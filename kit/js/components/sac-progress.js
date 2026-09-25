/**
 * <sac-progress value="40" max="100" label="Upload">
 * <sac-progress indeterminate>
 *
 * Horizontal progress bar. Determinate by default — bar width and the
 * percentage readout track value/max. Add [indeterminate] for an endless
 * slide animation when progress can't be measured (the percentage hides
 * itself in that mode).
 *
 * IMPORTANT implementation constraint (same as sac-slider): attribute
 * changes update the shadow DOM IN PLACE — never re-render it.
 *
 * Attributes:
 *   value          — current progress (default 0).
 *   max            — upper bound (default 100).
 *   label          — optional heading text. When set, a header row appears
 *                     above the track: label left, percentage right. With
 *                     no label attribute the row is omitted entirely.
 *   indeterminate  — presence switches to the endless-slide animation;
 *                     value/max stop driving the bar width, percentage
 *                     is hidden.
 *
 * Properties:
 *   value — get/set, reflects the attribute (string).
 *
 * Host reflects ARIA progressbar semantics: role="progressbar",
 * aria-valuemin/aria-valuemax always set, aria-valuenow tracks value and
 * is removed while indeterminate.
 */
class SacProgress extends HTMLElement {
    static get observedAttributes() { return ["value", "max", "label", "indeterminate"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
        if (!this.hasAttribute("role")) this.setAttribute("role", "progressbar");
        this._sync();
    }

    attributeChangedCallback() {
        if (this.shadowRoot.firstChild) this._sync();
    }

    get value() { return this.getAttribute("value") || "0"; }
    set value(v) { this.setAttribute("value", String(v)); }

    /** Update label/percentage/bar width + ARIA in place. */
    _sync() {
        const bar   = this.shadowRoot.getElementById("bar");
        const label = this.shadowRoot.getElementById("label");
        const pct   = this.shadowRoot.getElementById("pct");
        if (!bar) return;

        const max   = parseFloat(this.getAttribute("max")) || 100;
        const raw   = parseFloat(this.getAttribute("value")) || 0;
        const value = Math.min(max, Math.max(0, raw));
        const ratio = max > 0 ? (value / max) * 100 : 0;

        if (label) label.textContent = this.getAttribute("label") || "";
        if (pct) pct.textContent = `${Math.round(ratio)}%`;
        if (!this.hasAttribute("indeterminate")) bar.style.width = `${ratio}%`;

        this.setAttribute("aria-valuemin", "0");
        this.setAttribute("aria-valuemax", String(max));
        if (this.hasAttribute("indeterminate")) this.removeAttribute("aria-valuenow");
        else this.setAttribute("aria-valuenow", String(value));
    }

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; }

                .row {
                    display: flex;
                    justify-content: space-between;
                    font-size: 0.8rem;
                    color: color-mix(in srgb, var(--fg) 78%, var(--bg));
                    margin-bottom: 0.3rem;
                }
                /* No label attr → no header row at all (not just hidden text). */
                :host(:not([label])) .row { display: none; }

                .pct { color: var(--accent); font-weight: 600; }
                :host([indeterminate]) .pct { display: none; }

                .track {
                    height: 6px;
                    border-radius: var(--radius-s);
                    background: color-mix(in srgb, var(--fg) 10%, transparent);
                    overflow: hidden;
                }
                .bar {
                    height: 100%;
                    width: 0%;
                    border-radius: var(--radius-s);
                    background: var(--accent);
                    transition: width 0.2s var(--ease-smooth);
                }
                :host([indeterminate]) .bar {
                    width: 30%;
                    transition: none;
                    animation: sac-progress-slide 1.4s var(--ease-smooth) infinite;
                }

                @keyframes sac-progress-slide {
                    from { transform: translateX(-100%); }
                    to   { transform: translateX(333%); }
                }

                @media (prefers-reduced-motion: reduce) {
                    .bar { transition: none; }
                    :host([indeterminate]) .bar {
                        animation: none;
                        transform: none;
                        width: 100%;
                        opacity: 0.5;
                    }
                }
            </style>
            <div class="row">
                <span class="label" id="label"></span>
                <span class="pct" id="pct"></span>
            </div>
            <div class="track">
                <div class="bar" id="bar"></div>
            </div>
        `;
    }
}

customElements.define("sac-progress", SacProgress);
