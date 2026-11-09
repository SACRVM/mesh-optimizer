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
 *   write(path, value, opts)      store it; rejects if there is no room.
 *                                 opts.onProgress(loaded, total) — see below
 *   remove(path)                  delete one path
 *   list(prefix = "")             app-relative paths, sorted
 *   stat(path)                    { path, name, type, size, modified, binary }
 *                                 or null — what a file dialog lists. JSON
 *                                 entries carry no timestamp (modified: null)
 *   entries(prefix = "")          { folders, files } — direct children only
 *   move(from, to)                a file or a whole folder; rejects if `to` exists
 *   copy(from, to)                the same, keeping `from`
 *   rename(path, newName)         move within the same folder
 *   clear()                       delete everything this app stored
 *   usage()                       { bytes, count } — what this app keeps
 *   watch(cb)                     cb(path, value) on change, incl. other tabs;
 *                                 value is null for a delete. Returns an
 *                                 unsubscribe function.
 *
 * THE STORE CONTRACT. sac-file-browser and sac.files.virtual take any object
 * of this shape as their `store` — this handle, or a host's own (a server, a
 * cloud drive). Paths are relative, "/"-separated, no leading slash. A folder
 * is its path without a trailing slash ("Photos/2026"); a prefix handed to
 * list()/entries() carries one ("Photos/") or is "" for the root. An empty
 * folder exists as a marker entry "<folder>/.folder".
 *
 *   Required: read(path, fallback), write(path, value), remove(path),
 *             list(prefix), stat(path).
 *
 *   list(prefix) returns EVERY stored path under `prefix`, at all depths,
 *   flat and sorted — consumers derive folders from the paths. A store that
 *   can only list one level cheaply implements entries() as well; consumers
 *   prefer it when present.
 *
 *   Optional — a store without them keeps working; sac.fs.ops (below) fills
 *   each gap from the required five:
 *     entries(prefix)        { folders: string[], files: stat[] } — DIRECT
 *                            children of `prefix`. folders are full paths,
 *                            files are stat() objects, markers left out.
 *     url(path)              string | null (may be a Promise) — a URL the
 *                            browser can stream into <img>/<video>/<a
 *                            download>, instead of read() pulling the bytes
 *                            into a Blob. This handle has none: object URLs
 *                            nobody revokes would leak.
 *     move(from, to)         a file, or a folder with everything under
 *                            `from + "/"` (markers included). Rejects if `to`
 *                            exists. One request on a remote store, not a
 *                            round-trip of the bytes.
 *     copy(from, to)         the same shape; no bytes through the client on a
 *                            remote store. Rejects if `to` exists.
 *     rename(path, newName)  newName is ONE segment (no "/") — sugar for
 *                            move(path, dirname(path) + "/" + newName).
 *     write(path, value, { onProgress })
 *                            onProgress(loaded, total), called whenever the
 *                            store can say (an upload). Stores that ignore
 *                            the third argument keep working.
 *
 *   This handle implements entries, move, copy and rename at key level: a
 *   binary entry's bytes are handed from key to key in IndexedDB, never
 *   re-encoded. It calls onProgress once, (size, size), when the write is
 *   done — local writes have no in-between worth reporting.
 *
 *   A move or copy is heard by watch() as ordinary changes, entry by entry: a
 *   write of each new path (value = what read() would answer), then — for a
 *   move — a delete (null) of each old path. Other tabs hear the same through
 *   the storage event.
 *
 * sac.fs.ops — so a consumer never branches on what a store has. Each takes
 * the store first and uses its own method when present, else the fallback:
 *
 *   sac.fs.ops.entries(store, prefix)    list() + stat() folded to one level
 *   sac.fs.ops.url(store, path)          store.url, else null
 *   sac.fs.ops.move(store, from, to)     read + write + remove, file or folder
 *   sac.fs.ops.copy(store, from, to)     read + write, file or folder
 *   sac.fs.ops.rename(store, path, name) ops.move within the same folder
 *   sac.fs.ops.write(store, path, value, { onProgress })   passes opts through
 *
 * All return Promises. The fallbacks copy everything first and remove the
 * originals only once all copies stand, so a failure midway leaves a
 * duplicate, never a loss.
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

    /** A prefix for list()/entries(): "" for the root, else "a/b/". */
    function cleanPrefix(prefix) {
        const clean = String(prefix == null ? "" : prefix)
            .split("/").filter((seg) => seg && seg !== "." && seg !== "..").join("/");
        return clean ? clean + "/" : "";
    }

    /** rename()'s new name: exactly one path segment. */
    function cleanName(name) {
        const n = String(name == null ? "" : name).trim();
        if (!n || n === "." || n === ".." || n.includes("/")) {
            throw new Error(`[sac.fs] "${name}" is not a valid name — one segment, no "/"`);
        }
        return n;
    }

    const parentOf = (path) => { const cut = path.lastIndexOf("/"); return cut < 0 ? "" : path.slice(0, cut); };
    const MARKER = ".folder";            // an empty folder's marker entry

    /** Where move()/copy() may go: somewhere else, and not inside itself. */
    function checkTarget(from, to) {
        if (to.startsWith(from + "/")) {
            throw new Error(`[sac.fs] cannot move or copy "${from}" into itself`);
        }
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

        /** The stat object for one entry, from its raw stored string. */
        function statOf(clean, raw) {
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
        }

        const storeError = (clean, err) => new Error(
            `[sac.fs] ${appId}: could not store "${clean}" — ${err && err.name === "QuotaExceededError"
                ? "no room left in this browser's storage" : (err && err.message) || err}`);

        /** One entry to a new key, bytes and all: the bytes beside a stub are
         *  handed over as the Blob IndexedDB already holds (stub written last,
         *  as in writeBlob). Answers what read() would for the new path. */
        async function copyKey(fromKey, toKey, toPath) {
            const be = backend();
            let raw = await be.get(fromKey);
            if (raw == null) return undefined;
            const parsed = parseRaw(raw);
            if (!parsed.ok) {
                // Corrupt stays corrupt — carried as-is, not "repaired".
                try { await be.set(toKey, raw); } catch (err) { throw storeError(toPath, err); }
                return null;
            }
            if (!isStub(parsed.value)) {
                try { await be.set(toKey, raw); } catch (err) { throw storeError(toPath, err); }
                return parsed.value;
            }
            const meta = parsed.value[BLOB];
            let file = null;
            if (typeof meta.data !== "string" && typeof be.getBlob === "function") {
                let blob = null;
                try { blob = await be.getBlob(fromKey); } catch (err) { blob = null; }
                if (blob) {
                    let beside = false;
                    if (typeof be.setBlob === "function") {
                        try { await be.setBlob(toKey, blob); beside = true; }
                        catch (err) { beside = false; }
                    }
                    if (!beside) {
                        // The bytes cannot sit beside the new key: inline them.
                        raw = JSON.stringify({ [BLOB]: Object.assign({}, meta, { data: await blobToDataUrl(blob) }) });
                    }
                    file = new File([blob], baseName(toPath), {
                        type: meta.type || blob.type || "application/octet-stream",
                        lastModified: meta.modified || Date.now(),
                    });
                }
                // No bytes behind the stub: the stub goes along, as lost as before.
            } else if (typeof meta.data === "string") {
                file = await blobFor(be, toKey, parsed.value, toPath);
            }
            try { await be.set(toKey, raw); } catch (err) {
                await dropBytes(be, toKey, JSON.stringify({ [BLOB]: meta }));
                throw storeError(toPath, err);
            }
            return file;
        }

        /** move() and copy(): a file, a folder, or both when both exist. */
        async function transfer(from, to, keep) {
            const src = cleanPath(from);
            const dst = cleanPath(to);
            checkTarget(src, dst);
            const be = backend();
            const paths = [];
            if ((await be.get(root + src)) != null) paths.push(src);
            for (const key of await be.keys(root + src + "/")) paths.push(key.slice(root.length));
            if (!paths.length) throw new Error(`[sac.fs] ${appId}: "${src}" does not exist`);
            if (src === dst && !keep) return;             // a move onto itself: nothing to do
            if ((await be.get(root + dst)) != null || (await be.keys(root + dst + "/")).length) {
                throw new Error(`[sac.fs] ${appId}: "${dst}" already exists`);
            }
            paths.sort();
            // Everything lands before anything leaves: a failure midway leaves
            // a duplicate, never a loss.
            for (const p of paths) {
                const q = dst + p.slice(src.length);
                const value = await copyKey(root + p, root + q, q);
                if (value !== undefined) notify(root, q, value);
            }
            if (keep) return;
            for (const p of paths) {
                const key = root + p;
                const raw = await be.get(key);
                await be.del(key);                         // stub first, bytes after
                await dropBytes(be, key, raw);
                notify(root, p, null);
            }
        }

        const progress = (opts, size) => {
            if (!opts || typeof opts.onProgress !== "function") return;
            try { opts.onProgress(size, size); }
            catch (err) { console.error("[sac.fs] onProgress threw:", err); }
        };

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

            async write(path, value, opts) {
                const clean = cleanPath(path);
                const key = root + clean;
                if (value instanceof Blob) {
                    await writeBlob(key, clean, value);
                    progress(opts, value.size);
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
                progress(opts, new Blob([json]).size);
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
                return raw == null ? null : statOf(clean, raw);
            },

            async list(prefix = "") {
                const want = root + String(prefix || "").replace(/^\/+/, "");
                const keys = await backend().keys(want);
                return keys.map((k) => k.slice(root.length)).sort();
            },

            async entries(prefix = "") {
                const pre = cleanPrefix(prefix);
                const be = backend();
                const folders = new Set();
                const files = [];
                for (const key of await be.keys(root + pre)) {
                    const rest = key.slice(root.length + pre.length);
                    const cut = rest.indexOf("/");
                    if (cut >= 0) { folders.add(pre + rest.slice(0, cut)); continue; }
                    if (!rest || rest === MARKER) continue;
                    const raw = await be.get(key);
                    if (raw != null) files.push(statOf(pre + rest, raw));
                }
                files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
                return { folders: Array.from(folders).sort(), files };
            },

            move(from, to) { return transfer(from, to, false); },

            copy(from, to) { return transfer(from, to, true); },

            async rename(path, newName) {
                const clean = cleanPath(path);
                const parent = parentOf(clean);
                const name = cleanName(newName);
                return transfer(clean, parent ? `${parent}/${name}` : name, false);
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

        /** The optional store methods, for ANY store — its own when present,
         *  else built from the required five (see the header). */
        ops: makeOps(),
    };

    /* ------------------------------------------------------------- ops -- */

    function makeOps() {
        const has = (store, fn) => store && typeof store[fn] === "function";
        const ABSENT = {};                    // read()'s fallback: "not there"

        /** Every path a file-or-folder `from` covers: itself, if an entry, and
         *  everything under `from + "/"`. */
        async function covered(store, from) {
            const paths = [];
            if (await store.stat(from)) paths.push(from);
            for (const p of await store.list(from + "/")) paths.push(p);
            return Array.from(new Set(paths)).sort();
        }

        async function exists(store, path) {
            if (await store.stat(path)) return true;
            return (await store.list(path + "/")).length > 0;
        }

        async function transfer(store, from, to, keep) {
            const src = cleanPath(from);
            const dst = cleanPath(to);
            checkTarget(src, dst);
            const paths = await covered(store, src);
            if (!paths.length) throw new Error(`[sac.fs] "${src}" does not exist`);
            if (src === dst && !keep) return;
            if (await exists(store, dst)) throw new Error(`[sac.fs] "${dst}" already exists`);
            for (const p of paths) {
                const value = await store.read(p, ABSENT);
                if (value === ABSENT) continue;
                await store.write(dst + p.slice(src.length), value);
            }
            if (keep) return;
            for (const p of paths) await store.remove(p);
        }

        return {
            async entries(store, prefix = "") {
                if (has(store, "entries")) return store.entries(prefix);
                const pre = cleanPrefix(prefix);
                const folders = new Set();
                const names = [];
                for (const p of await store.list(pre)) {
                    if (!p.startsWith(pre)) continue;
                    const rest = p.slice(pre.length);
                    const cut = rest.indexOf("/");
                    if (cut >= 0) folders.add(pre + rest.slice(0, cut));
                    else if (rest && rest !== MARKER) names.push(p);
                }
                const files = (await Promise.all(names.map((p) =>
                    Promise.resolve(store.stat(p)).catch(() => null)))).filter(Boolean);
                files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
                return { folders: Array.from(folders).sort(), files };
            },

            async url(store, path) {
                if (!has(store, "url")) return null;
                try { return (await store.url(path)) || null; }
                catch (err) { return null; }       // a consumer then falls back to read()
            },

            async move(store, from, to) {
                if (has(store, "move")) return store.move(from, to);
                return transfer(store, from, to, false);
            },

            async copy(store, from, to) {
                if (has(store, "copy")) return store.copy(from, to);
                return transfer(store, from, to, true);
            },

            async rename(store, path, name) {
                if (has(store, "rename")) return store.rename(path, name);
                const clean = cleanPath(path);
                const parent = parentOf(clean);
                const n = cleanName(name);
                return transfer(store, clean, parent ? `${parent}/${n}` : n, false);
            },

            async write(store, path, value, opts) {
                return opts === undefined ? store.write(path, value) : store.write(path, value, opts);
            },
        };
    }
})();
