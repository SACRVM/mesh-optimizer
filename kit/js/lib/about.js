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
 *       license: "MIT", copyright: "Color Bucket contributors",
 *       source: "https://github.com/…",
 *       notices: [
 *           { title: "spectral.js", text: "MIT © 2025 Ronald van Wijnen…" },
 *           { title: "RAL",         text: "\"RAL\" is a registered trademark…" },
 *           { title: "marked", license: "MIT", holder: "Christopher Jeffrey",
 *             group: "Interface" },
 *       ],
 *   });
 *
 * Two tabs: Info (description, licence · copyright · source) and Open source
 * (the notices). A notice with `text` is a titled paragraph; one with
 * `license` / `holder` instead is a compact part — name, then one muted
 * "licence · holder" line, in columns, under its optional `group`. Only one
 * of the two filled → no tab strip.
 *
 * A host renders its OWN About through the same call, so the shell's About and
 * the app's About look related by construction — the point of shipping the
 * surface in the kit rather than letting every app reinvent it.
 *
 * Escape closes the About while focus is in it (`escape-closes`, 2.36.0).
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
            win.setAttribute("controls", "close");
            // An About is sized to its content (below) and can't be maximized —
            // resizing it is meaningless, and the resize grip would otherwise
            // sit on the scroll track of a long notice list. Drop it.
            win.setAttribute("no-resize", "");
            // Read-only, nothing to lose: Escape closes it like any dialog.
            win.setAttribute("escape-closes", "");
            win.dataset.about = key;

            const el = (tag, cls, text) => {
                const n = document.createElement(tag);
                if (cls) n.className = cls;
                if (text != null) n.textContent = text;
                return n;
            };
            // Kit strings that follow a language switch: [element, key, fallback].
            const labels = [];
            const label = (n, k, fb) => { n.textContent = sac.t(k, fb); labels.push([n, k, fb]); return n; };

            const body = el("div", "sac-about");

            // Header: icon + name + version.
            const head = el("header", "sac-about-head");
            if (m.icon) {
                const ic = document.createElement("sac-icon");
                ic.setAttribute("name", m.icon);
                head.appendChild(ic);
            }
            const heading = el("div");
            heading.appendChild(el("h2", null, name));
            if (m.version) heading.appendChild(el("p", "sac-caption", "v" + m.version));
            head.appendChild(heading);
            body.appendChild(head);

            // Info: description, then licence · copyright · source as a
            // term list.
            const info = document.createDocumentFragment();
            if (m.description) info.appendChild(el("p", "sac-about-desc", m.description));
            const rows = [
                ["about.license",   "Licence",     m.license],
                ["about.copyright", "Copyright",   m.copyright],
                ["about.source",    "Source code", m.source],
            ].filter((r) => r[2]);
            if (rows.length) {
                const dl = el("dl", "sac-about-facts");
                for (const [k, fb, value] of rows) {
                    const dd = el("dd");
                    if (k === "about.source" && /^https?:\/\//.test(value)) {
                        const a = el("a", null, value.replace(/^https?:\/\//, ""));
                        a.href = value; a.target = "_blank"; a.rel = "noopener";
                        dd.appendChild(a);
                    } else dd.textContent = value;
                    dl.append(label(el("dt"), k, fb), dd);
                }
                info.appendChild(dl);
            }

            // Notices. A notice with `text` keeps its titled paragraph; one
            // with `license` / `holder` instead is a part: its name, then
            // "licence · holder" on one muted line, in columns. `group`
            // sorts parts under a heading (Interface, Server…). All of it is
            // third-party text: textContent only.
            const notices = (Array.isArray(m.notices) ? m.notices : []).filter(Boolean);
            const oss = document.createDocumentFragment();
            const groups = new Map();
            for (const n of notices) {
                if (n.text || !(n.license || n.holder)) {
                    const sec = el("section", "sac-about-notice");
                    if (n.title) sec.appendChild(el("h3", "sac-caption", n.title));
                    if (n.text) sec.appendChild(el("p", null, n.text));
                    oss.appendChild(sec);
                    continue;
                }
                const g = n.group || "";
                if (!groups.has(g)) groups.set(g, []);
                groups.get(g).push(n);
            }
            if (groups.size) {
                const cols = el("div", "sac-about-parts");
                for (const [g, parts] of groups) {
                    const block = el("div", "sac-about-group");
                    if (g) block.appendChild(el("h3", "sac-caption", g));
                    const ul = el("ul");
                    for (const n of parts) {
                        const li = el("li");
                        li.appendChild(el("span", "sac-about-part", n.title || ""));
                        li.appendChild(el("span", "sac-about-lic",
                            [n.license, n.holder].filter(Boolean).join(" · ")));
                        ul.appendChild(li);
                    }
                    block.appendChild(ul);
                    cols.appendChild(block);
                }
                oss.appendChild(cols);
            }

            // Info and Open source are two tabs, so a long list of notices
            // never buries the app's own facts. Only one of them filled →
            // no tab strip, the content stands alone.
            const hasInfo = info.childNodes.length > 0;
            const hasOss = oss.childNodes.length > 0;
            if (hasInfo && hasOss) {
                const tabs = el("sac-tab-group", "sac-about-tabs");
                const tInfo = label(el("sac-tab"), "about.tab-info", "Info");
                const tOss = label(el("sac-tab"), "about.tab-oss", "Open source");
                tInfo.setAttribute("name", "info");
                tOss.setAttribute("name", "oss");
                const pInfo = el("sac-tab-panel", "sac-about-panel");
                const pOss = el("sac-tab-panel", "sac-about-panel");
                pInfo.setAttribute("name", "info");
                pOss.setAttribute("name", "oss");
                pInfo.appendChild(info);
                pOss.appendChild(oss);
                tabs.append(tInfo, tOss, pInfo, pOss);
                tabs.setAttribute("active", "info");
                body.appendChild(tabs);
            } else {
                body.appendChild(hasInfo ? info : oss);
            }
            // Parts in columns need the room; a short About stays narrow.
            win.setAttribute("width", groups.size ? "680px" : "440px");

            // An About left open follows a language switch (its title and
            // labels are the kit's; name and notices are the app's).
            // Unsubscribes itself once the window is gone.
            if (sac.lang) {
                const off = sac.lang.onChange(() => {
                    if (!win.isConnected) { off(); return; }
                    win.setAttribute("title", titleOf());
                    for (const [n, k, fb] of labels) n.textContent = sac.t(k, fb);
                });
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
                // With tabs: the taller tab sets the height, so switching
                // never resizes the window under the pointer.
                const tabs = body.querySelector("sac-tab-group");
                let h = body.scrollHeight;
                if (tabs) {
                    tabs.active = "oss";
                    h = Math.max(h, body.scrollHeight);
                    tabs.active = "info";
                }
                const fit = Math.min(h + chrome, maxH);
                win.style.height = Math.max(Math.min(fit, maxH), 160) + "px";
            }, 0);
            return win;
        },
    };
})();
