/**
 * SACRVM APPKIT — sac.app: the toolkit an APP uses.
 *
 * sac.apps (plural) is the host side: a registry, a stage, windows. This file
 * is the other half — the four things every app otherwise writes by hand, and
 * the one thing that makes an app truly autonomous: it runs on a shell AND on
 * its own page, unchanged.
 *
 * One repo, one app, always the same shape:
 *
 *   app.json     the manifest — what a desktop reads BEFORE running anything
 *   app.js       the app: ONE custom element, ONE classic script
 *   app.css      optional, injected by the app itself
 *   index.html   the harness: the app alone, no desktop, F5 to develop
 *
 * A minimal app:
 *
 *   (function () {
 *       const BASE = sac.app.base();          // this script's folder — parse time
 *
 *       class AppNotes extends sac.app.Element {
 *           build() {                          // once, when first connected
 *               sac.app.styles(BASE + "app.css", "app-notes-css");
 *               this.innerHTML = `…`;          // light DOM: ui.css applies
 *           }
 *           onMount(context) { … }             // once, when it is actually visible
 *           onUnmount() { … }                  // only on sac.apps.remove()
 *       }
 *
 *       sac.app.define("app-notes", AppNotes);
 *   })();
 *
 * Extending sac.app.Element is optional sugar — an app may implement mount()
 * and unmount() by hand and stay a plain HTMLElement. What is NOT optional:
 * one registered tag, a guarded define, and no second tag.
 *
 * API:
 *   sac.app.base()            → the calling script's folder URL. Call it at
 *                               parse time (top level of the app script);
 *                               document.currentScript is only correct there.
 *   sac.app.styles(href, id)  → inject one <link> per id, however often called
 *   sac.app.define(tag, Cls)  → guarded customElements.define
 *   sac.app.Element           → base class: build() / onMount() / onUnmount(),
 *                               plus the standalone fallback
 *   sac.app.context(el)       → the context an app gets with no host around
 *                               (rarely called directly — Element does it)
 *
 * Standalone fallback: when nothing calls mount() right after connect, the
 * element mounts itself with a context built from the page — query params,
 * the hash as the route, the page's <sac-sidebar> if it has one, and the
 * kit's theme. Same app file, same code path, no shell required.
 */
(function () {
    if (!window.sac) { console.warn("[sac.app] globals.js must load first — sac.app unavailable."); return; }
    if (sac.app) return;   // idempotent

    /* ------------------------------------------------------------- theme --
       The host owns this on a shell (sac.apps.theme). Standalone, and only
       then, fall back to a read-only view of the same rules — never a second
       implementation of them. */
    function themeHandle() {
        if (window.sac.apps && sac.apps.theme) return sac.apps.theme;
        const resolved = () => {
            const flag = document.documentElement.getAttribute("data-theme");
            if (flag === "light") return "light";
            if (flag === "auto" || !flag) {
                return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
            }
            return "dark";
        };
        return {
            get: () => document.documentElement.getAttribute("data-theme") || "dark",
            set: () => console.warn("[sac.app] theme.set() needs the kit's apps lib"),
            onChange(cb) {
                let last = resolved();
                const tick = () => { const now = resolved(); if (now !== last) { last = now; cb(now); } };
                const mq = matchMedia("(prefers-color-scheme: light)");
                mq.addEventListener("change", tick);
                const obs = new MutationObserver(tick);
                obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
                return () => { mq.removeEventListener("change", tick); obs.disconnect(); };
            },
        };
    }

    /** The context an app gets when it runs without a host. */
    function standaloneContext(el) {
        // Standalone there is no manifest to read the id from, so it comes off
        // the tag: "app-notes" → "notes". Follow the template's naming
        // (tag = "app-" + id) and the id — and with it the storage root under
        // context.fs — is the same whether the app runs alone or installed.
        // Name them differently and it is a different id, hence different
        // storage: harmless, but it is why the convention exists.
        const id = el.tagName.toLowerCase().replace(/^app-/, "");
        const routeOf = () => (window.location.hash || "").replace(/^#\/?/, "");
        return {
            appId: id,
            params: new URLSearchParams(window.location.search),
            route: routeOf(),
            onRoute(cb) {
                if (typeof cb !== "function") return () => {};
                const on = () => cb(routeOf());
                window.addEventListener("hashchange", on);
                return () => window.removeEventListener("hashchange", on);
            },
            // Standalone the app IS its own host — nothing is injected.
            host: null,
            // Same contract as on a desktop, different address space: there a
            // route sits under "#/<id>/", here it is the whole hash. Apps
            // build links with this and work in both places unchanged.
            href: (route) => {
                const clean = route == null ? "" : String(route).replace(/^\/+|\/+$/g, "");
                return clean ? "#/" + clean : "#/";
            },
            deepLink: {
                set(route) {
                    const clean = route == null ? "" : String(route).replace(/^\/+|\/+$/g, "");
                    window.history.replaceState({}, document.title,
                        window.location.pathname + window.location.search +
                        (clean ? "#/" + clean : ""));
                },
            },
            theme: themeHandle(),
            // The same storage the app gets on a desktop, under the same root
            // as long as the tag follows the naming above: develop standalone,
            // install later, and what you saved is still there.
            fs: window.sac.fs ? sac.fs.for(id) : null,
            identity: window.sac.identity ? sac.identity.forApp() : null,
            // The user's files: standalone that is the device (the browser
            // provider) unless the page installed another.
            files: window.sac.files ? sac.files.forApp() : null,
            // Standalone the app IS the page: unsaved work arms the browser's
            // leave-page question, exactly as a desktop would.
            setDirty(flag) {
                const on = !!flag;
                if (on === !!el._sacDirty) return;
                el._sacDirty = on;
                if (on) window.addEventListener("beforeunload", guard);
                else    window.removeEventListener("beforeunload", guard);
                document.dispatchEvent(new CustomEvent("sac:dirty", {
                    detail: { id, dirty: on }, bubbles: true,
                }));
            },
        };
    }

    function guard(e) {
        e.preventDefault();
        e.returnValue = "";
    }

    /**
     * The app base class. Three hooks, no plumbing:
     *   build()      once, on first connect — render here
     *   onMount(ctx) once, when the app is actually on screen — measure here
     *   onUnmount()  only when the host removes the app
     */
    class SacAppElement extends HTMLElement {
        connectedCallback() {
            // Marks the element as an accent scope: ui.css re-derives the
            // accent tokens here, so an app that sets its own --accent gets a
            // WHOLE retheme, and gets it wherever it runs.
            this.classList.add("sac-app");
            if (!this._sacBuilt) {
                this._sacBuilt = true;
                if (typeof this.build === "function") this.build();
            }
            if (this._sacMounted || this._sacSoloQueued) return;
            // A host mounts in the same task or the microtasks right after it.
            // If none did, nobody will — we are standalone, so mount ourselves.
            //
            // setTimeout, deliberately not requestAnimationFrame: a background
            // tab paints no frames, so a rAF check never runs and the app
            // would sit blank until the tab is looked at. A timeout is
            // throttled there, but it does fire.
            this._sacSoloQueued = true;
            setTimeout(() => {
                if (!this._sacMounted && this.isConnected) this.mount(standaloneContext(this));
            }, 0);
        }

        /** Called by the host (sac.apps) — or by the fallback above. */
        mount(context) {
            if (this._sacMounted) return;
            this._sacMounted = true;
            this.context = context;
            if (typeof this.onMount === "function") this.onMount(context);
        }

        unmount() {
            if (typeof this.onUnmount === "function") this.onUnmount();
            this._sacMounted = false;
        }
    }

    sac.app = {
        /** The folder of the script calling this — at PARSE time only. */
        base() {
            const s = document.currentScript;
            if (!s || !s.src) {
                console.warn("[sac.app] base() must be called at parse time, top level");
                return "";
            }
            return s.src.replace(/[^/]+$/, "");
        },

        /** One <link> per id, however many instances the app has. */
        styles(href, id) {
            const key = id || ("sac-app-css-" + href.replace(/[^a-z0-9]+/gi, "-"));
            if (document.getElementById(key)) return;
            const link = document.createElement("link");
            link.id = key;
            link.rel = "stylesheet";
            link.href = href;
            document.head.appendChild(link);
        },

        /** Guarded: a second desktop loading the same app must not throw. */
        define(tag, Class) {
            if (!customElements.get(tag)) customElements.define(tag, Class);
        },

        context: standaloneContext,
        Element: SacAppElement,
    };
})();
