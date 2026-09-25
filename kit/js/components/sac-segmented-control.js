/**
 * <sac-segmented-control value="all">
 *   <button data-value="today">Today</button>
 *   <button data-value="week">Week</button>
 *   <button data-value="all">All</button>
 * </sac-segmented-control>
 *
 * Button group; one active at a time. Active state tracked via the `value`
 * attribute. Buttons live in the light DOM (slotted) so apps can put text,
 * icons or SVG inside them.
 *
 * Attributes:
 *   value    — currently-active data-value.
 *   disabled — presence = inert + dimmed, fires nothing, out of the tab order.
 *
 * Properties:
 *   value    — get/set; setting is SILENT (fires nothing), like every value control.
 *   disabled — get/set, reflects the attribute.
 *
 * Events:
 *   sac:change — e.detail = { value } (string), on user click/keypress only.
 *                Bubbles, NOT composed (native change semantics).
 *
 * Compact/touch: the control never runs past its container — too many
 * segments fold onto a second row (flex-wrap; nothing changes while they
 * fit). Under (pointer: coarse) each segment keeps its look and gets an
 * invisible 44px-tall hit halo; under (hover: none) no hover wash sticks to a
 * tapped segment.
 *
 * Theming: the active segment uses --accent. For an edit-mode group, set
 * `style="--accent: var(--accent-edit)"` on the control — the per-element
 * accent override is the intended mechanism (no hardcoded per-value colors).
 */
class SacSegmentedControl extends HTMLElement {
    static get observedAttributes() { return ["value", "disabled"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback()        { this.render(); this.attach(); }
    attributeChangedCallback() { if (this.shadowRoot.firstChild) this.applyActive(); }

    get value() { return this.getAttribute("value") || ""; }
    // Programmatic set is SILENT — matches every other value control. Only a
    // user click/keypress fires, via _commit().
    set value(v) { this.setAttribute("value", v); }

    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }

    _commit(v) {
        if (this.disabled) return;
        this.setAttribute("value", v);
        this.dispatchEvent(new CustomEvent("sac:change", {
            detail: { value: v }, bubbles: true, composed: false,
        }));
    }

    render() {
        this.setAttribute("role", "radiogroup");
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: inline-flex;
                    background: var(--field);
                    /* The hairline the input family already wears. Without it
                       the track vanishes on light ground and the inset active
                       segment reads as "shorter than the control". */
                    border: 1px solid var(--border);
                    border-radius: var(--radius-m);
                    padding: 2px;
                    gap: 2px;
                    /* Too many segments for the space (a phone, a narrow
                       window): fold onto a second row rather than run off the
                       edge. Changes nothing while the row fits. */
                    flex-wrap: wrap;
                    max-width: 100%;
                    box-sizing: border-box;
                }
                /* NOTE: document styles beat ::slotted() styles for slotted
                   light-DOM children regardless of specificity (CSS scoping
                   cascade order) — ui.css's global button rule would wipe
                   these. !important is the intended mechanism here. */
                ::slotted(button) {
                    padding: 0.35rem 0.75rem !important;
                    border: none !important;
                    background: transparent !important;
                    color: color-mix(in srgb, var(--fg) 78%, var(--bg)) !important;
                    border-radius: var(--radius-s);
                    cursor: pointer;
                    font-size: 0.85rem;
                    font-family: inherit;
                    transition: all 0.15s;
                }
                ::slotted(button:hover) {
                    background: var(--hover) !important;
                    color: var(--text) !important;
                }
                ::slotted(button.active),
                ::slotted(button.active:hover) {
                    background: var(--accent-fill) !important;
                    color: var(--on-accent) !important;
                }
                ::slotted(button:focus-visible) {
                    outline: 2px solid var(--accent) !important;
                    outline-offset: 1px;
                }
                @media (prefers-reduced-motion: reduce) {
                    ::slotted(button) { transition: none !important; }
                }
                :host([disabled]) { opacity: .5; pointer-events: none; }

                /* Touch: the segment keeps its look, an invisible halo takes
                   the hit area to 44px tall (min(): only a short axis grows).
                   !important for the same document-beats-::slotted reason. */
                @media (pointer: coarse) {
                    ::slotted(button) { position: relative !important; }
                    ::slotted(button)::after {
                        content: "";
                        position: absolute;
                        inset: min(0px, calc((100% - 44px) / 2));
                    }
                }
                /* No stuck hover wash on the segment a finger just tapped. */
                @media (hover: none) {
                    ::slotted(button:hover) {
                        background: transparent !important;
                        color: color-mix(in srgb, var(--fg) 78%, var(--bg)) !important;
                    }
                    ::slotted(button.active:hover) {
                        background: var(--accent-fill) !important;
                        color: var(--on-accent) !important;
                    }
                }
            </style>
            <slot></slot>
        `;
        this.applyActive();
    }

    _buttons() {
        return Array.from(this.querySelectorAll("button[data-value]"));
    }

    applyActive() {
        const value = this.value;
        const btns = this._buttons();
        // A radiogroup to assistive tech: each segment is a radio carrying its
        // checked state (not colour alone), and only the active one is a tab
        // stop — arrows move between them (roving tabindex).
        const anyChecked = btns.some((b) => b.dataset.value === value);
        const off = this.disabled;
        btns.forEach((btn, i) => {
            const on = btn.dataset.value === value;
            btn.classList.toggle("active", on);
            btn.setAttribute("role", "radio");
            btn.setAttribute("aria-checked", on ? "true" : "false");
            if (off) btn.setAttribute("aria-disabled", "true");
            else     btn.removeAttribute("aria-disabled");
            // Disabled: nothing is a tab stop; otherwise the roving pattern.
            btn.tabIndex = off ? -1 : (on || (!anyChecked && i === 0) ? 0 : -1);
        });
    }

    attach() {
        this.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-value]");
            if (!btn) return;
            this._commit(btn.dataset.value);
        });
        this.addEventListener("keydown", (e) => {
            const btns = this._buttons();
            if (!btns.length) return;
            let idx = btns.findIndex((b) => b.dataset.value === this.value);
            if (idx < 0) idx = 0;
            let next = null;
            switch (e.key) {
                case "ArrowRight": case "ArrowDown": next = (idx + 1) % btns.length; break;
                case "ArrowLeft":  case "ArrowUp":   next = (idx - 1 + btns.length) % btns.length; break;
                case "Home": next = 0; break;
                case "End":  next = btns.length - 1; break;
                default: return;
            }
            e.preventDefault();
            const btn = btns[next];
            this._commit(btn.dataset.value);   // radio pattern: moving selects
            btn.focus();
        });
    }
}

customElements.define("sac-segmented-control", SacSegmentedControl);
