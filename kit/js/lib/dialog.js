/**
 * sac.dialog — promise-based dialog helpers.
 *
 * Thin wrappers around <sac-dialog>. Construct the element, wait for the
 * user's response, remove the element, resolve with the chosen action.
 *
 *   const answer = await sac.dialog.confirm({
 *       title:   "Delete this item?",
 *       message: "This item will be permanently deleted.",
 *       buttons: [
 *           { action: "cancel", label: "Cancel", kind: "default" },
 *           { action: "delete", label: "Delete", kind: "destructive", armAfterMs: 2000 },
 *       ],
 *   });
 *
 *   await sac.dialog.info({
 *       title:   "About",
 *       message: ["First paragraph.", "Second paragraph."],   // or one string
 *       label:   "Got it",                                    // default "OK"
 *   });
 *
 * `message` is one string or an array of strings — each becomes its own
 * paragraph, always via textContent (callers may pass user-sourced text).
 *
 * confirm() resolves with the clicked button's `action` string, or `null` if
 * the dialog was dismissed via Escape / backdrop / programmatic close.
 * Callers treat `null` the same as "cancel." info() is the one-button case —
 * announce, not ask — so its resolution carries no information.
 */
(function () {
    if (!window.sac) { console.warn("[sac.dialog] globals.js must load first — dialog unavailable."); return; }

    sac.dialog = {
        confirm({ title, message, buttons }) {
            return new Promise((resolve) => {
                const dlg = document.createElement("sac-dialog");
                if (title) dlg.setAttribute("title", title);
                dlg.buttons = Array.isArray(buttons) ? buttons : [];

                if (message) {
                    // textContent — never innerHTML. Callers may pass
                    // user-sourced strings. An array is one <p> per entry.
                    for (const part of Array.isArray(message) ? message : [message]) {
                        const p = document.createElement("p");
                        p.textContent = part;
                        dlg.appendChild(p);
                    }
                }

                dlg.addEventListener("sac:action", (e) => {
                    // Let the fade-out transition run before removal.
                    setTimeout(() => {
                        dlg.remove();
                        resolve(e.detail.action);
                    }, 120);
                }, { once: true });

                document.body.appendChild(dlg);
                // Let the element register before opening, so the open
                // animation starts from its closed state. A timeout, not
                // requestAnimationFrame: a background tab paints no frames,
                // and a dialog that never opens would hang its promise.
                setTimeout(() => dlg.open(), 0);
            });
        },

        /**
         * The one-button modal: an About panel, a licence notice, a "what
         * happened" explainer. Announce, not ask — so no action plumbing,
         * just "read, dismiss".
         */
        info({ title, message, label }) {
            return this.confirm({
                title,
                message,
                buttons: [{ action: "ok", label: label || "OK", kind: "primary" }],
            });
        },
    };
})();
