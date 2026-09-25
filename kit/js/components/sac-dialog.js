/**
 * <sac-dialog>  —  Modal confirm dialog.
 *
 * Shadow-DOM, glass-styled, centered overlay. General primitive; the common
 * "ask a question, get an answer" case is wrapped by `sac.dialog.confirm()`
 * (kit/js/lib/dialog.js).
 *
 * Usage:
 *   const dlg = document.createElement("sac-dialog");
 *   dlg.setAttribute("title", "Delete?");
 *   dlg.buttons = [
 *     { action: "cancel", label: "Cancel", kind: "default" },
 *     { action: "delete", label: "Delete", kind: "destructive", armAfterMs: 2000 },
 *   ];
 *   dlg.append(Object.assign(document.createElement("p"), { textContent: "…" }));
 *   document.body.appendChild(dlg);
 *   dlg.addEventListener("sac:action", e => console.log(e.detail.action));
 *   dlg.open();
 *
 * Keyboard:
 *   - Escape            → close with action=null.
 *   - Enter             → activates focused button (native).
 *   - Tab / Shift-Tab   → cycles between buttons (focus trap).
 *
 * Arming:
 *   - A button with armAfterMs waits N ms, then receives focus so Enter acts.
 *   - If the user's pointer enters (or a finger touches) any other button
 *     before the arm fires, the timer is cancelled — we don't steal focus
 *     from an actively-interacting user.
 *
 * Buttons: { action, label, kind: "default"|"primary"|"destructive",
 *            armAfterMs?, disabled? }. setDisabled(action, flag) toggles one
 *            later (a Save that waits for a filename).
 *
 * Validation: dlg.beforeAction = (action) => boolean | Promise<boolean>.
 *   Called on every BUTTON click (and trigger(action)); answering false keeps
 *   the dialog open — an overwrite question, an empty required field.
 *   Escape and the backdrop always cancel (action=null) without asking.
 *   trigger(action) runs a button's action from code, e.g. Enter in a field.
 *
 * Width: --dialog-width (default 420px) on the element — a dialog holding a
 *   file list wants more room than a question.
 *
 * Compact (≤768px, or a phone held sideways — ui.css §15): a BOTTOM SHEET — full width, anchored to the
 * bottom edge above the home-indicator safe area, at most 85dvh tall with the
 * body scrolling, actions full-width and stacked (the last button, usually
 * the primary one, on top). Focus trap and Escape are unchanged.
 */
class SacDialog extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this.buttons = [];
        this._armTimer = null;
        this._resolved = false;
        this._onKeydown = this._onKeydown.bind(this);
    }

    static get observedAttributes() { return ["title"]; }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
    }

    attributeChangedCallback() {
        if (this.shadowRoot.firstChild) this._renderHeader();
    }

    open() {
        this._resolved = false;
        // Remember who to hand focus back to when we close (the trigger).
        this._restoreFocus = document.activeElement;
        this._render();
        this.setAttribute("open", "");
        // Host focus so keydown routes here even before any button is focused.
        this.focus();
        document.addEventListener("keydown", this._onKeydown, true);
        this._startArmTimer();
        this.dispatchEvent(new CustomEvent("sac:open", { bubbles: true, composed: true }));
    }

    close(action = null) {
        if (this._resolved) return;
        this._resolved = true;
        this._cancelArmTimer();
        document.removeEventListener("keydown", this._onKeydown, true);
        this.removeAttribute("open");
        // Return focus to the element that opened us — a modal that drops focus
        // on the body strands keyboard and screen-reader users.
        const back = this._restoreFocus;
        this._restoreFocus = null;
        if (back && back.isConnected && typeof back.focus === "function") {
            back.focus({ preventScroll: true });
        }
        this.dispatchEvent(new CustomEvent("sac:action", { detail: { action }, bubbles: true, composed: true }));
    }

    /** Everything Tab should cycle: slotted interactive content (links, inputs
     *  in the message) first, then the dialog's own action buttons. The old
     *  trap saw only the buttons, so a link in the body was unreachable. */
    _focusables() {
        const sel = 'a[href], button:not([disabled]), input:not([disabled]), ' +
            'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        return [
            ...Array.from(this.querySelectorAll(sel)),
            ...Array.from(this.shadowRoot.querySelectorAll(".btn")),
        ];
    }

    _onKeydown(e) {
        if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            this.close(null);
            return;
        }
        if (e.key === "Tab") {
            // Focus trap across ALL focusables — slotted content and buttons.
            const items = this._focusables();
            if (items.length === 0) return;
            // A shadow button reads from shadowRoot.activeElement; a focused
            // slotted (light-DOM) element does not, so fall back to document.
            const active = this.shadowRoot.activeElement || document.activeElement;
            const idx = items.indexOf(active);
            let next;
            if (e.shiftKey) next = items[(idx <= 0 ? items.length : idx) - 1];
            else            next = items[(idx + 1) % items.length];
            e.preventDefault();
            next.focus();
        }
    }

    /** Run a button's action as if clicked: ask beforeAction, then close. */
    async trigger(action) {
        if (this._resolved || this._asking) return;
        if (typeof this.beforeAction === "function") {
            this._asking = true;
            let ok;
            try { ok = await this.beforeAction(action); }
            catch (err) { console.error("[sac-dialog] beforeAction threw:", err); ok = false; }
            finally { this._asking = false; }
            if (ok === false) return;
        }
        this.close(action);
    }

    /** Enable / disable one action's button. */
    setDisabled(action, flag) {
        const spec = this.buttons.find((b) => b.action === action);
        if (spec) spec.disabled = !!flag;
        const btn = Array.from(this.shadowRoot.querySelectorAll(".btn"))
            .find((b) => b.dataset.action === String(action));
        if (btn) btn.disabled = !!flag;
    }

    _startArmTimer() {
        const armed = this.buttons.findIndex(b => b.armAfterMs > 0);
        if (armed < 0) return;
        const ms = this.buttons[armed].armAfterMs;
        this._armTimer = setTimeout(() => {
            this._armTimer = null;
            const btn = this.shadowRoot.querySelectorAll(".btn")[armed];
            if (!btn) return;
            // .armed gives the explicit visual cue — :focus-visible won't
            // fire reliably for programmatic focus (Chrome hides the ring
            // when focus is set by script without a prior keyboard event).
            btn.classList.add("armed");
            btn.focus();
        }, ms);
    }

    _cancelArmTimer() {
        if (this._armTimer != null) {
            clearTimeout(this._armTimer);
            this._armTimer = null;
        }
    }

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    position: fixed;
                    inset: 0;
                    z-index: 20000;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    outline: none;
                }
                :host([open]) { display: flex; }

                .backdrop {
                    position: absolute;
                    inset: 0;
                    background: color-mix(in srgb, var(--sink) 50%, transparent);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    opacity: 0;
                    animation: fade-in 150ms ease-out forwards;
                }

                .panel {
                    position: relative;
                    width: var(--dialog-width, 420px);
                    max-width: calc(100vw - 32px);
                    /* A content-heavy dialog (an About panel, an explainer)
                       must never outgrow the viewport — centered, both ends
                       would be clipped with no way to reach them. The panel
                       caps out and the BODY scrolls; title and actions stay.
                       dvh, not vh: mobile URL bars shrink the visual
                       viewport under 100vh. */
                    max-height: calc(100dvh - 32px);
                    display: flex;
                    flex-direction: column;
                    background: color-mix(in srgb, var(--surface) 75%, transparent);
                    backdrop-filter: blur(20px) saturate(180%);
                    -webkit-backdrop-filter: blur(20px) saturate(180%);
                    border: 1px solid var(--border-strong);
                    border-radius: var(--radius-l);
                    box-shadow:
                        0 20px 50px color-mix(in srgb, var(--sink) 50%, transparent),
                        inset 0 0 0 1px color-mix(in srgb, var(--fg) 5%, transparent);
                    opacity: 0;
                    transform: scale(0.96);
                    animation: pop-in 150ms ease-out forwards;
                    color: var(--text);
                }

                .title {
                    flex: none;
                    font-family: 'Outfit', sans-serif;
                    font-weight: 700;
                    font-size: 1.05rem;
                    letter-spacing: -0.01em;
                    padding: 20px 20px 0;
                    color: var(--text);
                }

                .body {
                    flex: 1 1 auto;
                    min-height: 0;
                    overflow-y: auto;
                    padding: 8px 20px 20px;
                    font-size: 0.9rem;
                    line-height: 1.5;
                    color: var(--text-muted);
                }
                /* Scrollbar — the kit recipe (ui.css §5), re-stated because
                   ::-webkit-scrollbar does not pierce a shadow root. Firefox, which has
                   no ::-webkit-scrollbar, gets the standard pair instead. */
                .body::-webkit-scrollbar { width: 10px; height: 10px; }
                .body::-webkit-scrollbar-track { background: transparent; }
                .body::-webkit-scrollbar-thumb {
                    background: var(--scrollbar-thumb);
                    background-clip: content-box;
                    border: 2px solid transparent;
                    border-radius: 999px;
                }
                .body::-webkit-scrollbar-thumb:hover {
                    background: var(--scrollbar-thumb-hover);
                    background-clip: content-box;
                }
                .body::-webkit-scrollbar-corner { background: transparent; }
                @supports not selector(::-webkit-scrollbar) {
                    .body { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) transparent; }
                }
                .body ::slotted(p) { margin: 0; }
                /* No combinators inside ::slotted() — it takes a compound
                   selector only, anything else is silently dropped. The
                   structural pseudo-class matches against the light-DOM
                   siblings and does the same job. */
                .body ::slotted(p:not(:first-of-type)) { margin-top: 8px; }

                .actions {
                    flex: none;
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    padding: 12px 20px 20px;
                }

                /* Shared language for all three kinds: subtle tinted bg,
                   colored text, matching-color border on hover. The only
                   difference between kinds is the accent hue. */
                .btn {
                    font: 600 0.85rem 'Inter', sans-serif;
                    padding: 8px 16px;
                    border-radius: var(--radius-m);
                    cursor: pointer;
                    border: 1px solid transparent;
                    background: color-mix(in srgb, var(--fg) 6%, transparent);
                    color: var(--text);
                    transition: background 120ms, color 120ms, border-color 120ms, box-shadow 120ms;
                    outline: none;
                }
                .btn:hover {
                    background: var(--hover-strong);
                    border-color: color-mix(in srgb, var(--fg) 18%, transparent);
                }
                .btn:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 2px;
                }
                .btn:disabled { opacity: 0.45; cursor: default; pointer-events: none; }
                .actions:empty { display: none; }

                /* Ghost buttons: translucent washes, so the ink must follow
                   the THEME (-text variants / --text), never --on-accent —
                   white on a pale wash is unreadable in light. */
                .btn.primary {
                    background: color-mix(in srgb, var(--accent) 18%, transparent);
                    color: var(--accent-text);
                    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
                }
                .btn.primary:hover {
                    background: color-mix(in srgb, var(--accent) 32%, transparent);
                    color: var(--text);
                    border-color: var(--accent);
                }

                .btn.destructive {
                    background: color-mix(in srgb, var(--danger) 12%, transparent);
                    color: var(--danger-text);
                    border-color: color-mix(in srgb, var(--danger) 30%, transparent);
                }
                .btn.destructive:hover {
                    background: color-mix(in srgb, var(--danger) 26%, transparent);
                    color: var(--text);
                    border-color: var(--danger);
                }
                .btn.destructive:focus-visible {
                    outline-color: var(--danger);
                }

                /* .armed is added by the arming timer so the destructive
                   button has an unmistakable cue independent of
                   :focus-visible (which JS focus can't reliably trigger). */
                .btn.armed {
                    background: color-mix(in srgb, var(--danger) 26%, transparent);
                    color: var(--text);
                    border-color: var(--danger);
                    box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 28%, transparent);
                }

                @keyframes fade-in {
                    to { opacity: 1; }
                }
                @keyframes sheet-in {
                    from { opacity: 1; transform: translateY(100%); }
                    to   { opacity: 1; transform: none; }
                }

                @media (max-width: 768px), (max-height: 480px) and (pointer: coarse) {
                    :host { align-items: flex-end; }
                    .panel {
                        width: 100%;
                        max-width: 100%;
                        max-height: 85dvh;
                        border-bottom: none;
                        border-radius: var(--radius-l) var(--radius-l) 0 0;
                        padding-bottom: env(safe-area-inset-bottom, 0px);
                        transform: translateY(100%);
                        animation: sheet-in 220ms var(--ease-smooth) forwards;
                    }
                    .actions {
                        flex-direction: column-reverse;
                        align-items: stretch;
                    }
                    .btn { width: 100%; }
                }
                @media (pointer: coarse) {
                    .btn { min-height: 44px; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .backdrop, .panel { animation-duration: 1ms; }
                }
                @keyframes pop-in {
                    to { opacity: 1; transform: scale(1); }
                }
            </style>
            <div class="backdrop" part="backdrop"></div>
            <div class="panel" part="panel" role="dialog" aria-modal="true">
                <div class="title" id="dlg-title"></div>
                <div class="body"><slot></slot></div>
                <div class="actions"></div>
            </div>
        `;
        this._renderHeader();
        this._renderButtons();
        this.shadowRoot.querySelector(".backdrop").addEventListener("click", () => this.close(null));
    }

    _renderHeader() {
        const el = this.shadowRoot.getElementById("dlg-title");
        const title = this.getAttribute("title") || "";
        if (el) el.textContent = title;
        // Name the dialog by its title for assistive tech — but only when there
        // IS one, or aria-labelledby would point at an empty node.
        const panel = this.shadowRoot.querySelector(".panel");
        if (panel) {
            if (title) panel.setAttribute("aria-labelledby", "dlg-title");
            else       panel.removeAttribute("aria-labelledby");
        }
    }

    _renderButtons() {
        const row = this.shadowRoot.querySelector(".actions");
        row.innerHTML = "";
        this.buttons.forEach((spec) => {
            const btn = document.createElement("button");
            btn.className = "btn" + (spec.kind && spec.kind !== "default" ? " " + spec.kind : "");
            btn.type = "button";
            btn.textContent = spec.label;
            btn.dataset.action = spec.action == null ? "" : String(spec.action);
            btn.disabled = !!spec.disabled;
            btn.addEventListener("click", () => this.trigger(spec.action));
            // Any pointer interaction with a *different* button cancels the
            // arm timer so we don't yank focus from the user. pointerdown is
            // the touch equivalent: a finger never "enters" before it lands.
            const disarm = () => {
                if (this._armTimer != null) {
                    const armedIdx = this.buttons.findIndex(b => b.armAfterMs > 0);
                    const myIdx = this.buttons.indexOf(spec);
                    if (myIdx !== armedIdx) this._cancelArmTimer();
                }
            };
            btn.addEventListener("mouseenter", disarm);
            btn.addEventListener("pointerdown", disarm);
            row.appendChild(btn);
        });
    }
}

customElements.define("sac-dialog", SacDialog);
