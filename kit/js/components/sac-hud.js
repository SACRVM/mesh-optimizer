/**
 * <sac-hud position="top-right">...</sac-hud>
 *
 * Small info overlay positioned absolutely inside a relative parent
 * (typically a .viewport). Hidden when empty (a MutationObserver watches
 * the content), pointer-events: none so it never blocks the canvas.
 *
 * Attributes:
 *   position — top-left | top-right | bottom-left | bottom-right
 *              (default top-right)
 */
class SacHud extends HTMLElement {
    static get observedAttributes() { return ["position"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
        this.render();
        this.updateVisibility();
        this.observer = new MutationObserver(() => this.updateVisibility());
        this.observer.observe(this, { childList: true, subtree: true, characterData: true });
    }

    disconnectedCallback() {
        if (this.observer) this.observer.disconnect();
    }

    attributeChangedCallback() { if (this.shadowRoot.firstChild) this.render(); }

    updateVisibility() {
        this.style.display = this.textContent.trim() ? "block" : "none";
    }

    render() {
        const pos = this.getAttribute("position") || "top-right";
        const positions = {
            "top-left":     "top: 1rem; left: 1rem;",
            "top-right":    "top: 1rem; right: 1rem;",
            "bottom-left":  "bottom: 1rem; left: 1rem;",
            "bottom-right": "bottom: 1rem; right: 1rem;"
        };
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    position: absolute;
                    ${positions[pos] || positions["top-right"]}
                    background: var(--glass-strong);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    border: 1px solid var(--border-strong);
                    border-radius: var(--radius-l);
                    padding: 0.5rem 0.75rem;
                    color: color-mix(in srgb, var(--fg) 78%, var(--bg));
                    font-size: 0.8rem;
                    font-family: ui-monospace, 'Cascadia Mono', 'Courier New', monospace;
                    pointer-events: none;
                    z-index: 10;
                }
            </style>
            <slot></slot>
        `;
    }
}

customElements.define("sac-hud", SacHud);
