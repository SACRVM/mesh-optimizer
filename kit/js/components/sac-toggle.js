/**
 * <sac-toggle label="Pinned" checked>
 *
 * Custom switch. Fires `sac:change` with `e.detail = { value: boolean }`
 * (bubbles, NOT composed — like native change). Programmatic `.checked = …`
 * is silent.
 *
 * The checked state is styled purely via :host([checked]) — attribute
 * changes never re-render the shadow DOM (re-rendering would kill the
 * knob's slide transition; same in-place rule as sac-slider).
 *
 * Attributes:
 *   label    — text to the left of the switch.
 *   checked  — presence = on.
 *   disabled — presence = inert + dimmed, out of the tab order, fires nothing.
 *
 * Properties:
 *   checked  — get/set, reflects the attribute.
 *   disabled — get/set, reflects the attribute.
 *
 * Compact/touch: the whole row (label + switch) is the tap target; under
 * (pointer: coarse) the row is at least 44px tall. The switch itself keeps
 * its size. Nothing is hover-only.
 */
class SacToggle extends HTMLElement {
    static get observedAttributes() { return ["label", "checked", "disabled"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) {
            this.render();
            this.attach();
        }
    }

    attributeChangedCallback(name) {
        if (!this.shadowRoot.firstChild) return;
        if (name === "label") {
            const label = this.getAttribute("label") || "";
            const el = this.shadowRoot.querySelector(".label");
            if (el) el.textContent = label;
            this.setAttribute("aria-label", label);
        }
        // checked's look is pure :host([checked]) CSS; only the a11y state
        // needs syncing so a screen reader hears the switch flip.
        if (name === "checked") {
            this.setAttribute("aria-checked", this.checked ? "true" : "false");
        }
        if (name === "disabled") this._syncDisabled();
    }

    /** Disabled = out of the tab order, announced, and inert (CSS blocks the
     *  pointer; _toggle() blocks the keyboard). */
    _syncDisabled() {
        const off = this.disabled;
        this.setAttribute("aria-disabled", off ? "true" : "false");
        this.setAttribute("tabindex", off ? "-1" : "0");
    }

    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }

    get checked() { return this.hasAttribute("checked"); }
    set checked(v) {
        if (v) this.setAttribute("checked", "");
        else   this.removeAttribute("checked");
    }

    render() {
        const label = this.getAttribute("label") || "";
        // A real switch to assistive tech and the keyboard: role + state +
        // a tab stop + an accessible name. Author-set tabindex is respected.
        this.setAttribute("role", "switch");
        this.setAttribute("aria-checked", this.checked ? "true" : "false");
        if (!this.hasAttribute("tabindex")) this.setAttribute("tabindex", "0");
        if (label) this.setAttribute("aria-label", label);
        this._syncDisabled();
        const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0.25rem 0;
                    cursor: pointer;
                    color: var(--text);
                    font-size: 0.875rem;
                }
                :host(:focus-visible) {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                    border-radius: var(--radius-s);
                }
                :host([disabled]) { opacity: .5; pointer-events: none; }
                .label { user-select: none; }
                .switch {
                    position: relative;
                    width: 28px;
                    height: 14px;
                    background: color-mix(in srgb, var(--fg) 15%, transparent);
                    border-radius: 999px;
                    transition: background 0.2s;
                    flex-shrink: 0;
                }
                .knob {
                    position: absolute;
                    top: 1px; left: 1px;
                    width: 12px; height: 12px;
                    background: var(--text);
                    border-radius: 50%;
                    transition: transform 0.2s, background 0.2s;
                }
                :host([checked]) .switch { background: var(--accent); }
                :host([checked]) .knob   { transform: translateX(14px); background: var(--on-accent); }
                /* Touch: the whole row is the target (label included), so a
                   44px-tall row is the hit area — the 28px switch keeps its
                   look. */
                @media (pointer: coarse) {
                    :host { min-height: 44px; box-sizing: border-box; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .switch, .knob { transition: none; }
                }
            </style>
            <span class="label">${esc(label)}</span>
            <div class="switch"><div class="knob"></div></div>
        `;
    }

    _toggle() {
        if (this.disabled) return;
        this.checked = !this.checked;
        // Value control: sac:change with { value }, bubbles but NOT composed —
        // it mirrors native change/input and stays inside the consumer's tree.
        this.dispatchEvent(new CustomEvent("sac:change", {
            detail: { value: this.checked },
            bubbles: true,
            composed: false
        }));
    }

    attach() {
        this.addEventListener("click", () => this._toggle());
        this.addEventListener("keydown", (e) => {
            if (e.key === " " || e.key === "Enter") {
                e.preventDefault();   // Space would otherwise scroll the page
                this._toggle();
            }
        });
    }
}

customElements.define("sac-toggle", SacToggle);
