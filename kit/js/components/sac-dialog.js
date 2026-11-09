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
 *   - On open           → a button has focus, so Enter acts at once: the one
 *                         marked `default: true`, else the first primary,
 *                         else the first that isn't destructive (Cancel) —
 *                         disabled ones and one still waiting to arm skipped.
 *                         A body element with `autofocus` takes it instead;
 *                         so does a field focused right after open() (a
 *                         prompt's), and Enter there presses the primary.
 *   - ← / → (↑ / ↓)     → move focus through the action buttons while focus
 *                         is on one of them (or the dialog itself): wrapping,
 *                         disabled ones skipped; Home / End = first / last.
 *                         ↑ / ↓ follow the bottom sheet's stacked buttons.
 *                         Inside the body's fields the arrows are theirs.
 *   - Enter / Space     → presses the focused button (native). A focus ring
 *                         marks it — also when script set the focus, where
 *                         :focus-visible stays dark — never after a click.
 *   - Escape            → dismiss (action=null, asked first — see Dismissal).
 *                         Something inside the dialog
 *                         that handles Escape itself goes first: an open field
 *                         popover (sac-select list, sac-date-field calendar),
 *                         a menu, a field reverting its typing. It consumes
 *                         the key (stopPropagation or preventDefault) and the
 *                         dialog stays; the next Escape closes it.
 *   - Tab / Shift-Tab   → focus trap over everything focusable in the body,
 *                         then the buttons, in document order — including
 *                         the inputs inside kit fields' shadow roots, and
 *                         from inside another component's shadow root.
 *   Only the topmost open dialog handles keys.
 *
 * Arming:
 *   - A button with armAfterMs waits N ms, then receives focus so Enter acts.
 *     Until then the dialog sits on the safe button (the order above).
 *   - Any key (an arrow, Tab, typing) and the pointer entering (or a finger
 *     touching) any other button cancel the timer — we never steal focus
 *     from an actively-interacting user. Nor does it fire into a field.
 *
 * Buttons: { action, label, kind: "default"|"primary"|"destructive",
 *            default?, armAfterMs?, disabled?, labelKey? }. `default: true`
 *            = the button focused on open.
 *
 *            setDisabled(action, flag)
 *            toggles one later (a Save that waits for a filename). labelKey
 *            makes `label` the English fallback of sac.t(labelKey): the
 *            button then follows a runtime language switch in place.
 *
 * Validation: dlg.beforeAction = (action, info) => boolean | Promise<boolean>.
 *   Called on every BUTTON click (and trigger(action)); answering false keeps
 *   the dialog open — an overwrite question, an empty required field.
 *   trigger(action) runs a button's action from code, e.g. Enter in a field.
 *   Since 2.36 it is also asked on every dismissal (see below) with
 *   action=null and info = { via: "escape" | "backdrop" | "swipe" }, so an
 *   app can confirm ("Discard changes?") or refuse. While an answer is
 *   pending, further buttons and dismissals wait. A beforeAction that throws
 *   on a dismissal lets it close (one written before null was passed must
 *   not trap anyone); on a button it keeps the dialog open, as before.
 *   close(action) from code never asks.
 *
 * Dismissal (Escape, a backdrop tap, pulling the bottom sheet down):
 *   - All three go through beforeAction(null, { via }) first.
 *   - Edit guard: once a field in the body has been edited since open() — an
 *     input, change or sac:change event from the body — the backdrop and the
 *     swipe no longer dismiss: a backdrop tap only nudges the panel, a pulled
 *     sheet resists and springs back. Escape and an explicit Cancel / close
 *     button still close, so a typed text is never thrown away by a stray
 *     tap. Attribute light-dismiss: absent = this guard (the default);
 *     "always" = backdrop and swipe always dismiss (the pre-2.36 behaviour);
 *     "never" = only Escape and the buttons close.
 *   - Property edited (boolean): true once the guard has seen an edit. An
 *     app may set it (content changed by other means: a canvas, a drop) or
 *     clear it (a draft was just saved).
 *
 * Width: --dialog-width (default 420px) on the element — a dialog holding a
 *   file list wants more room than a question.
 *
 * Compact (≤768px, or a phone held sideways — ui.css §15): a BOTTOM SHEET — full width, anchored to the
 * bottom edge above the home-indicator safe area, at most 85dvh tall with the
 * body scrolling, actions full-width and stacked (the last button, usually
 * the primary one, on top). Focus trap and Escape are unchanged.
 *   The grabber bar and the title row pull the sheet: it follows the finger
 *   1:1 (and resists upwards); let go past its middle — or flick it down —
 *   and it leaves (a dismissal, like Escape: asked first), else it springs
 *   back. Held by the edit guard (see Dismissal) it resists downwards too
 *   and always springs back. Caught
 *   mid-flight, it carries on from where it is. Needs sac.motion
 *   (lib/motion.js); without it the sheet does not pull.
 *
 * Closing leaves the way it came: the sheet slides back down, a centred
 * dialog shrinks and fades (mirroring the entry). sac:action fires at once;
 * the element keeps [open] (and gets [closing], no pointer events) until the
 * exit has played, then fires sac:closed. Remove the element on sac:closed,
 * not on sac:action, or the exit is cut short (sac.dialog.* do this).
 *
 * Events: sac:open · sac:action { action } · sac:closed — all bubble +
 *   composed.
 */
class SacDialog extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this.buttons = [];
        this._armTimer = null;
        this._resolved = false;
        this._pointer = false;        // the last focus came from the pointer: no ring
        this._edited = false;         // the edit guard (see Dismissal)
        this._onKeydown = this._onKeydown.bind(this);
        // Escape from inside the dialog, bubble phase: see _onKeydown.
        this.addEventListener("keydown", (e) => this._onInnerEscape(e));
        // The edit guard: a field in the body changed since open(). Native
        // input/change are composed, so a kit field's inner input counts;
        // kit fields that only speak sac:change count through that.
        const edited = () => { if (this.hasAttribute("open") && !this._resolved) this._edited = true; };
        for (const type of ["input", "change", "sac:change"]) this.addEventListener(type, edited);
    }

    /** True once a field in the body was edited since open() (see Dismissal). */
    get edited() { return !!this._edited; }
    set edited(v) { this._edited = !!v; }

    static get observedAttributes() { return ["title"]; }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
        if (window.sac && sac.lang && !this._offLang) this._offLang = sac.lang.onChange(() => this._relabel());
    }

    disconnectedCallback() {
        if (this._offLang) { this._offLang(); this._offLang = null; }
        // Removed while open, without close(): stop trapping keys.
        const at = SacDialog._open.indexOf(this);
        if (at >= 0) SacDialog._open.splice(at, 1);
        document.removeEventListener("keydown", this._onKeydown, true);
    }

    /** A button's text: its labelKey through sac.t (label = the English
     *  fallback), else the caller's label as given. */
    static _label(spec) {
        return (spec.labelKey && window.sac && window.sac.t)
            ? window.sac.t(spec.labelKey, spec.label) : spec.label;
    }

    /** Language switch: buttons with a labelKey, in place — focus, the arm
     *  timer and disabled state are untouched. Title and body are the
     *  caller's. */
    _relabel() {
        this.shadowRoot.querySelectorAll(".actions .btn").forEach((btn, i) => {
            const spec = this.buttons[i];
            if (spec && spec.labelKey) btn.textContent = SacDialog._label(spec);
        });
    }

    attributeChangedCallback() {
        if (this.shadowRoot.firstChild) this._renderHeader();
    }

    open() {
        this._resolved = false;
        this._edited = false;
        this._swiped = false;
        this._sheetY = 0;
        this.removeAttribute("closing");
        // Remember who to hand focus back to when we close (the trigger).
        this._restoreFocus = document.activeElement;
        this._render();
        this.setAttribute("open", "");
        // Host focus so keydown routes here even before any button is focused.
        this.focus();
        document.addEventListener("keydown", this._onKeydown, true);
        if (!SacDialog._open.includes(this)) SacDialog._open.push(this);
        // Enter acts at once: a body element marked autofocus, else the
        // default button. A caller that focuses a field next keeps it.
        const auto = this.querySelector("[autofocus]");
        if (auto) auto.focus();
        else { const btn = this._defaultButton(); if (btn) this._focusButton(btn); }
        this._startArmTimer();
        this.dispatchEvent(new CustomEvent("sac:open", { bubbles: true, composed: true }));
    }

    close(action = null) {
        if (this._resolved) return;
        this._resolved = true;
        this._cancelArmTimer();
        document.removeEventListener("keydown", this._onKeydown, true);
        const at = SacDialog._open.indexOf(this);
        if (at >= 0) SacDialog._open.splice(at, 1);
        if (this._sheetSpring) { this._sheetSpring.stop(); this._sheetSpring = null; }
        this._leave();
        // Return focus to the element that opened us — a modal that drops focus
        // on the body strands keyboard and screen-reader users.
        const back = this._restoreFocus;
        this._restoreFocus = null;
        if (back && back.isConnected && typeof back.focus === "function") {
            back.focus({ preventScroll: true });
        }
        this.dispatchEvent(new CustomEvent("sac:action", { detail: { action }, bubbles: true, composed: true }));
    }

    /** Everything Tab should cycle, in composed order: the body's content
     *  (slots followed, shadow roots walked, so a kit field's inner input is
     *  listed) and then the dialog's own action buttons. A host that holds
     *  focusables of its own is left out — its insides are the stops. */
    _focusables() {
        const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
            'select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], ' +
            '[tabindex]:not([tabindex="-1"])';
        const out = [];
        const walk = (el) => {
            if (el.hidden || el.inert) return;
            if (el.localName === "slot") {
                const assigned = el.assignedElements({ flatten: true });
                (assigned.length ? assigned : Array.from(el.children)).forEach(walk);
                return;
            }
            const at = out.length;
            const self = el.matches(sel) && el.getClientRects().length > 0;
            if (self) out.push(el);
            Array.from((el.shadowRoot || el).children).forEach(walk);
            if (self && el.shadowRoot && out.length > at + 1) out.splice(at, 1);
        };
        Array.from(this.shadowRoot.children).forEach(walk);
        // A radio group is one stop, as natively: its checked radio, else
        // its first one. A group = same name within the same form or root.
        const radio = (el) => el.localName === "input" && el.type === "radio" && el.name;
        const pick = new Map();
        for (const el of out) {
            if (!radio(el)) continue;
            const owner = el.form || el.getRootNode();
            if (!pick.has(owner)) pick.set(owner, new Map());
            const g = pick.get(owner), cur = g.get(el.name);
            if (!cur || (el.checked && !cur.checked)) g.set(el.name, el);
        }
        return out.filter((el) => !radio(el) ||
            pick.get(el.form || el.getRootNode()).get(el.name) === el);
    }

    /** The focused element itself, down through every open shadow root —
     *  document.activeElement only names the outermost host. */
    static _deepActive() {
        let a = document.activeElement;
        while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
        return a;
    }

    /** The button focused on open: `default: true`, else the first primary,
     *  else the first non-destructive — never disabled, never one waiting to arm. */
    _defaultButton() {
        const btns = this.shadowRoot.querySelectorAll(".actions .btn");
        const ok = (spec, i) => btns[i] && !btns[i].disabled && !(spec.armAfterMs > 0);
        const pick = (test) => this.buttons.findIndex((b, i) => test(b) && ok(b, i));
        let i = pick((b) => b.default);
        if (i < 0) i = pick((b) => b.kind === "primary");
        if (i < 0) i = pick((b) => b.kind !== "destructive");
        return i < 0 ? null : btns[i];
    }

    _focusButton(btn) {
        this._pointer = false;
        btn.focus({ preventScroll: true });
    }

    /** ← / → (and ↑ / ↓, Home / End) through the enabled action buttons —
     *  only while focus is on one of them or on the dialog itself. */
    _moveButtons(e) {
        const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1, Home: "first", End: "last" };
        if (!(e.key in steps) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
        const row = this.shadowRoot.querySelector(".actions");
        const btns = Array.from(row.querySelectorAll(".btn")).filter((b) => !b.disabled);
        const act = SacDialog._deepActive();
        const at = btns.indexOf(act);
        if (!btns.length || (at < 0 && act !== this)) return false;
        e.preventDefault();
        let step = steps[e.key];
        // The bottom sheet stacks them last-on-top: ↑ is the next one there.
        if ((e.key === "ArrowUp" || e.key === "ArrowDown")
            && getComputedStyle(row).flexDirection === "column-reverse") step = -step;
        const n = btns.length;
        const to = step === "first" ? 0 : step === "last" ? n - 1
            : at < 0 ? (step > 0 ? 0 : n - 1) : (at + step + n) % n;
        this._focusButton(btns[to]);
        return true;
    }

    _onKeydown(e) {
        if (SacDialog._open[SacDialog._open.length - 1] !== this) return;
        // The user is on the keys: the arm timer never takes focus from them,
        // and a focus they move gets its ring.
        this._pointer = false;
        if (e.key !== "Escape") this._cancelArmTimer();
        if (this._moveButtons(e)) return;
        if (e.key === "Escape") {
            // From inside the dialog: the target gets its say first (an open
            // popover, a field reverting) — _onInnerEscape decides on the way
            // back up. From outside (focus on the page): close right here.
            if (e.composedPath().includes(this)) return;
            e.stopPropagation();
            e.preventDefault();
            this._dismiss("escape");
            return;
        }
        if (e.key === "Tab") {
            const items = this._focusables();
            if (items.length === 0) return;
            const idx = items.indexOf(SacDialog._deepActive());
            const step = e.shiftKey ? -1 : 1;
            let at = idx === -1 ? (e.shiftKey ? items.length : -1) : idx;
            e.preventDefault();
            // Walk on past anything that refuses focus (visibility: hidden,
            // a component that swallows focus()) — a stuck Tab is a trap
            // you cannot leave.
            for (let n = 0; n < items.length; n++) {
                at = (at + step + items.length) % items.length;
                items[at].focus();
                const now = SacDialog._deepActive();
                if (now === items[at] || (now && items[at].contains(now))) return;
            }
        }
    }

    /** Escape that bubbled out of the dialog's content unconsumed dismisses
     *  it. preventDefault here keeps sac.hotkeys (document, bubble) out of it. */
    _onInnerEscape(e) {
        if (e.key !== "Escape" || e.defaultPrevented || this._resolved) return;
        if (!this.hasAttribute("open") || SacDialog._open[SacDialog._open.length - 1] !== this) return;
        e.stopPropagation();
        e.preventDefault();
        this._dismiss("escape");
    }

    /** Backdrop and swipe may dismiss: light-dismiss="always" / "never",
     *  else only while nothing in the body was edited (the edit guard). */
    _lightDismiss() {
        const mode = this.getAttribute("light-dismiss");
        if (mode === "always") return true;
        if (mode === "never") return false;
        return !this._edited;
    }

    /** beforeAction(null, { via }) for a dismissal: true / false, or a
     *  Promise of that when the answer is async. A guard that throws lets
     *  the dismissal through (see Validation). */
    _askDismiss(via) {
        if (typeof this.beforeAction !== "function") return true;
        let answer;
        try { answer = this.beforeAction(null, { via }); }
        catch (err) { console.error("[sac-dialog] beforeAction threw:", err); return true; }
        if (!answer || typeof answer.then !== "function") return answer !== false;
        this._asking = true;
        return Promise.resolve(answer)
            .then((ok) => ok !== false, (err) => { console.error("[sac-dialog] beforeAction threw:", err); return true; })
            .finally(() => { this._asking = false; });
    }

    /** Escape or a backdrop tap (the swipe asks in _wireSheet): the edit
     *  guard first (backdrop only), then beforeAction, then close(null).
     *  A refusal on the spot nudges the panel, so the key or tap is seen to
     *  land; an async answer is the app's own to show. */
    _dismiss(via) {
        if (this._resolved || this._asking) return;
        if (via !== "escape" && !this._lightDismiss()) { this._nudge(); return; }
        const ok = this._askDismiss(via);
        if (ok === true) this.close(null);
        else if (ok === false) this._nudge();
        else ok.then((yes) => { if (yes && !this._resolved) this.close(null); });
    }

    /** A short give of the panel (Bootstrap's "static backdrop" cue): the
     *  dismissal was refused. Nothing under reduced motion or mid-pull. */
    _nudge() {
        const panel = this.shadowRoot.querySelector(".panel");
        if (!panel || typeof panel.animate !== "function" || this._sheetSpring) return;
        if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const base = getComputedStyle(panel).transform;
        const at = base === "none" ? "" : base + " ";
        const origin = SacDialog._sheet && SacDialog._sheet.matches ? "50% 100%" : "50% 50%";
        panel.animate([
            { transform: `${at}scale(1)`, transformOrigin: origin },
            { transform: `${at}scale(1.02)`, transformOrigin: origin },
            { transform: `${at}scale(1)`, transformOrigin: origin },
        ], { duration: 220, easing: "ease-out" });
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
            // Never into a field the user is in — only from a button or the dialog.
            const act = SacDialog._deepActive();
            if (act && act !== this && act !== document.body && !btn.parentNode.contains(act)) return;
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
                .body::-webkit-scrollbar { width: var(--scrollbar-size); height: var(--scrollbar-size); }
                .body::-webkit-scrollbar-track { background: transparent; }
                .body::-webkit-scrollbar-thumb {
                    background: var(--scrollbar-thumb);
                    background-clip: content-box;
                    border: var(--scrollbar-gap) solid transparent;
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
                    transition: background 120ms, color 120ms, border-color 120ms, box-shadow 120ms,
                                transform 0.2s var(--ease-smooth);
                    outline: none;
                }
                .btn:hover {
                    background: var(--hover-strong);
                    border-color: color-mix(in srgb, var(--fg) 18%, transparent);
                }
                /* Press: the button gives the moment the pointer goes down —
                   fast in (100ms), back at the normal pace. Transform only,
                   so an .armed cue stays as it is (pointerdown disarms). */
                .btn:active:not(:disabled) {
                    transform: scale(0.97);
                    transition-duration: 0.1s;
                }
                /* .focus: the ring for a focus set by script or the keys,
                   where :focus-visible stays dark — Enter presses this one. */
                .btn:focus-visible,
                .btn.focus {
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
                .btn.destructive:focus-visible,
                .btn.destructive.focus {
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
                /* Leaving: the entry's path backwards, with the easing
                   mirrored (ease-in for its ease-out). No "from": a backdrop
                   a pull already dimmed fades on from where it is. */
                @keyframes fade-out {
                    to { opacity: 0; }
                }
                @keyframes pop-out {
                    from { opacity: 1; transform: scale(1); }
                    to   { opacity: 0; transform: scale(0.96); }
                }
                @keyframes sheet-out {
                    from { opacity: 1; transform: none; }
                    to   { opacity: 1; transform: translateY(100%); }
                }
                :host([closing]) { pointer-events: none; }
                :host([closing]) .backdrop { animation: fade-out 150ms ease-in forwards; }
                :host([closing]) .panel { animation: pop-out 150ms ease-in forwards; }

                .grabber { display: none; }

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
                    :host([closing]) .panel {
                        animation: sheet-out 220ms cubic-bezier(0.8, 0, 0.6, 1) forwards;
                    }
                    /* The grabber and the title row are the sheet's grip:
                       together at least 44px tall, and a finger there pulls
                       the sheet instead of scrolling the page. */
                    .grabber {
                        display: block;
                        flex: none;
                        position: relative;
                        height: 24px;
                        cursor: grab;
                        touch-action: none;
                    }
                    .grabber::before {
                        content: "";
                        position: absolute;
                        top: 9px;
                        left: 50%;
                        width: 36px;
                        height: 5px;
                        margin-left: -18px;
                        border-radius: 999px;
                        background: color-mix(in srgb, var(--fg) 25%, transparent);
                    }
                    .title {
                        padding-top: 4px;
                        cursor: grab;
                        touch-action: none;
                        user-select: none;
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
                    .backdrop, .panel,
                    :host([closing]) .backdrop, :host([closing]) .panel { animation-duration: 1ms; }
                }
                /* Reduced transparency / more contrast: the panel turns
                   solid (same hue, nothing shining through) and drops the
                   blur. The backdrop is a scrim — it keeps its dim and only
                   loses the blur. Background/blur/border only: the sheet
                   pull's inline opacity/transform are untouched. */
                @media (prefers-reduced-transparency: reduce) {
                    .backdrop { backdrop-filter: none; -webkit-backdrop-filter: none; }
                    .panel { background: var(--glass-solid); backdrop-filter: none; -webkit-backdrop-filter: none; }
                }
                @media (prefers-contrast: more) {
                    .backdrop { backdrop-filter: none; -webkit-backdrop-filter: none; }
                    .panel { background: var(--glass-solid); backdrop-filter: none; -webkit-backdrop-filter: none; border-color: var(--border-contrast); }
                }
                @keyframes pop-in {
                    to { opacity: 1; transform: scale(1); }
                }
            </style>
            <div class="backdrop" part="backdrop"></div>
            <div class="panel" part="panel" role="dialog" aria-modal="true">
                <div class="grabber" part="grabber" aria-hidden="true"></div>
                <div class="title" id="dlg-title"></div>
                <div class="body"><slot></slot></div>
                <div class="actions"></div>
            </div>
        `;
        this._renderHeader();
        this._renderButtons();
        const backdrop = this.shadowRoot.querySelector(".backdrop");
        // A held dialog stays open under a backdrop tap — so the tap must not
        // take focus out of it either (a mouse press on a non-focusable node
        // would blur the field to <body>, and the next keystroke goes nowhere).
        backdrop.addEventListener("mousedown", (e) => e.preventDefault());
        backdrop.addEventListener("click", () => this._dismiss("backdrop"));
        this._wireSheet();
    }

    /** Compact: the grabber and the title row pull the sheet down. Let go
     *  past its middle — or flicked down — it leaves (when beforeAction
     *  agrees); else it springs back. Held by the edit guard it resists
     *  downwards as well and always springs back. */
    _wireSheet() {
        const panel = this.shadowRoot.querySelector(".panel");
        const backdrop = this.shadowRoot.querySelector(".backdrop");
        const grips = [this.shadowRoot.querySelector(".grabber"), this.shadowRoot.querySelector(".title")];
        let drag = null;
        const place = (y) => {
            this._sheetY = y;
            panel.style.transform = `translateY(${y}px)`;
            backdrop.style.opacity = String(Math.min(1, Math.max(0, 1 - y / (panel.offsetHeight || 1))));
        };
        const down = (e) => {
            const m = SacDialog._motion();
            if (!m || !SacDialog._sheet || !SacDialog._sheet.matches) return;
            if (this._resolved || this._asking || !this.hasAttribute("open")) return;
            if (e.pointerType === "mouse" && e.button !== 0) return;
            if (this._sheetSpring) { this._sheetSpring.stop(); this._sheetSpring = null; }
            // The entry animation holds the panel (a fill beats inline
            // styles): take it over at the place it shows right now.
            if (panel.style.animation !== "none") {
                const cs = getComputedStyle(panel);
                const y = new DOMMatrixReadOnly(cs.transform).m42;
                panel.style.opacity = cs.opacity;      // the base style is the entry's start: 0
                panel.style.animation = "none";
                backdrop.style.animation = "none";
                place(y);
            }
            e.currentTarget.setPointerCapture(e.pointerId);
            // free = the swipe may dismiss at all (the edit guard).
            drag = { id: e.pointerId, y0: e.clientY - this._sheetY, track: m.tracker(), free: this._lightDismiss() };
            drag.track.add(this._sheetY, e.timeStamp);
            e.preventDefault();
        };
        const move = (e) => {
            if (!drag || e.pointerId !== drag.id || this._resolved) return;
            const raw = e.clientY - drag.y0;
            const h = panel.offsetHeight;
            // Upwards it always resists; downwards too while held, harder,
            // so it reads as "this will not go" from the first pixel.
            place(raw < 0 ? SacDialog._motion().rubberband(raw, h)
                : drag.free ? raw : SacDialog._motion().rubberband(raw, h / 3));
            drag.track.add(this._sheetY, e.timeStamp);
        };
        const up = (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            const v = e.type === "pointerup" ? drag.track.velocity(e.timeStamp) : 0;
            const free = drag.free;
            drag = null;
            if (this._resolved) return;
            const m = SacDialog._motion();
            const h = panel.offsetHeight;
            let dismiss = free && this._sheetY + m.project(v) > h / 2;
            // A dismissal: beforeAction first. An async answer lets the
            // sheet spring home meanwhile; a yes then carries it down from
            // wherever it is (_leave).
            let pending = null;
            if (dismiss) {
                const ok = this._askDismiss("swipe");
                if (ok !== true) { dismiss = false; if (ok !== false) pending = ok; }
            }
            const s = this._sheetSpring = m.spring({
                from: this._sheetY, to: dismiss ? h : 0, velocity: v,
                damping: !dismiss && Math.abs(v) > SacDialog.FLICK ? 0.8 : 1,
                response: 0.3,
                onUpdate: place,
                onDone: () => {
                    if (this._sheetSpring !== s) return;
                    this._sheetSpring = null;
                    if (dismiss) { this._swiped = true; this.close(null); }
                },
            });
            if (pending) pending.then((yes) => {
                if (yes && !this._resolved) { this._swiped = true; this.close(null); }
            });
        };
        for (const g of grips) {
            if (!g) continue;
            g.addEventListener("pointerdown", down);
            g.addEventListener("pointermove", move);
            g.addEventListener("pointerup", up);
            g.addEventListener("pointercancel", up);
        }
    }

    /** The exit: [closing] plays it, then [open] goes and sac:closed fires.
     *  A sheet a pull has taken over is carried down by a spring from where
     *  it is; a fallback timer ends it where no animation runs (a hidden
     *  tab, a display:none ancestor). Reopened meanwhile: nothing happens. */
    _leave() {
        const panel = this.shadowRoot.querySelector(".panel");
        const backdrop = this.shadowRoot.querySelector(".backdrop");
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (!this._resolved) return;
            this.removeAttribute("closing");
            this.removeAttribute("open");
            this.dispatchEvent(new CustomEvent("sac:closed", { bubbles: true, composed: true }));
        };
        const timer = setTimeout(finish, 600);
        if (!panel || !this.hasAttribute("open")) { finish(); return; }
        if (backdrop) backdrop.style.animation = "";        // fade on from where a pull left it
        this.setAttribute("closing", "");
        const m = SacDialog._motion();
        if (panel.style.animation === "none" && m) {
            m.spring({
                from: this._sheetY || 0, to: panel.offsetHeight, response: 0.3,
                onUpdate: (y) => { panel.style.transform = `translateY(${y}px)`; },
                onDone: finish,
            });
        } else {
            panel.addEventListener("animationend", (e) => { if (e.target === panel) finish(); });
        }
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
        // A focus the pointer gave shows no ring (as :focus-visible).
        row.addEventListener("pointerdown", () => { this._pointer = true; }, true);
        this.buttons.forEach((spec) => {
            const btn = document.createElement("button");
            btn.className = "btn" + (spec.kind && spec.kind !== "default" ? " " + spec.kind : "");
            btn.type = "button";
            btn.textContent = SacDialog._label(spec);
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
            btn.addEventListener("focus", () => btn.classList.toggle("focus", !this._pointer));
            btn.addEventListener("blur", () => btn.classList.remove("focus"));
            row.appendChild(btn);
        });
    }
}

/** Open dialogs, oldest first: only the last one handles keys. */
SacDialog._open = [];

/** The compact rule from the stylesheet above: a bottom sheet. */
SacDialog._sheet = window.matchMedia
    ? matchMedia("(max-width: 768px), (max-height: 480px) and (pointer: coarse)") : null;

/** px/s: a release faster than this was a flick (a little bounce back). */
SacDialog.FLICK = 400;

/** sac.motion when lib/motion.js is loaded, else null. */
SacDialog._motion = () => (window.sac && window.sac.motion) || null;

customElements.define("sac-dialog", SacDialog);
