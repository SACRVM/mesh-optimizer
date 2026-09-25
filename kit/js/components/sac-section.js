/**
 * <sac-section title="FILTERS">
 *   …controls…
 * </sac-section>
 *
 * Sidebar group separator: uppercase title + thin underline.
 *
 * Attributes:
 *   title — uppercase heading text. Rendered at --text — a group heading is
 *           meant to stand out from the labels it heads (AA with room to spare;
 *           never the tertiary --text-dim, which failed AA at this size).
 *
 * CSS parts (style from the light DOM, e.g. sac-section::part(title) { … }):
 *   title — the heading.   body — the slotted content wrapper.
 */
class SacSection extends HTMLElement {
    static get observedAttributes() { return ["title"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback()        { this.render(); }
    attributeChangedCallback() { this.render(); }

    render() {
        const title = this.getAttribute("title") || "";
        // Escape: the heading is injected into innerHTML, and an app may set it
        // from dynamic data (a user-named group). Same rule as the rest of the kit.
        const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    margin-bottom: 1.5rem;
                }
                /* Shares the caption shape (ui.css --caption-* tokens) with the
                   .sac-caption light-DOM utility, so the two never drift. The
                   heading lifts the colour to --text and adds the underline. */
                .title {
                    font-family: var(--caption-font);
                    font-size: var(--caption-size);
                    font-weight: var(--caption-weight);
                    letter-spacing: var(--caption-tracking);
                    text-transform: uppercase;
                    color: var(--text);
                    margin-bottom: 0.75rem;
                    padding-bottom: 0.5rem;
                    border-bottom: 1px solid var(--border);
                }
                .body {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                }
            </style>
            <div class="title" part="title">${esc(title)}</div>
            <div class="body" part="body"><slot></slot></div>
        `;
    }
}

customElements.define("sac-section", SacSection);
