/**
 * <sac-icon name="...">
 *
 * Inline SVG icon. Resolves `name` against the sac.icons registry (icons.js).
 * Size via CSS custom property --icon-size (default 24px).
 * Color via currentColor (inherits from parent).
 *
 * Attributes:
 *   name — lookup key in the sac.icons registry.
 *
 * Example:
 *   <sac-icon name="note"></sac-icon>
 *   <sac-icon name="cube" style="--icon-size: 48px;"></sac-icon>
 */
class SacIcon extends HTMLElement {
    static get observedAttributes() { return ["name"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback() { this.render(); }
    attributeChangedCallback() { this.render(); }

    render() {
        const name = this.getAttribute("name");
        const path = (window.sac && sac.icons) ? sac.icons.get(name) : null;
        const isFilled = (window.sac && sac.icons) ? sac.icons.isFilled(name) : false;

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: inline-flex;
                    width: var(--icon-size, 24px);
                    height: var(--icon-size, 24px);
                    vertical-align: middle;
                }
                svg {
                    width: 100%;
                    height: 100%;
                    display: block;
                }
            </style>
            ${path
                ? (isFilled
                    ? `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">${path}</svg>`
                    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                         ${path}
                       </svg>`)
                : ``}
        `;
    }
}

customElements.define("sac-icon", SacIcon);
