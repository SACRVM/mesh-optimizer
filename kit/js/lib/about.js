/**
 * sac.about — the shared About window.
 *
 * A peer of sac.dialog, but a <sac-window>, not a <sac-dialog>: an About is
 * READ, not answered — several paragraphs of credits, licences and trademark
 * notices you may want to leave open. sac.dialog.info collapses to one block;
 * this renders a titled section per notice.
 *
 * Every app's About is the same shape, rendered from data — most of it already
 * in the manifest (name · icon · description · version) plus one optional field
 * `notices`:
 *
 *   sac.about.open(context.manifest);          // a hosted app: zero duplication
 *   sac.about.open({                           // or an explicit object (standalone)
 *       name: "Color Bucket", icon: "palette", version: "1.0.0",
 *       description: "Mix colors like paint…",
 *       notices: [
 *           { title: "spectral.js", text: "MIT © 2025 Ronald van Wijnen…" },
 *           { title: "RAL",         text: "\"RAL\" is a registered trademark…" },
 *       ],
 *   });
 *
 * A host renders its OWN About through the same call, so the shell's About and
 * the app's About look related by construction — the point of shipping the
 * surface in the kit rather than letting every app reinvent it.
 *
 * Returns the <sac-window>. Re-opening the same About (matched by name) brings
 * the existing one to front instead of stacking a duplicate. All text is set
 * via textContent — notice text is third-party and is never trusted as markup.
 *
 * Compact/touch: sac-window maximizes itself on compact the moment it opens,
 * so the fit-to-content height below is skipped for a maximized window — it
 * would otherwise shrink the phone's full-screen About back to a 440px-era
 * rect. The notices scroll inside the window as usual.
 */
(function () {
    if (!window.sac) { console.warn("[sac.about] globals.js must load first — about unavailable."); return; }

    sac.about = {
        open(data) {
            const m = data || {};
            const name = m.name || sac.t("about.this-app", "This app");
            const titleOf = () => sac.t("about.title", "About {name}").replace("{name}", name);

            // One About per subject: a second click resurfaces it, never stacks.
            const key = "about:" + name;
            const existing = [...document.querySelectorAll("sac-window[data-about]")]
                .find((w) => w.dataset.about === key);
            if (existing) { existing.open(); existing.bringToFront?.(); return existing; }

            const win = document.createElement("sac-window");
            win.setAttribute("title", titleOf());
            // An About left open follows a language switch (its title is the
            // kit's; name and notices are the app's). Unsubscribes itself
            // once the window is gone.
            if (sac.lang) {
                const off = sac.lang.onChange(() => {
                    if (!win.isConnected) { off(); return; }
                    win.setAttribute("title", titleOf());
                });
            }
            win.setAttribute("controls", "close");
            win.setAttribute("width", "440px");
            // An About is sized to its content (below) and can't be maximized —
            // resizing it is meaningless, and the resize grip would otherwise
            // sit on the scroll track of a long notice list. Drop it.
            win.setAttribute("no-resize", "");
            win.dataset.about = key;

            const body = document.createElement("div");
            body.className = "sac-about";

            // Header: icon + name + version.
            const head = document.createElement("header");
            head.className = "sac-about-head";
            if (m.icon) {
                const ic = document.createElement("sac-icon");
                ic.setAttribute("name", m.icon);
                head.appendChild(ic);
            }
            const heading = document.createElement("div");
            const h = document.createElement("h2");
            h.textContent = name;
            heading.appendChild(h);
            if (m.version) {
                const v = document.createElement("p");
                v.className = "sac-caption";
                v.textContent = "v" + m.version;
                heading.appendChild(v);
            }
            head.appendChild(heading);
            body.appendChild(head);

            // Description.
            if (m.description) {
                const p = document.createElement("p");
                p.className = "sac-about-desc";
                p.textContent = m.description;
                body.appendChild(p);
            }

            // Notices — one titled section each. Third-party text: textContent.
            for (const n of (Array.isArray(m.notices) ? m.notices : [])) {
                if (!n) continue;
                const sec = document.createElement("section");
                sec.className = "sac-about-notice";
                if (n.title) {
                    const t = document.createElement("h3");
                    t.className = "sac-caption";
                    t.textContent = n.title;
                    sec.appendChild(t);
                }
                if (n.text) {
                    const txt = document.createElement("p");
                    txt.textContent = n.text;
                    sec.appendChild(txt);
                }
                body.appendChild(sec);
            }

            win.appendChild(body);
            document.body.appendChild(win);
            // Register before opening so the open animation starts from closed;
            // a timeout, not rAF (a background tab paints no frames).
            setTimeout(() => {
                win.open();
                win.bringToFront?.();
                // Compact: open() just maximized it — leave that rect alone.
                if (win.hasAttribute("maximized")) return;
                // Fit the window to its content. sac-window has no intrinsic
                // height (it defaults to 300px), which clipped a longer About
                // mid-sentence. Measure the now-laid-out body, add the window
                // chrome, and cap so the window never runs past the viewport
                // bottom from its top edge — a very long notice list then
                // scrolls inside .content instead of overflowing off-screen.
                const bar = win.shadowRoot?.querySelector(".title-bar");
                const chrome = (bar ? bar.offsetHeight : 44)
                    + 40   // .content padding (20px top + bottom)
                    + 2;   // container borders
                const top = parseInt(win.style.top, 10) || 100;
                const maxH = Math.max(200, window.innerHeight - top - 24);
                const fit = Math.min(body.scrollHeight + chrome, maxH);
                win.style.height = Math.max(Math.min(fit, maxH), 160) + "px";
            }, 0);
            return win;
        },
    };
})();
