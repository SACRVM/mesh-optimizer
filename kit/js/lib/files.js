/**
 * SACRVM APPKIT — sac.files: open and save the USER's files.
 *
 * context.fs is an app's private drawer — settings, autosaves, its own state.
 * sac.files is the other thing every editor needs: "Open…" and "Save as…"
 * on files that belong to the person, not to the app. Where those files live
 * is the HOST's decision, and the app never knows or cares:
 *
 *   const picked = await context.files.open({ accept: ".png,image/*" });
 *   if (picked) load(await picked.file.arrayBuffer());
 *
 *   let doc = await context.files.save(blob, { name: "hero.png" });   // Save as…
 *   doc = await context.files.save(blob, { handle: doc.handle });     // Save
 *
 * Every answer is a FileRef — { name, file, handle } — or null when the user
 * cancelled. `file` is a File (type, size, lastModified). `handle` is opaque:
 * hand it back to save() and the same file is overwritten without a dialog.
 * It may be null (a browser that can only download): save() then asks again.
 *
 * WHO ANSWERS — a provider: { kind, open(opts), save(blob, opts) }.
 *
 *   sac.files.browser      the default. The device's own files: the File
 *                          System Access API where it exists (real Save, the
 *                          handle writes back), else <input type=file> to
 *                          open and a download to save.
 *   sac.files.virtual(o)   the desktop's own file space: a kit dialog over a
 *                          sac.fs handle — by default sac.fs.shared("files"),
 *                          one space every app on the desktop sees. The
 *                          dialog also offers the device, both ways.
 *                          Options: { store, label, pixelated, root,
 *                          readonly, device } — see SCOPED PROVIDERS.
 *   anything else          a host with a server, a cloud drive, a sync —
 *                          the same three members.
 *
 *   sac.files.use(sac.files.virtual());   // a desktop, once at boot
 *   sac.files.use(null);                  // back to the browser default
 *
 * SCOPED PROVIDERS — sac.files.virtual() narrowed for one app (sac.apps
 * grant.files = { provider }, see apps.js):
 *
 *   sac.files.virtual({ store, root: "Apps/paint", readonly: true })
 *
 *   root      a folder of the store the provider is jailed in. The dialog
 *             shows it as the top (its breadcrumb is `label`, default the
 *             folder's name), and every path — picked, typed, handed back in
 *             a handle — is resolved inside it: a ".." or "." segment, a
 *             "\", or a segment that decodes (%2e%2e) to one of those is
 *             refused (code "denied"), a leading "/" means the root. What
 *             the store answers outside the folder is dropped. provider.store
 *             is the jailed view, never the whole store.
 *   readonly  open only: every save() rejects with code "denied" (before any
 *             dialog), and the dialog's list changes nothing (no New folder,
 *             delete, rename or drops). provider.readonly = true.
 *   device    false drops "Open from / Save to this device…" from the
 *             dialog (default true). The device is the user's own choice,
 *             not the store's; turn it off when the app must stay in root.
 *
 * The jail holds for what crosses the app bridge (an isolated app only ever
 * holds opaque handle ids). A same-realm app shares the page's realm — it
 * could reach sac.fs itself — so for it the scope is the shape it gets, not
 * a security boundary (as with context.fs).
 *
 * THE REMOTE PROVIDER PATTERN — a provider whose picker the HOST draws and
 * whose handles only the host can read. The shape is the same three members;
 * what makes it "remote" is two promises the provider keeps:
 *
 *   1. open() / save() draw their own UI in the host's page (sac.files.virtual
 *      does: a <sac-dialog> + <sac-file-browser>) — the calling app never
 *      sees the store, only the FileRef it is handed.
 *   2. FileRef.handle is opaque: whatever the provider needs to write back
 *      (a path, a server file id + etag, …), never something the caller must
 *      understand. save({ handle }) with its own handle = Save, no dialog.
 *
 *   const remote = {
 *       kind: "cloud",
 *       async open(opts)       { const pick = await myPicker(opts);   // host UI
 *                                return pick && { name: pick.name, file: pick.file,
 *                                                 handle: { owner: remote, id: pick.id, etag: pick.etag } }; },
 *       async save(blob, opts) { const h = opts.handle;                // ours: no picker
 *                                if (h && h.owner === remote) { … write, If-Match h.etag …; return ref; }
 *                                … else a save-as picker … },
 *   };
 *   sac.files.use(remote);
 *
 * An ISOLATED app (sac.apps, sandboxed frame) reaches the same provider
 * through the bridge (kit/js/lib/app-bridge.js): its context.files is a proxy
 * whose open/save post to the host, which runs the active provider — or the
 * app's own one when the host granted files: { provider } — and the picker
 * opens in the top window. The provider's real handle stays in a
 * per-frame table on the host; the app holds a random id that stands for it,
 * hands it back on the next save() and the host resolves it — the path, the
 * etag, the provider object never cross. Bytes cross as structured-cloned
 * File / Blob (sac.apps.limits.maxBytes caps them; beyond, "too-large").
 * A provider that refuses a save — a read-only space, a failed write —
 * throws; give the Error `code: "denied"` for "not allowed" and the app sees
 * that code (anything else arrives as "internal").
 *
 * A handle remembers which provider made it and goes back there: a file
 * opened from the device is saved back to the device even while the desktop
 * space is the default. The app does not need to know.
 *
 * API (all async):
 *   open(opts)          → FileRef | FileRef[] (multiple) | null
 *       opts: { accept, multiple, title }
 *   save(data, opts)    → FileRef | null
 *       data: Blob | string | JSON-able value (strings → text/plain,
 *             values → application/json)
 *       opts: { name, type, accept, handle, title, onProgress }
 *       onProgress(loaded, total) hears the write when the provider's store
 *       reports it (virtual: a store whose write() takes { onProgress }). The
 *       virtual save dialog shows the same progress itself, and stays up
 *       until the write landed (2.36.0 — it used to close at once when the
 *       store reported nothing): a quiet store gets an indeterminate bar
 *       after 250ms. A write that fails keeps the dialog open with the typed
 *       name and the reason under it ("Couldn't save “x”. Try again, or pick
 *       another folder or name."); Save tries again, Cancel answers null —
 *       the failure is no longer thrown to the app. In the dialog's file
 *       list a tap selects (the Save / Open button confirms).
 *   kind                the active provider's kind — "browser", "virtual",
 *                       or a host's own — e.g. to word a toast ("Downloaded"
 *                       vs "Saved")
 *   readonly            true when the active provider says so (a scoped
 *                       virtual({ readonly: true }), or a host's own
 *                       provider with `readonly: true`) — hide "Save"
 *   use(provider)       host-side: install a provider (null = default)
 *   forApp(provider?)   the app-facing view (open/save/kind/readonly) —
 *                       context.files. With a provider: a view bound to
 *                       that provider only (sac.apps' per-app grant) —
 *                       every call goes to it, handles included, and the
 *                       page's active provider is never consulted
 *
 * `accept` is the <input accept> grammar — ".png,image/*" or an array.
 *
 * Language: the virtual dialog's kit strings follow a runtime switch while
 * it is open (title unless the caller gave one, buttons, the name label,
 * the device link, the save progress label; the file list relabels itself).
 * The replace question is a short-lived confirm — its buttons follow, its
 * text is set once.
 */
(function () {
    if (!window.sac) { console.warn("[sac.files] globals.js must load first — files unavailable."); return; }
    if (sac.files) return;   // idempotent

    const t = (key, fallback) => sac.t(key, fallback);

    /* ------------------------------------------------------- helpers -- */

    const acceptList = (accept) => (Array.isArray(accept) ? accept : String(accept || "").split(","))
        .map((s) => String(s).trim()).filter(Boolean);

    const EXT_MIME = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
        ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon",
        ".json": "application/json", ".txt": "text/plain", ".md": "text/markdown",
        ".csv": "text/csv", ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    };

    function toBlob(data, type) {
        if (data instanceof Blob) return data;
        if (typeof data === "string") return new Blob([data], { type: type || "text/plain" });
        return new Blob([JSON.stringify(data, null, 2)], { type: type || "application/json" });
    }

    function asFile(blob, name) {
        if (blob instanceof File && blob.name === name) return blob;
        return new File([blob], name, { type: blob.type, lastModified: Date.now() });
    }

    const ref = (name, file, handle) => ({ name, file, handle: handle || null });

    /** An Error with a code the app bridge passes through ("denied", …). */
    function coded(code, message) {
        const err = new Error(`[sac.files] ${message}`);
        err.code = code;
        return err;
    }

    /* ------------------------------------------------------ the jail --
       A store view rooted at one folder. Every path in is resolved inside
       the root and refused if it tries to leave; every path out is made
       root-relative, and anything outside the root is dropped. */

    function decodeSeg(seg) {
        try { return decodeURIComponent(seg); } catch (err) { return seg; }
    }

    /** "a/b" relative to the jail's root — or a thrown "denied". */
    function jailPath(path, allowEmpty) {
        const s = String(path == null ? "" : path);
        if (s.includes("\\") || /[\u0000-\u001f]/.test(s)) throw coded("denied", `"${s}" is not a path inside this folder`);
        const segs = s.split("/").filter(Boolean);
        for (const seg of segs) {
            const d = decodeSeg(seg);
            if (seg === "." || seg === ".." || d === "." || d === ".." || d.includes("/") || d.includes("\\")) {
                throw coded("denied", `"${s}" leaves this folder`);
            }
        }
        const rel = segs.join("/");
        if (!rel && !allowEmpty) throw coded("bad-request", "a path is required");
        return rel;
    }

    function rootedStore(store, root, readonly) {
        const base = root ? root + "/" : "";
        const inner = (p) => base + jailPath(p, false);
        const innerPrefix = (p) => { const rel = jailPath(p, true); return rel ? base + rel + "/" : base; };
        const outer = (full) => (typeof full === "string" && full.startsWith(base) && full.length > base.length
            ? full.slice(base.length) : null);
        const outStat = (s) => {
            if (!s) return s;
            const path = outer(s.path);
            return path == null ? null : Object.assign({}, s, { path });
        };
        const refuse = () => Promise.reject(coded("denied", "this folder is read-only"));
        const view = {
            root,
            readonly,
            read: async (path, fallback = null) => store.read(inner(path), fallback),
            write: async (path, value, opts) => (readonly ? refuse() : storeWrite(store, inner(path), value, opts)),
            remove: async (path) => (readonly ? refuse() : store.remove(inner(path))),
            list: async (prefix) => (await store.list(innerPrefix(prefix))).map(outer).filter((p) => p != null),
            stat: async (path) => outStat(await store.stat(inner(path))),
        };
        if (typeof store.entries === "function") {
            view.entries = async (prefix) => {
                const res = await store.entries(innerPrefix(prefix));
                return {
                    folders: (res.folders || []).map(outer).filter((p) => p != null),
                    files: (res.files || []).map(outStat).filter(Boolean),
                };
            };
        }
        if (typeof store.url === "function") view.url = async (path) => store.url(inner(path));
        const oneName = (name) => {
            const n = String(name == null ? "" : name);
            if (!n || n.includes("/") || jailPath(n, false) !== n) throw coded("denied", `"${n}" is not a name inside this folder`);
            return n;
        };
        if (typeof store.move === "function") {
            view.move = async (from, to) => (readonly ? refuse() : store.move(inner(from), inner(to)));
        }
        if (typeof store.copy === "function") {
            view.copy = async (from, to) => (readonly ? refuse() : store.copy(inner(from), inner(to)));
        }
        if (typeof store.rename === "function") {
            view.rename = async (path, name) => (readonly ? refuse() : store.rename(inner(path), oneName(name)));
        }
        return view;
    }

    /** A write through sac.fs.ops when it is loaded (it knows the optional
     *  store methods), else straight to the store — which may ignore opts. */
    function storeWrite(store, path, value, opts) {
        if (sac.fs && sac.fs.ops) return sac.fs.ops.write(store, path, value, opts);
        return store.write(path, value, opts);
    }

    /** onProgress callbacks, all of them, none allowed to break a save. */
    function fanOut(...cbs) {
        const live = cbs.filter((cb) => typeof cb === "function");
        return (loaded, total) => {
            for (const cb of live) {
                try { cb(loaded, total); }
                catch (err) { console.error("[sac.files] onProgress threw:", err); }
            }
        };
    }

    /** The <input accept> grammar as FS Access `types` — mime keys, ext lists. */
    function pickerTypes(accept, description) {
        const list = acceptList(accept);
        if (!list.length) return undefined;
        const map = {};
        for (const a of list) {
            if (a.startsWith(".")) {
                const mime = EXT_MIME[a.toLowerCase()] || "application/octet-stream";
                (map[mime] = map[mime] || []).push(a);
            } else {
                map[a] = map[a] || [];
            }
        }
        return [{ description: description || t("files.accept-description", "Files"), accept: map }];
    }

    const cancelled = (err) => err && (err.name === "AbortError" || err.name === "NotAllowedError");

    /* --------------------------------------------- the browser provider -- */

    function inputPick(accept, multiple) {
        return new Promise((resolve) => {
            const input = document.createElement("input");
            input.type = "file";
            const list = acceptList(accept);
            if (list.length) input.accept = list.join(",");
            input.multiple = !!multiple;
            input.style.display = "none";
            let done = false;
            const finish = (files) => {
                if (done) return;
                done = true;
                input.remove();
                resolve(files);
            };
            input.addEventListener("change", () => finish(Array.from(input.files || [])));
            input.addEventListener("cancel", () => finish([]));
            document.body.appendChild(input);
            input.click();
        });
    }

    function download(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }

    async function writable(fsHandle) {
        if (!fsHandle || typeof fsHandle.createWritable !== "function") return false;
        if (typeof fsHandle.queryPermission !== "function") return true;
        const opts = { mode: "readwrite" };
        if ((await fsHandle.queryPermission(opts)) === "granted") return true;
        return (await fsHandle.requestPermission(opts)) === "granted";
    }

    async function writeHandle(fsHandle, blob) {
        const w = await fsHandle.createWritable();
        await w.write(blob);
        await w.close();
    }

    const browser = {
        kind: "browser",

        async open(opts = {}) {
            const multiple = !!opts.multiple;
            if (typeof window.showOpenFilePicker === "function") {
                try {
                    const handles = await window.showOpenFilePicker({
                        multiple, types: pickerTypes(opts.accept), excludeAcceptAllOption: false,
                    });
                    const refs = await Promise.all(handles.map(async (h) =>
                        ref(h.name, await h.getFile(), { owner: browser, fsHandle: h })));
                    return multiple ? refs : refs[0] || null;
                } catch (err) {
                    if (cancelled(err)) return null;
                    // A cross-origin frame, a policy — fall through to the input.
                }
            }
            const files = await inputPick(opts.accept, multiple);
            if (!files.length) return null;
            const refs = files.map((f) => ref(f.name, f, null));
            return multiple ? refs : refs[0];
        },

        async save(blob, opts = {}) {
            const name = opts.name || (opts.handle && opts.handle.name) || "untitled";
            const h = opts.handle && opts.handle.fsHandle;
            if (h && await writable(h).catch(() => false)) {
                await writeHandle(h, blob);
                return ref(h.name, asFile(blob, h.name), opts.handle);
            }
            if (typeof window.showSaveFilePicker === "function") {
                try {
                    const fsHandle = await window.showSaveFilePicker({
                        suggestedName: name,
                        types: pickerTypes(opts.accept || (blob.type ? [blob.type] : [])),
                    });
                    await writeHandle(fsHandle, blob);
                    return ref(fsHandle.name, asFile(blob, fsHandle.name), { owner: browser, fsHandle, name: fsHandle.name });
                } catch (err) {
                    if (cancelled(err)) return null;
                }
            }
            // No real save here: a download. There is nothing to write back
            // to, so the next save() asks — honest, if less convenient.
            download(blob, name);
            return ref(name, asFile(blob, name), null);
        },
    };

    /* ------------------------------------------ the dialog + virtual FS -- */

    const CSS_ID = "sac-files-css";
    function injectCss() {
        if (document.getElementById(CSS_ID)) return;
        const style = document.createElement("style");
        style.id = CSS_ID;
        style.textContent = `
            .sac-files-dialog { --dialog-width: 640px; }
            .sac-files-body { display: flex; flex-direction: column; gap: 10px; height: min(420px, 60dvh); }
            .sac-files-body sac-file-browser { flex: 1; min-height: 0; }
            .sac-files-row { display: flex; align-items: center; gap: 8px; }
            .sac-files-row label { flex: none; font-size: 0.8rem; color: var(--text-muted); }
            .sac-files-row input { flex: 1; min-width: 0; }
            .sac-files-device {
                align-self: flex-start;
                display: inline-flex; align-items: center; gap: 6px;
                font: inherit; font-size: 0.8rem; font-weight: 600;
                color: var(--accent-text); background: none; border: 0;
                padding: 4px 0; cursor: pointer;
            }
            .sac-files-device:hover { text-decoration: underline; }
            /* Press: a ghost wash the moment it goes down. The spread shadow
               (same colour; never painted under the box) gives the
               padding-less link a 4px margin of wash. */
            .sac-files-device:active:not(:disabled) {
                background: var(--hover-strong);
                box-shadow: 0 0 0 4px var(--hover-strong);
                border-radius: var(--radius-s);
            }
            .sac-files-device:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-s); }
            .sac-files-device svg { width: 14px; height: 14px; }
            .sac-files-progress[hidden] { display: none; }
            /* A failed save: the reason under the name (ui.css .field-error
               — danger ink, 0.8rem, collapses while empty); the store's own
               words below it, quieter. */
            .sac-files-error:not(:empty) { display: flex; flex-direction: column; gap: 2px; }
            .sac-files-error-detail { color: var(--text-muted); overflow-wrap: anywhere; }
            .sac-files-body[inert] > :not(.sac-files-progress) { opacity: 0.55; }
        `;
        document.head.appendChild(style);
    }

    const icon = (n) => {
        const p = sac.icons ? sac.icons.get(n) : null;
        return p ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>` : "";
    };

    const extOf = (name) => { const m = /\.[^./]+$/.exec(name || ""); return m ? m[0].toLowerCase() : ""; };

    /* How long a save waits for the store to report progress before the bar
       shows as indeterminate ("busy") — the dialog itself waits for the
       write either way. */
    const PROGRESS_GRACE_MS = 250;

    /**
     * The dialog: resolves { paths } (open), { path } (save), { device: true }
     * (the user asked for the device instead) or null (cancelled).
     *
     * Save with `commit(path, onProgress)`: the write runs while the dialog
     * is still up and the dialog closes only once it landed, resolving
     * { path, result }. Progress the store reports shows as a bar; a quiet
     * store gets an indeterminate one after the grace period. A failed write
     * keeps the dialog open (2.36.0): the typed name stays, the reason shows
     * under it, Save tries again and Cancel resolves null. ({ path, error }
     * only if the dialog was closed mid-write by other means.)
     */
    function dialog({ mode, store, accept, multiple, name, title, label, pixelated, commit, readonly, device: offerDevice = true }) {
        injectCss();
        return new Promise((resolve) => {
            const saving = mode === "save";
            const dlg = document.createElement("sac-dialog");
            dlg.className = "sac-files-dialog";
            const kitTitle = () => (saving ? t("files.save-title", "Save as") : t("files.open-title", "Open"));
            dlg.setAttribute("title", title || kitTitle());
            // labelKey: sac-dialog relabels its buttons on a language switch.
            dlg.buttons = [
                { action: "cancel", label: "Cancel", labelKey: "files.cancel" },
                saving
                    ? { action: "ok", label: "Save", labelKey: "files.save", kind: "primary", disabled: true }
                    : { action: "ok", label: "Open", labelKey: "files.open", kind: "primary", disabled: true },
            ];

            const body = document.createElement("div");
            body.className = "sac-files-body";
            const browserEl = document.createElement("sac-file-browser");
            const acc = acceptList(accept).join(",");
            if (acc && !saving) browserEl.setAttribute("accept", acc);
            if (multiple && !saving) browserEl.setAttribute("multiple", "");
            if (pixelated) browserEl.setAttribute("pixelated", "");
            if (label) browserEl.setAttribute("root-label", label);
            if (readonly) browserEl.setAttribute("readonly", "");
            // A tap picks (the OK button confirms) — it never opens at once.
            browserEl.setAttribute("tap", "select");
            body.appendChild(browserEl);

            let nameInput = null;
            // A failed save: the reason under the name, the dialog still up.
            let failure = null;          // { name, detail } while shown
            let errorEl = null;
            if (saving) {
                const row = document.createElement("div");
                row.className = "sac-files-row";
                row.innerHTML = `<label for="sac-files-name"></label>
                    <input id="sac-files-name" type="text" spellcheck="false" autocomplete="off">`;
                nameInput = row.querySelector("input");
                nameInput.value = name || "";
                // The Field errors pattern (ui.css .field-error): a line under
                // the field, in the page and EMPTY while there is nothing to
                // say — a live region that is already there announces new
                // text reliably. Row and line share one box, so the body's
                // gap does not open around an empty line.
                const nameBox = document.createElement("div");
                errorEl = document.createElement("div");
                errorEl.className = "field-error sac-files-error";
                errorEl.id = "sac-files-error";
                errorEl.setAttribute("aria-live", "polite");
                nameBox.append(row, errorEl);
                body.appendChild(nameBox);
            }
            const paintError = () => {
                if (!errorEl) return;
                errorEl.textContent = "";
                if (!failure) {
                    nameInput.removeAttribute("aria-describedby");
                    return;
                }
                const main = document.createElement("span");
                main.textContent = t("files.save-failed", "Couldn't save “{name}”. Try again, or pick another folder or name.")
                    .replace("{name}", failure.name);
                errorEl.appendChild(main);
                if (failure.detail) {
                    // The store's own words, for whoever can act on them.
                    const why = document.createElement("span");
                    why.className = "sac-files-error-detail";
                    why.textContent = failure.detail;
                    errorEl.appendChild(why);
                }
                nameInput.setAttribute("aria-describedby", errorEl.id);
            };
            const clearError = () => { if (failure) { failure = null; paintError(); } };

            let choice = null;
            const device = document.createElement("button");
            device.type = "button";
            device.className = "sac-files-device";
            device.innerHTML = `${icon(saving ? "download" : "upload")}<span></span>`;
            device.addEventListener("click", () => { choice = { device: true }; dlg.close("device"); });
            if (offerDevice) body.appendChild(device);

            // Save progress: hidden until the store reports some.
            let bar = null;
            if (saving) {
                bar = document.createElement("sac-progress");
                bar.className = "sac-files-progress";
                bar.hidden = true;
                body.appendChild(bar);
            }
            dlg.appendChild(body);

            // Kit strings as text / attributes on the live nodes — run now
            // and again on every language switch while the dialog is up.
            const relabel = () => {
                if (!title) dlg.setAttribute("title", kitTitle());
                const lbl = body.querySelector(".sac-files-row label");
                if (lbl) lbl.textContent = t("files.name", "Name");
                device.querySelector("span").textContent = saving
                    ? t("files.to-device", "Save to this device instead…")
                    : t("files.from-device", "Open from this device…");
                if (bar) bar.setAttribute("label", t("files.saving", "Saving…"));
                if (failure) paintError();
            };
            relabel();
            const offLang = sac.lang ? sac.lang.onChange(relabel) : () => {};

            const targetPath = () => {
                let n = (nameInput.value || "").trim().replace(/^\/+|\/+$/g, "");
                if (!n) return "";
                // A typed "../x" or "a\b" is not a name here (a jailed store
                // would refuse it anyway): keep Save disabled.
                if (n.split("/").some((seg) => !seg || seg === "." || seg === "..") || n.includes("\\")) return "";
                // Keep the type recognisable: "hero" saving a PNG is "hero.png".
                const want = extOf(name);
                if (want && !extOf(n)) n += want;
                return browserEl.path ? `${browserEl.path}/${n}` : n;
            };
            const sync = () => {
                dlg.setDisabled("ok", saving ? !targetPath() : browserEl.selected.length === 0);
            };

            browserEl.addEventListener("sac:select", () => {
                if (saving && browserEl.selected.length) {
                    const p = browserEl.selected[0];
                    nameInput.value = p.slice(p.lastIndexOf("/") + 1);
                }
                sync();
            });
            browserEl.addEventListener("sac:navigate", () => { clearError(); sync(); });
            browserEl.addEventListener("sac:choose", () => dlg.trigger("ok"));
            if (nameInput) {
                nameInput.addEventListener("input", () => { clearError(); sync(); });
                nameInput.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") { e.preventDefault(); dlg.trigger("ok"); }
                });
            }

            dlg.beforeAction = async (action) => {
                if (action !== "ok") return true;
                if (!saving) {
                    if (!browserEl.selected.length) return false;
                    choice = { paths: browserEl.selected };
                    return true;
                }
                const path = targetPath();
                if (!path) return false;
                if (await store.stat(path)) {
                    const answer = await sac.dialog.confirm({
                        title: t("files.replace-title", "Replace this file?"),
                        message: `“${path.slice(path.lastIndexOf("/") + 1)}” ${t("files.replace-message", "already exists. Saving replaces it.")}`,
                        buttons: [
                            { action: "cancel", label: "Cancel", labelKey: "files.cancel" },
                            { action: "replace", label: "Replace", labelKey: "files.replace", kind: "destructive" },
                        ],
                    });
                    if (answer !== "replace") return false;
                }
                if (!commit) {
                    choice = { path };
                    return true;
                }
                return write(path);
            };

            /* The write, inside the dialog, which closes only once it LANDED.
               Everything but the progress bar is frozen meanwhile; Escape is
               held back (a dismissal waits for a pending beforeAction; were
               the dialog closed mid-write anyway, the answer still waits for
               the write). A store that reports progress shows it; one that
               does not shows an indeterminate bar after the grace period. A
               failed write keeps the dialog up: unfrozen, the typed name
               still in the field, the reason under it — Save tries again,
               Cancel answers null. */
            let writing = null;
            const holdEscape = (e) => {
                if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); }
            };
            async function write(path) {
                let reported = false;
                const onProgress = (loaded, total) => {
                    const known = total > 0 && Number.isFinite(total);
                    if (known && loaded >= total && !reported) return;   // done-at-once: nothing to show
                    reported = true;
                    bar.hidden = false;
                    if (known) {
                        bar.removeAttribute("indeterminate");
                        bar.setAttribute("max", String(total));
                        bar.setAttribute("value", String(Math.min(loaded, total)));
                    } else {
                        bar.setAttribute("indeterminate", "");
                    }
                };
                clearError();
                body.inert = true;
                dlg.setDisabled("cancel", true);
                dlg.setDisabled("ok", true);
                window.addEventListener("keydown", holdEscape, true);
                const release = () => window.removeEventListener("keydown", holdEscape, true);
                writing = Promise.resolve()
                    .then(() => commit(path, onProgress))
                    .then((result) => ({ path, result }), (error) => ({ path, error }));
                // A quiet store: after the grace period the bar says "busy".
                const quiet = setTimeout(() => {
                    if (reported) return;
                    bar.hidden = false;
                    bar.setAttribute("indeterminate", "");
                }, PROGRESS_GRACE_MS);
                const outcome = await writing;
                clearTimeout(quiet);
                release();
                if (!outcome.error) return true;
                // Failed: stay. The answer is no longer this write — a Cancel
                // now answers null, a Save writes again.
                console.error("[sac.files] save failed:", outcome.error);
                writing = null;
                bar.hidden = true;
                body.inert = false;
                dlg.setDisabled("cancel", false);
                sync();
                const err = outcome.error;
                failure = {
                    name: path.slice(path.lastIndexOf("/") + 1),
                    detail: String((err && err.message) || err || "").replace(/^\[sac\.[a-z]+\]\s*/i, ""),
                };
                paintError();
                if (nameInput && dlg.hasAttribute("open")) nameInput.focus();
                return false;
            }

            // The exit plays before the element goes (sac:closed).
            const closed = new Promise((r) => dlg.addEventListener("sac:closed", r, { once: true }));
            dlg.addEventListener("sac:action", async () => {
                offLang();
                const answer = writing ? await writing : choice;
                await closed;
                dlg.remove();
                resolve(answer);
            }, { once: true });

            document.body.appendChild(dlg);
            browserEl.store = store;
            setTimeout(() => {
                dlg.open();
                // In a folder given by the name ("sprites/hero.png"), start there.
                if (saving && name && name.includes("/")) {
                    browserEl.path = name.slice(0, name.lastIndexOf("/"))
                        .split("/").filter((seg) => seg && seg !== "." && seg !== "..").join("/");
                    nameInput.value = name.slice(name.lastIndexOf("/") + 1);
                }
                sync();
                if (nameInput) {
                    nameInput.focus();
                    const dot = nameInput.value.lastIndexOf(".");
                    nameInput.setSelectionRange(0, dot > 0 ? dot : nameInput.value.length);
                } else {
                    browserEl.shadowRoot.querySelector(".list")?.focus();
                }
            }, 0);
        });
    }

    function virtual(options = {}) {
        const whole = options.store || sac.fs.shared("files");
        // Scoped (root / readonly): everything — the dialog, reads, writes,
        // handles — goes through the jailed view; unscoped, the store as is.
        let root = "";
        if (options.root != null && options.root !== "") {
            try { root = jailPath(options.root, true); }
            catch (err) { throw new Error(`[sac.files] virtual(): root "${options.root}" is not a folder path — no "..", ".", or "\\"`); }
        }
        const readonly = options.readonly === true;
        const device = options.device !== false;
        const store = root || readonly ? rootedStore(whole, root, readonly) : whole;
        const label = options.label || (root ? root.slice(root.lastIndexOf("/") + 1) : undefined);
        const denied = () => coded("denied", "this file space is read-only");
        const provider = {
            kind: "virtual",
            store,
            root,
            readonly,

            async open(opts = {}) {
                const answer = await dialog({
                    mode: "open", store, accept: opts.accept, multiple: opts.multiple,
                    title: opts.title, label, pixelated: options.pixelated,
                    readonly, device,
                });
                if (!answer) return null;
                if (answer.device) return device ? browser.open(opts) : null;
                const refs = [];
                for (const path of answer.paths) {
                    let file = await store.read(path, null);
                    if (file == null) continue;
                    if (!(file instanceof Blob)) file = asFile(toBlob(file), path.slice(path.lastIndexOf("/") + 1));
                    refs.push(ref(file.name, file, { owner: provider, path }));
                }
                if (!refs.length) return null;
                return opts.multiple ? refs : refs[0];
            },

            async save(blob, opts = {}) {
                if (readonly) throw denied();
                const h = opts.handle;
                // A device file opened through this dialog goes back to the
                // device (sac.files.save routes by owner already; a view
                // bound to this provider — forApp(provider) — lands here).
                if (h && h.owner === browser && device) return browser.save(blob, opts);
                if (h && h.owner === provider && h.path) {
                    // Resolved inside the jail again: a handle whose path was
                    // tampered with cannot leave the root.
                    // Save onto a known file: no dialog, so progress goes to
                    // the caller's opts.onProgress only.
                    await storeWrite(store, h.path, blob, { onProgress: fanOut(opts.onProgress) });
                    const fileName = h.path.slice(h.path.lastIndexOf("/") + 1);
                    return ref(fileName, asFile(blob, fileName), h);
                }
                const answer = await dialog({
                    mode: "save", store, name: opts.name || "untitled", title: opts.title,
                    label, pixelated: options.pixelated, device,
                    // Replacing an existing file is a plain write — the store
                    // overwrites; the dialog asked first.
                    commit: (path, onProgress) => storeWrite(store, path, blob,
                        { onProgress: fanOut(onProgress, opts.onProgress) }),
                });
                if (!answer) return null;
                if (answer.device) return device ? browser.save(blob, Object.assign({}, opts, { handle: null })) : null;
                if (answer.error) throw answer.error;
                const fileName = answer.path.slice(answer.path.lastIndexOf("/") + 1);
                return ref(fileName, asFile(blob, fileName), { owner: provider, path: answer.path });
            },
        };
        return provider;
    }

    /* ------------------------------------------------------------ API -- */

    let active = null;
    const current = () => active || browser;

    sac.files = {
        get kind() { return current().kind || "custom"; },
        get readonly() { return current().readonly === true; },

        use(provider) {
            if (provider && (typeof provider.open !== "function" || typeof provider.save !== "function")) {
                console.warn("[sac.files] use() needs a provider with open() and save()");
                return;
            }
            active = provider || null;
        },

        async open(opts = {}) {
            return current().open(Object.assign({}, opts, { accept: acceptList(opts.accept) }));
        },

        async save(data, opts = {}) {
            const blob = toBlob(data, opts.type);
            const o = Object.assign({}, opts, { accept: acceptList(opts.accept) });
            // A handle goes home to the provider that made it.
            const owner = o.handle && o.handle.owner;
            if (owner && typeof owner.save === "function") return owner.save(blob, o);
            return current().save(blob, Object.assign(o, { handle: null }));
        },

        /** What an app gets as context.files: open, save, kind, readonly —
         *  no use(). With a provider, a view bound to it alone (a per-app
         *  grant): the page's active provider is never consulted, and a
         *  handle goes to this provider, which decides what it means. */
        forApp(provider) {
            if (provider) {
                if (typeof provider.open !== "function" || typeof provider.save !== "function") {
                    throw new Error("[sac.files] forApp() needs a provider with open() and save()");
                }
                return {
                    open: async (opts = {}) => provider.open(Object.assign({}, opts, { accept: acceptList(opts.accept) })),
                    save: async (data, opts = {}) => provider.save(toBlob(data, opts.type),
                        Object.assign({}, opts, { accept: acceptList(opts.accept), handle: opts.handle || null })),
                    get kind() { return provider.kind || "custom"; },
                    get readonly() { return provider.readonly === true; },
                };
            }
            return {
                open: (opts) => sac.files.open(opts),
                save: (data, opts) => sac.files.save(data, opts),
                get kind() { return sac.files.kind; },
                get readonly() { return sac.files.readonly; },
            };
        },

        browser,
        virtual,
    };
})();
