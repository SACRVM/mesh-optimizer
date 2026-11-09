/**
 * SACRVM APPKIT — the host half of an ISOLATED app (sac.apps, #13).
 *
 * sac.apps loads this file on demand the first time it opens an app the host
 * installed with `isolated` (or whose manifest asked for it). It builds the
 * sandboxed frame, speaks the postMessage protocol with the guest runtime
 * (kit/js/lib/app-guest.js) and answers the guest's calls with the SAME
 * in-realm context sac.apps would have handed the app — so every capability
 * keeps its host-side semantics (scoped fs, the host's file picker, the
 * theme toggle, dirty tracking, deep links) and the host decides what exists
 * at all (context.granted).
 *
 * THE FRAME
 *   <iframe sandbox="allow-scripts allow-forms allow-popups allow-downloads">
 *   — never allow-same-origin, never allow-top-navigation. Opaque origin: no
 *   parent DOM, no host localStorage / IndexedDB / cookies.
 *
 * THE HARNESS (default: srcdoc, built by harness() below)
 *   <html data-sac-guest>, a CSP <meta> built from the grant, the kit's
 *   ui.css + all.js, then app-guest.js. The app's entry is NOT in the
 *   harness: it arrives in the boot message and the guest injects it once
 *   the kit is ready, with integrity + crossorigin when pinned. CSP:
 *     default-src 'none'
 *     script-src  <kit>/js/  <entry folder>
 *     style-src   <kit>/css/ <entry folder> 'unsafe-inline'   ← the kit's
 *                 Shadow-DOM components inject <style> and style="" markup
 *     font-src    <kit>/fonts/ <entry folder>
 *     img-src     <entry folder> blob: data:
 *     media-src   <entry folder> blob: data:
 *     connect-src the granted origins + blob: data: (never other origins)
 *     base-uri 'none'; form-action 'none'
 *   The kit is the HOST's kit (resolved from sac.apps.kitUrl / the URL
 *   apps.js was loaded from) — a hosted app runs on the host's kit, same as
 *   same-realm hosting. Fonts and a pinned entry are CORS loads from an
 *   opaque origin: their server must send Access-Control-Allow-Origin
 *   (GitHub Pages sends "*"). An unpinned entry is tried as a CORS load
 *   first and plainly after — only a CORS-loaded entry's uncaught errors
 *   arrive with message and stack (see ERRORS).
 *
 *   A host that serves its own harness (a real CSP header, frame-ancestors,
 *   …) sets sac.apps.frameUrl — a URL, or (manifest, granted) → URL. The
 *   document it serves must: mark <html data-sac-guest>, load <kit>/css/ui.css,
 *   <kit>/js/all.js and then <kit>/js/lib/app-guest.js, NOT load the entry
 *   itself, and allow (CSP) the kit, the entry's folder and the granted
 *   connect origins. The frame is sandboxed by the kit either way.
 *
 * SECURITY
 *   Every inbound message must come from THIS frame's window
 *   (event.source === frame.contentWindow) with the protocol envelope; after
 *   hello, it must also carry the per-frame token sent in boot (a document
 *   the frame navigated to never learns it). A second hello — a new document
 *   in the frame — is ignored. Nothing the guest sends is evaluated;
 *   navigation requests are honoured only for the view's own route space and
 *   the hrefs the host itself declared (context.host). Messages TO the frame
 *   go with targetOrigin "*" — the only way to address an opaque origin; they
 *   carry nothing but the app's own data.
 *
 * FILES ACROSS THE BOUNDARY (#17)
 *   files.open / files.save run the host's provider (sac.files — the picker
 *   is the host's, drawn in the top window). The FileRef.handle the provider
 *   returns stays HERE, in a per-frame table; the guest gets a random id and
 *   hands it back on the next save(), which then saves without a picker.
 *   Bytes cross as structured-cloned Blob / File. Files the host opens the
 *   app WITH ("Open with" — sac.apps.open(id, params, { files })) cross the
 *   same way: in mount (launch) and, later, as a "launch" event. A provider that refuses a
 *   save (read-only) throws an Error with code "denied"; the guest sees it.
 *   Per app: when the host granted files: { provider } (#28), the context
 *   this bridge serves holds a view bound to that provider alone — the
 *   page's sac.files is never reached, and a handle id resolves only to a
 *   handle that provider issued to this frame. context.files.readonly
 *   crosses in mount (filesReadonly).
 *
 * IMAGES FROM THE HOST
 *   The frame's img-src allows only the entry's folder, blob: and data:. So
 *   an image URL the host hands over (a host toolbar avatar's `src`, the
 *   identity's `avatar`) is fetched HERE and sent as a Blob; the guest makes
 *   its own object URL (revoked on change / unmount). data: URLs pass as is.
 *
 * COMMANDS
 *   The app's own sac.commands registrations (in the frame) are forwarded as
 *   data — id, label, icon, group, hotkey (display) — and registered here as
 *   proxies under a group named after the app ("<App>" or "<App> · <group>")
 *   so the host's Ctrl-K palette lists them; running one asks the frame to
 *   run the real command. Labels are text (the palette writes textContent).
 *   Proxies leave when the app is removed, and while its window is closed.
 *
 * ERRORS
 *   The guest reports the app's uncaught exceptions, unhandled rejections and
 *   a throwing mount() / unmount() as "app-error" messages; they reach the
 *   host page as sac:app-error (see apps.js — capped and rate-limited there).
 *   A source outside the entry's folder is dropped, with its line / column.
 *
 * LIMITS (sac.apps.limits)
 *   maxBytes — one payload: a Blob's size, or a structured-clone size
 *              estimate of any other value, in either direction → "too-large"
 *   rate     — calls per second per frame (a token bucket, burst = rate)
 *              → "rate-limited"; 0 turns it off
 *   timeout  — see app-guest.js; the host pulses "alive" for slow calls
 *
 * API (used by sac.apps; exposed for hosts that want the harness text):
 *   sac.appBridge.create(opts) → bridge { frame, ready, mount(ctx), launch(files), dispose(cb) }
 *   sac.appBridge.harness({ kitUrl, manifest, granted }) → { html, csp }
 */
(function () {
    if (!window.sac) { console.warn("[sac.appBridge] globals.js must load first."); return; }
    if (sac.appBridge) return;   // idempotent

    const ENVELOPE = "app-bridge";
    const VERSION = 1;
    const SANDBOX = "allow-scripts allow-forms allow-popups allow-downloads";
    const BOOT_TIMEOUT = 20000;   // hello + entry + define, before the host gives up
    const ERROR_KINDS = ["error", "rejection", "mount", "unmount"];
    const CODES = ["denied", "not-found", "bad-request", "too-large", "rate-limited", "timeout", "integrity", "network", "internal"];

    // The theme seeds (ui.css §2): computed on the host's <html> and replayed
    // on the guest's, so a custom theme reaches the frame, not just the flag.
    const SEEDS = [
        "--bg", "--fg", "--surface", "--accent", "--accent-edit", "--accent-warm",
        "--danger", "--ok", "--on-accent", "--lift", "--sink", "--viewport-bg",
        "--radius-s", "--radius-m", "--radius-l",
        "--palette-blue", "--palette-orange", "--palette-red", "--palette-green", "--palette-purple",
        "--palette-pink", "--palette-yellow", "--palette-teal", "--palette-gray", "--palette-indigo",
    ];

    function randomId() {
        const b = new Uint8Array(16);
        crypto.getRandomValues(b);
        return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    }

    function fallbackError(code, message) {
        const err = new Error(message);
        err.name = "SacAppError";
        err.code = code;
        return err;
    }

    /** Plain data only — functions, DOM nodes and cycles fall away. */
    function jsonSafe(v) {
        if (v == null) return v;
        try { return JSON.parse(JSON.stringify(v)); } catch (err) { return null; }
    }

    /** A structured-clone size estimate in bytes — strings 2/char, a Blob
     *  its size, buffers their length, containers their parts. Stops
     *  counting once past `limit`. */
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

    const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;")
        .replace(/</g, "&lt;").replace(/>/g, "&gt;");

    /* --------------------------------------------------------- harness -- */

    function harness(o) {
        const kit = new URL(o.kitUrl, document.baseURI).href.replace(/\/?$/, "/");
        const entry = new URL(o.manifest.src, document.baseURI);
        const appDir = new URL(".", entry).href;
        const src = (u) => {
            // A CSP source list is space/semicolon separated: a URL carrying
            // either would smuggle in a directive. Refuse, do not escape.
            if (/[\s;,'"<>]/.test(u)) throw fallbackError("bad-request", `[sac.apps] unsafe URL for a CSP source: ${u}`);
            return u;
        };
        const connect = (o.granted && o.granted.connect || []).map(src);
        const csp = [
            "default-src 'none'",
            `script-src ${src(kit + "js/")} ${src(appDir)}`,
            `style-src ${src(kit + "css/")} ${src(appDir)} 'unsafe-inline'`,
            `font-src ${src(kit + "fonts/")} ${src(appDir)}`,
            `img-src ${src(appDir)} blob: data:`,
            `media-src ${src(appDir)} blob: data:`,
            `connect-src ${connect.concat(["blob:", "data:"]).join(" ")}`,
            "base-uri 'none'",
            "form-action 'none'",
        ].join("; ");
        const html = "<!doctype html><html data-sac-guest><head><meta charset=\"utf-8\">" +
            `<meta http-equiv="Content-Security-Policy" content="${escAttr(csp)}">` +
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
            `<link rel="stylesheet" href="${escAttr(kit)}css/ui.css">` +
            `<script src="${escAttr(kit)}js/all.js"></script>` +
            `<script src="${escAttr(kit)}js/lib/app-guest.js"></script>` +
            "</head><body></body></html>";
        return { html, csp };
    }

    /* ------------------------------------------------------ host state -- */

    function themeSnapshot() {
        const root = document.documentElement;
        const cs = getComputedStyle(root);
        const vars = {};
        SEEDS.forEach((k) => {
            const v = cs.getPropertyValue(k).trim();
            if (v) vars[k] = v;
        });
        // Anything a host set inline on <html> (a user's accent, …) too.
        for (let i = 0; i < root.style.length; i++) {
            const k = root.style[i];
            if (k.startsWith("--")) vars[k] = root.style.getPropertyValue(k).trim();
        }
        const flag = sac.apps && sac.apps.theme ? sac.apps.theme.get() : "dark";
        return { flag, vars };
    }

    const langNow = () => (sac.lang ? sac.lang.get() : "en");
    const regionalNow = () => (sac.regional ? sac.regional.get() : null);

    /* ---------------------------------------------------------- bridge -- */

    function create(opts) {
        const o = opts || {};
        const manifest = o.manifest;
        const id = manifest.id;
        const granted = o.granted || { fs: false, files: false, identity: false, connect: [] };
        const api = o.api || {};
        const appError = o.appError || fallbackError;
        const limits = Object.assign({ timeout: 30000, maxBytes: 64 * 1024 * 1024, rate: 200 }, o.limits || {});
        const token = randomId();
        const integrity = typeof manifest.integrity === "string" && manifest.integrity ? manifest.integrity : "";
        // The entry's folder (absolute) — an error's source is passed on only
        // when it lies in there, so no host URL leaks into the report.
        let entryDir = "";
        try { entryDir = new URL(".", new URL(manifest.src, document.baseURI)).href; } catch (err) { /* no src */ }

        const frame = document.createElement("iframe");
        frame.setAttribute("sandbox", SANDBOX);
        frame.className = "sac-app-frame";
        frame.title = manifest.name || id;
        frame.referrerPolicy = "no-referrer";
        frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:transparent;";

        let phase = "hello";          // hello → boot → ready → mounted | failed
        let disposed = false;
        let hostCtx = null;
        let unmountAck = null;
        let heartbeat = null;
        let watchOff = null;
        const pendingCalls = new Set();
        const handles = new Map();    // opaque id → the provider's real FileRef.handle
        const actions = new Map();    // opaque id → the host's toolbar entry
        let declared = new Set();     // hrefs the host itself offers the app
        const offs = [];              // unsubscribes, run on dispose
        const images = new Map();     // image URL → Promise<Blob|null>
        const proxies = new Map();    // guest command id → unregister of the host proxy
        let guestCommands = [];       // the frame's commands, as data
        let commandsLive = true;      // false while the app's window is closed
        let bucket = null;            // rate limit: tokens left
        let refilled = 0;

        let readyResolve, readyReject;
        const ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
        ready.catch(() => {});        // the caller awaits; never an unhandled rejection
        const bootTimer = setTimeout(() => fail(appError("timeout",
            `[sac.apps] "${id}": its isolated frame did not start within ${BOOT_TIMEOUT / 1000} s`)), BOOT_TIMEOUT);

        function fail(err) {
            if (phase === "ready" || phase === "mounted" || phase === "failed") return;
            phase = "failed";
            clearTimeout(bootTimer);
            readyReject(err);
        }

        function post(msg) {
            if (disposed || !frame.contentWindow) return;
            frame.contentWindow.postMessage(Object.assign({ sac: ENVELOPE, v: VERSION }, msg), "*");
        }

        function push(topic, data) {
            if (phase !== "mounted") return;
            try { post(Object.assign({ type: "event", topic }, data)); }
            catch (err) { console.warn(`[sac.apps] ${id}: could not send "${topic}" to the frame —`, err.message); }
        }

        /* ---- images: bytes, not URLs (the frame's img-src stays tight) ---- */

        function imageBytes(url) {
            if (!images.has(url)) {
                images.set(url, (async () => {
                    try {
                        const abs = new URL(url, document.baseURI);
                        if (!/^(https?|blob):$/.test(abs.protocol)) return null;
                        const res = await fetch(abs.href, {
                            credentials: abs.origin === window.location.origin ? "same-origin" : "omit",
                        });
                        if (!res.ok) return null;
                        const blob = await res.blob();
                        return blob.size <= limits.maxBytes ? blob : null;
                    } catch (err) {
                        return null;
                    }
                })());
            }
            return images.get(url);
        }

        /** A copy of obj whose image URL at `key` became `<key>Blob` (data:
         *  URLs stay — img-src allows them). */
        async function withImage(obj, key) {
            if (!obj || typeof obj[key] !== "string" || !obj[key] || /^data:/i.test(obj[key])) return obj;
            const blob = await imageBytes(obj[key]);
            const out = Object.assign({}, obj, { [key]: null });
            if (blob) out[key + "Blob"] = blob;
            return out;
        }

        async function identityOut(p) {
            const j = jsonSafe(p);
            return j && typeof j === "object" ? withImage(j, "avatar") : null;
        }

        /* ---- the host's injection, as data ---- */

        async function serializeHost(h) {
            actions.clear();
            if (!h) { declared = new Set(); return null; }
            const out = jsonSafe(Object.assign({}, h, { nav: undefined, toolbar: undefined })) || {};
            if (Array.isArray(h.nav)) {
                out.nav = h.nav.map((n) => jsonSafe({ label: n && n.label, href: n && n.href, icon: n && n.icon }));
            }
            if (Array.isArray(h.toolbar)) {
                out.toolbar = await Promise.all(h.toolbar.map(async (tb) => {
                    const e = jsonSafe({
                        icon: tb.icon, label: tb.label, title: tb.title, href: tb.href, avatar: tb.avatar,
                    }) || {};
                    if (e.avatar) e.avatar = await withImage(e.avatar, "src");
                    if (!tb.href && typeof tb.onClick === "function") {
                        const aid = randomId();
                        actions.set(aid, tb);
                        e.actionId = aid;
                    }
                    return e;
                }));
            }
            declared = new Set();
            if (typeof out.href === "string") declared.add(out.href);
            (out.nav || []).forEach((n) => { if (n && typeof n.href === "string") declared.add(n.href); });
            (out.toolbar || []).forEach((t) => { if (t && typeof t.href === "string") declared.add(t.href); });
            return out;
        }

        const accentNow = () => (o.accentEl ? o.accentEl.style.getPropertyValue("--accent").trim() || null : null);

        /* ---- calls ---- */

        const str = (v, what) => {
            if (typeof v !== "string") throw appError("bad-request", `${what} must be a string`);
            return v;
        };

        function checkSize(v, what) {
            const size = estimateSize(v, limits.maxBytes);
            if (size > limits.maxBytes) {
                throw appError("too-large", `${what}: ${size} bytes exceed the limit of ${limits.maxBytes}`);
            }
            return v;
        }

        /** Token bucket: `rate` calls per second, bursts up to `rate`. */
        function allowCall() {
            const rate = Number(limits.rate);
            if (!(rate > 0) || rate === Infinity) return true;
            const now = performance.now();
            if (bucket === null) { bucket = rate; refilled = now; }
            bucket = Math.min(rate, bucket + ((now - refilled) / 1000) * rate);
            refilled = now;
            if (bucket < 1) return false;
            bucket -= 1;
            return true;
        }

        /* ---- the frame's commands, as palette proxies ---- */

        function applyCommands() {
            proxies.forEach((off) => { try { off(); } catch (err) { /* gone */ } });
            proxies.clear();
            if (disposed || !commandsLive || !sac.commands) return;
            const appName = manifest.name || manifest.title || id;
            guestCommands.forEach((c) => {
                proxies.set(c.id, sac.commands.register({
                    id: `app:${id}:${c.id}`,
                    label: c.label,
                    icon: c.icon,
                    group: c.group ? `${appName} · ${c.group}` : appName,
                    hotkey: c.hotkey,
                    run: () => push("command", { id: c.id }),
                }));
            });
        }

        function cleanCommands(list) {
            if (!Array.isArray(list)) throw appError("bad-request", "commands.set needs an array");
            if (list.length > 500) throw appError("too-large", "more than 500 commands");
            const seen = new Set();
            const out = [];
            list.forEach((c) => {
                if (!c || typeof c !== "object" || c.id == null || c.id === "") return;
                const cid = String(c.id).slice(0, 200);
                if (seen.has(cid)) return;
                seen.add(cid);
                out.push({
                    id: cid,
                    label: String(c.label == null ? cid : c.label).slice(0, 200),
                    icon: typeof c.icon === "string" && /^[a-z0-9-]{1,60}$/i.test(c.icon) ? c.icon : null,
                    group: typeof c.group === "string" && c.group ? c.group.slice(0, 80) : null,
                    hotkey: typeof c.hotkey === "string" && c.hotkey ? c.hotkey.slice(0, 40) : null,
                });
            });
            return out;
        }

        function fs() {
            if (!hostCtx.fs) throw appError("denied", "no storage was granted to this app");
            return hostCtx.fs;
        }

        function files() {
            if (!granted.files || !hostCtx.files) throw appError("denied", "the user's files were not granted to this app");
            return hostCtx.files;
        }

        function handleId(real) {
            if (!real) return null;
            for (const [k, v] of handles) if (v === real) return k;
            const hid = randomId();
            handles.set(hid, real);
            return hid;
        }

        const toGuestRef = (ref) => (ref ? { name: ref.name, file: ref.file, handle: handleId(ref.handle) } : null);

        function fileOpts(raw, keys) {
            const src = raw && typeof raw === "object" ? raw : {};
            const out = {};
            keys.forEach((k) => {
                const v = src[k];
                if (typeof v === "string" || typeof v === "boolean") out[k] = v;
                else if (Array.isArray(v)) out[k] = v.map(String);
            });
            return out;
        }

        const progressTo = (callId) => (loaded, total) =>
            push("progress", { id: callId, loaded, total });

        function navigate(href) {
            if (typeof href !== "string" || !href || href.length > 2048) throw appError("bad-request", "navigate needs an href");
            if (/^\s*(javascript|data|vbscript):/i.test(href)) throw appError("denied", "script URLs are never followed");
            const own = typeof hostCtx.href === "function" ? hostCtx.href("") : null;
            if (own && (href === own || href.startsWith(own + "/"))) {
                window.location.hash = href;
                return;
            }
            if (!declared.has(href)) throw appError("denied", `the host offers no link to ${href}`);
            const m = /^\?app=([^&#]+)/.exec(href);
            if (m) {
                const target = decodeURIComponent(m[1]);
                if (sac.apps.get(target)) { sac.apps.open(target).catch(() => {}); return; }
            }
            if (href.startsWith("#")) { window.location.hash = href; return; }
            window.location.assign(href);
        }

        const METHODS = {
            "fs.read": async ([path, fallback]) =>
                checkSize(await fs().read(str(path, "path"), fallback === undefined ? null : fallback), "fs.read"),
            "fs.write": async ([path, value, wo], callId) => {
                checkSize(value, "fs.write");
                const p = str(path, "path");
                if (wo && wo.progress) await fs().write(p, value, { onProgress: progressTo(callId) });
                else await fs().write(p, value);
            },
            "fs.remove":  async ([path]) => { await fs().remove(str(path, "path")); },
            "fs.list":    ([prefix]) => fs().list(prefix == null ? "" : str(prefix, "prefix")),
            "fs.stat":    ([path]) => fs().stat(str(path, "path")),
            "fs.entries": ([prefix]) => fs().entries(prefix == null ? "" : str(prefix, "prefix")),
            "fs.move":    async ([a, b]) => { await fs().move(str(a, "from"), str(b, "to")); },
            "fs.copy":    async ([a, b]) => { await fs().copy(str(a, "from"), str(b, "to")); },
            "fs.rename":  async ([a, b]) => { await fs().rename(str(a, "path"), str(b, "name")); },
            "fs.clear":   async () => { await fs().clear(); },
            "fs.usage":   () => fs().usage(),
            "fs.watch": () => {
                const handle = fs();
                if (!watchOff) {
                    watchOff = handle.watch((path, value) => {
                        const tooBig = estimateSize(value, limits.maxBytes) > limits.maxBytes;
                        push("fs", { path, value: tooBig ? undefined : value });
                    });
                }
                return true;
            },
            "fs.unwatch": () => {
                if (watchOff) { watchOff(); watchOff = null; }
                return true;
            },

            "identity.get": () => {
                if (!granted.identity || !hostCtx.identity) throw appError("denied", "identity was not granted to this app");
                return identityOut(hostCtx.identity.get());
            },

            "files.open": async ([raw]) => {
                const res = await files().open(fileOpts(raw, ["accept", "multiple", "title"]));
                checkSize(res, "files.open");
                return Array.isArray(res) ? res.map(toGuestRef) : toGuestRef(res);
            },
            "files.save": async ([blob, raw], callId) => {
                const api = files();
                if (!(blob instanceof Blob)) throw appError("bad-request", "files.save needs a Blob");
                checkSize(blob, "files.save");
                const so = fileOpts(raw, ["name", "type", "accept", "title"]);
                if (raw && raw.handle != null) {
                    const real = handles.get(String(raw.handle));
                    if (!real) throw appError("not-found", "unknown file handle — open or save the file again");
                    so.handle = real;
                }
                if (raw && raw.progress) so.onProgress = progressTo(callId);
                return toGuestRef(await api.save(blob, so));
            },

            "theme.set":    ([mode]) => { hostCtx.theme.set(mode); },
            // A <sac-lang-toggle> the user clicked inside the frame — the
            // same switch a same-realm app's toggle flips on the page.
            "lang.set": ([code]) => {
                if (typeof code !== "string" || !/^(auto|[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*)$/i.test(code)) {
                    throw appError("bad-request", "lang.set needs \"auto\" or a language code");
                }
                if (sac.lang) sac.lang.set(code);
            },
            "commands.set": ([list]) => {
                guestCommands = cleanCommands(list);
                applyCommands();
                return guestCommands.length;
            },
            "setDirty":     ([flag]) => { hostCtx.setDirty(!!flag); },
            "deepLink.set": ([x]) => {
                if (manifest.kind === "view") {
                    if (x != null && typeof x !== "string") throw appError("bad-request", "a view's deep link is a route string");
                } else if (x != null && (typeof x !== "object" || Array.isArray(x))) {
                    throw appError("bad-request", "a window's deep link is a plain object");
                }
                hostCtx.deepLink.set(x == null ? null : jsonSafe(x));
            },
            "toolbar-action": ([aid]) => {
                const tb = actions.get(aid);
                if (!tb) throw appError("not-found", "unknown toolbar action");
                tb.onClick(tb);
            },
            "navigate": ([href]) => { navigate(href); },
            "palette": () => {
                if (!sac.palette) return false;
                sac.palette.open();
                return true;
            },
            "close": () => { hostCtx.close(); },

            // A host capability (grant.api): own keys of what the host
            // granted, nothing reachable through a prototype.
            "api.call": async ([name, method, callArgs]) => {
                const own = (o, k) => o && typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
                const cap = own(api, name) ? api[name] : null;
                const fn = cap && own(cap, method) ? cap[method] : null;
                if (typeof fn !== "function") throw appError("denied", `the host granted no ${String(name)}.${String(method)}`);
                try { return await fn(...(Array.isArray(callArgs) ? callArgs : [])); }
                catch (err) { throw o.apiError ? o.apiError(err) : err; }
            },
        };

        function toWire(err) {
            const message = String((err && err.message) || err || "error").slice(0, 1000);
            // A host capability's own code (grant.api) passes through as is.
            let code = err && (err.hostCode || CODES.includes(err.code)) ? err.code : null;
            if (!code) {
                if (/does not exist|not found|no such/i.test(message)) code = "not-found";
                else if (/already exists|not JSON-serializable|cannot be stored|invalid|must be|is not a/i.test(message)) code = "bad-request";
                else code = "internal";
            }
            return { code, message };
        }

        function reply(callId, ok, value) {
            const msg = ok ? { type: "result", id: callId, ok: true, result: value }
                           : { type: "result", id: callId, ok: false, error: toWire(value) };
            try { post(msg); }
            catch (err) {
                // The result itself cannot cross (DataCloneError): say so.
                post({ type: "result", id: callId, ok: false,
                       error: { code: "internal", message: `result could not be sent: ${err.message}` } });
            }
        }

        function onCall(d) {
            const callId = d.id;
            if (typeof callId !== "number" && typeof callId !== "string") return;
            const fn = Object.prototype.hasOwnProperty.call(METHODS, d.method) ? METHODS[d.method] : null;
            if (!fn) { reply(callId, false, appError("bad-request", `unknown method "${String(d.method)}"`)); return; }
            if (!hostCtx) { reply(callId, false, appError("bad-request", "the app is not mounted yet")); return; }
            if (!allowCall()) {
                reply(callId, false, appError("rate-limited", `more than ${limits.rate} calls per second`));
                return;
            }
            const args = Array.isArray(d.args) ? d.args : [];
            const size = estimateSize(args, limits.maxBytes);
            if (size > limits.maxBytes) {
                reply(callId, false, appError("too-large", `${String(d.method)}: ${size} bytes exceed the limit of ${limits.maxBytes}`));
                return;
            }
            pendingCalls.add(callId);
            if (!heartbeat) {
                heartbeat = setInterval(() => {
                    if (pendingCalls.size) post({ type: "alive", ids: Array.from(pendingCalls) });
                }, Math.max(1000, Math.floor(limits.timeout / 3)));
            }
            Promise.resolve()
                .then(() => fn(args, callId))
                .then((result) => reply(callId, true, result), (err) => reply(callId, false, err))
                .finally(() => pendingCalls.delete(callId));
        }

        /* ---- inbound ---- */

        function onMessage(e) {
            if (disposed || !frame.contentWindow || e.source !== frame.contentWindow) return;
            const d = e.data;
            if (!d || typeof d !== "object" || d.sac !== ENVELOPE || d.v !== VERSION || typeof d.type !== "string") return;

            if (d.type === "hello") {
                if (phase !== "hello") return;   // a second document in the frame: not ours
                phase = "boot";
                post({
                    type: "boot", token,
                    entry: { src: manifest.src, integrity, tag: manifest.tag },
                    theme: themeSnapshot(), accent: accentNow(), lang: langNow(), regional: regionalNow(),
                    limits: { timeout: limits.timeout, maxBytes: limits.maxBytes, rate: limits.rate },
                });
                return;
            }
            if (d.token !== token) return;

            switch (d.type) {
                case "ready":
                    if (phase !== "boot") return;
                    phase = "ready";
                    clearTimeout(bootTimer);
                    readyResolve();
                    if (hostCtx) startMount();
                    break;
                case "load-error":
                    if (phase !== "boot") return;
                    if (d.reason === "script") o.classify(manifest.src, integrity).then(fail, fail);
                    else fail(appError("internal", `"${manifest.tag}" was never defined after loading ${manifest.src} — does the script define this exact tag?`));
                    break;
                case "call":
                    if (phase === "mounted") onCall(d);
                    break;
                case "unmounted":
                    if (unmountAck) unmountAck();
                    break;
                case "app-error": {
                    // The app's own failure after boot. Known kinds, plain
                    // values; sac.apps caps, rate-limits and fires
                    // sac:app-error.
                    if (!o.onError || !ERROR_KINDS.includes(d.kind)) return;
                    const src = typeof d.source === "string" && entryDir && d.source.startsWith(entryDir)
                        ? d.source : undefined;
                    o.onError(d.kind, {
                        message: typeof d.message === "string" ? d.message : "",
                        stack: typeof d.stack === "string" ? d.stack : undefined,
                        source: src,
                        line: src && Number.isFinite(d.line) ? d.line : undefined,
                        column: src && Number.isFinite(d.column) ? d.column : undefined,
                    });
                    break;
                }
                default: break;
            }
        }
        window.addEventListener("message", onMessage);

        /* ---- mount: the snapshot, then keep it in sync ---- */

        function mount(ctx) {
            hostCtx = ctx;
            if (phase === "ready") startMount();
        }

        function startMount() {
            doMount().catch((err) => console.error(`[sac.apps] ${id}: mount over the bridge failed —`, err));
        }

        async function doMount() {
            phase = "mounting";
            const ctx = hostCtx;
            const isView = manifest.kind === "view";
            const host = isView ? await serializeHost(ctx.host) : undefined;
            const identity = granted.identity && ctx.identity ? await identityOut(ctx.identity.get()) : null;
            if (disposed) return;
            phase = "mounted";

            post({
                type: "mount",
                appId: id,
                kind: isView ? "view" : "window",
                manifest: jsonSafe(ctx.manifest),
                params: ctx.params ? ctx.params.toString() : "",
                route: isView ? ctx.route || "" : undefined,
                base: isView ? ctx.href("") : undefined,
                host,
                theme: themeSnapshot(),
                accent: accentNow(),
                lang: langNow(),
                regional: regionalNow(),
                identity,
                filesKind: granted.files && ctx.files ? ctx.files.kind : null,
                filesReadonly: !!(granted.files && ctx.files && ctx.files.readonly),
                launch: (ctx.launch && ctx.launch.files || []).map(toGuestRef),
                granted: jsonSafe(ctx.granted),
                // Names and method names only — the functions stay here.
                api: Object.fromEntries(Object.entries(api).map(([n, m]) => [n, Object.keys(m)])),
            });

            // Route: host → guest (a rail link, back/forward, a pasted URL).
            if (isView) {
                offs.push(ctx.onRoute((route) => push("route", { route, base: ctx.href("") })));
                const onScope = () => push("route", { route: ctx.route, base: ctx.href("") });
                document.addEventListener("sac:scope-changed", onScope);
                offs.push(() => document.removeEventListener("sac:scope-changed", onScope));
                // A host re-declaration (init({host}) again) mutates ctx.host
                // in place and fires this — the frame gets the new data.
                let hostSeq = 0;
                const onHost = async () => {
                    const my = ++hostSeq;
                    const data = await serializeHost(ctx.host);
                    if (my === hostSeq) push("host", { host: data });
                };
                document.addEventListener("sac:host-changed", onHost);
                offs.push(() => document.removeEventListener("sac:host-changed", onHost));
            }

            // Theme: the flag AND the seeds, on any change to <html>.
            let lastTheme = JSON.stringify(themeSnapshot());
            const onTheme = () => {
                const snap = themeSnapshot();
                const key = JSON.stringify(snap);
                if (key === lastTheme) return;
                lastTheme = key;
                push("theme", { theme: snap });
            };
            const themeObs = new MutationObserver(onTheme);
            themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
            const mq = window.matchMedia("(prefers-color-scheme: light)");
            mq.addEventListener("change", onTheme);
            offs.push(() => { themeObs.disconnect(); mq.removeEventListener("change", onTheme); });

            // The app's own accent seed (a tile accent, a recolor) on its
            // wrapper / window.
            if (o.accentEl) {
                let lastAccent = accentNow();
                const accObs = new MutationObserver(() => {
                    const a = accentNow();
                    if (a === lastAccent) return;
                    lastAccent = a;
                    push("accent", { accent: a });
                });
                accObs.observe(o.accentEl, { attributes: true, attributeFilter: ["style"] });
                offs.push(() => accObs.disconnect());
            }

            if (sac.lang) offs.push(sac.lang.onChange((lang) => push("lang", { lang })));
            if (sac.regional) offs.push(sac.regional.onChange((r) => push("regional", { regional: r })));
            if (granted.identity && ctx.identity) {
                let idSeq = 0;
                offs.push(ctx.identity.onChange(async (p) => {
                    const my = ++idSeq;
                    const data = await identityOut(p);
                    if (my === idSeq) push("identity", { profile: data });
                }));
            }

            // A window app's commands leave the palette while it is closed.
            if (!isView && o.accentEl) {
                const win = o.accentEl;
                const onOpen = (e) => { if (e.target === win && !commandsLive) { commandsLive = true; applyCommands(); } };
                const onClose = (e) => { if (e.target === win && commandsLive) { commandsLive = false; applyCommands(); } };
                win.addEventListener("sac:open", onOpen);
                win.addEventListener("sac:close", onClose);
                offs.push(() => { win.removeEventListener("sac:open", onOpen); win.removeEventListener("sac:close", onClose); });
            }
        }

        /* ---- teardown ---- */

        function dispose(done) {
            if (disposed) { if (done) done(); return; }
            let finished = false;
            const finish = () => {
                if (finished) return;
                finished = true;
                disposed = true;
                clearTimeout(bootTimer);
                clearInterval(heartbeat);
                window.removeEventListener("message", onMessage);
                if (watchOff) { watchOff(); watchOff = null; }
                offs.splice(0).forEach((off) => { try { if (typeof off === "function") off(); } catch (err) { /* already gone */ } });
                handles.clear();
                actions.clear();
                proxies.forEach((off) => { try { off(); } catch (err) { /* gone */ } });
                proxies.clear();
                images.clear();
                frame.remove();
                if (done) done();
            };
            fail(appError("internal", `[sac.apps] "${id}" was removed while loading`));
            if (phase === "mounted") {
                // unmount() over the wire, like the in-realm call — best
                // effort: the frame goes when it answered, or a moment later.
                unmountAck = finish;
                try { post({ type: "unmount" }); } catch (err) { finish(); return; }
                setTimeout(finish, 1000);
            } else {
                finish();
            }
        }

        // Last: the document. srcdoc unless the host serves its own harness.
        const frameUrl = typeof o.frameUrl === "function"
            ? o.frameUrl(jsonSafe(manifest), jsonSafe(granted))
            : o.frameUrl;
        if (frameUrl) {
            frame.src = String(frameUrl);
        } else {
            try {
                frame.srcdoc = harness({ kitUrl: o.kitUrl, manifest, granted }).html;
            } catch (err) {
                fail(err.code ? err : appError("internal", err.message));
            }
        }
        (o.container || document.body).appendChild(frame);

        /** "Open with" on a mounted app: the files as guest refs. */
        function launch(files) {
            push("launch", { files: (files || []).map(toGuestRef) });
        }

        return { frame, ready, mount, launch, dispose };
    }

    sac.appBridge = { create, harness, estimateSize };
})();
