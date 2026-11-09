/**
 * <sac-scene-graph> + <sac-scene-item>  —  tree list.
 *
 * Generic hierarchical list with visibility toggles, color wells, delete
 * buttons and expand chevrons — used for scene graphs, layer lists, any
 * tree of toggleable things.
 *
 *   <sac-scene-graph aria-label="Scene">
 *     <sac-scene-item id="obj-1" label="Group" visible expandable>
 *       <sac-scene-item id="obj-2" label="Mesh" visible color="#3b82f6" can-delete></sac-scene-item>
 *     </sac-scene-item>
 *   </sac-scene-graph>
 *
 * <sac-scene-graph> is the tree (role="tree" unless the author set a role):
 * give it an aria-label.
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
 * Keyboard (the WAI tree pattern; the whole tree is ONE Tab stop):
 *   Roving tabindex across every item of the tree — only one row is a Tab
 *   stop: the focused one; with focus elsewhere, the selected (active) row,
 *   else the row the keyboard last stood on, else the first. Tab from that
 *   row reaches ITS eye, colour well and trash (the sac-layer-list way);
 *   every other row's controls are out of the tab order. The chevron never
 *   is — ←/→ do its job.
 *   ↑ / ↓          previous / next visible row (moves focus, does not select)
 *   Home / End     first / last visible row
 *   →              collapsed: expand · expanded: to the first child
 *   ←              expanded: collapse · else: to the parent row
 *   Enter / Space  select (sac:select; Ctrl/⌘ = additive, Shift = range)
 *
 * Names: every control says which item it acts on — "Hide Mesh" / "Show
 * Mesh" (the eye; the name says the action, so no aria-pressed), "Delete
 * Mesh", "Color of Mesh". The row is a treeitem named by the label (plus
 * ", hidden" when the eye is shut) with aria-level, aria-selected and, on a
 * nested row, aria-expanded; its children sit in a role="group".
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
    /** A kit string with {name} filled in (item names are app data). */
    const tn = (key, fallback, name) => t(key, fallback).replace("{name}", () => name);

    // Shared by render() and the in-place visibility toggle.
    const EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    const EYE_CLOSED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

    const ITEM = "sac-scene-item";

    /* ------------------------------------------------- roving tabindex --- */

    /** The tree an item belongs to: its <sac-scene-graph>, else (an item used
     *  on its own) its outermost item. */
    function treeOf(item) {
        const graph = item.closest("sac-scene-graph");
        if (graph) return graph;
        let top = item;
        for (let p = item.parentElement; p; p = p.parentElement) if (p.localName === ITEM) top = p;
        return top;
    }

    /** Every item of a tree in document order (the root too, when it is an item). */
    function allItems(root) {
        const list = Array.from(root.querySelectorAll(ITEM));
        return root.localName === ITEM ? [root, ...list] : list;
    }

    /** The parent item of an item, or null. */
    function parentItem(item) {
        const p = item.parentElement;
        return p ? p.closest(ITEM) : null;
    }

    /** The rows a keyboard can reach: items with no collapsed item above them. */
    function visibleItems(root) {
        return allItems(root).filter((it) => {
            for (let p = parentItem(it); p; p = parentItem(p)) {
                if (!p.hasAttribute("expanded")) return false;
                if (p === root) break;
            }
            return true;
        });
    }

    /** One Tab stop per tree: the focused row; with focus elsewhere the
     *  selected row, else where the keyboard last was (or its nearest
     *  visible parent), else the first row. */
    function syncTree(root) {
        if (!root || !root.isConnected) return;
        const visible = visibleItems(root);
        let cur = root._sgCurrent;
        const focused = cur && cur.isConnected && root.contains(cur) && cur.shadowRoot.activeElement;
        if (!focused || !visible.includes(cur)) {
            let last = cur && cur.isConnected && root.contains(cur) ? cur : null;
            while (last && !visible.includes(last)) last = parentItem(last);
            cur = visible.find((it) => it.hasAttribute("active")) || last || visible[0] || null;
            root._sgCurrent = cur;
        }
        for (const it of allItems(root)) if (it._setTabStop) it._setTabStop(it === cur);
    }

    const pending = new Set();
    /** Batch: a tree of 50 items rendering at once syncs once. */
    function scheduleSync(root) {
        if (!root || pending.has(root)) return;
        pending.add(root);
        queueMicrotask(() => { pending.delete(root); syncTree(root); });
    }

class SacSceneGraph extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) {
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
        if (!this.hasAttribute('role')) this.setAttribute('role', 'tree');
        scheduleSync(this);
    }
}

class SacSceneItem extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._tabStop = false;
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
        this._tree = treeOf(this);
        this.render();
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
        // The tree it left picks a new Tab stop if this was it.
        if (this._tree && this._tree !== this) scheduleSync(this._tree);
        this._tree = null;
    }

    /** The name the row and its controls carry. */
    _name() {
        return this.getAttribute('label') || t('scene.unnamed', 'Unnamed');
    }

    /** Every accessible name from the current state and language — the row
     *  (", hidden" when the eye is shut) and each control, named after the
     *  item. In place: no re-render, focus stays. */
    _paintNames() {
        const root = this.shadowRoot;
        const row = root.querySelector('.item-row');
        if (!row) return;
        const name = this._name();
        row.setAttribute('aria-label', this.visible ? name : `${name}, ${t('scene.hidden', 'hidden')}`);
        const set = (sel, text) => { const el = root.querySelector(sel); if (el) el.setAttribute('aria-label', text); };
        set('#btn-expand', t('scene.expand', 'Expand / collapse'));
        set('#btn-visibility', this.visible
            ? tn('scene.hide-named', 'Hide {name}', name)
            : tn('scene.show-named', 'Show {name}', name));
        set('#btn-delete', tn('scene.delete-named', 'Delete {name}', name));
        set('#item-color', tn('scene.color-named', 'Color of {name}', name));
    }

    /** Runtime language switch: the control labels (and the "Unnamed"
     *  placeholder) in place — no re-render, so focus and the colour
     *  input's transient state survive. */
    _relabel() {
        const root = this.shadowRoot;
        if (!root.firstChild) return;
        if (!this.getAttribute('label')) {
            const text = root.querySelector('#item-label');
            if (text) text.textContent = t('scene.unnamed', 'Unnamed');
        }
        this._paintNames();
    }

    /** Roving tabindex (syncTree): this row — and its eye, colour well and
     *  trash — are Tab stops, or none of them is. The chevron never is. */
    _setTabStop(on) {
        this._tabStop = !!on;
        const root = this.shadowRoot;
        const row = root.querySelector('.item-row');
        if (!row) return;
        row.tabIndex = on ? 0 : -1;
        root.querySelectorAll('#btn-visibility, #btn-delete, #item-color').forEach((el) => { el.tabIndex = on ? 0 : -1; });
    }

    /** Move the keyboard to this row. */
    _focusRow() {
        const row = this.shadowRoot.querySelector('.item-row');
        if (!row) return;
        const tree = treeOf(this);
        tree._sgCurrent = this;
        syncTree(tree);
        row.focus();
    }

    _isNested() {
        return Array.from(this.children).some((c) => c.localName === ITEM) || this.hasAttribute('expandable');
    }

    _setExpanded(on) {
        this.expanded = on;
        this.dispatchEvent(new CustomEvent('sac:expand', { detail: { id: this.id, expanded: on }, bubbles: true, composed: true }));
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
            scheduleSync(treeOf(this));
            return;
        }
        if (name === 'expanded') {
            row.classList.toggle('expanded', this.expanded);
            if (row.hasAttribute('aria-expanded'))
                row.setAttribute('aria-expanded', this.expanded ? 'true' : 'false');
            const kids = this.shadowRoot.querySelector('.children');
            if (kids) kids.style.display = this.expanded ? 'block' : 'none';
            scheduleSync(treeOf(this));
            return;
        }
        if (name === 'visible') {
            const btn = this.shadowRoot.querySelector('#btn-visibility');
            if (btn) btn.innerHTML = this.visible ? EYE_OPEN : EYE_CLOSED;
            this._paintNames();
            return;
        }
        this.render();
    }

    render() {
        const label = this._name();
        const color = this.getAttribute('color');
        const canDelete = this.hasAttribute('can-delete');
        // Item labels are user data (object/layer names) written into innerHTML
        // and re-rendered on every attribute change — escape both the text and
        // the color that feeds an attribute value.
        const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const safeColor = /^#[0-9a-f]{3,8}$/i.test(color || '') ? color : '#000000';
        // `expandable` keeps the chevron on a row whose children are built
        // lazily (children only detected once you actually expand it).
        const isNested = this._isNested();
        // Depth for aria-level: the items above this one, plus one.
        let level = 1;
        for (let p = parentItem(this); p; p = parentItem(p)) level++;
        // Roving tabindex: only the tree's current row (and its controls)
        // are Tab stops — syncTree() moves it.
        const tab = this._tabStop ? '0' : '-1';

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
                /* Press: answers the moment it goes down. */
                .item-row:active:not(.active) {
                    background: var(--hover-strong);
                    transition-duration: 0s;
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
                    border-radius: var(--radius-s);
                }
                .icon:hover { opacity: 1; }
                button.icon:active { background: var(--hover-strong); transition-duration: 0s; }
                .item-row:focus { outline: none; }
                .item-row:focus-visible,
                button.icon:focus-visible,
                input[type="color"]:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 1px;
                }
                /* A keyboard on a control shows it at full strength. */
                button.icon:focus-visible { opacity: 1 !important; }
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
                /* The press gives under the pointer instead of the hover zoom. */
                input[type="color"]:active {
                    transform: scale(0.97);
                    transition-duration: 0.1s;
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
                    /* …but the press itself still shows (a touch is a hover too). */
                    .item-row:not(.active):active { background: var(--hover-strong); }
                    input[type="color"]:active { transform: scale(0.97); }
                }
                @media (prefers-reduced-motion: reduce) {
                    .item-row, .icon, .chevron, input[type="color"] { transition: none; }
                }
            </style>
            <div class="item-row ${this.active ? 'active' : ''} ${this.expanded ? 'expanded' : ''}"
                 role="treeitem" tabindex="${tab}" aria-level="${level}"
                 aria-selected="${this.active ? 'true' : 'false'}"
                 ${isNested ? `aria-expanded="${this.expanded ? 'true' : 'false'}"` : ''}>
                ${isNested ? `
                    <button type="button" class="chevron icon" id="btn-expand" tabindex="-1">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                ` : '<div class="spacer"></div>'}

                <button type="button" class="icon" id="btn-visibility" tabindex="${tab}">
                    ${this.visible ? EYE_OPEN : EYE_CLOSED}
                </button>

                <div class="label" id="item-label">${escText(label)}</div>

                ${color ? `<label class="well"><input type="color" value="${safeColor}" id="item-color" tabindex="${tab}"></label>` : ''}

                ${canDelete ? `
                    <button type="button" class="icon" id="btn-delete" tabindex="${tab}" style="opacity: 0.4">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                ` : ''}
            </div>
            <div class="children" role="group">
                <slot></slot>
            </div>
        `;
        this._paintNames();

        const row = this.shadowRoot.querySelector('.item-row');

        // The keyboard stood here (a click focuses the row too): this row
        // becomes the tree's one Tab stop.
        row.addEventListener('focusin', () => {
            const tree = treeOf(this);
            if (tree._sgCurrent === this && this._tabStop) return;
            tree._sgCurrent = this;
            syncTree(tree);
        });

        // Keyboard on the row itself (a treeitem). Keys on its controls are
        // theirs (Enter/Space press them natively).
        row.onkeydown = (e) => {
            if (e.target !== row) return;
            const tree = treeOf(this);
            const go = (item) => { e.preventDefault(); if (item) item._focusRow(); };
            switch (e.key) {
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    this.dispatchEvent(new CustomEvent('sac:select', {
                        detail: { id: this.id, additive: e.ctrlKey || e.metaKey, range: e.shiftKey },
                        bubbles: true, composed: true
                    }));
                    break;
                case 'ArrowDown':
                case 'ArrowUp': {
                    const rows = visibleItems(tree);
                    const i = rows.indexOf(this);
                    go(rows[i + (e.key === 'ArrowDown' ? 1 : -1)]);
                    break;
                }
                case 'Home':
                    go(visibleItems(tree)[0]);
                    break;
                case 'End': {
                    const rows = visibleItems(tree);
                    go(rows[rows.length - 1]);
                    break;
                }
                case 'ArrowRight':
                    if (!this._isNested()) break;
                    e.preventDefault();
                    if (!this.expanded) this._setExpanded(true);
                    else go(Array.from(this.children).find((c) => c.localName === ITEM));
                    break;
                case 'ArrowLeft': {
                    e.preventDefault();
                    if (this._isNested() && this.expanded) { this._setExpanded(false); break; }
                    const up = parentItem(this);
                    if (up && (tree === up || tree.contains(up))) up._focusRow();
                    break;
                }
            }
        };

        row.onclick = (e) => {
            const path = e.composedPath();
            if (path.some(el => el.id === 'btn-visibility')) {
                this.dispatchEvent(new CustomEvent('sac:visibility', { detail: { id: this.id, visible: !this.visible }, bubbles: true, composed: true }));
            } else if (path.some(el => el.id === 'btn-expand')) {
                this._setExpanded(!this.expanded);
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

        scheduleSync(treeOf(this));
    }
}

customElements.define('sac-scene-graph', SacSceneGraph);
customElements.define('sac-scene-item', SacSceneItem);
})();
