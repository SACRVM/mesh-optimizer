/**
 * SACRVM APPKIT — the guest half of an ISOLATED app (sac.apps, #13).
 *
 * Runs inside the sandboxed frame a host builds for an app it installed with
 * `isolated` (kit/js/lib/app-bridge.js is the host half). It loads the app's
 * entry, builds a `context` of the SAME shape sac.apps hands a same-realm app
 * — fs / identity / files / theme / setDirty / deepLink as postMessage calls
 * to the host — and calls el.mount(context). An app written against the
 * documented contract cannot tell the difference, except through
 * context.isolated (true) and context.granted.
 *
 * NOT part of all.js, and inert anywhere but in a harness: it runs only in
 * a framed document whose <html> carries `data-sac-guest`. The harness loads
 * it after the kit:
 *
 *   <html data-sac-guest>
 *     <link rel="stylesheet" href="<kit>/css/ui.css">
 *     <script src="<kit>/js/all.js"></script>
 *     <script src="<kit>/js/lib/app-guest.js"></script>
 *
 * The harness never names the app's entry: the host sends it (with its pin)
 * in the boot message, and this file injects it once the kit is ready — so
 * the entry always runs on a loaded kit.
 *
 * Protocol (envelope { sac: "app-bridge", v: 1, type, … }), in order:
 *   guest → host  hello                     (kit ready; once per document)
 *   host → guest  boot { token, entry, theme, lang, regional, limits }
 *   guest → host  ready | load-error { reason: "script" | "undefined" }
 *   host → guest  mount { snapshot }        (views: when first shown)
 *   guest → host  call { id, method, args } → result { id, ok, result | error }
 *   host → guest  event { topic, … }        theme lang regional route host
 *                                           identity accent fs progress launch
 *   host → guest  alive { ids }             (a slow call is still running)
 *   host → guest  unmount → guest → host unmounted
 *   guest → host  app-error { kind, message, stack?, source?, line?, column? }
 *                 (after boot: an uncaught error, an unhandled rejection, a
 *                 throwing mount() / unmount() — the host fires sac:app-error)
 * Every message the guest sends after boot carries the token; every message
 * it accepts must come from window.parent (and, after boot, its origin).
 *
 * Calls reject with an Error whose `code` is one of: denied, not-found,
 * bad-request, too-large, rate-limited, timeout, integrity, network,
 * internal. A call with no answer within limits.timeout (default 30 s; the
 * host's `alive` pulse keeps a slow one — a picker the user is still looking
 * at — open) rejects with "timeout". A payload above limits.maxBytes (a
 * Blob's size, or a structured-clone estimate of any value) rejects
 * "too-large" before it is sent; the host checks again.
 *
 * Also forwarded, so the frame behaves like a same-realm app:
 *   - the app's sac.commands registrations → proxies in the host's Ctrl-K
 *     palette (running one runs the real command here);
 *   - a user click on a <sac-theme-toggle> / <sac-lang-toggle> inside the
 *     app → theme.set / lang.set on the HOST (a same-realm toggle switches
 *     the page, too). The frame then follows the host's answer; a toggle
 *     never switches only the frame.
 *   - images the host hands over (host toolbar avatars, the identity's
 *     avatar) arrive as Blobs; this runtime makes object URLs for them and
 *     revokes them on change / unmount.
 */
(function () {
    "use strict";
    const root = document.documentElement;
    if (window.parent === window || !root.hasAttribute("data-sac-guest")) return;
    if (window.__sacGuest) return;   // idempotent
    window.__sacGuest = true;

    const ENVELOPE = "app-bridge";
    const VERSION = 1;
    const DEFINE_TIMEOUT = 8000;

    let token = null;
    let hostOrigin = "*";
    let booted = false;
    let entryTag = null;
    let limits = { timeout: 30000, maxBytes: 64 * 1024 * 1024 };

    let seq = 0;
    const pending = new Map();      // id → { resolve, reject, timer, onProgress, method }

    let appEl = null;
    let accentSeed = null;
    let themeVars = {};
    let themeKeys = new Set();
    let route = "";
    let base = null;           // "#/<id>" (scoped) — a view's own route space
    const routeCbs = new Set();
    let identity = null;
    const identitySubs = new Set();
    const fsWatchers = new Set();
    const launchCbs = new Set();
    let filesKind = null;
    let filesReadonly = false;
    let hostObj = null;
    let declared = new Set();
    let hostUrls = [];              // object URLs made for host toolbar avatars
    let identityUrl = null;         // object URL of the identity's avatar
    let mounted = false;            // commands are forwarded once mounted
    let commandsTimer = null;
    let hostFlag = null;            // the theme flag the host last sent
    let pendingFlag = null;         // a toggle click on its way to the host

    /* ------------------------------------------------------------ wire -- */

    function post(msg) {
        window.parent.postMessage(Object.assign({ sac: ENVELOPE, v: VERSION, token }, msg), hostOrigin);
    }

    /** The app broke: tell the host (it caps and rate-limits; this side
     *  only trims, so one report stays small). */
    function report(kind, info) {
        if (!booted) return;
        const i = info instanceof Error ? { message: info.message, stack: info.stack }
            : (info && typeof info === "object" ? info : { message: String(info) });
        const msg = { type: "app-error", kind, message: String(i.message || "").slice(0, 1000) };
        if (typeof i.stack === "string") msg.stack = i.stack.slice(0, 4000);
        if (typeof i.source === "string" && i.source) {
            msg.source = i.source.slice(0, 2000);
            if (Number.isFinite(i.line)) msg.line = i.line;
            if (Number.isFinite(i.column)) msg.column = i.column;
        }
        try { post(msg); } catch (err) { /* nothing left to tell */ }
    }

    window.addEventListener("error", (e) => {
        // A failing <script> / <img> fires here too, without an ErrorEvent:
        // only real exceptions are the app's errors.
        if (!(e instanceof ErrorEvent)) return;
        const err = e.error;
        report("error", {
            message: e.message || (err && err.message) || "",
            stack: err && typeof err.stack === "string" ? err.stack : undefined,
            source: e.filename, line: e.lineno, column: e.colno,
        });
    });
    window.addEventListener("unhandledrejection", (e) => {
        const r = e.reason;
        report("rejection", r instanceof Error ? r : { message: String(r) });
    });

    function appError(code, message) {
        const err = new Error(message);
        err.name = "SacAppError";
        err.code = code;
        return err;
    }

    /** A structured-clone size estimate (same rule as the host's). */
    function estimateSize(v, limit) {
        let total = 0;
        const seen = new WeakSet();
        const stack = [v];
        while (stack.length) {
            const x = stack.pop();
            if (typeof x === "string") total += x.length * 2;
            else if (typeof x === "number" || typeof x === "bigint") total += 8;
            else if (x == null || typeof x === "boolean") total += 1;
            else if (typeof x === "object") {
                if (seen.has(x)) continue;
                seen.add(x);
                if (x instanceof Blob) total += x.size;
                else if (x instanceof ArrayBuffer) total += x.byteLength;
                else if (ArrayBuffer.isView(x)) total += x.byteLength;
                else if (x instanceof Map) x.forEach((val, k) => stack.push(k, val));
                else if (x instanceof Set) x.forEach((val) => stack.push(val));
                else Object.keys(x).forEach((k) => { total += k.length * 2; stack.push(x[k]); });
            }
            if (total > limit) return total;
        }
        return total;
    }

    function call(method, args, opts) {
        return new Promise((resolve, reject) => {
            const size = estimateSize(args || [], limits.maxBytes);
            if (size > limits.maxBytes) {
                reject(appError("too-large",
                    `${method}: ${size} bytes exceed the host's limit of ${limits.maxBytes}`));
                return;
            }
            const id = ++seq;
            const rec = { resolve, reject, method, onProgress: opts && opts.onProgress };
            rec.arm = () => {
                clearTimeout(rec.timer);
                rec.timer = setTimeout(() => {
                    pending.delete(id);
                    reject(appError("timeout", `${method}: no answer from the host within ${limits.timeout} ms`));
                }, limits.timeout);
            };
            rec.arm();
            pending.set(id, rec);
            try {
                post({ type: "call", id, method, args: args || [] });
            } catch (err) {
                // DataCloneError: a function, a DOM node … cannot cross.
                clearTimeout(rec.timer);
                pending.delete(id);
                reject(appError("bad-request", `${method}: ${err.message}`));
            }
        });
    }

    /** In-realm these return nothing and never throw — here, too. */
    function fire(method, args) {
        call(method, args).catch((err) => console.warn(`[sac.apps] ${method}: ${err.message}`));
    }

    function settle(d) {
        const rec = pending.get(d.id);
        if (!rec) return;
        pending.delete(d.id);
        clearTimeout(rec.timer);
        if (d.ok) rec.resolve(d.result);
        else {
            const e = d.error || {};
            rec.reject(appError(typeof e.code === "string" ? e.code : "internal",
                typeof e.message === "string" ? e.message : `${rec.method} failed`));
        }
    }

    /* ----------------------------------------------------------- theme -- */

    const flagNow = () => {
        const f = root.getAttribute("data-theme");
        return f === "light" || f === "auto" ? f : "dark";
    };

    function setFlag(flag) {
        if (flag === "light" || flag === "auto") root.setAttribute("data-theme", flag);
        else root.removeAttribute("data-theme");
    }

    /** Toggles in the app show the HOST's choice (a programmatic .theme set
     *  fires no sac:change, so this never loops back to the host). */
    function syncThemeToggles() {
        document.querySelectorAll("sac-theme-toggle").forEach((t) => {
            if (t.theme !== hostFlag) t.theme = hostFlag;
        });
    }

    function applyTheme(t) {
        if (!t) return;
        hostFlag = t.flag === "light" || t.flag === "auto" ? t.flag : "dark";
        pendingFlag = null;
        setFlag(hostFlag);
        syncThemeToggles();
        const vars = t.vars && typeof t.vars === "object" ? t.vars : {};
        themeKeys.forEach((k) => { if (!(k in vars)) root.style.removeProperty(k); });
        themeKeys = new Set();
        themeVars = {};
        Object.keys(vars).forEach((k) => {
            if (!/^--[\w-]+$/.test(k) || typeof vars[k] !== "string") return;
            root.style.setProperty(k, vars[k]);
            themeKeys.add(k);
            themeVars[k] = vars[k];
        });
        applyAccent();
    }

    /** The app's own seed (a tile accent, manifest.accent) wins over the
     *  host's root accent — the frame is the app, so its root is the scope. */
    function applyAccent() {
        if (accentSeed) root.style.setProperty("--accent", accentSeed);
        else if (themeVars["--accent"]) root.style.setProperty("--accent", themeVars["--accent"]);
        else root.style.removeProperty("--accent");
    }

    function themeGet() {
        if (window.sac && sac.apps && sac.apps.theme) return sac.apps.theme.get();
        const f = root.getAttribute("data-theme");
        return f === "light" || f === "auto" ? f : "dark";
    }

    function themeOnChange(cb) {
        if (window.sac && sac.apps && sac.apps.theme) return sac.apps.theme.onChange(cb);
        return () => {};
    }

    /* The flag belongs to the host. Anything else that flips it here — a
       <sac-theme-toggle> connecting (it applies its own stored default) —
       is put back; a user's click on one is sent up and followed when the
       host answers. */
    new MutationObserver(() => {
        if (hostFlag === null) return;
        const f = flagNow();
        if (f === hostFlag || f === pendingFlag) return;
        setFlag(hostFlag);
        syncThemeToggles();
    }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

    document.addEventListener("sac:change", (e) => {
        if (!booted || !e.target || !e.detail) return;
        if (e.target.tagName === "SAC-THEME-TOGGLE") {
            pendingFlag = e.detail.value;
            fire("theme.set", [e.detail.value]);
        } else if (e.target.tagName === "SAC-LANG-TOGGLE") {
            fire("lang.set", [e.detail.value]);
        }
    }, true);

    function applyLang(code) {
        if (code && window.sac && sac.lang && sac.lang.get() !== code) sac.lang.set(code);
    }

    function applyRegional(r) {
        if (r && window.sac && sac.regional) sac.regional.set(r);
    }

    /* ------------------------------------------------------------ host -- */

    /** The host's injection, rebuilt: toolbar action ids become onClick
     *  functions that ask the host to run ITS function. */
    /** Image bytes from the host → an object URL here (img-src allows
     *  blob:), remembered in `bag` for revoking. */
    function blobUrl(blob, bag) {
        if (!(blob instanceof Blob)) return null;
        const url = URL.createObjectURL(blob);
        bag.push(url);
        return url;
    }

    function hostFrom(data, urls) {
        if (!data || typeof data !== "object") return null;
        const h = Object.assign({}, data);
        if (Array.isArray(h.toolbar)) {
            h.toolbar = h.toolbar.map((tb) => {
                const o = Object.assign({}, tb);
                const aid = o.actionId;
                delete o.actionId;
                if (aid) o.onClick = () => fire("toolbar-action", [aid]);
                if (o.avatar && typeof o.avatar === "object") {
                    const av = Object.assign({}, o.avatar);
                    if (av.srcBlob) av.src = blobUrl(av.srcBlob, urls);
                    delete av.srcBlob;
                    if (!av.src) delete av.src;
                    o.avatar = av;
                }
                return o;
            });
        }
        return h;
    }

    function identityFrom(p) {
        if (identityUrl) { URL.revokeObjectURL(identityUrl); identityUrl = null; }
        if (!p || typeof p !== "object") return null;
        const out = Object.assign({}, p);
        if (out.avatarBlob) {
            const bag = [];
            out.avatar = blobUrl(out.avatarBlob, bag);
            identityUrl = bag[0] || null;
        }
        delete out.avatarBlob;
        return out;
    }

    function collectDeclared(h) {
        const set = new Set();
        if (!h) return set;
        if (typeof h.href === "string") set.add(h.href);
        (Array.isArray(h.nav) ? h.nav : []).forEach((n) => { if (n && typeof n.href === "string") set.add(n.href); });
        (Array.isArray(h.toolbar) ? h.toolbar : []).forEach((t) => { if (t && typeof t.href === "string") set.add(t.href); });
        return set;
    }

    function updateHost(data) {
        const urls = [];
        const next = hostFrom(data, urls);
        declared = collectDeclared(next);
        // Same rule as in-realm: a view mounted without a host has no object
        // to refresh; one that had one sees it mutated in place.
        if (!hostObj || !next) { urls.forEach((u) => URL.revokeObjectURL(u)); return; }
        Object.keys(hostObj).forEach((k) => { if (!(k in next)) delete hostObj[k]; });
        Object.assign(hostObj, next);
        const old = hostUrls;
        hostUrls = urls;
        document.dispatchEvent(new CustomEvent("sac:host-changed"));
        // The nav has re-rendered from the new data: the old images can go.
        setTimeout(() => old.forEach((u) => URL.revokeObjectURL(u)), 1000);
    }

    /* ------------------------------------------------------- commands -- */

    /** The app's sac.commands, as data for the host's palette. Batched: a
     *  burst of registrations is one message. */
    function syncCommands() {
        if (!mounted || commandsTimer || !window.sac || !sac.commands) return;
        commandsTimer = setTimeout(() => {
            commandsTimer = null;
            const list = sac.commands.list().map((c) => ({
                id: c.id,
                label: String(c.label),
                icon: typeof c.icon === "string" ? c.icon : null,
                group: typeof c.group === "string" ? c.group : null,
                hotkey: typeof c.hotkey === "string" ? c.hotkey : null,
            }));
            fire("commands.set", [list]);
        }, 0);
    }

    function wrapCommands() {
        if (!window.sac || !sac.commands || sac.commands.__sacGuest) return;
        const c = sac.commands;
        const register = c.register.bind(c);
        const unregister = c.unregister.bind(c);
        c.register = (command) => {
            const off = register(command);
            syncCommands();
            return function unregisterCommand() { off(); syncCommands(); };
        };
        c.unregister = (cid) => { unregister(cid); syncCommands(); };
        Object.defineProperty(c, "__sacGuest", { value: true });
    }

    function runCommand(cid) {
        const cmd = window.sac && sac.commands ? sac.commands.list().find((c) => c.id === cid) : null;
        if (!cmd || typeof cmd.run !== "function") return;
        try { cmd.run(); }
        catch (err) { console.error(`[sac.apps] command "${cid}" threw:`, err); }
    }

    const ownRoute = (href) => !!base && (href === base || href.startsWith(base + "/"));

    /* Links: the frame does not navigate itself to the host's addresses. A
       click on one (⌂, the suite nav, a toolbar link, ?app=…) or on the
       view's own route space ("#/<id>/…", what context.href builds) goes to
       the host, which checks it and moves the TOP page — as the same click
       does in-realm. Other in-document anchors stay the frame's own. */
    document.addEventListener("click", (e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = e.composedPath().find((n) => n && n.tagName === "A" && n.hasAttribute("href"));
        if (!a) return;
        if (a.target && a.target !== "_self") return;
        const href = a.getAttribute("href");
        if (ownRoute(href) || declared.has(href) || /^\?app=/.test(href)) {
            e.preventDefault();
            fire("navigate", [href]);
        }
    });
    // A route the app set by script (location.hash = context.href(…)):
    // hand it to the host as well.
    window.addEventListener("hashchange", () => {
        const h = window.location.hash;
        if (ownRoute(h)) fire("navigate", [h]);
    });

    /* The palette chord: this document has its own keyboard; the host's
       <sac-command-palette> lives up there. Unless the app runs a palette of
       its own, mod+K is relayed. */
    window.addEventListener("keydown", (e) => {
        if (e.defaultPrevented || !booted) return;
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
        if (String(e.key).toLowerCase() !== "k") return;
        if (window.sac && sac.palette) return;
        e.preventDefault();
        fire("palette", []);
    });

    /* --------------------------------------------------------- context -- */

    function toBlob(data, type) {
        if (data instanceof Blob) return data;
        if (typeof data === "string") return new Blob([data], { type: type || "text/plain" });
        return new Blob([JSON.stringify(data, null, 2)], { type: type || "application/json" });
    }

    /** File opts that can cross: plain values only; a handle is the host's
     *  opaque id string. */
    function fileOpts(opts) {
        const o = opts || {};
        const out = {};
        ["name", "type", "title"].forEach((k) => { if (typeof o[k] === "string") out[k] = o[k]; });
        if (typeof o.accept === "string" || Array.isArray(o.accept)) out.accept = [].concat(o.accept).map(String);
        if (o.multiple) out.multiple = true;
        if (typeof o.handle === "string") out.handle = o.handle;
        return out;
    }

    const fsProxy = {
        read: (path, fallback = null) => call("fs.read", [path, fallback]),
        write(path, value, opts) {
            const progress = opts && typeof opts.onProgress === "function";
            return call("fs.write", [path, value, progress ? { progress: true } : undefined],
                progress ? { onProgress: opts.onProgress } : undefined).then(() => undefined);
        },
        remove: (path) => call("fs.remove", [path]).then(() => undefined),
        list: (prefix = "") => call("fs.list", [prefix]),
        stat: (path) => call("fs.stat", [path]),
        entries: (prefix = "") => call("fs.entries", [prefix]),
        move: (from, to) => call("fs.move", [from, to]).then(() => undefined),
        copy: (from, to) => call("fs.copy", [from, to]).then(() => undefined),
        rename: (path, name) => call("fs.rename", [path, name]).then(() => undefined),
        clear: () => call("fs.clear", []).then(() => undefined),
        usage: () => call("fs.usage", []),
        watch(cb) {
            if (typeof cb !== "function") return () => {};
            fsWatchers.add(cb);
            if (fsWatchers.size === 1) fire("fs.watch", []);
            return () => {
                if (!fsWatchers.delete(cb)) return;
                if (!fsWatchers.size) fire("fs.unwatch", []);
            };
        },
    };

    const identityHandle = {
        get: () => identity,
        onChange(cb) {
            if (typeof cb !== "function") return () => {};
            identitySubs.add(cb);
            return () => identitySubs.delete(cb);
        },
    };

    const filesProxy = {
        open: (opts) => call("files.open", [fileOpts(opts)]),
        save(data, opts) {
            const blob = toBlob(data, opts && opts.type);
            const progress = opts && typeof opts.onProgress === "function";
            return call("files.save", [blob, Object.assign(fileOpts(opts), progress ? { progress: true } : {})],
                progress ? { onProgress: opts.onProgress } : undefined);
        },
        get kind() { return filesKind; },
        get readonly() { return filesReadonly; },
    };

    function buildContext(d) {
        const granted = d.granted || { fs: false, files: false, identity: false, connect: [] };
        const ctx = {
            appId: d.appId,
            manifest: Object.assign({}, d.manifest),
            params: new URLSearchParams(d.params || ""),
            theme: {
                get: themeGet,
                set: (mode) => fire("theme.set", [mode]),
                onChange: themeOnChange,
            },
            fs: granted.fs ? fsProxy : null,
            identity: granted.identity ? identityHandle : null,
            files: granted.files ? filesProxy : null,
            lang: window.sac && sac.lang ? {
                get: () => sac.lang.get(),
                onChange: (cb) => sac.lang.onChange(cb),
            } : null,
            setDirty(flag) { fire("setDirty", [!!flag]); },
            close() { fire("close", []); },
            launch: { files: Array.isArray(d.launch) ? d.launch : [] },
            onLaunch(cb) {
                if (typeof cb !== "function") return () => {};
                launchCbs.add(cb);
                return () => launchCbs.delete(cb);
            },
            granted: Object.assign({}, granted, {
                connect: (granted.connect || []).slice(),
                api: (granted.api || []).slice(),
            }),
            isolated: true,
        };
        // The host's own capabilities (grant.api): each method a call over
        // the bridge — the host runs it and answers.
        Object.entries(d.api || {}).forEach(([name, methods]) => {
            if (!Array.isArray(methods) || Object.prototype.hasOwnProperty.call(ctx, name)) return;
            const cap = {};
            methods.forEach((m) => {
                if (typeof m === "string") cap[m] = (...args) => call("api.call", [name, m, args]);
            });
            ctx[name] = Object.freeze(cap);
        });

        if (d.kind !== "view") {
            ctx.deepLink = {
                set(obj) {
                    let plain = null;
                    if (obj != null) {
                        plain = {};
                        Object.entries(obj).forEach(([k, v]) => { if (v != null) plain[k] = String(v); });
                    }
                    fire("deepLink.set", [plain]);
                },
            };
            return ctx;
        }

        route = d.route || "";
        base = typeof d.base === "string" ? d.base : base;
        ctx.route = route;
        ctx.onRoute = (cb) => {
            if (typeof cb !== "function") return () => {};
            routeCbs.add(cb);
            return () => routeCbs.delete(cb);
        };
        hostObj = hostFrom(d.host, hostUrls);
        declared = collectDeclared(hostObj);
        ctx.host = hostObj;
        const clean = (r) => (r == null ? "" : String(r).replace(/^\/+|\/+$/g, ""));
        ctx.href = (r) => { const c = clean(r); return base + (c ? "/" + c : ""); };
        ctx.deepLink = {
            set(r) {
                route = clean(r);
                fire("deepLink.set", [route]);
            },
        };
        return ctx;
    }

    /** The frame may still be 0×0 when the host reveals it (a view shown in
     *  the same task): mount once it has a box, so an app that measures in
     *  mount() gets real numbers — the same promise the host keeps in-realm. */
    function whenSized() {
        return new Promise((resolve) => {
            if (window.innerWidth > 0 && window.innerHeight > 0) { resolve(); return; }
            const done = () => { window.removeEventListener("resize", check); resolve(); };
            const check = () => { if (window.innerWidth > 0 && window.innerHeight > 0) done(); };
            window.addEventListener("resize", check);
            setTimeout(done, 1000);
        });
    }

    function mount(d) {
        if (appEl) return;
        identity = identityFrom(d.identity);
        filesKind = d.filesKind || null;
        filesReadonly = d.filesReadonly === true;
        accentSeed = d.accent || null;
        applyTheme(d.theme);
        applyLang(d.lang);
        applyRegional(d.regional);
        const ctx = buildContext(d);
        root.style.height = "100%";
        document.body.style.height = "100%";
        whenSized().then(() => {
            appEl = document.createElement(entryTag);
            if (d.kind === "view") appEl.className = "sac-app-view";
            appEl.style.height = "100%";
            document.body.appendChild(appEl);
            if (typeof appEl.mount === "function") {
                try { appEl.mount(ctx); }
                catch (err) {
                    console.error(`[sac.apps] ${ctx.appId}.mount() threw:`, err);
                    report("mount", err);
                }
            }
            mounted = true;
            syncCommands();
        });
    }

    function loadEntry(entry) {
        entryTag = entry.tag;
        if (customElements.get(entry.tag)) { post({ type: "ready" }); return; }
        // A CORS load first: only then does the browser hand over an
        // uncaught error's message and stack (else "Script error.") and fire
        // unhandledrejection for it. A server without CORS gets a second,
        // plain try; a pinned entry is CORS by necessity.
        inject(entry, true);
    }

    function inject(entry, cors) {
        const s = document.createElement("script");
        if (entry.integrity) {
            s.integrity = entry.integrity;
            s.crossOrigin = "anonymous";
        } else if (cors) {
            s.crossOrigin = "anonymous";
        }
        s.src = entry.src;
        s.onload = () => {
            let done = false;
            customElements.whenDefined(entry.tag).then(() => {
                if (done) return;
                done = true;
                post({ type: "ready" });
            });
            setTimeout(() => {
                if (done) return;
                done = true;
                post({ type: "load-error", reason: "undefined" });
            }, DEFINE_TIMEOUT);
        };
        s.onerror = () => {
            s.remove();
            if (cors && !entry.integrity) inject(entry, false);
            else post({ type: "load-error", reason: "script" });
        };
        document.head.appendChild(s);
    }

    /* --------------------------------------------------------- inbound -- */

    function onEvent(d) {
        switch (d.topic) {
            case "theme":    applyTheme(d.theme); break;
            case "accent":   accentSeed = d.accent || null; applyAccent(); break;
            case "lang":     applyLang(d.lang); break;
            case "regional": applyRegional(d.regional); break;
            case "host":     updateHost(d.host); break;
            case "route": {
                if (typeof d.base === "string") base = d.base;
                const next = d.route || "";
                if (next === route) break;
                route = next;
                routeCbs.forEach((cb) => {
                    try { cb(next); }
                    catch (err) { console.error("[sac.apps] onRoute handler threw:", err); }
                });
                break;
            }
            case "command":  runCommand(d.id); break;
            case "launch": {
                const files = Array.isArray(d.files) ? d.files : [];
                launchCbs.forEach((cb) => {
                    try { cb({ files: files.slice() }); }
                    catch (err) { console.error("[sac.apps] onLaunch handler threw:", err); }
                });
                break;
            }
            case "identity":
                identity = identityFrom(d.profile);
                identitySubs.forEach((cb) => {
                    try { cb(identity); }
                    catch (err) { console.error("[sac.apps] identity onChange threw:", err); }
                });
                break;
            case "fs":
                fsWatchers.forEach((cb) => {
                    try { cb(d.path, d.value); }
                    catch (err) { console.error("[sac.apps] fs.watch callback threw:", err); }
                });
                break;
            case "progress": {
                const rec = pending.get(d.id);
                if (rec) rec.arm();
                if (rec && rec.onProgress) {
                    try { rec.onProgress(d.loaded, d.total); }
                    catch (err) { console.error("[sac.apps] onProgress threw:", err); }
                }
                break;
            }
            default: break;
        }
    }

    window.addEventListener("message", (e) => {
        if (e.source !== window.parent) return;
        const d = e.data;
        if (!d || typeof d !== "object" || d.sac !== ENVELOPE || d.v !== VERSION) return;

        if (d.type === "boot") {
            if (booted) return;
            booted = true;
            token = d.token;
            hostOrigin = e.origin && e.origin !== "null" ? e.origin : "*";
            if (d.limits) limits = Object.assign({}, limits, d.limits);
            applyTheme(d.theme);
            applyLang(d.lang);
            applyRegional(d.regional);
            if (d.accent) { accentSeed = d.accent; applyAccent(); }
            loadEntry(d.entry);
            return;
        }
        if (!booted || (hostOrigin !== "*" && e.origin !== hostOrigin)) return;

        switch (d.type) {
            case "mount":  mount(d); break;
            case "result": settle(d); break;
            case "alive":  (Array.isArray(d.ids) ? d.ids : []).forEach((id) => { const r = pending.get(id); if (r) r.arm(); }); break;
            case "event":  onEvent(d); break;
            case "unmount":
                if (appEl && typeof appEl.unmount === "function") {
                    try { appEl.unmount(); }
                    catch (err) {
                        console.error("[sac.apps] unmount() threw:", err);
                        report("unmount", err);
                    }
                }
                hostUrls.forEach((u) => URL.revokeObjectURL(u));
                hostUrls = [];
                identityFrom(null);
                post({ type: "unmounted" });
                break;
            default: break;
        }
    });

    // Say hello once the kit is loaded — the entry must never run before it.
    const hello = () => { wrapCommands(); post({ type: "hello" }); };
    if (window.sacReady) hello();
    else document.addEventListener("sac:ready", hello, { once: true });
})();
