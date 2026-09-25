/**
 * <sac-scene-graph> + <sac-scene-item>  —  tree list.
 *
 * Generic hierarchical list with visibility toggles, color wells, delete
 * buttons and expand chevrons — used for scene graphs, layer lists, any
 * tree of toggleable things.
 *
 *   <sac-scene-graph>
 *     <sac-scene-item id="obj-1" label="Group" visible expandable>
 *       <sac-scene-item id="obj-2" label="Mesh" visible color="#3b82f6" can-delete></sac-scene-item>
 *     </sac-scene-item>
 *   </sac-scene-graph>
 *
 * <sac-scene-item> attributes:
 *   label      — display text (default "Unnamed").
 *   visible    — presence = eye open.
 *   color      — hex color; renders a color well.
 *   can-delete — renders a trash button.
 *   active     — selected state.
 *   expanded   — children shown.
 *   expandable — keeps the chevron on a row whose children are built lazily.
 *
 * NOTE: the element's `id` attribute is used as the data id in every event
 * detail — give each item a meaningful id.
 *
 * Events (all bubble + composed, detail.id = element id):
 *   sac:select     — detail also carries `additive` (ctrl/cmd) and `range`
 *                    (shift) so a host can build multi-selection without
 *                    re-implementing hit detection.
 *   sac:visibility — detail.visible = the REQUESTED new state.
 *   sac:expand     — detail.expanded.
 *   sac:delete
 *   sac:recolor    — detail.color.
 *
 * Compact/touch: under (pointer: coarse) every row is 44px tall and each
 * control (chevron, eye, color well, trash) is a 44 x 44px target with the
 * same small glyph — real boxes, not overlapping halos, because the controls
 * sit side by side. Every action is always visible (none is hover-revealed);
 * under (hover: none) the sticky hover tint and the color well's hover zoom
 * are switched off so a tapped row does not stay lit.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

    // Shared by render() and the in-place visibility toggle.
    const EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    const EYE_CLOSED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

class SacSceneGraph extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    width: 100%;
                    overflow-x: hidden;
                    font-family: 'Inter', sans-serif;
                }
            </style>
            <slot></slot>
        `;
    }
}

class SacSceneItem extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    static get observedAttributes() {
        return ['label', 'visible', 'color', 'can-delete', 'active', 'expanded', 'expandable'];
    }

    get visible() { return this.hasAttribute('visible'); }
    set visible(val) { if (val) this.setAttribute('visible', ''); else this.removeAttribute('visible'); }

    get expanded() { return this.hasAttribute('expanded'); }
    set expanded(val) { if (val) this.setAttribute('expanded', ''); else this.removeAttribute('expanded'); }

    get active() { return this.hasAttribute('active'); }
    set active(val) { if (val) this.setAttribute('active', ''); else this.removeAttribute('active'); }

    connectedCallback() {
        this.render();
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
    }

    /** Runtime language switch: the control labels (and the "Unnamed"
     *  placeholder) in place — no re-render, so focus and the colour
     *  input's transient state survive. */
    _relabel() {
        const root = this.shadowRoot;
        if (!root.firstChild) return;
        const set = (sel, text) => { const el = root.querySelector(sel); if (el) el.setAttribute('aria-label', text); };
        set('#btn-expand', t('scene.expand', 'Expand / collapse'));
        set('#btn-visibility', t('scene.visibility', 'Toggle visibility'));
        set('#btn-delete', t('scene.delete', 'Delete'));
        set('#item-color', t('scene.color', 'Color'));
        if (!this.getAttribute('label')) {
            const unnamed = t('scene.unnamed', 'Unnamed');
            const text = root.querySelector('#item-label');
            if (text) text.textContent = unnamed;
            set('.item-row', unnamed);
        }
    }

    attributeChangedCallback(name) {
        const row = this.shadowRoot.firstChild && this.shadowRoot.querySelector('.item-row');
        // The interaction-driven attributes update IN PLACE — a full re-render
        // on every eye/select/expand click would rebuild the row, drop the
        // colour input's transient state and re-bind handlers for nothing.
        // Structural attributes (label, colour, can-delete, expandable) still
        // re-render, and the first paint happens in connectedCallback.
        if (!row) return;
        if (name === 'active') {
            row.classList.toggle('active', this.active);
            row.setAttribute('aria-selected', this.active ? 'true' : 'false');
            return;
        }
        if (name === 'expanded') {
            row.classList.toggle('expanded', this.expanded);
            if (row.hasAttribute('aria-expanded'))
                row.setAttribute('aria-expanded', this.expanded ? 'true' : 'false');
            const kids = this.shadowRoot.querySelector('.children');
            if (kids) kids.style.display = this.expanded ? 'block' : 'none';
            return;
        }
        if (name === 'visible') {
            const btn = this.shadowRoot.querySelector('#btn-visibility');
            if (btn) {
                btn.setAttribute('aria-pressed', this.visible ? 'true' : 'false');
                btn.innerHTML = this.visible ? EYE_OPEN : EYE_CLOSED;
            }
            return;
        }
        this.render();
    }

    render() {
        const label = this.getAttribute('label') || t('scene.unnamed', 'Unnamed');
        const color = this.getAttribute('color');
        const canDelete = this.hasAttribute('can-delete');
        // Item labels are user data (object/layer names) written into innerHTML
        // and re-rendered on every attribute change — escape both the text and
        // the color that feeds an attribute value.
        const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const safeColor = /^#[0-9a-f]{3,8}$/i.test(color || '') ? color : '#000000';
        // Kit strings for the control labels.
        const L = {
            expand:  t('scene.expand', 'Expand / collapse'),
            visible: t('scene.visibility', 'Toggle visibility'),
            del:     t('scene.delete', 'Delete'),
            colorL:  t('scene.color', 'Color'),
        };
        // `expandable` keeps the chevron on a row whose children are built
        // lazily (children only detected once you actually expand it).
        const isNested = this.children.length > 0 || this.hasAttribute('expandable');

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    width: 100%;
                }
                .item-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 8px;
                    border-radius: var(--radius-m);
                    cursor: pointer;
                    transition: background 0.2s;
                    user-select: none;
                    /* Reserve the selected state's border on EVERY row —
                       otherwise selecting a row makes it 2px taller and the
                       whole list jumps. */
                    border: 1px solid transparent;
                }
                .item-row:hover {
                    background: color-mix(in srgb, var(--fg) 5%, transparent);
                }
                .item-row.active {
                    background: color-mix(in srgb, var(--accent) 20%, transparent);
                    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
                }
                .icon {
                    width: 14px;
                    height: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0.7;
                    transition: opacity 0.2s;
                }
                /* The action controls are real <button>s (focusable, keyboard-
                   operable, labelled) wearing the .icon look — reset the chrome. */
                button.icon {
                    background: none;
                    border: none;
                    padding: 0;
                    margin: 0;
                    color: inherit;
                    cursor: pointer;
                }
                .icon:hover { opacity: 1; }
                .item-row:focus-visible,
                button.icon:focus-visible,
                input[type="color"]:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 1px;
                }
                .label {
                    flex-grow: 1;
                    font-size: 0.75rem;
                    font-weight: 500;
                    color: color-mix(in srgb, var(--fg) 80%, var(--bg));
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .active .label { color: var(--text); }
                .chevron {
                    width: 12px;
                    height: 12px;
                    transition: transform 0.2s;
                    opacity: 0.5;
                }
                .expanded .chevron { transform: rotate(90deg); }
                .children {
                    display: ${this.expanded ? 'block' : 'none'};
                    padding-left: 14px;
                    border-left: 1px solid color-mix(in srgb, var(--fg) 5%, transparent);
                    margin-left: 6px;
                }
                input[type="color"] {
                    width: 14px;
                    height: 14px;
                    padding: 0;
                    border: 1px solid color-mix(in srgb, var(--fg) 40%, transparent);
                    background: none;
                    cursor: pointer;
                    border-radius: var(--radius-s);
                    box-shadow: 0 0 3px color-mix(in srgb, var(--sink) 50%, transparent);
                    transition: transform 0.1s;
                }
                input[type="color"]:hover {
                    transform: scale(1.2);
                    border-color: var(--text);
                }
                /* The color input's hit box. Invisible on a mouse (contents),
                   the 44px target on touch. A <label> so a tap anywhere on it
                   opens the picker. */
                .well { display: contents; }
                .spacer { width: 12px; }
                @media (pointer: coarse) {
                    .item-row { min-height: 44px; padding: 0 4px; gap: 0; }
                    button.icon, .well, .spacer {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        width: 44px;
                        height: 44px;
                        flex: none;
                    }
                    button.icon svg { width: 16px; height: 16px; }
                    .label { padding: 0 4px; }
                    input[type="color"] { width: 20px; height: 20px; }
                }
                @media (hover: none) {
                    /* A tap leaves :hover stuck until the next tap elsewhere. */
                    .item-row:not(.active):hover { background: none; }
                    input[type="color"]:hover {
                        transform: none;
                        border-color: color-mix(in srgb, var(--fg) 40%, transparent);
                    }
                }
                @media (prefers-reduced-motion: reduce) {
                    .item-row, .icon, .chevron, input[type="color"] { transition: none; }
                }
            </style>
            <div class="item-row ${this.active ? 'active' : ''} ${this.expanded ? 'expanded' : ''}"
                 role="treeitem" tabindex="0"
                 aria-label="${escText(label).replace(/"/g, '&quot;')}"
                 aria-selected="${this.active ? 'true' : 'false'}"
                 ${isNested ? `aria-expanded="${this.expanded ? 'true' : 'false'}"` : ''}>
                ${isNested ? `
                    <button type="button" class="chevron icon" id="btn-expand" aria-label="${escText(L.expand)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                ` : '<div class="spacer"></div>'}

                <button type="button" class="icon" id="btn-visibility" aria-label="${escText(L.visible)}" aria-pressed="${this.visible ? 'true' : 'false'}">
                    ${this.visible ? EYE_OPEN : EYE_CLOSED}
                </button>

                <div class="label" id="item-label">${escText(label)}</div>

                ${color ? `<label class="well"><input type="color" value="${safeColor}" id="item-color" aria-label="${escText(L.colorL)}"></label>` : ''}

                ${canDelete ? `
                    <button type="button" class="icon" id="btn-delete" aria-label="${escText(L.del)}" style="opacity: 0.4">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                ` : ''}
            </div>
            <div class="children">
                <slot></slot>
            </div>
        `;

        const row = this.shadowRoot.querySelector('.item-row');

        // Keyboard on the row itself (a treeitem): Enter/Space selects,
        // Right/Left open and close a nested row. The action buttons are
        // natural tab stops and operate with Enter/Space on their own.
        row.onkeydown = (e) => {
            if (e.target !== row) return;   // let a focused button handle its own keys
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.dispatchEvent(new CustomEvent('sac:select', {
                    detail: { id: this.id, additive: e.ctrlKey || e.metaKey, range: e.shiftKey },
                    bubbles: true, composed: true
                }));
            } else if (e.key === 'ArrowRight' && isNested && !this.expanded) {
                e.preventDefault();
                this.expanded = true;
                this.dispatchEvent(new CustomEvent('sac:expand', { detail: { id: this.id, expanded: true }, bubbles: true, composed: true }));
            } else if (e.key === 'ArrowLeft' && isNested && this.expanded) {
                e.preventDefault();
                this.expanded = false;
                this.dispatchEvent(new CustomEvent('sac:expand', { detail: { id: this.id, expanded: false }, bubbles: true, composed: true }));
            }
        };

        row.onclick = (e) => {
            const path = e.composedPath();
            if (path.some(el => el.id === 'btn-visibility')) {
                this.dispatchEvent(new CustomEvent('sac:visibility', { detail: { id: this.id, visible: !this.visible }, bubbles: true, composed: true }));
            } else if (path.some(el => el.id === 'btn-expand')) {
                this.expanded = !this.expanded;
                this.dispatchEvent(new CustomEvent('sac:expand', { detail: { id: this.id, expanded: this.expanded }, bubbles: true, composed: true }));
            } else if (path.some(el => el.id === 'btn-delete')) {
                this.dispatchEvent(new CustomEvent('sac:delete', { detail: { id: this.id }, bubbles: true, composed: true }));
            } else if (path.some(el => el.id === 'item-color' || (el.classList && el.classList.contains('well')))) {
                // Color change handled by onchange below. A tap on the well's
                // margin reaches the label first — not a row select either.
            } else {
                // Modifier hints so a host can build multi-selections without
                // re-implementing hit detection: `additive` = toggle one
                // (ctrl/cmd), `range` = span from the last anchor (shift).
                this.dispatchEvent(new CustomEvent('sac:select', {
                    detail: { id: this.id, additive: e.ctrlKey || e.metaKey, range: e.shiftKey },
                    bubbles: true, composed: true
                }));
            }
        };

        const colorInput = this.shadowRoot.querySelector('#item-color');
        if (colorInput) {
            colorInput.onchange = (e) => {
                this.dispatchEvent(new CustomEvent('sac:recolor', { detail: { id: this.id, color: e.target.value }, bubbles: true, composed: true }));
            };
        }
    }
}

customElements.define('sac-scene-graph', SacSceneGraph);
customElements.define('sac-scene-item', SacSceneItem);
})();
