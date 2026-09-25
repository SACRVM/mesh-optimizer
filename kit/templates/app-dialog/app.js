/**
 * <app-my-dialog-app> — a DIALOG app (manifest kind: "window").
 *
 * It floats above the desktop in a <sac-window> the host provides. Small
 * tools live here: a calculator, a converter, a quick note.
 *
 * The whole contract is the three hooks below. Everything else — the guarded
 * tag, this script's folder, the stylesheet, and running with no desktop at
 * all — is sac.app.
 */
(function () {
    // Parse time, top level: document.currentScript is this file only here.
    const BASE = sac.app.base();

    class AppMyDialogApp extends sac.app.Element {
        /** Once, on first connect. Light DOM, so ui.css tokens apply. */
        build() {
            sac.app.styles(BASE + "app.css", "app-my-dialog-app-css");
            this.innerHTML = `
                <h2>My Dialog App</h2>
                <p class="lead">Replace this with the actual tool.</p>
                <sac-toggle class="ready" label="Ready" checked></sac-toggle>
                <p class="readout">theme: <code class="theme">—</code></p>
                <button class="btn primary act">Do the thing</button>
            `;
        }

        /** Once, when the app is really on screen — measure here if you must. */
        onMount(context) {
            const themeOut = this.querySelector(".theme");
            const show = (t) => { themeOut.textContent = t; };
            show(context.theme.get());
            // Returns an unsubscribe — keep it, call it in onUnmount.
            this._offTheme = context.theme.onChange(show);

            this.querySelector(".act").addEventListener("click", () => {
                // sac.toast is the host's, and optional: never assume chrome.
                if (typeof sac.toast === "function") sac.toast("It did the thing.", { kind: "success" });
            });
        }

        /** Only when the host removes the app. Undo what onMount did. */
        onUnmount() {
            if (this._offTheme) { this._offTheme(); this._offTheme = null; }
        }
    }

    sac.app.define("app-my-dialog-app", AppMyDialogApp);
})();
