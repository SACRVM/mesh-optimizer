/**
 * <sac-toast-stack>  —  Transient notification stack.
 *
 * The floating sibling of <sac-status-banner>: the banner is INLINE and
 * permanent (it sits in a form and waits to be cleared), a toast is a
 * corner-anchored, self-dismissing message for app-level feedback — "Saved.",
 * "Export failed.", "Reindex finished." Nothing that must be read to proceed
 * belongs in a toast; that is a dialog or a banner.
 *
 * One stack element hosts many toast cards. Apps rarely place it by hand —
 * `sac.toast()` creates a shared `#sac-toast-stack` on first use.
 *
 * Usage:
 *   sac.toast("Saved.", { kind: "success" });
 *   sac.toast("Connection lost.", { kind: "error", duration: 0, title: "Offline" });
 *
 *   const t = sac.toast("Uploading…", { duration: 0 });
 *   t.dismiss();                                   // when the upload finishes
 *
 *   // Explicit stack (e.g. a second one in another corner):
 *   <sac-toast-stack position="top-right"></sac-toast-stack>
 *
 * Attributes:
 *   position — bottom-right (default) | bottom-left | top-right | top-left.
 *              Handled purely in CSS, so changing it never re-renders.
 *              Top corners clear the fixed 50px <sac-nav> ribbon.
 *
 * Methods:
 *   add(message, { kind, duration, title })
 *              kind:     "info" (default) | "success" | "warn" | "error"
 *                        → --accent / --ok / --accent-warm / --danger
 *              duration: ms until auto-dismiss (default 4000; 0 = sticky)
 *              title:    optional bold line above the message
 *              → returns the toast element, carrying a .dismiss() method.
 *
 * API:
 *   sac.toast(message, opts) — same signature as add(), on the shared stack.
 *
 * Behavior:
 *   - Newest toast always appears NEAREST the anchored corner: bottom stacks
 *     grow upward (column-reverse), top stacks grow downward (column). The
 *     corner is the stable place the eye returns to.
 *   - Hovering a toast clears its timer; leaving restarts the FULL duration,
 *     so a message you reached for never vanishes mid-read.
 *   - Messages and titles are written with textContent, never innerHTML —
 *     toast strings routinely come from errors, files and users.
 *   - The stack itself is pointer-events: none and stays in the DOM; only the
 *     cards are interactive.
 *
 * Compact/touch:
 *   - On a compact viewport (ui.css §15) every stack, whatever its
 *     `position`, sits at the BOTTOM edge, full width minus an 8px gutter,
 *     above env(safe-area-inset-bottom) (the home indicator); newest card
 *     nearest the bottom. Cards slide up instead of sideways.
 *   - The hover pause has a touch twin: a finger ON a toast holds its timer,
 *     lifting it restarts the full duration (pointerdown / pointerup, for
 *     touch and pen; the mouse keeps enter/leave).
 *   - Swipe a toast sideways (past ~80px) to dismiss it; a shorter drag
 *     snaps back. Vertical drags still scroll the page.
 *   - Under (pointer: coarse) the close button keeps its 20px look with a
 *     44px hit area.
 */
(function () {

    /** Kit i18n: sac.t when globals.js is loaded, the English fallback when
     *  the component runs standalone. */
    const t = (key, fallback) =>
        (window.sac && window.sac.t) ? window.sac.t(key, fallback) : fallback;

class SacToastStack extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
        if (!this.shadowRoot.firstChild) this._render();
    }

    /**
     * Push a toast onto the stack.
     * @returns {HTMLElement} the card, with a .dismiss() method attached.
     */
    add(message, { kind = "info", duration = 4000, title } = {}) {
        if (!this.shadowRoot.firstChild) this._render();

        const k = SacToastStack.KINDS[kind] ? kind : "info";
        const region = this.shadowRoot.getElementById("region");

        const card = document.createElement("div");
        card.className = `toast ${k}`;
        // The shared region is polite; an error/warning should interrupt.
        // role="alert" is assertive, role="status" polite — set per kind so
        // urgency rides in semantics, not only in the icon's colour.
        card.setAttribute("role", (k === "error" || k === "warn") ? "alert" : "status");

        const icon = document.createElement("sac-icon");
        icon.className = "icon";
        icon.setAttribute("name", SacToastStack.KINDS[k]);
        icon.setAttribute("aria-hidden", "true");   // colour cue, not content
        card.appendChild(icon);

        const content = document.createElement("div");
        content.className = "content";
        if (title != null && String(title) !== "") {
            const t = document.createElement("div");
            t.className = "title";
            t.textContent = String(title);   // textContent: caller strings are untrusted.
            content.appendChild(t);
        }
        const msg = document.createElement("div");
        msg.className = "message";
        msg.textContent = message == null ? "" : String(message);
        content.appendChild(msg);
        card.appendChild(content);

        const close = document.createElement("button");
        close.className = "close";
        close.type = "button";
        close.setAttribute("aria-label", t("toast.dismiss", "Dismiss"));
        const closeIcon = document.createElement("sac-icon");
        closeIcon.setAttribute("name", "close");
        close.appendChild(closeIcon);
        close.addEventListener("click", () => this._dismiss(card));
        card.appendChild(close);

        // Timer bookkeeping lives on the card so every handler below (and the
        // caller's .dismiss()) works off one source of truth.
        card._duration = Number(duration) || 0;
        card._timer = null;
        card.dismiss = () => this._dismiss(card);

        // Pause while pointed at (mouse) or held (touch, pen). Pointer events
        // filtered by type, not mouseenter: a tap fires compat mouseenter
        // with no mouseleave until the next tap elsewhere — the toast would
        // stay paused forever after a touch.
        card.addEventListener("pointerenter", (e) => {
            if (e.pointerType === "mouse") this._clearTimer(card);
        });
        card.addEventListener("pointerleave", (e) => {
            if (e.pointerType === "mouse") this._startTimer(card);
        });
        this._bindTouch(card);

        region.appendChild(card);
        this._startTimer(card);
        return card;
    }

    _startTimer(card) {
        this._clearTimer(card);
        if (card._duration > 0 && !card._leaving) {
            card._timer = setTimeout(() => this._dismiss(card), card._duration);
        }
    }

    _clearTimer(card) {
        if (card._timer != null) {
            clearTimeout(card._timer);
            card._timer = null;
        }
    }

    /**
     * Touch and pen: hold = pause, release = full duration again, and a
     * sideways swipe dismisses. touch-action: pan-y (CSS) keeps vertical
     * drags for page scrolling and hands horizontal ones to us.
     */
    _bindTouch(card) {
        let drag = null;                  // { id, x, dx } while a finger is down
        const release = (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            const dx = drag.dx;
            drag = null;
            card.style.transition = "";
            if (Math.abs(dx) > 80) { this._swipeAway(card, dx); return; }
            card.style.translate = "";
            this._startTimer(card);
        };
        card.addEventListener("pointerdown", (e) => {
            if (e.pointerType === "mouse" || card._leaving) return;
            this._clearTimer(card);
            drag = { id: e.pointerId, x: e.clientX, dx: 0 };
        });
        card.addEventListener("pointermove", (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            drag.dx = e.clientX - drag.x;
            // A small dead zone: a tap on the close button must stay a tap.
            if (Math.abs(drag.dx) < 10) return;
            if (!card.hasPointerCapture(e.pointerId)) card.setPointerCapture(e.pointerId);
            // `translate`, not `transform`: the entry animation holds
            // transform (and opacity) with fill-mode forwards, and an
            // animated property ignores inline styles. translate composes
            // on top of it instead.
            card.style.transition = "none";
            card.style.translate = `${drag.dx}px 0`;
        });
        card.addEventListener("pointerup", release);
        card.addEventListener("pointercancel", release);
    }

    /** Swipe exit: carry on in the swipe's direction, then remove. */
    _swipeAway(card, dx) {
        if (card._leaving) return;
        card._leaving = true;
        this._clearTimer(card);
        card.classList.add("swiped");
        card.style.translate = `${dx > 0 ? "" : "-"}110% 0`;
        setTimeout(() => card.remove(), 200);
    }

    _dismiss(card) {
        if (card._leaving) return;
        card._leaving = true;
        this._clearTimer(card);
        card.classList.add("out");
        // Timer, not animationend: with prefers-reduced-motion the animation
        // is neutralized and animationend may never fire.
        setTimeout(() => card.remove(), 200);
    }

    _render() {
        // Region label: attribute position in the template below.
        const esc = (s) => String(s).replace(/"/g, "&quot;");
        const L = { region: esc(t("toast.notifications", "Notifications")) };
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    position: fixed;
                    z-index: 30000;          /* above <sac-dialog> (20000) */
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    pointer-events: none;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;

                    /* Default corner = bottom-right; the three overrides below
                       are the only deviations. An unknown value lands here. */
                    bottom: 1rem;
                    right: 1rem;
                }
                :host([position="bottom-left"]) {
                    left: 1rem;
                    right: auto;
                }
                :host([position="top-right"]) {
                    top: calc(50px + 1rem);   /* clear the fixed <sac-nav> */
                    bottom: auto;
                }
                :host([position="top-left"]) {
                    top: calc(50px + 1rem);
                    bottom: auto;
                    left: 1rem;
                    right: auto;
                }

                /* Newest nearest the corner. Cards are appended, so plain
                   column puts the last (= newest) card at the bottom — right
                   for bottom corners; top corners reverse so the newest card
                   sits at the top instead. */
                .region {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-end;
                    gap: 10px;
                }
                :host([position^="top"]) .region { flex-direction: column-reverse; }
                :host([position$="left"]) .region { align-items: flex-start; }

                .toast {
                    --slide-from: 20px;
                    pointer-events: auto;
                    box-sizing: border-box;
                    min-width: 260px;
                    max-width: 380px;
                    display: flex;
                    align-items: flex-start;
                    gap: 10px;
                    padding: 10px 12px;
                    --kind: var(--accent);
                    --kind-ink: var(--accent-text);
                    background:
                        linear-gradient(color-mix(in srgb, var(--kind) 6%, transparent),
                                        color-mix(in srgb, var(--kind) 6%, transparent)),
                        var(--glass-strong);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border: 1px solid var(--border-strong);
                    border-radius: var(--radius-l);
                    box-shadow: var(--shadow-2);
                    opacity: 0;
                    animation: toast-in 0.22s var(--ease-smooth) forwards;
                }
                /* Left corners slide in from the left. */
                :host([position$="left"]) .toast { --slide-from: -20px; }

                .toast.out {
                    animation: toast-out 0.18s var(--ease-smooth) forwards;
                }

                /* Kind = the icon color + a whisper of background tint — never
                   a colored edge stripe (kit rule: no thick colored borders on
                   rounded surfaces). Everything else is identical, so a stack
                   of mixed toasts still reads as one set. The icon carries
                   meaning, so it uses the AA -text variant (holds 3:1 on both
                   grounds); the tint keeps the raw kind color. */
                .toast.info    { --kind: var(--accent);      --kind-ink: var(--accent-text); }
                .toast.success { --kind: var(--ok);          --kind-ink: var(--ok-text); }
                .toast.warn    { --kind: var(--accent-warm); --kind-ink: var(--accent-warm-text); }
                .toast.error   { --kind: var(--danger);      --kind-ink: var(--danger-text); }

                .icon {
                    --icon-size: 18px;
                    flex: none;
                    margin-top: 1px;
                    color: var(--kind-ink);
                }

                .content { flex: 1; min-width: 0; }

                .title {
                    font-weight: 600;
                    font-size: 0.85rem;
                    color: var(--text);
                    margin-bottom: 2px;
                }

                .message {
                    font-size: 0.85rem;
                    line-height: 1.4;
                    color: var(--text-muted);
                    overflow-wrap: anywhere;
                }

                .close {
                    flex: none;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 20px;
                    height: 20px;
                    padding: 0;
                    margin: -1px -2px 0 0;
                    border: none;
                    border-radius: var(--radius-m);
                    background: transparent;
                    color: var(--text-dim);
                    cursor: pointer;
                    transition: color 120ms var(--ease-smooth), background 120ms var(--ease-smooth);
                }
                .close sac-icon { --icon-size: 13px; }
                .close:hover {
                    color: var(--text);
                    background: var(--hover);
                }
                .close:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 1px;
                }

                @keyframes toast-in {
                    from { opacity: 0; transform: translateX(var(--slide-from)); }
                    to   { opacity: 1; transform: translateX(0); }
                }
                @keyframes toast-out {
                    from { opacity: 1; transform: translateX(0); }
                    to   { opacity: 0; transform: translateX(var(--slide-from)); }
                }

                .toast.swiped {
                    transition: translate 0.18s var(--ease-smooth);
                }

                /* Compact: one bottom-anchored, full-width stack whatever the
                   position attribute says — a corner card on a phone is most
                   of the width anyway, and the thumb lives at the bottom. The
                   8px gutter and the home-indicator inset keep it off the
                   edges. Newest nearest the bottom edge, as in any bottom
                   stack. */
                @media (max-width: 768px), (max-height: 480px) and (pointer: coarse) {
                    :host,
                    :host([position]) {
                        top: auto;
                        bottom: calc(8px + env(safe-area-inset-bottom, 0px));
                        left: calc(8px + env(safe-area-inset-left, 0px));
                        right: calc(8px + env(safe-area-inset-right, 0px));
                    }
                    .region,
                    :host([position]) .region {
                        flex-direction: column;
                        align-items: stretch;
                    }
                    .toast {
                        min-width: 0;
                        max-width: none;
                    }
                    @keyframes toast-in {
                        from { opacity: 0; transform: translateY(20px); }
                        to   { opacity: 1; transform: translateY(0); }
                    }
                    @keyframes toast-out {
                        from { opacity: 1; transform: translateY(0); }
                        to   { opacity: 0; transform: translateY(20px); }
                    }
                }

                /* Touch: horizontal drags are ours (swipe to dismiss),
                   vertical ones still scroll. The close button keeps its
                   20px look; an invisible halo makes the hit area 44px. */
                @media (pointer: coarse) {
                    .toast { touch-action: pan-y; }
                    .close { position: relative; }
                    .close::after {
                        content: "";
                        position: absolute;
                        inset: -12px;
                    }
                }

                /* Motion is decoration here — the message and the dismissal
                   timing are unaffected. */
                @media (prefers-reduced-motion: reduce) {
                    .toast,
                    .toast.out {
                        animation: none;
                        opacity: 1;
                        transform: none;
                    }
                    .toast.out { opacity: 0; }
                    .toast.swiped { transition: none; }
                    .close { transition: none; }
                }
            </style>
            <div class="region" id="region" role="region" aria-live="polite" aria-label="${L.region}"></div>
        `;
    }
}

/** kind → sac.icons name. The color per kind is CSS (.toast.<kind>). */
SacToastStack.KINDS = {
    info:    "info",
    success: "success",
    warn:    "warn",
    error:   "error",
};

customElements.define("sac-toast-stack", SacToastStack);

/**
 * sac.toast(message, opts) — the one-liner every app actually calls. Lazily
 * creates the shared bottom-right stack on first use.
 */
if (window.sac && !sac.toast) {
    sac.toast = (message, opts) => {
        let stack = document.getElementById("sac-toast-stack");
        if (!stack) {
            stack = document.createElement("sac-toast-stack");
            stack.id = "sac-toast-stack";
            document.body.appendChild(stack);
        }
        return stack.add(message, opts);
    };
}
})();
