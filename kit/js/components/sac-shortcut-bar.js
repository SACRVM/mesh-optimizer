/**
 * <sac-shortcut-bar group="Files"></sac-shortcut-bar>
 *
 *   bar.items = [
 *     { label: "New folder", combo: "alt+n", icon: "folder-plus", action: () => view.newFolder() },
 *     { label: "Trash", combo: "delete", action: () => view.trash(),
 *       shiftLabel: "Delete permanently", shiftAction: () => view.destroy() },
 *     { label: () => sac.t("files.preview", "Preview"), combo: "alt+p", action: () => view.togglePreview() },
 *   ];
 *
 * A visible action bar over sac.hotkeys — the Norton-Commander bottom row.
 * Every item is a button showing its key cap (sac.hotkeys.format) AND a
 * binding in the registry, so <sac-shortcut-sheet> lists it without extra
 * wiring and a key press and a click run the same action. The bar is a view
 * over the registry, not a second source of truth: bindings are registered
 * while the bar is connected and withdrawn on disconnect / an items change.
 *
 * Which items exist is the CALLER'S job (the kit's no-dead-buttons
 * convention): hand in an already-filtered array. `disabled` greys an item
 * out and leaves its combo unregistered — a disabled action has no binding.
 *
 * Property:
 *   items — [{ label, combo, action, shiftLabel?, shiftAction?, icon?,
 *            disabled?, id? }]. Assigning re-renders and re-registers.
 *     label       — string, or a function returning one (called on every
 *                   render and on a language switch, so a translated label
 *                   follows sac.lang).
 *     combo       — a sac.hotkeys combo ("alt+n", "delete", "mod+shift+s").
 *                   Optional: without one the item is a plain button.
 *     action(e)   — run by the hotkey (e = the KeyboardEvent), a click
 *                   (the MouseEvent) or the nav's "…" menu (its sac:select
 *                   event). Always an event, so `e.shiftKey` is safe to read.
 *     shiftLabel  — string | function: the label while Shift is held.
 *     shiftAction — the Shift variant. When given, the bar ALSO registers
 *                   "shift+<combo>" for it (listed under shiftLabel) and a
 *                   Shift+click runs it. When absent, a Shift+click runs
 *                   `action` with the event (check e.shiftKey) and the
 *                   Shift+key chord is the caller's own register() — the
 *                   registry matches combos exactly, so "delete" does not
 *                   fire for Shift+Delete.
 *     icon        — sac.icons name shown between key cap and label.
 *     disabled    — greyed out, not clickable, not registered.
 *     id          — echoed as data-id on the button and in sac:invoke.
 *   group — the heading the bindings are listed under in the sheet: a
 *           string or a function returning one. Mirrors the attribute; the
 *           property wins.
 *
 * Attributes:
 *   group — as above (string form).
 *   nav   — which <sac-nav> the bar folds into on compact: a CSS selector,
 *           or "none" to never fold. Absent = the first <sac-nav> in the
 *           bar's document (or shadow root).
 *   fit   — "labels": when the items do not fit one row, the items that
 *           have an icon drop their label first (key cap + icon, the label
 *           stays the tooltip and accessible name); only what still does
 *           not fit goes into "…". Absent = straight into "…".
 *   folded — reflected, read-only: present while the bar's items live in
 *           the nav's "…" menu (the bar itself is hidden).
 *   shift  — reflected, read-only: present while the Shift layer is up.
 *
 * Events:
 *   sac:invoke — detail { id, shift, source: "key" | "click" | "menu" } —
 *           an item ran, right after its action. Bubbles + composed.
 *
 * Shift layer: while Shift is held (and focus is not in a text field) every
 * item with a shiftLabel swaps its label text in place, and an item with a
 * shiftAction also shows the Shift chord on its key cap — no re-render, no
 * flash. Released on keyup, window blur and when the tab is hidden; a
 * pointer moving over the bar re-syncs it with the event's shiftKey.
 *
 * Language: key caps and function labels re-render in place on a
 * sac.lang switch.
 *
 * One row at every width: the items that do not fit fold, from the end,
 * into a trailing "…" menu (<sac-menu>, needs it loaded) — same labels,
 * icons and key caps, Shift layer included; their hotkeys stay registered.
 * Compact (≤768px, the kit's `compact` query): the bar hides and its items
 * join the nav's "…" menu as one group (sac-nav setOverflowGroup) — Shift
 * variants with a shiftAction as entries of their own, since a phone has no
 * Shift key. Without a nav (or nav="none") the bar stays, with its own "…".
 * Touch: (pointer: coarse) makes every button 44px tall.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

    /** The compact query — the same string as sac-nav / ui.css §15. */
    const COMPACT = "(max-width: 768px), (max-height: 480px) and (pointer: coarse)";

    /** A label option → its current string (functions are called each time). */
    function text(v) {
        if (typeof v === "function") {
            try { const s = v(); return s == null ? "" : String(s); } catch (e) { return ""; }
        }
        return v == null ? "" : String(v);
    }

    const hk = () => (window.sac && sac.hotkeys) || null;
    const fmt = (combo) => (hk() ? sac.hotkeys.format(combo) : String(combo));

    /** Does the combo already carry Shift? ("shift+x" has no Shift variant.) */
    const hasShift = (combo) => /(^|\+)\s*shift\s*\+/i.test(combo);

    /** aria-keyshortcuts spelling: "Control+Shift+K". */
    function ariaKeys(combo) {
        const mac = hk() && sac.hotkeys.isMac();
        return String(combo).split("+").map((p) => {
            const s = p.trim().toLowerCase();
            if (s === "mod") return mac ? "Meta" : "Control";
            if (s === "ctrl" || s === "control") return "Control";
            if (s === "cmd" || s === "command" || s === "meta" || s === "win" || s === "super") return "Meta";
            if (s === "option") return "Alt";
            if (s === "del") return "Delete";
            if (s === "esc") return "Escape";
            return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Plus";
        }).join("+");
    }

    /** Is the key event coming out of a text field? Shadow-DOM aware. */
    function isTyping(e) {
        const path = typeof e.composedPath === "function" ? e.composedPath() : null;
        const el = (path && path[0]) || e.target;
        if (!el || el.nodeType !== 1) return false;
        if (el.isContentEditable) return true;
        const tag = el.localName;
        if (tag === "textarea" || tag === "select") return true;
        if (tag !== "input") return false;
        const type = (el.getAttribute("type") || "text").toLowerCase();
        return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file"].includes(type);
    }

class SacShortcutBar extends HTMLElement {
    static get observedAttributes() { return ["group", "nav", "fit"]; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._items = [];
        this._group = undefined;      // property override of the attribute
        this._offs = [];              // hotkey unregister functions
        this._shift = false;
        this._nav = null;             // the nav we folded into
        this._onKeyDown = (e) => {
            if (e.key === "Shift") { if (!isTyping(e)) this._setShift(true); }
            else if (this._shift && !e.shiftKey) this._setShift(false);
        };
        this._onKeyUp = (e) => { if (e.key === "Shift") this._setShift(false); };
        this._onBlur = () => this._setShift(false);
        this._onVisibility = () => { if (document.hidden) this._setShift(false); };
        this._onPointer = (e) => this._setShift(!!e.shiftKey);
    }

    get items() { return this._items; }
    set items(v) {
        this._items = Array.isArray(v) ? v.filter(Boolean) : [];
        if (this.shadowRoot.firstChild) this._renderItems();
        if (this.isConnected) { this._register(); this._syncFold(); }
    }

    get group() { return this._group !== undefined ? this._group : (this.getAttribute("group") || ""); }
    set group(v) {
        this._group = v;
        if (this.isConnected) this._register();
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
        this._register();
        window.addEventListener("keydown", this._onKeyDown, true);
        window.addEventListener("keyup", this._onKeyUp, true);
        window.addEventListener("blur", this._onBlur);
        document.addEventListener("visibilitychange", this._onVisibility);
        this.addEventListener("pointermove", this._onPointer);
        this._mq = window.matchMedia(COMPACT);
        this._mqHandler = () => this._syncFold();
        this._mq.addEventListener("change", this._mqHandler);
        this._syncFold();
        // One row: re-fit whenever the bar's width changes, and once the
        // fonts are in (a label's width depends on them).
        if (!this._ro) this._ro = new ResizeObserver(() => this._layout());
        this._ro.observe(this);
        document.fonts?.ready.then(() => this._layout());
        // The "…" needs sac-menu, which may define after the bar.
        if (!customElements.get("sac-menu")) customElements.whenDefined("sac-menu").then(() => this._layout());
        // The nav may upgrade after the bar (script order, markup order).
        if (!customElements.get("sac-nav")) customElements.whenDefined("sac-nav").then(() => this._syncFold());
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    disconnectedCallback() {
        this._unregister();
        window.removeEventListener("keydown", this._onKeyDown, true);
        window.removeEventListener("keyup", this._onKeyUp, true);
        window.removeEventListener("blur", this._onBlur);
        document.removeEventListener("visibilitychange", this._onVisibility);
        this.removeEventListener("pointermove", this._onPointer);
        this._mq?.removeEventListener("change", this._mqHandler);
        this._ro?.disconnect();
        this._unfold();
        this._shift = false;
        if (this._offLang) { this._offLang(); this._offLang = null; }
    }

    attributeChangedCallback(name) {
        if (!this.isConnected) return;
        if (name === "group" && this._group === undefined) this._register();
        if (name === "nav") { this._unfold(); this._syncFold(); }
        if (name === "fit") this._layout();
    }

    /* ------------------------------------------------------- registry */

    _register() {
        this._unregister();
        const api = hk();
        if (!api) return;
        const group = this.group;
        const groupFn = typeof group === "function" ? group : () => group;
        this._items.forEach((item) => {
            if (!item.combo || item.disabled || typeof item.action !== "function") return;
            this._offs.push(api.register(item.combo, (e) => this._invoke(item, false, e, "key"),
                { description: () => text(item.label), group: groupFn }));
            if (typeof item.shiftAction === "function" && !hasShift(item.combo)) {
                this._offs.push(api.register("shift+" + item.combo, (e) => this._invoke(item, true, e, "key"),
                    { description: () => text(item.shiftLabel) || text(item.label), group: groupFn }));
            }
        });
    }

    _unregister() {
        this._offs.forEach((off) => off());
        this._offs = [];
    }

    _invoke(item, shift, e, source) {
        if (item.disabled) return;
        const fn = shift && typeof item.shiftAction === "function" ? item.shiftAction : item.action;
        if (typeof fn !== "function") return;
        try { fn(e); }
        catch (err) { console.error("[sac-shortcut-bar] action threw:", err); }
        this.dispatchEvent(new CustomEvent("sac:invoke", {
            detail: { id: item.id ?? null, shift: !!shift, source }, bubbles: true, composed: true,
        }));
    }

    /* ------------------------------------------------------- rendering */

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; }
                :host([hidden]), :host([folded]) { display: none; }
                /* One row: what does not fit folds into "…" (_layout). The
                   2px pad keeps the focus ring inside the clip. */
                .bar {
                    display: flex;
                    flex-wrap: nowrap;
                    align-items: center;
                    gap: 6px;
                    overflow: hidden;
                    padding: 2px;
                    margin: -2px;
                }
                .bar:empty { display: none; }
                .item[hidden], .more[hidden] { display: none; }
                .item { flex: none; }
                /* fit="labels": icon items show key cap + icon only. */
                .bar.icons .item.has-icon .label { display: none; }
                .bar.icons .item.has-icon { padding-right: 8px; }
                .more { flex: none; }
                .more-btn { padding: 0 8px; }
                /* "…" entries: label, then the key cap at the right edge. */
                .more button[data-action] kbd { margin-left: auto; padding-left: 5px; }
                /* The kit's .toolbar .btn recipe, re-stated for the shadow
                   root, with the key cap leading. */
                .item {
                    --icon-size: 16px;
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    height: 32px;
                    padding: 0 0.8rem 0 5px;
                    background: color-mix(in srgb, var(--fg) 5%, transparent);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-m);
                    color: var(--text);
                    font-family: inherit;
                    font-size: 0.68rem;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.02em;
                    white-space: nowrap;
                    cursor: pointer;
                    transition: background 0.2s ease, border-color 0.2s ease,
                                transform 0.2s var(--ease-smooth);
                }
                .item:hover:not(:disabled) {
                    background: var(--hover);
                    border-color: var(--accent);
                }
                /* Press: the button gives the moment it goes down — fast in
                   (100ms), back at the normal pace. The "…" trigger too. */
                .item:active:not(:disabled) {
                    transform: scale(0.97);
                    transition-duration: 0.1s;
                }
                .item:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                }
                .item:disabled { opacity: 0.3; cursor: not-allowed; }
                /* The ui.css kbd recipe, sized for a 32px button. */
                kbd {
                    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
                    font-size: 0.68rem;
                    font-weight: 500;
                    text-transform: none;
                    letter-spacing: 0;
                    line-height: 1.4;
                    background: var(--field);
                    border: 1px solid var(--border-strong);
                    border-bottom-width: 2px;
                    border-radius: var(--radius-s);
                    padding: 0 5px;
                    color: var(--text-muted);
                }
                kbd:empty { display: none; }
                /* The Shift layer: a relabelled item reads in the accent. */
                .item.shifted .label { color: var(--accent); }
                @media (pointer: coarse) {
                    .item { height: 44px; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .item { transition: none; }
                }
            </style>
            <div class="bar" role="toolbar" part="bar"></div>
        `;
        const bar = this.shadowRoot.querySelector(".bar");
        bar.addEventListener("click", (e) => {
            const btn = e.target.closest("button.item:not(.more-btn)");
            if (!btn || btn.disabled) return;
            const item = this._items[Number(btn.dataset.index)];
            if (item) this._invoke(item, e.shiftKey, e, "click");
        });
        // The "…": a <sac-menu> whose trigger wears the item recipe.
        const more = document.createElement("sac-menu");
        more.className = "more";
        more.hidden = true;
        more.innerHTML = `<button slot="trigger" class="item more-btn" type="button"><sac-icon name="more"></sac-icon></button>`;
        // The menu's own event stays in here: the bar answers with sac:invoke.
        more.addEventListener("sac:select", (e) => {
            e.stopPropagation();
            const item = this._items[Number(e.detail && e.detail.action)];
            if (item) this._invoke(item, this._shift, e, "menu");
        });
        this._more = more;
        this._renderItems();
    }

    _renderItems() {
        const bar = this.shadowRoot.querySelector(".bar");
        bar.setAttribute("aria-label", t("shortcutbar.label", "Shortcuts"));
        bar.replaceChildren();
        this._items.forEach((item, i) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = item.icon ? "item has-icon" : "item";
            b.setAttribute("part", "item");
            b.dataset.index = String(i);
            if (item.id != null) b.dataset.id = String(item.id);
            if (item.disabled) b.disabled = true;
            const kbd = document.createElement("kbd");
            b.appendChild(kbd);
            if (item.icon) {
                const ic = document.createElement("sac-icon");
                ic.setAttribute("name", item.icon);
                b.appendChild(ic);
            }
            const label = document.createElement("span");
            label.className = "label";
            b.appendChild(label);
            bar.appendChild(b);
        });
        bar.appendChild(this._more);
        this._relabel();
    }

    /** Labels and key caps for the current Shift state and language — in
     *  place, so a Shift press or a language switch never rebuilds. The
     *  nav's "…" group is refreshed too, unless only Shift changed. */
    _relabel(menu = true) {
        const bar = this.shadowRoot.querySelector(".bar");
        if (bar) {
            bar.setAttribute("aria-label", t("shortcutbar.label", "Shortcuts"));
            bar.querySelectorAll("button.item").forEach((b) => {
                const item = this._items[Number(b.dataset.index)];
                if (!item) return;
                const swapLabel = this._shift && text(item.shiftLabel);
                const swapKey = this._shift && item.combo && typeof item.shiftAction === "function" && !hasShift(item.combo);
                const combo = item.combo ? (swapKey ? "shift+" + item.combo : item.combo) : "";
                const label = swapLabel || text(item.label);
                b.querySelector(".label").textContent = label;
                b.querySelector("kbd").textContent = combo ? fmt(combo) : "";
                b.classList.toggle("shifted", !!(swapLabel || swapKey));
                // The name a screen reader reads, also with the label hidden.
                b.setAttribute("aria-label", label);
                if (combo) {
                    b.setAttribute("aria-keyshortcuts", ariaKeys(combo));
                    b.title = `${label} (${fmt(combo)})`;
                } else {
                    b.removeAttribute("aria-keyshortcuts");
                    b.title = label;
                }
            });
            const more = this._more && this._more.querySelector(".more-btn");
            if (more) {
                const m = t("shortcutbar.more", "More");
                more.setAttribute("aria-label", m);
                more.title = m;
            }
        }
        // A new language changes widths; the Shift layer must not make the
        // row jump, so it only refreshes the "…" entries.
        if (menu) this._layout();
        else this._fillMore();
        if (menu && this._nav) this._nav.setOverflowGroup(this, this._menuEntries());
    }

    /* ------------------------------------------------------- one row */

    /** Fit one row: all items in, then (fit="labels") icon items without
     *  labels, then fold items from the end into "…" until the row fits. */
    _layout() {
        const bar = this.shadowRoot.querySelector(".bar");
        const more = this._more;
        if (!bar || !more || !this.isConnected || this.hasAttribute("folded")) return;
        const buttons = [...bar.querySelectorAll("button.item:not(.more-btn)")];
        buttons.forEach((b) => { b.hidden = false; });
        bar.classList.remove("icons");
        more.hidden = true;
        this._over = [];
        if (!bar.clientWidth) { this._fillMore(); return; }   // not laid out
        const fits = () => bar.scrollWidth <= bar.clientWidth + 1;
        if (!fits() && this.getAttribute("fit") === "labels") bar.classList.add("icons");
        if (!fits() && customElements.get("sac-menu")) {
            more.hidden = false;
            for (let i = buttons.length - 1; i >= 0 && !fits(); i--) {
                buttons[i].hidden = true;
                this._over.unshift(Number(buttons[i].dataset.index));
            }
        }
        this._fillMore();
    }

    /** The "…" entries for the folded items, in the bar's current Shift
     *  state: icon, label, key cap. */
    _fillMore() {
        const more = this._more;
        if (!more) return;
        more.querySelectorAll("button[data-action]").forEach((n) => n.remove());
        (this._over || []).forEach((i) => {
            const item = this._items[i];
            if (!item) return;
            const b = document.createElement("button");
            b.type = "button";
            b.dataset.action = String(i);
            if (item.disabled) b.disabled = true;
            if (item.icon) {
                const ic = document.createElement("sac-icon");
                ic.setAttribute("name", item.icon);
                b.appendChild(ic);
            }
            const swapKey = this._shift && item.combo && typeof item.shiftAction === "function" && !hasShift(item.combo);
            b.appendChild(document.createTextNode((this._shift && text(item.shiftLabel)) || text(item.label)));
            if (item.combo) {
                const k = document.createElement("kbd");
                k.textContent = fmt(swapKey ? "shift+" + item.combo : item.combo);
                b.appendChild(k);
            }
            more.appendChild(b);
        });
    }

    _setShift(on) {
        if (on === this._shift) return;
        this._shift = on;
        this.toggleAttribute("shift", on);
        // Nothing to swap: skip the DOM walk.
        if (this._items.some((i) => i.shiftLabel || i.shiftAction)) this._relabel(false);
    }

    /* ------------------------------------------------------- compact fold */

    _findNav() {
        const sel = this.getAttribute("nav");
        if (sel === "none") return null;
        const root = this.getRootNode();
        let nav = null;
        try {
            nav = (root.querySelector && root.querySelector(sel || "sac-nav")) ||
                  document.querySelector(sel || "sac-nav");
        } catch (e) {
            console.warn(`[sac-shortcut-bar] nav: invalid selector "${sel}"`);
        }
        return nav && typeof nav.setOverflowGroup === "function" ? nav : null;
    }

    _syncFold() {
        if (!this.isConnected || !this._mq) return;
        const nav = this._mq.matches && this._items.length ? this._findNav() : null;
        if (!nav) { this._unfold(); return; }
        if (this._nav && this._nav !== nav) this._nav.setOverflowGroup(this, null);
        this._nav = nav;
        this.setAttribute("folded", "");
        nav.setOverflowGroup(this, this._menuEntries());
    }

    _unfold() {
        if (this._nav) this._nav.setOverflowGroup(this, null);
        this._nav = null;
        this.removeAttribute("folded");
    }

    /** The "…" menu group: one entry per item, plus one per Shift variant
     *  that has its own action (a phone has no Shift key). */
    _menuEntries() {
        const out = [];
        this._items.forEach((item) => {
            if (typeof item.action !== "function") return;
            out.push({ label: text(item.label), icon: item.icon, disabled: !!item.disabled,
                       run: (e) => this._invoke(item, false, e, "menu") });
            if (typeof item.shiftAction === "function") {
                out.push({ label: text(item.shiftLabel) || text(item.label), icon: item.icon,
                           disabled: !!item.disabled, run: (e) => this._invoke(item, true, e, "menu") });
            }
        });
        return out;
    }
}

customElements.define("sac-shortcut-bar", SacShortcutBar);
})();
