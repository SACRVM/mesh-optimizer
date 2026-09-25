/**
 * <sac-toolbox value="pencil" columns="2" hotkeys></sac-toolbox>
 *
 *   box.tools = [
 *       { id: "pencil", icon: "pencil",     label: "Pencil",     key: "b" },
 *       { id: "eraser", icon: "eraser",     label: "Eraser",     key: "e" },
 *       null,                                   // visual gap
 *       { id: "fill",   icon: "bucket",     label: "Fill",       key: "g" },
 *       { id: "pick",   icon: "eyedropper", label: "Eyedropper", key: "i" },
 *   ];
 *
 * A tool ribbon for any editor: a radio grid of square icon buttons, exactly
 * one active — any "pick the current tool" surface (a paint or pixel canvas,
 * a map editor, a diagram tool, a selection-mode switch).
 * Where <sac-segmented-control> is a row of WORDS, this is a grid of GLYPHS —
 * so every tool carries a kit tooltip with its name and shortcut, and the
 * name is also its accessible label (a bare glyph is never the only label).
 *
 * Attributes:
 *   value    — the active tool id, reflected.
 *   columns  — grid columns, default 2. "row" lays every tool out in ONE
 *              horizontal row instead (a top ribbon). "auto" fills the
 *              width it is given — as many tools per row as fit, wrapping
 *              only when the container is too narrow (a sidebar panel that
 *              the user resizes). A number is applied as a custom property
 *              (--sac-toolbox-columns), so changing it re-renders nothing.
 *   hotkeys  — presence registers every tool's `key` through sac.hotkeys
 *              while the element is connected (description = label, group =
 *              the `group` attribute or "Tools"), so the bindings show up in
 *              <sac-shortcut-sheet> and the command palette for free. The key
 *              selects the tool and fires sac:change, like a click. Removed
 *              from the registry again on disconnect / attribute removal /
 *              a new `tools` list.
 *   group    — the heading the hotkeys are listed under (default "Tools").
 *   disabled — presence = inert + dimmed, fires nothing, hotkeys ignored.
 *
 * Properties:
 *   tools    — array of { id, icon, label, key? }. `null` or { separator:
 *              true } inserts a visual gap: a full-width break in a grid, a
 *              thin hairline in a row. Setting it rebuilds the buttons.
 *   value    — get/set; setting is SILENT (fires nothing), like every value
 *              control. An id that is not in `tools` leaves nothing active.
 *   disabled — get/set, reflects the attribute.
 *
 * Methods:
 *   focus()  — focuses the active tool (or the first one).
 *
 * Events:
 *   sac:change — e.detail = { value } (tool id), on user click / keyboard /
 *                hotkey only. Bubbles, NOT composed (native change semantics).
 *
 * Keyboard: a radiogroup with roving tabindex — only the active tool is a
 * tab stop. ←/→ step through the tools in order (wrapping), ↑/↓ move to the
 * tool visually above/below (measured from the layout, so separators and a
 * short last row never trap the cursor), Home/End jump to the ends. Moving
 * selects, the radio pattern.
 *
 * Compact/touch: under (pointer: coarse) every button grows to 44 × 44 (the
 * glyph stays the same size); under (hover: none) no hover wash sticks to a
 * tapped tool. The tooltips are the kit bubble, which has its own long-press
 * path on touch.
 *
 * Theming: tokens only. The active tool is --accent-fill with --on-accent ink
 * — override --accent on the element for an edit-mode ribbon, the same
 * per-element mechanism as <sac-segmented-control>.
 */
/** Kit i18n: sac.t when globals.js is loaded, the English fallback when the
 *  component runs standalone. (A top-level name: `t` is the tool loop
 *  variable inside the class.) */
const sacToolboxT = (key, fallback) =>
    (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacToolbox extends HTMLElement {
    static get observedAttributes() { return ["value", "columns", "hotkeys", "group", "disabled"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._tools = [];
        this._tips = [];        // attach-mode tooltip handles, destroyed on rebuild
        this._offKeys = [];     // sac.hotkeys unregister functions
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._renderShell();
        this.setAttribute("role", "radiogroup");
        this._applyColumns();
        this._build();
        this._bindKeys();
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    disconnectedCallback() {
        this._unbindKeys();
        this._dropTips();
        if (this._offLang) { this._offLang(); this._offLang = null; }
    }

    /** Runtime language switch. Tool labels are app data; what changes is
     *  the key-cap spelling inside each tooltip ("Del" → "Entf"). Updated in
     *  place — buttons, focus and the active tool are untouched. The hotkey
     *  group resolves itself (a function, see _bindKeys). */
    _relabel() {
        const btns = this._buttons();
        this._entries().forEach((tool, i) => {
            const label = this._label(tool);
            if (this._tips[i]) this._tips[i].update(label);
            else if (btns[i] && btns[i].hasAttribute("title")) btns[i].title = label;
        });
    }

    attributeChangedCallback(name) {
        if (!this.shadowRoot.firstChild) return;
        if (name === "value" || name === "disabled") this._applyActive();
        if (name === "columns") this._applyColumns();
        if (name === "hotkeys" || name === "group" || name === "disabled") this._bindKeys();
    }

    get tools() { return this._tools.slice(); }
    set tools(list) {
        this._tools = Array.isArray(list) ? list.slice() : [];
        if (!this.shadowRoot.firstChild) return;   // built on connect
        this._build();
        this._bindKeys();
    }

    get value() { return this.getAttribute("value") || ""; }
    set value(v) { this.setAttribute("value", v == null ? "" : String(v)); }

    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }

    focus(opts) {
        const btns = this._buttons();
        const btn = btns.find((b) => b.dataset.id === this.value) || btns[0];
        if (btn) btn.focus(opts);
    }

    /* ------------------------------------------------------------ state --- */

    _commit(id) {
        if (this.disabled || id === this.value) {
            // Re-picking the active tool is not a change — but a click still
            // counts as "the user chose this", so nothing else to do.
            return;
        }
        this.setAttribute("value", id);
        this.dispatchEvent(new CustomEvent("sac:change", {
            detail: { value: id }, bubbles: true, composed: false,
        }));
    }

    _entries() {
        return this._tools.filter((t) => t && !t.separator && t.id != null);
    }

    _buttons() {
        return Array.from(this.shadowRoot.querySelectorAll("button.tool"));
    }

    /* ----------------------------------------------------------- render --- */

    _renderShell() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: inline-block;
                    --sac-toolbox-columns: 2;
                    /* The kit's tool measure (ui.css), so an .icon-btn.tool
                       row beside the box matches it; 32px standalone. */
                    --tool-size: var(--tool-btn-size, 32px);
                    max-width: 100%;
                }
                :host([disabled]) { opacity: .5; pointer-events: none; }
                .grid {
                    display: grid;
                    grid-template-columns: repeat(var(--sac-toolbox-columns), var(--tool-size));
                    gap: 4px;
                }
                /* auto: the element takes its container's width and the
                   grid packs as many fixed-size tools per row as fit. */
                :host([columns="auto"]) { display: block; }
                :host([columns="auto"]) .grid {
                    grid-template-columns: repeat(auto-fill, var(--tool-size));
                }
                :host([columns="row"]) .grid {
                    grid-template-columns: none;
                    grid-auto-flow: column;
                    grid-auto-columns: var(--tool-size);
                    align-items: center;
                }
                /* A gap: a full-width break in a grid, a hairline in a row. */
                .sep { grid-column: 1 / -1; height: 4px; }
                :host([columns="row"]) .sep {
                    grid-column: auto;
                    width: 1px;
                    height: 60%;
                    justify-self: center;
                    background: var(--border-strong);
                }
                button.tool {
                    width: var(--tool-size);
                    height: var(--tool-size);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                    margin: 0;
                    border: 1px solid transparent;
                    border-radius: var(--radius-m);
                    background: transparent;
                    color: var(--text-muted);
                    cursor: pointer;
                    --icon-size: var(--tool-btn-icon, 18px);
                    transition: background 0.15s, color 0.15s;
                }
                button.tool:hover { background: var(--hover); color: var(--text); }
                button.tool.active,
                button.tool.active:hover {
                    background: var(--accent-fill);
                    color: var(--on-accent);
                }
                button.tool:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 1px;
                }
                sac-icon { pointer-events: none; }
                @media (prefers-reduced-motion: reduce) {
                    button.tool { transition: none; }
                }
                /* Touch: the whole button grows — a tool grid is tapped all
                   day, a halo over a neighbour would steal its taps. */
                @media (pointer: coarse) {
                    :host { --tool-size: var(--tool-btn-size, 44px); }
                }
                @media (hover: none) {
                    button.tool:hover { background: transparent; color: var(--text-muted); }
                    button.tool.active:hover { background: var(--accent-fill); color: var(--on-accent); }
                }
            </style>
            <div class="grid" part="grid"></div>
        `;
        const grid = this.shadowRoot.querySelector(".grid");
        grid.addEventListener("click", (e) => {
            const btn = e.target.closest("button.tool");
            if (btn) this._commit(btn.dataset.id);
        });
        grid.addEventListener("keydown", (e) => this._onKeydown(e));
    }

    _applyColumns() {
        const c = this.getAttribute("columns");
        const n = parseInt(c, 10);
        if (c !== "row" && n > 0) this.style.setProperty("--sac-toolbox-columns", String(n));
        else this.style.removeProperty("--sac-toolbox-columns");
    }

    _label(t) {
        const key = t.key ? ((window.sac && sac.hotkeys) ? sac.hotkeys.format(t.key) : String(t.key).toUpperCase()) : "";
        return key ? `${t.label} (${key})` : String(t.label || t.id);
    }

    _build() {
        const grid = this.shadowRoot.querySelector(".grid");
        this._dropTips();
        grid.innerHTML = "";
        const canTip = !!(window.sac && sac.tooltip && sac.tooltip.attach);
        const place = this.getAttribute("columns") === "row" ? "bottom" : "right";
        for (const t of this._tools) {
            if (!t || t.separator) {
                const sep = document.createElement("span");
                sep.className = "sep";
                sep.setAttribute("aria-hidden", "true");
                grid.appendChild(sep);
                continue;
            }
            if (t.id == null) continue;
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "tool";
            btn.setAttribute("part", "tool");
            btn.dataset.id = String(t.id);
            btn.setAttribute("role", "radio");
            btn.setAttribute("aria-label", t.label || String(t.id));
            if (t.key) btn.setAttribute("aria-keyshortcuts", String(t.key));
            const icon = document.createElement("sac-icon");
            icon.setAttribute("name", t.icon || "");
            btn.appendChild(icon);
            grid.appendChild(btn);
            if (canTip) this._tips.push(sac.tooltip.attach(btn, this._label(t), { placement: place }));
            else btn.title = this._label(t);
        }
        this._applyActive();
    }

    _dropTips() {
        this._tips.forEach((h) => h && h.destroy());
        this._tips = [];
    }

    _applyActive() {
        const value = this.value;
        const btns = this._buttons();
        const anyChecked = btns.some((b) => b.dataset.id === value);
        const off = this.disabled;
        btns.forEach((btn, i) => {
            const on = btn.dataset.id === value;
            btn.classList.toggle("active", on);
            btn.setAttribute("aria-checked", on ? "true" : "false");
            if (off) btn.setAttribute("aria-disabled", "true");
            else     btn.removeAttribute("aria-disabled");
            btn.tabIndex = off ? -1 : (on || (!anyChecked && i === 0) ? 0 : -1);
        });
    }

    /* --------------------------------------------------------- keyboard --- */

    _onKeydown(e) {
        const btns = this._buttons();
        if (!btns.length) return;
        const cur = btns.indexOf(this.shadowRoot.activeElement);
        const idx = cur >= 0 ? cur : Math.max(0, btns.findIndex((b) => b.dataset.id === this.value));
        let next = null;
        switch (e.key) {
            case "ArrowRight": next = (idx + 1) % btns.length; break;
            case "ArrowLeft":  next = (idx - 1 + btns.length) % btns.length; break;
            case "ArrowDown":  next = this._vertical(btns, idx, +1); break;
            case "ArrowUp":    next = this._vertical(btns, idx, -1); break;
            case "Home":       next = 0; break;
            case "End":        next = btns.length - 1; break;
            default: return;
        }
        e.preventDefault();
        if (next == null || next < 0) return;
        const btn = btns[next];
        this._commit(btn.dataset.id);   // radio pattern: moving selects
        btn.focus();
    }

    /** The button in the next row above/below whose centre is closest in x.
     *  Measured, not computed from `columns`: separators and a short last
     *  row shift the index math, the layout never lies. In a single row the
     *  vertical arrows behave like ←/→. */
    _vertical(btns, idx, dir) {
        const rects = btns.map((b) => b.getBoundingClientRect());
        const me = rects[idx];
        const cx = me.left + me.width / 2;
        let rowTop = null;
        rects.forEach((r) => {
            const beyond = dir > 0 ? r.top > me.top + 1 : r.top < me.top - 1;
            if (!beyond) return;
            if (rowTop == null || (dir > 0 ? r.top < rowTop : r.top > rowTop)) rowTop = r.top;
        });
        if (rowTop == null) {
            // Nothing above/below: a single row, or already at an edge.
            return this.getAttribute("columns") === "row"
                ? (idx + dir + btns.length) % btns.length
                : idx;
        }
        let best = idx, bestD = Infinity;
        rects.forEach((r, i) => {
            if (Math.abs(r.top - rowTop) > 1) return;
            const d = Math.abs(r.left + r.width / 2 - cx);
            if (d < bestD) { bestD = d; best = i; }
        });
        return best;
    }

    /* ---------------------------------------------------------- hotkeys --- */

    _bindKeys() {
        this._unbindKeys();
        if (!this.isConnected || !this.hasAttribute("hotkeys")) return;
        if (!(window.sac && sac.hotkeys)) return;
        // A function: listings resolve the default heading in the current language.
        const group = () => this.getAttribute("group") || sacToolboxT("toolbox.group", "Tools");
        for (const t of this._entries()) {
            if (!t.key) continue;
            const id = String(t.id);
            this._offKeys.push(sac.hotkeys.register(t.key, () => {
                if (this.disabled) return;
                this._commit(id);
            }, { description: t.label || id, group }));
        }
    }

    _unbindKeys() {
        this._offKeys.forEach((off) => off());
        this._offKeys = [];
    }
}

customElements.define("sac-toolbox", SacToolbox);
