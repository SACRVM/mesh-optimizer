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
 *                          Options: { store, label, pixelated }.
 *   anything else          a host with a server, a cloud drive, a sync —
 *                          the same three members.
 *
 *   sac.files.use(sac.files.virtual());   // a desktop, once at boot
 *   sac.files.use(null);                  // back to the browser default
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
 *       opts: { name, type, accept, handle, title }
 *   kind                the active provider's kind — "browser", "virtual",
 *                       or a host's own — e.g. to word a toast ("Downloaded"
 *                       vs "Saved")
 *   use(provider)       host-side: install a provider (null = default)
 *   forApp()            the app-facing view (open/save/kind) — context.files
 *
 * `accept` is the <input accept> grammar — ".png,image/*" or an array.
 *
 * Language: the virtual dialog's kit strings follow a runtime switch while
 * it is open (title unless the caller gave one, buttons, the name label,
 * the device link; the file list relabels itself). The replace question is
 * a short-lived confirm — its buttons follow, its text is set once.
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
            .sac-files-device:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-s); }
            .sac-files-device svg { width: 14px; height: 14px; }
        `;
        document.head.appendChild(style);
    }

    const icon = (n) => {
        const p = sac.icons ? sac.icons.get(n) : null;
        return p ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>` : "";
    };

    const extOf = (name) => { const m = /\.[^./]+$/.exec(name || ""); return m ? m[0].toLowerCase() : ""; };

    /**
     * The dialog: resolves { paths } (open), { path } (save), { device: true }
     * (the user asked for the device instead) or null (cancelled).
     */
    function dialog({ mode, store, accept, multiple, name, title, label, pixelated }) {
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
            body.appendChild(browserEl);

            let nameInput = null;
            if (saving) {
                const row = document.createElement("div");
                row.className = "sac-files-row";
                row.innerHTML = `<label for="sac-files-name"></label>
                    <input id="sac-files-name" type="text" spellcheck="false" autocomplete="off">`;
                nameInput = row.querySelector("input");
                nameInput.value = name || "";
                body.appendChild(row);
            }

            let choice = null;
            const device = document.createElement("button");
            device.type = "button";
            device.className = "sac-files-device";
            device.innerHTML = `${icon(saving ? "download" : "upload")}<span></span>`;
            device.addEventListener("click", () => { choice = { device: true }; dlg.close("device"); });
            body.appendChild(device);
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
            };
            relabel();
            const offLang = sac.lang ? sac.lang.onChange(relabel) : () => {};

            const targetPath = () => {
                let n = (nameInput.value || "").trim().replace(/^\/+|\/+$/g, "");
                if (!n) return "";
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
            browserEl.addEventListener("sac:navigate", sync);
            browserEl.addEventListener("sac:choose", () => dlg.trigger("ok"));
            if (nameInput) {
                nameInput.addEventListener("input", sync);
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
                choice = { path };
                return true;
            };

            dlg.addEventListener("sac:action", () => {
                offLang();
                setTimeout(() => { dlg.remove(); resolve(choice); }, 120);
            }, { once: true });

            document.body.appendChild(dlg);
            browserEl.store = store;
            setTimeout(() => {
                dlg.open();
                // In a folder given by the name ("sprites/hero.png"), start there.
                if (saving && name && name.includes("/")) {
                    browserEl.path = name.slice(0, name.lastIndexOf("/"));
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
        const store = options.store || sac.fs.shared("files");
        const provider = {
            kind: "virtual",
            store,

            async open(opts = {}) {
                const answer = await dialog({
                    mode: "open", store, accept: opts.accept, multiple: opts.multiple,
                    title: opts.title, label: options.label, pixelated: options.pixelated,
                });
                if (!answer) return null;
                if (answer.device) return browser.open(opts);
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
                const h = opts.handle;
                if (h && h.owner === provider && h.path) {
                    await store.write(h.path, blob);
                    const fileName = h.path.slice(h.path.lastIndexOf("/") + 1);
                    return ref(fileName, asFile(blob, fileName), h);
                }
                const answer = await dialog({
                    mode: "save", store, name: opts.name || "untitled", title: opts.title,
                    label: options.label, pixelated: options.pixelated,
                });
                if (!answer) return null;
                if (answer.device) return browser.save(blob, Object.assign({}, opts, { handle: null }));
                await store.write(answer.path, blob);
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

        /** What an app gets as context.files: open, save, kind — no use(). */
        forApp() {
            return {
                open: (opts) => sac.files.open(opts),
                save: (data, opts) => sac.files.save(data, opts),
                get kind() { return sac.files.kind; },
            };
        },

        browser,
        virtual,
    };
})();
