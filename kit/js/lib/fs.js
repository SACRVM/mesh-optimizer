/**
 * SACRVM APPKIT — sac.fs: the storage capability behind context.fs.
 *
 * An app gets a handle scoped to itself and nothing else:
 *
 *   await context.fs.write("notes/2026-08", { title: "…", body: "…" });
 *   const note = await context.fs.read("notes/2026-08", null);
 *   const paths = await context.fs.list("notes/");
 *
 * Three properties make this worth having over raw localStorage:
 *
 *   1. SCOPED. Every path is stored under "sac.fs/<appId>/", so two apps
 *      cannot collide on "settings" — and neither has to invent a prefix.
 *   2. ASYNC. Every method returns a Promise, even though the default backend
 *      answers immediately. An app written against this today keeps working
 *      when a host swaps in IndexedDB, the File System Access API or a server.
 *   3. SWAPPABLE. The namespacing, JSON and notification layers are the kit's;
 *      the actual bytes go through a four-method backend a host can replace:
 *
 *        sac.fs.backend = {
 *            get(key),          // → string | null   (may return a Promise)
 *            set(key, value),   // string
 *            del(key),
 *            keys(prefix),      // → string[]
 *            // optional — bytes (see Values below):
 *            getBlob(key), setBlob(key, blob), delBlob(key),
 *        };
 *
 * Values are JSON — objects, arrays, strings, numbers, booleans, null — or a
 * Blob (a File is one). Bytes do not go through JSON: the entry holds a small
 * stub ({ "$sac.blob": { type, size, modified } }) and the bytes live beside
 * it, in IndexedDB for the default backend. So list(), usage() and watch()
 * see a binary file like any other entry, a PNG costs what a PNG costs, and
 * localStorage's few megabytes are not the ceiling. read() hands a binary
 * entry back as a File (name = the last path segment, lastModified = when it
 * was written). Wrap raw bytes in a Blob before writing them.
 *
 * A backend that can hold bytes adds three optional methods — getBlob(key),
 * setBlob(key, blob), delBlob(key). One that cannot still works: the bytes
 * then ride inline in the stub as a data: URL, which is correct, only larger.
 *
 * The handle an app receives is deliberately small. It cannot read another
 * app's data, and it cannot enumerate what else is stored — not as a security
 * boundary (same origin, same JS realm) but so the shape stays honest when a
 * backend where that IS enforced arrives.
 *
 * API (all async except watch):
 *   read(path, fallback = null)   the stored value, or fallback if absent
 *   write(path, value)            store it; rejects if there is no room
 *   remove(path)                  delete one path
 *   list(prefix = "")             app-relative paths, sorted
 *   stat(path)                    { path, name, type, size, modified, binary }
 *                                 or null — what a file dialog lists. JSON
 *                                 entries carry no timestamp (modified: null)
 *   clear()                       delete everything this app stored
 *   usage()                       { bytes, count } — what this app keeps
 *   watch(cb)                     cb(path, value) on change, incl. other tabs;
 *                                 value is null for a delete. Returns an
 *                                 unsubscribe function.
 *
 * Shared spaces: sac.fs.shared(name) returns the same handle over a root that
 * belongs to no app ("sac.shared/<name>/") — the user's files (sac.files)
 * live in one. It is kept out of every app's drawer, so sac.fs.apps() never
 * lists it; who may reach it is the host's call.
 */
(function () {
    if (!window.sac) { console.warn("[sac.fs] globals.js must load first — storage unavailable."); return; }
    if (sac.fs) return;   // idempotent

    const ROOT = "sac.fs/";
    const SHARED_ROOT = "sac.shared/";
    const BLOB = "$sac.blob";            // the stub's one key

    /* IndexedDB — where the default backend keeps bytes. One database, one
       object store, keyed by the same key as the entry's stub. Opened lazily:
       a page that never stores a Blob never opens it. */
    let dbPromise = null;
    function db() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                if (!window.indexedDB) { reject(new Error("no IndexedDB")); return; }
                const req = indexedDB.open("sac.fs", 1);
                req.onupgradeneeded = () => req.result.createObjectStore("blobs");
                req.onsuccess = () => resolve(req.result);
                req.onerror   = () => reject(req.error);
            });
            // A failed open is not cached: a private window may refuse once
            // and allow later, and the inline fallback covers the meantime.
            dbPromise.catch(() => { dbPromise = null; });
        }
        return dbPromise;
    }
    function blobStore(mode, act) {
        return db().then((conn) => new Promise((resolve, reject) => {
            const tx  = conn.transaction("blobs", mode);
            const req = act(tx.objectStore("blobs"));
            tx.oncomplete = () => resolve(req.result);
            tx.onerror    = () => reject(tx.error);
            tx.onabort    = () => reject(tx.error);
        }));
    }

    /** localStorage, wrapped to the backend's four methods. */
    const localBackend = {
        get(key) {
            try { return localStorage.getItem(key); }
            catch (err) { return null; }          // private mode, blocked storage
        },
        set(key, value) { localStorage.setItem(key, value); },
        del(key) {
            try { localStorage.removeItem(key); } catch (err) { /* nothing to undo */ }
        },
        keys(prefix) {
            const out = [];
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith(prefix)) out.push(key);
                }
            } catch (err) { /* no storage, no keys */ }
            return out;
        },
        getBlob(key)       { return blobStore("readonly",  (st) => st.get(key)); },
        setBlob(key, blob) { return blobStore("readwrite", (st) => st.put(blob, key)); },
        delBlob(key)       { return blobStore("readwrite", (st) => st.delete(key)); },
    };

    /* ----------------------------------------------------------- blobs -- */

    const isStub = (v) => v != null && typeof v === "object" && !Array.isArray(v)
        && v[BLOB] != null && typeof v[BLOB] === "object";

    function parseRaw(raw) {
        if (raw == null) return { ok: true, absent: true, value: null };
        try { return { ok: true, value: JSON.parse(raw) }; }
        catch (err) { return { ok: false, err }; }
    }

    const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload  = () => resolve(r.result);
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
        });
    }

    /** The bytes behind a stub, as a File — or null when they are gone. */
    async function blobFor(backend, key, stub, path) {
        const meta = stub[BLOB];
        let blob = null;
        if (typeof meta.data === "string") {
            try { blob = await (await fetch(meta.data)).blob(); }
            catch (err) { blob = null; }
        } else if (typeof backend.getBlob === "function") {
            try { blob = await backend.getBlob(key); }
            catch (err) { blob = null; }
        }
        if (!blob) return null;
        return new File([blob], baseName(path), {
            type: meta.type || blob.type || "application/octet-stream",
            lastModified: meta.modified || Date.now(),
        });
    }

    /** Drop the bytes kept beside whatever stub `raw` is, if any. */
    async function dropBytes(backend, key, raw) {
        const parsed = parseRaw(raw);
        if (!parsed.ok || !isStub(parsed.value) || typeof parsed.value[BLOB].data === "string") return;
        if (typeof backend.delBlob !== "function") return;
        try { await backend.delBlob(key); } catch (err) { /* already gone */ }
    }

    /** Path hygiene: no leading/trailing slashes, no empty segments, no "..". */
    function cleanPath(path) {
        const clean = String(path == null ? "" : path)
            .split("/").filter((seg) => seg && seg !== "." && seg !== "..").join("/");
        if (!clean) throw new Error("[sac.fs] a path is required");
        return clean;
    }

    const cleanId = (appId) =>
        String(appId || "app").replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();

    /* Local listeners, so a write is heard in THIS tab too — the storage event
       fires only in the others. Keyed by app root. */
    const watchers = new Map();          // root → Set<cb>

    function notify(root, path, value) {
        const set = watchers.get(root);
        if (!set) return;
        for (const cb of set) {
            try { cb(path, value); }
            catch (err) { console.error("[sac.fs] a watcher threw:", err); }
        }
    }

    // Other tabs of the same origin. One document-level listener, however many
    // handles exist; storage events carry the new value already.
    let storageBound = false;
    function bindStorage() {
        if (storageBound) return;
        storageBound = true;
        window.addEventListener("storage", async (e) => {
            if (!e.key || !(e.key.startsWith(ROOT) || e.key.startsWith(SHARED_ROOT))) return;
            for (const root of watchers.keys()) {
                if (!e.key.startsWith(root)) continue;
                const path = e.key.slice(root.length);
                let value = null;
                if (e.newValue != null) {
                    try { value = JSON.parse(e.newValue); } catch (err) { value = null; }
                }
                // The other tab wrote bytes: watchers here get the File, as
                // the writing tab's own watchers did.
                if (isStub(value)) value = await blobFor(sac.fs.backend || localBackend, e.key, value, path);
                notify(root, path, value);
            }
        });
    }

    /** The handle one app gets. Everything it can reach lives under its root.
     *  `appId` names it in messages; a shared space passes its own root. */
    function handleFor(appId, rootOverride) {
        const root = rootOverride || ROOT + cleanId(appId) + "/";
        const backend = () => sac.fs.backend || localBackend;

        /** Bytes beside, stub in the entry — or inline when there is no
         *  beside. The stub is written LAST, so a reader never finds a stub
         *  whose bytes are not there yet. */
        async function writeBlob(key, clean, blob) {
            const be = backend();
            const meta = {
                type: blob.type || "application/octet-stream",
                size: blob.size,
                modified: Date.now(),
            };
            const old = await be.get(key);
            let beside = false;
            if (typeof be.setBlob === "function") {
                try { await be.setBlob(key, blob); beside = true; }
                catch (err) { beside = false; }       // no IndexedDB here: go inline
            }
            if (!beside) {
                await dropBytes(be, key, old);
                meta.data = await blobToDataUrl(blob);
            }
            try {
                await be.set(key, JSON.stringify({ [BLOB]: meta }));
            } catch (err) {
                throw new Error(
                    `[sac.fs] ${appId}: could not store "${clean}" — ${err && err.name === "QuotaExceededError"
                        ? "no room left in this browser's storage" : (err && err.message) || err}`);
            }
            notify(root, clean, new File([blob], baseName(clean),
                { type: meta.type, lastModified: meta.modified }));
        }

        return {
            async read(path, fallback = null) {
                const clean = cleanPath(path);
                const key = root + clean;
                const parsed = parseRaw(await backend().get(key));
                if (parsed.ok && parsed.absent) return fallback;
                if (!parsed.ok) {
                    // Corrupt data is not worth crashing an app over: say so
                    // loudly, hand back the fallback, let the app move on.
                    console.warn(`[sac.fs] ${appId}: "${path}" is not readable JSON`, parsed.err);
                    return fallback;
                }
                if (!isStub(parsed.value)) return parsed.value;
                const file = await blobFor(backend(), key, parsed.value, clean);
                if (!file) {
                    console.warn(`[sac.fs] ${appId}: "${path}" lost its bytes`);
                    return fallback;
                }
                return file;
            },

            async write(path, value) {
                const clean = cleanPath(path);
                const key = root + clean;
                if (value instanceof Blob) {
                    await writeBlob(key, clean, value);
                    return;
                }
                // JSON replacing bytes: the old bytes must not outlive it.
                await dropBytes(backend(), key, await backend().get(key));
                let json;
                try {
                    json = JSON.stringify(value);
                } catch (err) {
                    throw new Error(`[sac.fs] ${appId}: "${path}" is not JSON-serializable`);
                }
                if (json === undefined) {
                    // JSON.stringify answers undefined for functions, symbols
                    // and undefined itself — no throw to catch, so check it.
                    throw new Error(
                        `[sac.fs] ${appId}: "${path}" — a function, a symbol or undefined cannot be stored`);
                }
                try {
                    await backend().set(key, json);
                } catch (err) {
                    // Quota is the one failure an app can act on (prune, warn
                    // the user), so it must arrive as a rejection, not a
                    // swallowed console line.
                    throw new Error(
                        `[sac.fs] ${appId}: could not store "${path}" — ${err && err.name === "QuotaExceededError"
                            ? "no room left in this browser's storage" : (err && err.message) || err}`);
                }
                notify(root, clean, value);
            },

            async remove(path) {
                const clean = cleanPath(path);
                const key = root + clean;
                await dropBytes(backend(), key, await backend().get(key));
                await backend().del(key);
                notify(root, clean, null);
            },

            async stat(path) {
                const clean = cleanPath(path);
                const raw = await backend().get(root + clean);
                if (raw == null) return null;
                const parsed = parseRaw(raw);
                if (parsed.ok && isStub(parsed.value)) {
                    const meta = parsed.value[BLOB];
                    return {
                        path: clean, name: baseName(clean), binary: true,
                        type: meta.type || "application/octet-stream",
                        size: meta.size || 0, modified: meta.modified || null,
                    };
                }
                return {
                    path: clean, name: baseName(clean), binary: false,
                    type: "application/json", size: new Blob([raw]).size, modified: null,
                };
            },

            async list(prefix = "") {
                const want = root + String(prefix || "").replace(/^\/+/, "");
                const keys = await backend().keys(want);
                return keys.map((k) => k.slice(root.length)).sort();
            },

            async clear() {
                const keys = await backend().keys(root);
                for (const key of keys) {
                    await dropBytes(backend(), key, await backend().get(key));
                    await backend().del(key);
                    notify(root, key.slice(root.length), null);
                }
            },

            async usage() {
                const keys = await backend().keys(root);
                let bytes = 0;
                for (const key of keys) {
                    const raw = await backend().get(key);
                    // UTF-16 in every engine that ships localStorage: two bytes
                    // per code unit, key included — it is stored too.
                    if (raw != null) bytes += (raw.length + key.length) * 2;
                    // Bytes kept beside a stub count at their own size.
                    const parsed = parseRaw(raw);
                    if (parsed.ok && isStub(parsed.value) && typeof parsed.value[BLOB].data !== "string") {
                        bytes += parsed.value[BLOB].size || 0;
                    }
                }
                return { bytes, count: keys.length };
            },

            watch(cb) {
                if (typeof cb !== "function") return () => {};
                bindStorage();
                if (!watchers.has(root)) watchers.set(root, new Set());
                watchers.get(root).add(cb);
                return () => {
                    const set = watchers.get(root);
                    if (!set) return;
                    set.delete(cb);
                    if (set.size === 0) watchers.delete(root);
                };
            },
        };
    }

    sac.fs = {
        /**
         * The handle for one app — what lands in context.fs.
         *
         * A host calls this too, with somebody else's id: that is how a desktop
         * shows what an app is keeping (`usage()`) or offers to delete it
         * (`clear()`) without being that app.
         */
        for: (appId) => handleFor(appId),

        /**
         * A space that belongs to no app — the same handle, rooted at
         * "sac.shared/<name>/". sac.files keeps the user's files in
         * shared("files"). apps() never lists it: it is nobody's drawer.
         */
        shared: (name) => handleFor(`shared:${cleanId(name)}`, SHARED_ROOT + cleanId(name) + "/"),

        /**
         * Host-side: the ids that have stored something. An app cannot ask this
         * — it only ever sees its own drawer — but a host must be able to, or
         * the data of an app somebody uninstalled a year ago is unreachable
         * and unaccountable. Pair it with for(id).usage() and for(id).clear().
         */
        async apps() {
            const backend = sac.fs.backend || localBackend;
            const keys = await backend.keys(ROOT);
            const ids = new Set();
            for (const key of keys) {
                const rest = key.slice(ROOT.length);
                const cut = rest.indexOf("/");
                if (cut > 0) ids.add(rest.slice(0, cut));
            }
            return Array.from(ids).sort();
        },

        /** Swap the bytes layer; null restores the localStorage default. */
        backend: null,
    };
})();
