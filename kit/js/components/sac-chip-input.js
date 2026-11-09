/**
 * <sac-chip-input add-label="Add tag" [allow-create]>
 *
 * Combobox for editing a list of named chips. No backend coupling, no
 * registry: the host supplies suggestions and persists results.
 *
 * Renders the current chips followed by a text input; focus/typing opens a
 * dropdown of matching suggestions. Tab / Enter / comma commit the
 * highlighted suggestion (or the top match). With [allow-create], an
 * unknown entry offers "Create '<name>'" — choosing it opens a 10-swatch
 * palette picker, emits `sac:create`, then commits the new chip.
 *
 * Keyboard:
 *   - Tab / Enter / ,    commit highlighted/top
 *   - Esc                close dropdown (no commit)
 *   - ArrowDown / Up     move highlight
 *   - Backspace on an empty entry marks the last chip (outlined, and
 *     announced "Press Backspace again to remove {label}"); a second
 *     Backspace removes it (announced "{label} removed"). Any other key, a
 *     click or leaving the field clears the mark. A held Backspace (key
 *     repeat) never removes chips.
 *
 * ARIA: the entry is role="combobox" (aria-expanded, aria-controls,
 * aria-activedescendant, aria-autocomplete="list") named by `add-label`; the
 * dropdown is a listbox of role="option" rows, the highlighted one
 * aria-selected. The colour step after "Create" is a named group of swatch
 * buttons. Announcements go through a polite live region in the shadow root.
 *
 * Attributes:
 *   add-label    — ghost-button text when empty (default "Add"); also the
 *                  entry's accessible name and, outside size="cell", its
 *                  placeholder while it holds no text
 *   allow-create — presence enables creating unknown entries
 *   size         — absent = the inline row above; "cell" = the cell-editor
 *                  contract (style guide → Cell editors): one line that fills
 *                  its container, the text entry always shown (no ghost
 *                  button), the list opens on typing or ↓ — not on focus —
 *                  and closes after each pick. Enter picks from an open
 *                  list, else commits (sac:commit); Escape closes the list,
 *                  else cancels (sac:cancel); Tab takes a typed match and
 *                  moves on (never swallowed).
 *
 * Properties:
 *   value        — string[]; current normalised names. Reading returns a copy.
 *   suggestions  — array of { name, color, count?, label?, labelKey? }; color
 *                  is a palette slot name ("blue", "orange", … — see
 *                  --palette-* tokens). label is the text SHOWN for the name
 *                  (chips and list): capitals, spaces, umlauts, e.g.
 *                  { name: "fragile", label: "Fragile" }. labelKey makes
 *                  label the English fallback of sac.t(labelKey), so the
 *                  text follows a runtime language switch. Typing matches
 *                  label and name alike; value stays the list of names.
 *   focus({ select }) — reveals and focuses the text entry.
 *
 * Events:
 *   sac:change  — e.detail = { value: string[] } (new list, normalised, deduped).
 *                 Bubbles, NOT composed (native change semantics).
 *   sac:create  — e.detail = { name, color }, bubbles + composed — the host
 *                 persists the new entry and typically refreshes .suggestions.
 *
 * Compact/touch: nothing depends on hover — the hover highlight is a mirror
 * of the keyboard highlight, and a TAP (click) commits a suggestion or a
 * colour, so a swipe that scrolls the list picks nothing. Under
 * (pointer: coarse) suggestion rows are 44px, the add button and colour
 * swatches get 44px hit halos, chips sit 10px apart so their × halos do not
 * overlap, and the field uses 16px type (no iOS focus zoom). The dropdown is
 * at most 100vw - 16px wide, clamped 8px inside the viewport, and measures
 * its room against the visual viewport, so it flips above the field when
 * the on-screen keyboard is up.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

    /** Palette slot → English name, for the color picker's swatch tooltips
     *  (key "chip-input.color-<slot>"). */
    const SLOT_NAMES = {
        blue: "Blue", orange: "Orange", red: "Red", green: "Green", purple: "Purple",
        pink: "Pink", yellow: "Yellow", teal: "Teal", gray: "Gray", indigo: "Indigo",
    };

class SacChipInput extends HTMLElement {
    static PALETTE_SLOTS = ["blue", "orange", "red", "green", "purple", "pink", "yellow", "teal", "gray", "indigo"];
    static get observedAttributes() { return ["disabled", "size", "add-label"]; }

    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }

    attributeChangedCallback(name) {
        if (name === "disabled" && this._entry) this._entry.disabled = this.disabled;
        if (name === "size") { this._refreshAddButton(); this._nameEntry(); }
        if (name === "add-label") this._relabel();
    }

    focus(opts) {
        if (!this._entry) return super.focus(opts);
        this._addBtn.hidden = true;
        this._entry.hidden = false;
        this._entry.focus(opts);
        if (opts && opts.select) this._entry.select();
    }

    _cell() { return this.getAttribute("size") === "cell"; }

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._value = [];
        this._suggestions = [];
        this._colors = new Map();    // name → slot (from suggestions + created)
        this._labels = new Map();    // name → suggestion with a label / labelKey
        this._open = false;
        this._highlight = 0;
        this._creating = null;       // pending name awaiting color choice
        this._snapshot = [];         // value when focus entered (size="cell" cancel)
        this._inside = false;
        this._onDocPointer = this._onDocPointer.bind(this);
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
        document.addEventListener("pointerdown", this._onDocPointer, true);
        this._onReposition = () => this._positionDropdown();
        window.addEventListener("scroll", this._onReposition, true);
        window.addEventListener("resize", this._onReposition);
        // The on-screen keyboard shrinks the VISUAL viewport only (window
        // resize does not fire for it) — re-anchor so the list is not left
        // underneath the keyboard.
        window.visualViewport?.addEventListener("resize", this._onReposition);
        // Runtime language switch: relabel in place — chips, typing, the
        // open dropdown and its highlight survive.
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
        document.removeEventListener("pointerdown", this._onDocPointer, true);
        if (this._onReposition) {
            window.removeEventListener("scroll", this._onReposition, true);
            window.removeEventListener("resize", this._onReposition);
            window.visualViewport?.removeEventListener("resize", this._onReposition);
        }
    }

    get value() { return [...this._value]; }
    set value(v) {
        this._value = Array.isArray(v) ? [...new Set(v.filter(Boolean).map(this._normalize).filter(Boolean))] : [];
        this._renderChips();
        this._refreshAddButton();
    }

    get suggestions() { return [...this._suggestions]; }
    set suggestions(list) {
        this._suggestions = Array.isArray(list) ? list.filter(s => s && s.name) : [];
        this._labels.clear();
        for (const s of this._suggestions) {
            if (s.color) this._colors.set(s.name, s.color);
            if (s.label || s.labelKey) this._labels.set(s.name, s);
        }
        if (this._open) this._renderDropdown();
        this._renderChips(); // colors may have changed
    }

    _colorFor(name) {
        return this._colors.get(name) || "gray";
    }

    /** The text shown for a name: its suggestion's labelKey through sac.t
     *  (label = the fallback), its label, else the name itself. */
    _labelFor(name) {
        const s = this._labels.get(name);
        if (!s) return name;
        const fallback = s.label ? String(s.label) : name;
        return s.labelKey ? t(s.labelKey, fallback) : fallback;
    }

    _normalize(raw) {
        if (raw == null) return "";
        const trimmed = String(raw).trim().toLowerCase();
        return /^[a-z0-9_:-]{1,50}$/.test(trimmed) ? trimmed : "";
    }

    /** The ghost button's text: the app's add-label, else the kit default. */
    _addLabel() {
        return this.getAttribute("add-label") || t("chip-input.add", "Add");
    }

    /** Kit strings in the current language: the ghost button's text node,
     *  and an open dropdown re-rendered from unchanged state (query,
     *  highlight, pending create) with its scroll kept. */
    _relabel() {
        if (!this._addText) return;
        this._addText.textContent = this._addLabel();
        this._nameEntry();
        if (this._labels.size) this._renderChips();          // labelKey'd names
        if (this._open) {
            const top = this._dropdown.scrollTop;
            this._renderDropdown();
            this._dropdown.scrollTop = top;
        }
    }

    /** The entry's name is the add label; outside a cell it is also the
     *  placeholder (shown only while the entry holds no text). The listbox
     *  carries the same name. */
    _nameEntry() {
        if (!this._entry) return;
        const name = this._addLabel();
        this._entry.setAttribute("aria-label", name);
        if (this._cell()) this._entry.removeAttribute("placeholder");
        else this._entry.placeholder = name;
        if (!this._creating) this._dropdown.setAttribute("aria-label", name);
    }

    /** Polite announcement through the shadow root's live region. Cleared
     *  first and set a frame later, so the same words twice are read twice. */
    _say(text) {
        const live = this._live;
        if (!live) return;
        cancelAnimationFrame(this._sayRaf);
        live.textContent = "";
        if (!text) return;
        this._sayRaf = requestAnimationFrame(() => { live.textContent = text; });
    }

    /** Backspace mark: the chip a second Backspace removes (null = none). */
    _markChip(name) {
        this._marked = name || null;
        if (!this._chipsRoot) return;
        for (const chip of this._chipsRoot.querySelectorAll("sac-chip")) {
            chip.classList.toggle("marked", chip.dataset.name === this._marked);
        }
    }

    _clearMark() {
        if (!this._marked) return;
        this._markChip(null);
        this._say("");
    }

    _render() {
        const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const addLabel = escText(this._addLabel());
        this.shadowRoot.innerHTML = `
            <style>
                :host([disabled]) { opacity: .5; pointer-events: none; }
                :host {
                    display: inline-block;
                    position: relative;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    font-size: 12px;
                    color: var(--text);
                    /* The chips, the ghost button and the text entry take
                       turns in one row, so they share its height: swapping
                       the ghost for the entry never moves what is below.
                       22px is a removable sac-chip (its 14px × + 3px
                       padding + 1px border, twice) — keep in step with it.
                       middle, not baseline: the baseline would come from
                       whichever of them is first (11px ghost text, 12px
                       entry text) and nudge the line by a pixel on the swap. */
                    --_chip-h: 22px;
                    --_row-h: 22px;
                    vertical-align: middle;
                }
                .row {
                    display: inline-flex;
                    flex-wrap: wrap;
                    align-items: center;
                    gap: 4px;
                    min-height: var(--_row-h);
                }
                input.entry {
                    flex: 1 1 80px;
                    min-width: 80px;
                    box-sizing: border-box;
                    height: var(--_row-h);
                    background: transparent;
                    color: inherit;
                    border: none;
                    outline: none;
                    font: inherit;
                    padding: 0 4px;
                }
                input.entry[hidden] { display: none !important; }
                input.entry::placeholder { color: var(--text-dim); opacity: 1; }
                /* Backspace mark: the chip the next Backspace removes —
                   the kit's focus ring, since it has the keyboard's aim. */
                sac-chip.marked {
                    outline: 2px solid var(--accent);
                    outline-offset: 1px;
                    border-radius: 999px;
                }
                /* Screen-reader-only live text. */
                .sr {
                    position: absolute;
                    width: 1px;
                    height: 1px;
                    margin: -1px;
                    padding: 0;
                    overflow: hidden;
                    clip: rect(0 0 0 0);
                    white-space: nowrap;
                    border: 0;
                }

                /* Empty-state affordance: a chip-shaped dashed ghost button so
                   it's obvious you can add entries. */
                button.add-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    box-sizing: border-box;
                    height: var(--_chip-h);
                    padding: 0 9px;
                    border-radius: 999px;
                    border: 1px dashed var(--text-muted);
                    background: transparent;
                    color: var(--text-muted);
                    font: inherit;
                    /* sac-chip's type, line by line — after the font reset
                       (which brought back a normal line-height), so the
                       ghost reads like the chips that replace it. */
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    font-size: 11px;
                    font-weight: 600;
                    letter-spacing: 0.01em;
                    line-height: 1;
                    cursor: pointer;
                    transition: color 100ms, border-color 100ms, background 100ms,
                                transform 0.2s var(--ease-smooth);
                }
                button.add-btn:hover {
                    color: var(--text);
                    border-color: var(--text);
                    background: color-mix(in srgb, var(--fg) 4%, transparent);
                }
                /* Press: answers the moment it goes down. */
                button.add-btn:active:not(:disabled) {
                    transform: scale(0.97);
                    transition-duration: 0.1s;
                }
                button.add-btn[hidden] { display: none !important; }
                button.add-btn .plus { font-weight: 700; }
                .dropdown {
                    /* position:fixed + JS-positioned coordinates so the
                       dropdown lives outside layout flow (no page scrollbar)
                       and we can flip up/down based on viewport space. Shown
                       in the top layer (popover), so a transformed or clipping
                       ancestor cannot catch it — see sac-menu for the why. */
                    position: fixed;
                    inset: auto;                   /* the UA pins popovers to all four sides… */
                    margin: 0;                     /* …and centres them with auto margins */
                    display: block;
                    /* Never wider than the viewport minus the 8px clamp
                       _positionDropdown() keeps on both sides. */
                    min-width: min(220px, 100vw - 16px);
                    max-width: min(360px, 100vw - 16px);
                    max-height: 240px;
                    overflow-y: auto;
                    background: color-mix(in srgb, var(--glass-hue) 96%, transparent);
                    backdrop-filter: blur(14px) saturate(160%);
                    -webkit-backdrop-filter: blur(14px) saturate(160%);
                    border: 1px solid var(--border-strong);
                    border-radius: var(--radius-l);
                    padding: 4px;
                    box-shadow: var(--shadow-2);
                    z-index: 9999;
                }
                :host(:not([open])) .dropdown { display: none; }
                .opt {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 8px;
                    border-radius: var(--radius-m);
                    cursor: pointer;
                    color: var(--text);
                }
                .opt:hover, .opt.hl {
                    background: var(--hover);
                }
                /* Press: a pickable row steps to the strong wash at once. */
                .opt[data-idx]:active {
                    background: var(--hover-strong);
                    transition-duration: 0s;
                }
                .opt .swatch {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    flex-shrink: 0;
                }
                .opt .count {
                    margin-left: auto;
                    font-size: 10px;
                    color: var(--text-muted);
                }
                .opt.create {
                    color: var(--accent);
                    font-weight: 600;
                }
                .opt.create::before {
                    content: "+";
                    width: 14px; text-align: center;
                    color: var(--accent);
                }
                .picker {
                    display: grid;
                    grid-template-columns: repeat(5, 1fr);
                    gap: 6px;
                    padding: 8px;
                }
                .swatch-btn {
                    width: 28px; height: 28px;
                    border-radius: 50%;
                    border: 2px solid transparent;
                    background: var(--palette-gray);
                    cursor: pointer;
                    transition: transform 100ms, border-color 100ms;
                }
                .swatch-btn:hover {
                    transform: scale(1.1);
                    border-color: color-mix(in srgb, var(--fg) 50%, transparent);
                }
                /* Press replaces the lift. Outranks the (hover: none) reset
                   below, so a tap still shows it. */
                .swatch-btn:active:not(:disabled) {
                    transform: scale(0.95);
                    transition-duration: 0.1s;
                }
                .picker-header {
                    padding: 8px 10px 4px;
                    font-size: 11px;
                    color: var(--text-muted);
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }

                /* Touch: 44px rows and targets, 16px type in the field (below
                   16px iOS zooms the page on focus), a wider gap so the chips'
                   × halos do not overlap their neighbours. The row is the
                   entry's 44px; the ghost keeps the chips' 32px (sac-chip's
                   24px touch ×) and a 44px halo, centred in that row. */
                @media (pointer: coarse) {
                    :host { --_chip-h: 32px; --_row-h: 44px; }
                    .row { gap: 12px 10px; }
                    input.entry { font-size: max(16px, 1rem); }
                    button.add-btn { position: relative; }
                    button.add-btn::after,
                    .swatch-btn::after {
                        content: "";
                        position: absolute;
                        inset: min(0px, calc((100% - 44px) / 2));
                    }
                    .opt { min-height: 44px; box-sizing: border-box; }
                    .picker { gap: 8px; }
                    .swatch-btn {
                        position: relative;
                        width: 36px;
                        height: 36px;
                    }
                }
                /* A tap leaves :hover stuck — no lifted swatch, no washed
                   ghost button after the finger is gone. */
                @media (hover: none) {
                    button.add-btn:hover {
                        color: var(--text-muted);
                        border-color: var(--text-muted);
                        background: transparent;
                    }
                    .swatch-btn:hover { transform: none; border-color: transparent; }
                }

                /* size="cell" — the cell-editor contract: one line that
                   fills the cell, the cell's font, no own focus ring. */
                :host([size="cell"]) {
                    display: block;
                    width: 100%;
                    height: 100%;
                    font: inherit;
                    color: inherit;
                }
                :host([size="cell"]) .row {
                    display: flex;
                    flex-wrap: nowrap;
                    width: 100%;
                    height: 100%;
                    padding: 0 var(--cell-padding-inline, 8px);
                    min-height: 0;
                    box-sizing: border-box;
                    overflow-x: auto;
                    scrollbar-width: none;
                }
                :host([size="cell"]) .row::-webkit-scrollbar { display: none; }
                :host([size="cell"]) .row sac-chip { flex: none; }
                :host([size="cell"]) input.entry {
                    flex: 1 0 60px;
                    min-width: 60px;
                    height: 100%;
                    min-height: 0;
                    padding: 0 2px;
                }
                @media (pointer: coarse) {
                    :host([size="cell"]) .row { gap: 6px; }
                    :host([size="cell"]) input.entry { font-size: max(16px, 1em); min-height: 0; }
                }

                /* Scrollbar theme — duplicated because the global rule in
                   ui.css doesn't pierce Shadow DOM. */
                .dropdown::-webkit-scrollbar { width: var(--scrollbar-size); }
                .dropdown::-webkit-scrollbar-track { background: transparent; }
                .dropdown::-webkit-scrollbar-thumb {
                    background: var(--scrollbar-thumb);
                    background-clip: content-box;
                    border: var(--scrollbar-gap) solid transparent;
                    border-radius: 999px;
                }

                /* Reduced transparency / more contrast: the blurred dropdown
                   turns solid; under more contrast its edge shows clearly. */
                @media (prefers-reduced-transparency: reduce) {
                    .dropdown { background: var(--glass-solid); backdrop-filter: none; -webkit-backdrop-filter: none; }
                }
                @media (prefers-contrast: more) {
                    .dropdown { background: var(--glass-solid); backdrop-filter: none; -webkit-backdrop-filter: none; border-color: var(--border-contrast); }
                }
            </style>
            <div class="row" id="row">
                <button type="button" class="add-btn" id="add-btn">
                    <span class="plus">+</span><span class="add-text">${addLabel}</span>
                </button>
                <input class="entry" id="entry" autocomplete="off" hidden
                       role="combobox" aria-autocomplete="list" aria-haspopup="listbox"
                       aria-expanded="false" aria-controls="dropdown"/>
            </div>
            <div class="dropdown" id="dropdown" role="listbox" popover="manual"></div>
            <div class="sr" id="live" role="status"></div>
        `;
        this._chipsRoot = this.shadowRoot.getElementById("row");
        this._entry = this.shadowRoot.getElementById("entry");
        this._entry.disabled = this.disabled;
        this._addBtn = this.shadowRoot.getElementById("add-btn");
        this._addText = this._addBtn.querySelector(".add-text");
        this._dropdown = this.shadowRoot.getElementById("dropdown");
        this._live = this.shadowRoot.getElementById("live");
        this._nameEntry();

        this._addBtn.addEventListener("click", () => {
            // Reveal the input first so focus() lands on a non-hidden element.
            this._addBtn.hidden = true;
            this._entry.hidden = false;
            this._entry.focus();
        });

        // A cell editor opens the list on typing / ↓ only: an Enter or Esc
        // straight after focus then belongs to the grid, not to a list.
        this._entry.addEventListener("focus", () => { if (!this._cell()) this._openDropdown(); });
        this._entry.addEventListener("input", () => {
            this._clearMark();
            this._highlight = 0;
            if (this._cell() && !this._open) this._openDropdown();
            else this._renderDropdown();
        });
        this.addEventListener("focusin", () => {
            if (this._inside) return;
            this._inside = true;
            this._snapshot = [...this._value];
        });
        this.addEventListener("focusout", (e) => {
            if (e.relatedTarget !== this) this._inside = false;
        });
        this._entry.addEventListener("keydown", (e) => this._onKey(e));
        this._entry.addEventListener("blur", () => {
            this._clearMark();
            // After the dropdown closes via outside-click, snap back to the
            // ghost button when the input ends up empty + unfocused.
            queueMicrotask(() => this._refreshAddButton());
        });
        // A click anywhere in the field (a chip, its ×) ends a Backspace mark.
        this._chipsRoot.addEventListener("pointerdown", () => this._clearMark());

        this._renderChips();
        this._refreshAddButton();
    }

    /** Show the ghost button only when there are no chips, the input is not
     *  focused, and the dropdown is closed. */
    _refreshAddButton() {
        if (!this._addBtn || !this._entry) return;
        const empty = this._value.length === 0;
        const inputFocused = this.shadowRoot.activeElement === this._entry;
        const showButton = empty && !inputFocused && !this._open && this._entry.value === "" && !this._cell();
        this._addBtn.hidden = !showButton;
        this._entry.hidden = showButton;
    }

    _renderChips() {
        if (!this._chipsRoot) return;
        // Remove old chips only — keep both the input and the add button.
        for (const node of [...this._chipsRoot.children]) {
            if (node === this._entry || node === this._addBtn) continue;
            node.remove();
        }
        if (this._marked && !this._value.includes(this._marked)) this._marked = null;
        for (const name of this._value) {
            const chip = document.createElement("sac-chip");
            chip.dataset.name = name;
            chip.setAttribute("label", this._labelFor(name));
            chip.setAttribute("color", this._colorFor(name));
            chip.setAttribute("removable", "");
            if (name === this._marked) chip.classList.add("marked");
            chip.addEventListener("sac:remove", () => this._removeChip(name));
            this._chipsRoot.insertBefore(chip, this._addBtn);
        }
    }

    _openDropdown() {
        this._open = true;
        this.setAttribute("open", "");
        this._entry.setAttribute("aria-expanded", "true");
        this._refreshAddButton();
        this._renderDropdown();
        this._raise();                   // top layer before measuring
        this._positionDropdown();
    }

    _closeDropdown() {
        this._open = false;
        this.removeAttribute("open");
        this._entry.setAttribute("aria-expanded", "false");
        this._entry.removeAttribute("aria-activedescendant");
        this._lower();
        this._creating = null;
        this._entry.value = "";
        this._refreshAddButton();
    }

    /* Top layer: a transformed ancestor (a .tile, a card with backdrop-filter)
       would otherwise become the containing block for this fixed panel, and its
       overflow would clip it. There is no close transition here, so leaving the
       layer can be immediate. */
    _raise() {
        const d = this._dropdown;
        if (!d || typeof d.showPopover !== "function" || d.matches(":popover-open")) return;
        try { d.showPopover(); } catch (err) { /* already shown */ }
    }

    _lower() {
        const d = this._dropdown;
        if (!d || typeof d.hidePopover !== "function" || !d.matches(":popover-open")) return;
        try { d.hidePopover(); } catch (err) { /* already hidden */ }
    }

    /** Anchor the fixed-position dropdown to the input's viewport rect.
     *  Opens downward when there's room, otherwise flips up. The space below
     *  ends at the visual viewport's bottom — above an open on-screen
     *  keyboard — and the left edge is clamped 8px inside the viewport so a
     *  field near the right edge of a phone does not push the list off it. */
    _positionDropdown() {
        if (!this._open || !this._dropdown || !this._entry) return;
        const rect = this._entry.getBoundingClientRect();
        const dropdownMax = 240; // matches max-height
        const margin = 4;
        const vv = window.visualViewport;
        const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
        const spaceBelow = viewBottom - rect.bottom;
        const spaceAbove = rect.top;
        const openUp = spaceBelow < dropdownMax + margin && spaceAbove > spaceBelow;
        const top = openUp
            ? Math.max(8, rect.top - Math.min(dropdownMax, spaceAbove - margin) - margin)
            : rect.bottom + margin;
        this._dropdown.style.top = `${top}px`;
        const vw = document.documentElement.clientWidth;
        const width = this._dropdown.offsetWidth;
        this._dropdown.style.left = `${Math.max(8, Math.min(rect.left, vw - 8 - width))}px`;
        this._dropdown.style.maxHeight = `${Math.min(dropdownMax, openUp ? spaceAbove - margin : spaceBelow - margin)}px`;
    }

    _onDocPointer(e) {
        if (!this._open) return;
        if (e.composedPath().includes(this)) return;
        this._closeDropdown();
    }

    _renderDropdown() {
        if (!this._open) return;
        // Kit strings land in TEXT positions of the dropdown HTML.
        const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

        if (this._creating) {
            this._renderColorPicker();
            return;
        }
        this._dropdown.setAttribute("role", "listbox");
        this._dropdown.removeAttribute("aria-labelledby");
        this._dropdown.setAttribute("aria-label", this._addLabel());

        // Match the name and the shown label alike ("zer" finds a "fragile"
        // labelled "Zerbrechlich").
        const q = this._entry.value.trim().toLowerCase();
        const shown = (s) => this._labelFor(s.name).toLowerCase();
        const matches = this._suggestions.filter(s =>
            !this._value.includes(s.name) &&
            (q === "" || s.name.includes(q) || shown(s).includes(q))
        );

        const exact = q && matches.find(s => s.name === q || shown(s) === q);
        const canCreate = this.hasAttribute("allow-create");
        const showCreate = canCreate && q && !exact && this._normalize(q);

        const opts = [];
        for (const t of matches) {
            opts.push({ kind: "existing", entry: t });
        }
        if (showCreate) {
            opts.push({ kind: "create", name: this._normalize(q) });
        }

        // Keep the committed option set in lockstep with what is rendered —
        // including the empty case, or Enter/arrows act on a stale list the
        // user can no longer see (dropdown says "no matches", commit adds one).
        this._currentOpts = opts;
        if (opts.length === 0) {
            this._highlight = 0;
            this._dropdown.innerHTML = `<div class="opt" style="color:var(--text-muted);cursor:default;">${esc(t("chip-input.no-matches", "no matches"))}</div>`;
            this._entry.removeAttribute("aria-activedescendant");
            return;
        }

        if (this._highlight >= opts.length) this._highlight = 0;
        // Rows are options; the highlighted one is aria-selected and the
        // entry's active descendant (focus never leaves the entry).
        const optAttrs = (i) =>
            `id="opt-${i}" role="option" aria-selected="${i === this._highlight ? "true" : "false"}" data-idx="${i}"`;

        // Suggestion names + colors are host-supplied and (unlike committed
        // chips) NOT normalised, so both are untrusted in this innerHTML sink.
        // The color feeds a CSS var name inside a style attribute — restrict it
        // to the slot charset so it can neither break out nor inject.
        const safeSlot = (c) => (/^[a-z0-9_-]+$/i.test(c || "") ? c : "gray");
        const html = opts.map((o, i) => {
            if (o.kind === "create") {
                return `<div class="opt create ${i === this._highlight ? "hl" : ""}" ${optAttrs(i)}>${esc(t("chip-input.create", 'Create "{name}"')).replace("{name}", esc(o.name))}</div>`;
            }
            const color = `var(--palette-${safeSlot(o.entry.color)}, var(--palette-gray))`;
            const count = o.entry.count > 0 ? `<span class="count">${esc(String(o.entry.count))}</span>` : "";
            return `<div class="opt ${i === this._highlight ? "hl" : ""}" ${optAttrs(i)}>
                        <span class="swatch" style="background:${color}" aria-hidden="true"></span>
                        <span>${esc(this._labelFor(o.entry.name))}</span>${count}
                    </div>`;
        }).join("");

        this._dropdown.innerHTML = html;
        this._entry.setAttribute("aria-activedescendant", `opt-${this._highlight}`);
        const hlRow = this._dropdown.querySelector(`#opt-${this._highlight}`);
        if (hlRow && hlRow.scrollIntoView) hlRow.scrollIntoView({ block: "nearest" });
        this._dropdown.querySelectorAll(".opt[data-idx]").forEach(el => {
            el.addEventListener("mouseenter", () => {
                this._highlight = Number(el.dataset.idx);
                this._dropdown.querySelectorAll(".opt").forEach(o => {
                    o.classList.remove("hl");
                    o.setAttribute("aria-selected", "false");
                });
                el.classList.add("hl");
                el.setAttribute("aria-selected", "true");
                this._entry.setAttribute("aria-activedescendant", el.id);
            });
            // mousedown only keeps focus in the entry (so its blur doesn't
            // close us first); the commit waits for the click, which a finger
            // only produces on a tap — a swipe that scrolls the list must not
            // pick whatever row it started on.
            el.addEventListener("mousedown", (e) => e.preventDefault());
            el.addEventListener("click", () => {
                this._highlight = Number(el.dataset.idx);
                this._commit();
            });
        });
    }

    _renderColorPicker() {
        const slots = SacChipInput.PALETTE_SLOTS;
        // Kit string in a TEXT position; the name itself is already-normalised
        // chip data ([a-z0-9_:-] only).
        const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const hint = esc(t("chip-input.pick-color", 'Pick color for "{name}"'))
            .replace("{name}", this._creating);
        const swatches = slots.map(c =>
            `<button type="button" class="swatch-btn" data-color="${c}" style="background:var(--palette-${c})" title="${esc(t(`chip-input.color-${c}`, SLOT_NAMES[c] || c)).replace(/"/g, "&quot;")}"></button>`
        ).join("");
        // Not a list of options now: a named group of swatch buttons.
        this._dropdown.setAttribute("role", "group");
        this._dropdown.setAttribute("aria-labelledby", "picker-header");
        this._dropdown.removeAttribute("aria-label");
        this._entry.removeAttribute("aria-activedescendant");
        this._dropdown.innerHTML = `
            <div class="picker-header" id="picker-header">${hint}</div>
            <div class="picker">${swatches}</div>
        `;
        this._dropdown.querySelectorAll(".swatch-btn").forEach(btn => {
            btn.addEventListener("mousedown", (e) => e.preventDefault());   // keep focus in the entry
            btn.addEventListener("click", () => {
                const color = btn.dataset.color;
                const name = this._creating;
                this._creating = null;
                this._colors.set(name, color);
                this.dispatchEvent(new CustomEvent("sac:create", {
                    detail: { name, color },
                    bubbles: true, composed: true,
                }));
                this._addChip(name);
                this._entry.value = "";
                this._renderDropdown();
                this._entry.focus();
                if (this._cell()) this._closeDropdown();
            });
        });
    }

    _onKey(e) {
        // Backspace on an empty entry: the first press marks the last chip,
        // the second removes it. A held key (repeat) never removes; any other
        // key (modifiers aside) drops the mark.
        if (e.key === "Backspace" && this._entry.value === "" && this._value.length > 0 && !this._creating) {
            e.preventDefault();
            if (e.repeat) return;
            const last = this._value[this._value.length - 1];
            const label = this._labelFor(last);
            if (this._marked === last) {
                this._markChip(null);
                this._removeChip(last);
                this._say(t("chip-input.removed", "{name} removed").replace("{name}", () => label));
            } else {
                this._markChip(last);
                this._say(t("chip-input.backspace-again", "Press Backspace again to remove {name}").replace("{name}", () => label));
            }
            return;
        }
        if (!["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"].includes(e.key)) this._clearMark();

        if (this._cell() && this._onCellKey(e)) return;
        if (this._creating) {
            if (e.key === "Escape") { this._creating = null; this._renderDropdown(); e.preventDefault(); }
            return;
        }

        if (!this._open) {
            if (e.key === "ArrowDown") { this._openDropdown(); e.preventDefault(); }
            return;
        }

        if (e.key === "Escape") { this._closeDropdown(); e.preventDefault(); return; }

        const opts = this._currentOpts || [];
        if (e.key === "ArrowDown") {
            this._highlight = Math.min(this._highlight + 1, opts.length - 1);
            this._renderDropdown(); e.preventDefault(); return;
        }
        if (e.key === "ArrowUp") {
            this._highlight = Math.max(this._highlight - 1, 0);
            this._renderDropdown(); e.preventDefault(); return;
        }
        if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
            if (opts.length === 0) {
                // No suggestions; if input is normalisable and creation is
                // allowed, treat as create.
                const n = this.hasAttribute("allow-create") ? this._normalize(this._entry.value) : "";
                if (n) {
                    this._creating = n;
                    this._renderDropdown();
                    e.preventDefault();
                }
                return;
            }
            this._commit();
            e.preventDefault();
        }
    }

    /** size="cell": Enter / Escape / Tab per the cell-editor contract.
     *  Returns true when the key was handled here. */
    _onCellKey(e) {
        const k = e.key;
        if (k !== "Enter" && k !== "Escape" && k !== "Tab") return false;
        const opts = this._currentOpts || [];
        const typed = this._entry.value.trim() !== "";
        if (k === "Tab") {                                   // never swallowed
            const opt = opts[this._highlight];
            if (this._open && typed && opt && opt.kind === "existing") this._addChip(opt.entry.name);
            if (this._open) this._closeDropdown();
            return true;
        }
        if (this._creating) { e.stopPropagation(); return false; }   // the colour step keeps its own keys
        e.preventDefault();
        e.stopPropagation();
        if (k === "Escape") {
            if (this._open) { this._closeDropdown(); return true; }
            this.value = this._snapshot;
            this._emitCell("sac:cancel");
            return true;
        }
        // Enter: an open list takes it (pick / create), else it commits.
        if (this._open) {
            if (opts.length) this._commit();
            else if (this.hasAttribute("allow-create") && this._normalize(this._entry.value)) {
                this._creating = this._normalize(this._entry.value);
                this._renderDropdown();
            }
            if (!this._creating) this._closeDropdown();
            return true;
        }
        this._emitCell("sac:commit", e.shiftKey);
        return true;
    }

    _emitCell(type, shiftKey) {
        const detail = { value: [...this._value] };
        if (type === "sac:commit") detail.shiftKey = !!shiftKey;
        this.dispatchEvent(new CustomEvent(type, {
            detail, bubbles: true, composed: true,
        }));
    }

    _commit() {
        const opt = this._currentOpts?.[this._highlight];
        if (!opt) return;
        if (opt.kind === "create") {
            this._creating = opt.name;
            this._renderDropdown();
            return;
        }
        this._addChip(opt.entry.name);
        this._entry.value = "";
        this._highlight = 0;
        this._renderDropdown();
        if (this._cell()) this._closeDropdown();             // a cell editor: one pick, list gone
    }

    _addChip(name) {
        const n = this._normalize(name);
        if (!n || this._value.includes(n)) return;
        this._value = [...this._value, n];
        this._renderChips();
        this._refreshAddButton();
        this._emit();
    }

    _removeChip(name) {
        const next = this._value.filter(t => t !== name);
        if (next.length === this._value.length) return;
        this._value = next;
        this._renderChips();
        if (this._open) this._renderDropdown();
        this._refreshAddButton();
        this._emit();
    }

    _emit() {
        this.dispatchEvent(new CustomEvent("sac:change", {
            detail: { value: [...this._value] },
            bubbles: true, composed: false,   // native change semantics (value control)
        }));
    }
}

customElements.define("sac-chip-input", SacChipInput);
})();
