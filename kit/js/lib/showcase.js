/**
 * SACRVM APPKIT — showcase helpers: build an API page in the style guide's look.
 *
 * The style guide is written with these, and an add-on (a component that
 * lives in its own repo) documents itself with the same ones, so every API
 * page reads alike. Pair with kit/css/showcase.css — the `sg-*` classes —
 * and start from kit/templates/showcase.html.
 *
 *   const { code, table, compact, note } = sac.showcase;
 *   page.innerHTML = `
 *       <div class="sg-page">
 *           <h1>&lt;my-widget&gt;</h1>
 *           <p class="lead">One sentence on what it is.</p>
 *           <div class="sg-demo"><my-widget></my-widget></div>
 *           ${code(`<my-widget value="3"></my-widget>`)}
 *           ${table("Attribute", [["value", "The number shown."]])}
 *           ${compact("stacks below 480px.")}
 *       </div>`;
 *   sac.showcase.watchCode(page);
 *
 *   esc(text)             HTML-escapes a string (& < >).
 *   code(source)          <pre class="sg-code"> — the source is escaped.
 *   table(title, rows)    API table, rows = [[key, description HTML], …];
 *                         the key is escaped and set as code. "" for no rows.
 *   compact(html)         "Compact / touch:" line — the phone behaviour.
 *   note(html)            Warm callout (.sg-note) — a caveat, not a fact.
 *   watchCode(root)       Marks which side of each pre.sg-code inside root
 *                         still scrolls (.sg-more-start / .sg-more-end, a soft
 *                         edge on phones). Call after each render; returns a
 *                         function that stops watching.
 *
 * Not part of all.js's runtime needs — a page that is not documentation
 * never calls it — but listed there so a quick start can.
 */
(function () {
    if (!window.sac) { console.warn("[sac.showcase] globals.js must load first — showcase unavailable."); return; }

    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    sac.showcase = {
        esc,
        code: (s) => `<pre class="sg-code"><code>${esc(s)}</code></pre>`,
        table: (title, rows) => rows.length === 0 ? "" : `
        <table class="sg">
            <tr><th style="width:220px">${title}</th><th>Description</th></tr>
            ${rows.map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${v}</td></tr>`).join("")}
        </table>`,
        compact: (html) => `<p class="sg-compact"><b>Compact / touch:</b> ${html}</p>`,
        note: (html) => `<p class="sg-note">${html}</p>`,
        watchCode(root) {
            const mark = (pre) => {
                const max = pre.scrollWidth - pre.clientWidth;
                pre.classList.toggle("sg-more-start", pre.scrollLeft > 1);
                pre.classList.toggle("sg-more-end", pre.scrollLeft < max - 1);
            };
            const obs = new ResizeObserver((entries) => entries.forEach((e) => mark(e.target)));
            const pres = Array.from(root.querySelectorAll("pre.sg-code"));
            const onScroll = (e) => mark(e.currentTarget);
            pres.forEach((pre) => {
                pre.addEventListener("scroll", onScroll, { passive: true });
                obs.observe(pre);
            });
            return () => {
                obs.disconnect();
                pres.forEach((pre) => pre.removeEventListener("scroll", onScroll));
            };
        },
    };
})();
