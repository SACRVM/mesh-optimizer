/**
 * SACRVM APPKIT — sac.identity: who is at this desktop.
 *
 * The second capability behind the app contract, and the smaller one:
 *
 *   const me = context.identity.get();          // { id, name, avatar } | null
 *   context.identity.onChange((me) => paint(me));
 *
 * WHAT THIS IS NOT: authentication. There is no server, no password, no
 * verification and no secret — a profile is a name and a face somebody typed
 * into their own browser. Never treat it as proof of anything, never gate
 * access on it, and never send it anywhere the user did not ask you to. What
 * it IS: the difference between an app that greets you and an app that cannot
 * tell whether anyone is there.
 *
 * The shape is chosen so it survives becoming more later: if a host one day
 * backs this with a real account, `{ id, name, avatar }` and `onChange` still
 * describe it, and apps written today keep working.
 *
 * HOST side — the host owns the profile, because the profile is the host's
 * notion of you, not any single app's:
 *
 *   sac.identity.set({ name: "Ada", avatar: "ada.png" });   // settings UI
 *   sac.identity.clear();
 *
 * A host that has a REAL identity — an app with a backend, a session, an
 * account — hands the source over instead, and keeps everything apps depend
 * on: sac.identity.use({ get, onChange?, set?, clear? }). Omit set() and the
 * identity is read-only, which is what an account should be. Same idea as
 * sac.fs.backend: the kit owns the shape, the host owns the answer.
 *
 * APP side — read-only. An app that wants a name of its own asks in its own
 * UI and keeps it in its own context.fs; it does not get to rename you
 * everywhere.
 *
 *   context.identity.get()          → { id, name, avatar } | null when nobody
 *                                     has said who they are (the default)
 *   context.identity.onChange(cb)   → cb(profile|null); returns an unsubscribe
 *
 * Storage rides on the fs backend (so a host that swapped it keeps identity
 * with it) at a key outside every app's drawer, and changes are heard across
 * tabs of the same origin.
 */
(function () {
    if (!window.sac) { console.warn("[sac.identity] globals.js must load first — identity unavailable."); return; }
    if (sac.identity) return;   // idempotent

    const KEY = "sac.identity/profile";

    /** The same bytes layer sac.fs uses, or localStorage when it is absent. */
    function backend() {
        if (window.sac.fs && sac.fs.backend) return sac.fs.backend;
        return {
            get(key) {
                try { return localStorage.getItem(key); }
                catch (err) { return null; }
            },
            set(key, value) { localStorage.setItem(key, value); },
            del(key) {
                try { localStorage.removeItem(key); } catch (err) { /* nothing to undo */ }
            },
        };
    }

    let cache;                       // undefined = not read yet, null = nobody
    let provider = null;             // a host with a real account system
    const listeners = new Set();

    function read() {
        // A provider is the source of truth while it is installed: the kit
        // keeps the app-facing shape and the fan-out, the host owns the answer.
        if (provider) {
            try {
                const me = provider.get();
                return me && typeof me.name === "string"
                    ? { id: me.id || "u", name: me.name, avatar: me.avatar }
                    : null;
            } catch (err) {
                console.error("[sac.identity] the provider's get() threw:", err);
                return null;
            }
        }
        if (cache !== undefined) return cache;
        const raw = backend().get(KEY);
        if (raw == null) { cache = null; return cache; }
        try {
            const data = JSON.parse(raw);
            cache = data && typeof data.name === "string" ? data : null;
        } catch (err) {
            console.warn("[sac.identity] stored profile unreadable, treating as nobody:", err);
            cache = null;
        }
        return cache;
    }

    function emit() {
        const me = read();
        for (const cb of listeners) {
            try { cb(me); }
            catch (err) { console.error("[sac.identity] a listener threw:", err); }
        }
    }

    // Other tabs of the same origin — one listener, bound on first use.
    let bound = false;
    function bindStorage() {
        if (bound) return;
        bound = true;
        window.addEventListener("storage", (e) => {
            if (e.key !== KEY) return;
            cache = undefined;              // re-read lazily, then tell everyone
            emit();
        });
    }

    /** A stable, meaningless id. Not a secret and not a fingerprint: it exists
     *  so an app can key data by "who", and so a future account has something
     *  to attach to. */
    function newId() {
        return "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function subscribe(cb) {
        if (typeof cb !== "function") return () => {};
        bindStorage();
        listeners.add(cb);
        return () => listeners.delete(cb);
    }

    sac.identity = {
        /** @returns {{id: string, name: string, avatar?: string}|null} */
        get() {
            const me = read();
            return me ? Object.assign({}, me) : null;
        },

        /**
         * Host side. Keeps the existing id when there is one — renaming
         * yourself does not make you somebody else.
         * @param {{name: string, avatar?: string}|null} profile
         */
        set(profile) {
            if (provider) {
                if (typeof provider.set !== "function") {
                    console.warn("[sac.identity] this host's identity is read-only " +
                                 "(it comes from an account, not from a field)");
                    return this.get();
                }
                provider.set(profile);
                emit();
                return this.get();
            }
            if (!profile || !String(profile.name || "").trim()) return this.clear();
            const previous = read();
            const next = {
                id:     (previous && previous.id) || newId(),
                name:   String(profile.name).trim().slice(0, 80),
                avatar: profile.avatar ? String(profile.avatar) : undefined,
            };
            if (next.avatar === undefined) delete next.avatar;
            try {
                backend().set(KEY, JSON.stringify(next));
            } catch (err) {
                console.warn("[sac.identity] could not store the profile:", err);
                return null;
            }
            cache = next;
            emit();
            return Object.assign({}, next);
        },

        /** Back to nobody. The id is gone with it — this is "forget me". With a
         *  provider installed this is the host's sign-out, if it offers one. */
        clear() {
            if (provider) {
                if (typeof provider.clear === "function") provider.clear();
                emit();
                return this.get();
            }
            backend().del(KEY);
            cache = null;
            emit();
            return null;
        },

        /** cb(profile|null) on every change, including from another tab. */
        onChange: subscribe,

        /**
         * Hand the source over to a host that has a real one — an app with a
         * backend, a session, an account. The kit keeps what apps depend on
         * (the shape, forApp(), the fan-out); the host answers who is here:
         *
         *   sac.identity.use({
         *       get()            { return session.user &&                    // may be null
         *              { id: session.user.id, name: session.user.name, avatar: session.user.avatar }; },
         *       onChange(cb)     { return session.subscribe(cb); },          // optional
         *       clear()          { session.signOut(); },                     // optional
         *       set(profile)     { … },                                      // optional; omit and
         *   });                                                              // the identity is read-only
         *
         * get() is SYNCHRONOUS on purpose — apps call it while rendering. A
         * host whose answer needs a round trip returns null until it knows and
         * then announces: either through the onChange it provided, or by
         * calling sac.identity.changed(). Apps paint "nobody" first and update,
         * exactly as they already do for the theme.
         *
         * Passing null gives the local profile back.
         */
        use(impl) {
            if (this._offProvider) { this._offProvider(); this._offProvider = null; }
            provider = impl || null;
            if (provider && typeof provider.onChange === "function") {
                const off = provider.onChange(() => emit());
                if (typeof off === "function") this._offProvider = off;
            }
            emit();
        },

        /** A host with a provider announcing that the answer changed. */
        changed() { emit(); },

        /** The read-only view an app receives as context.identity. */
        forApp() {
            return {
                get: () => sac.identity.get(),
                onChange: subscribe,
            };
        },
    };
})();
