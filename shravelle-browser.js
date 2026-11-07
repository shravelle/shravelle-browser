/*!
 * Shravelle Browser SDK — real user monitoring for any website.
 * Works with plain HTML, React, Angular, Vue, Next.js, WordPress, etc.
 *
 * <script src="/shravelle-browser.js"></script>
 * <script>
 *   Shravelle.init({ endpoint: "https://ingest.example.com", key: "shv_brw_...", app: "shop-web", release: "5.3.0",
 *                  tracePropagationTargets: ["api.example.com"] });
 * </script>
 *
 * Collects: page views (incl. SPA route changes), Core Web Vitals (LCP, INP,
 * CLS, FCP, TTFB), JavaScript errors and unhandled promise rejections,
 * fetch/XHR calls (with W3C traceparent injection to link browser and
 * backend traces), click breadcrumbs and custom events, and (opt-in, privacy
 * masked) session replay recordings: Shravelle.init({ ..., sessionReplay: true }).
 *
 * No data is lost on flaky networks: events are queued in memory, mirrored
 * to localStorage, flushed with sendBeacon when the page is hidden, and
 * retried with backoff on the next page load if delivery failed.
 */
(function (global) {
  "use strict";
  if (global.Shravelle && global.Shravelle.__loaded) return;

  var cfg = { endpoint: "", key: "", app: "web", release: "", sampleRate: 1, flushInterval: 5000, maxBatch: 100,
              tracePropagationTargets: [], captureClicks: true, captureAjax: true, beforeSend: null,
              sessionReplay: false, replaySampleRate: 1, replayMaskText: true, replayMaskInputs: true };
  var queue = [], userId = "", sessionId = "", started = false, sampled = true, retryDelay = 2000;
  var STORE = "__shravelle_q", SESSION = "__shravelle_s", MAX_STORED = 2000;

  function now() { return new Date().toISOString(); }
  function rnd(n) {
    var a = new Uint8Array(n);
    (global.crypto || global.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function safe(fn) { return function () { try { return fn.apply(this, arguments); } catch (e) { /* never break the host page */ } }; }

  function loadSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION) || "null");
      if (s && Date.now() - s.t < 30 * 60 * 1000) { s.t = Date.now(); localStorage.setItem(SESSION, JSON.stringify(s)); return s.id; }
      var id = rnd(16); localStorage.setItem(SESSION, JSON.stringify({ id: id, t: Date.now() })); return id;
    } catch (e) { return rnd(16); }
  }

  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(queue.slice(-MAX_STORED))); } catch (e) {}
  }
  function restore() {
    try { var q = JSON.parse(localStorage.getItem(STORE) || "[]"); if (q.length) queue = q.concat(queue); } catch (e) {}
  }

  function push(ev) {
    if (!started || !sampled) return;
    ev.timestamp = ev.timestamp || now();
    ev.page_url = ev.page_url || location.href;
    ev.session_id = sessionId;
    if (userId) ev.user_id = userId;
    if (cfg.beforeSend) { ev = cfg.beforeSend(ev); if (!ev) return; }
    queue.push(ev);
    if (queue.length > MAX_STORED) queue.splice(0, queue.length - MAX_STORED);
    persist();
    if (queue.length >= cfg.maxBatch) flush();
  }

  // endpoint may be a list of gateways: on failure the SDK fails over
  var epIndex = 0;
  function endpoints() { return [].concat(cfg.endpoint); }
  function url() { var e = endpoints(); return String(e[epIndex % e.length]).replace(/\/$/, "") + "/v1/rum?key=" + encodeURIComponent(cfg.key); }
  function payload(events) { return JSON.stringify({ app: cfg.app, session_id: sessionId, user_id: userId, release: cfg.release, events: events }); }

  var inflight = false;
  function flush(useBeacon) {
    if (!queue.length || inflight) return;
    var batch = queue.slice(0, cfg.maxBatch);
    var body = payload(batch);
    if (useBeacon && navigator.sendBeacon) {
      // text/plain avoids a CORS preflight, which beacons cannot do
      if (navigator.sendBeacon(url(), new Blob([body], { type: "text/plain" }))) { queue.splice(0, batch.length); persist(); }
      return;
    }
    inflight = true;
    origFetch(url(), { method: "POST", body: body, keepalive: body.length < 60000, headers: { "Content-Type": "text/plain" } })
      .then(function (r) {
        inflight = false;
        if (r.ok || r.status === 400 || r.status === 401 || r.status === 403) { // delivered, or will never be accepted
          queue.splice(0, batch.length); persist(); retryDelay = 2000;
          if (queue.length) setTimeout(flush, 0);
        } else { backoff(); }
      }, function () { inflight = false; backoff(); });
  }
  function backoff() { epIndex++; retryDelay = Math.min(retryDelay * 2, 60000); setTimeout(flush, retryDelay); }

  // ---- page views & SPA navigation ----------------------------------------
  var lastPath = "";
  function pageView(kind) {
    var href = location.href;
    if (href === lastPath) return;
    lastPath = href;
    var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    var load = kind === "initial" && nav ? nav.loadEventEnd || nav.domComplete || nav.duration : 0;
    push({ type: "page_view", name: kind, duration_ms: load, referrer: document.referrer });
  }
  function patchHistory() {
    ["pushState", "replaceState"].forEach(function (m) {
      var orig = history[m];
      history[m] = function () { var r = orig.apply(this, arguments); setTimeout(safe(function () { pageView("route_change"); }), 0); return r; };
    });
    addEventListener("popstate", safe(function () { pageView("route_change"); }));
    addEventListener("hashchange", safe(function () { pageView("route_change"); }));
  }

  // ---- Core Web Vitals ---------------------------------------------------------
  function observe(type, cb, opts) {
    try { var po = new PerformanceObserver(function (l) { l.getEntries().forEach(cb); }); po.observe(Object.assign({ type: type, buffered: true }, opts || {})); return po; } catch (e) { return null; }
  }
  function vitals() {
    var lcp = 0, cls = 0, inp = 0, sent = false;
    observe("largest-contentful-paint", function (e) { lcp = e.startTime; });
    observe("layout-shift", function (e) { if (!e.hadRecentInput) cls += e.value; });
    observe("event", function (e) { if (e.interactionId && e.duration > inp) inp = e.duration; }, { durationThreshold: 16 });
    observe("paint", function (e) { if (e.name === "first-contentful-paint") push({ type: "web_vital", name: "FCP", value: e.startTime }); });
    var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    if (nav) push({ type: "web_vital", name: "TTFB", value: nav.responseStart });
    function report() {
      if (sent) return; sent = true;
      if (lcp) push({ type: "web_vital", name: "LCP", value: lcp });
      push({ type: "web_vital", name: "CLS", value: Math.round(cls * 10000) / 10000 });
      if (inp) push({ type: "web_vital", name: "INP", value: inp });
    }
    addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") report(); }, true);
    addEventListener("pagehide", report, true);
  }

  // ---- errors ------------------------------------------------------------------
  function errors() {
    addEventListener("error", safe(function (e) {
      if (e.target && e.target !== global && (e.target.src || e.target.href)) {
        push({ type: "js_error", name: "ResourceError", message: "Failed to load " + (e.target.src || e.target.href) });
        return;
      }
      var err = e.error || {};
      push({ type: "js_error", name: err.name || "Error", message: e.message || String(err), stack: err.stack || (e.filename + ":" + e.lineno + ":" + e.colno) });
    }), true);
    addEventListener("unhandledrejection", safe(function (e) {
      var r = e.reason || {};
      push({ type: "js_error", name: r.name || "UnhandledRejection", message: r.message || String(r), stack: r.stack || "" });
    }));
  }

  // ---- fetch / XHR -----------------------------------------------------------------
  var origFetch = global.fetch ? global.fetch.bind(global) : null;
  function isOwn(u) { return endpoints().some(function (e) { return u.indexOf(e) === 0; }); }
  function shouldTrace(u) {
    try {
      var host = new URL(u, location.href).host;
      if (host === location.host) return true;
      return cfg.tracePropagationTargets.some(function (t) { return t instanceof RegExp ? t.test(u) : host === t || u.indexOf(t) === 0; });
    } catch (e) { return false; }
  }
  function ajaxName(method, u) {
    try { var p = new URL(u, location.href); return method + " " + p.host + p.pathname.replace(/\/\d+(?=\/|$)/g, "/:id").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":uuid"); }
    catch (e) { return method + " " + u; }
  }
  function ajax() {
    if (origFetch) {
      global.fetch = function (input, init) {
        var u = typeof input === "string" ? input : (input && input.url) || "";
        if (isOwn(u)) return origFetch(input, init);
        var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
        var start = performance.now(), traceId = "";
        if (shouldTrace(u)) {
          traceId = rnd(16);
          init = Object.assign({}, init || {});
          var h = new Headers((init && init.headers) || (input && input.headers) || {});
          h.set("traceparent", "00-" + traceId + "-" + rnd(8) + "-01");
          init.headers = h;
        }
        return origFetch(input, init).then(function (r) {
          push({ type: "ajax", name: ajaxName(method, u), duration_ms: performance.now() - start, status: r.status, trace_id: traceId });
          return r;
        }, function (err) {
          push({ type: "ajax", name: ajaxName(method, u), duration_ms: performance.now() - start, status: 0, message: String(err), trace_id: traceId });
          throw err;
        });
      };
    }
    var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__o = { m: String(m).toUpperCase(), u: String(u) }; return XO.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      var x = this, o = x.__o;
      if (o && !isOwn(o.u)) {
        var start = performance.now(), traceId = "";
        if (shouldTrace(o.u)) { traceId = rnd(16); try { x.setRequestHeader("traceparent", "00-" + traceId + "-" + rnd(8) + "-01"); } catch (e) {} }
        x.addEventListener("loadend", safe(function () {
          push({ type: "ajax", name: ajaxName(o.m, o.u), duration_ms: performance.now() - start, status: x.status, trace_id: traceId });
        }));
      }
      return XS.apply(this, arguments);
    };
  }

  // ---- breadcrumbs -------------------------------------------------------------------
  function clicks() {
    addEventListener("click", safe(function (e) {
      var el = e.target && e.target.closest ? e.target.closest("a,button,[role=button],input[type=submit]") : null;
      if (!el) return;
      var label = (el.getAttribute("data-shravelle-name") || el.getAttribute("aria-label") || el.innerText || el.value || el.id || el.tagName).trim().slice(0, 80);
      push({ type: "custom", name: "click", message: label, attributes: { element: el.tagName.toLowerCase(), id: el.id || "", href: el.getAttribute("href") || "" } });
    }), true);
  }

  // ---- session replay (opt-in: sessionReplay: true) ----------------------------------
  // Records the page as a DOM snapshot plus changes (mutations, scrolls, inputs, mouse)
  // and sends it in chunks to /v1/replay. Privacy by default: all text is masked
  // ("*") unless an element (or an ancestor) has data-shravelle-unmask; form inputs
  // are always masked (passwords, card and similar fields are never recorded, even
  // unmasked); elements with data-shravelle-block are replaced by an empty box;
  // scripts and event handler attributes are never recorded.
  var R = { on: false, ids: null, next: 1, buf: [], size: 0, seq: 0, start: 0, clicks: 0, rage: 0, err: false, lastClicks: [], timer: 0 };
  var RSTATE = "__shravelle_r", REPLAY_CHUNK = 300000;
  function rid(n) { var i = R.ids.get(n); if (!i) { i = R.next++; R.ids.set(n, i); } return i; }
  function blocked(el) { return el.closest && el.closest("[data-shravelle-block]"); }
  function unmasked(el) { return !!(el && el.closest && el.closest("[data-shravelle-unmask]")); }
  function maskText(s, el) { return (cfg.replayMaskText !== false && !unmasked(el)) ? String(s).replace(/\S/g, "*") : String(s); }
  function sensitive(el) {
    var t = (el.type || "").toLowerCase(), ac = (el.getAttribute && el.getAttribute("autocomplete") || "").toLowerCase();
    return t === "password" || /cc-|card|cvc|cvv|one-time-code|new-password|current-password/.test(ac) || /card|cvv|cvc|pass|otp|pin|aadhaar|pan/i.test((el.name || "") + " " + (el.id || ""));
  }
  function inputValue(el) {
    var t = (el.type || "").toLowerCase();
    if (t === "checkbox" || t === "radio") return el.checked ? "1" : "0";
    if (sensitive(el) || cfg.replayMaskInputs !== false || !unmasked(el)) return String(el.value || "").replace(/./g, "*");
    return String(el.value || "");
  }
  function absUrl(u) { try { return new URL(u, location.href).href; } catch (e) { return ""; } }
  function cleanAttrs(el) {
    var out = {}, tag = el.tagName.toLowerCase();
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i], n = a.name.toLowerCase(), v = a.value;
      if (n.indexOf("on") === 0 || n === "srcdoc" || n === "nonce" || n === "integrity") continue;
      if (/^\s*javascript:/i.test(v)) continue;
      if (n === "value" && (tag === "input" || tag === "textarea" || tag === "option")) continue;
      if (n === "src" || n === "href" || n === "poster" || n === "action") v = absUrl(v);
      if (n === "srcset") v = v.split(",").map(function (p) { var s = p.trim().split(/\s+/); s[0] = absUrl(s[0]); return s.join(" "); }).join(", ");
      if ((n === "placeholder" || n === "title" || n === "alt" || n === "aria-label") && cfg.replayMaskText !== false && !unmasked(el)) v = maskText(v, el);
      out[n] = v;
    }
    if (tag === "input" || tag === "textarea" || tag === "select") out.__v = inputValue(el);
    if (tag === "iframe") delete out.src;
    return out;
  }
  function inlineSheet(el) {
    try { var rules = el.sheet && el.sheet.cssRules; if (!rules) return null; var s = ""; for (var i = 0; i < rules.length; i++) s += rules[i].cssText + "\n"; return s; } catch (e) { return null; }
  }
  function ser(n) {
    if (n.nodeType === 3) {
      var p = n.parentNode, ptag = p && p.tagName ? p.tagName.toLowerCase() : "";
      return { i: rid(n), y: 3, x: ptag === "style" ? n.nodeValue : maskText(n.nodeValue, p) };
    }
    if (n.nodeType !== 1) return null;
    var tag = n.tagName.toLowerCase();
    if (tag === "script" || tag === "noscript" || (tag === "link" && /preload|prefetch|modulepreload/i.test(n.rel || ""))) return null;
    if (blocked(n)) { var r = n.getBoundingClientRect(); return { i: rid(n), y: 1, t: "div", a: { style: "width:" + r.width + "px;height:" + r.height + "px;background:#e5e7eb", "data-shravelle-block": "" }, c: [] }; }
    if (tag === "link" && /stylesheet/i.test(n.rel || "")) { var css = inlineSheet(n); if (css != null) return { i: rid(n), y: 1, t: "style", a: {}, c: [{ i: rid(document.createTextNode("")), y: 3, x: css }] }; }
    var o = { i: rid(n), y: 1, t: tag, a: cleanAttrs(n), c: [] };
    if (n.namespaceURI === "http://www.w3.org/2000/svg") o.s = 1;
    if (tag === "style") { var cs = inlineSheet(n); if (cs != null && !n.textContent) o.c.push({ i: R.next++, y: 3, x: cs }); }
    for (var c = n.firstChild; c; c = c.nextSibling) { var s = ser(c); if (s) o.c.push(s); }
    return o;
  }
  function rec(ev) {
    if (!R.on) return;
    ev.t = Date.now();
    if (!R.start) R.start = ev.t;
    var s = JSON.stringify(ev); R.buf.push(s); R.size += s.length;
    if (R.size > REPLAY_CHUNK) flushReplay(false);
  }
  function snapshot() {
    R.ids = new WeakMap(); R.next = 1;
    rec({ k: "full", w: innerWidth, h: innerHeight, url: location.href, d: document.doctype ? document.doctype.name : "html", n: ser(document.documentElement), sx: scrollX, sy: scrollY });
  }
  function replayUrl() { var e = endpoints(); return String(e[epIndex % e.length]).replace(/\/$/, "") + "/v1/replay?key=" + encodeURIComponent(cfg.key); }
  function flushReplay(unloading) {
    if (!R.buf.length) return;
    var events = "[" + R.buf.join(",") + "]", body = JSON.stringify({ app: cfg.app, session_id: sessionId, user_id: userId, seq: R.seq, start: R.start, end: Date.now(),
      page_url: location.href, has_error: R.err, clicks: R.clicks, rage_clicks: R.rage }).replace(/}$/, ',"events":' + events + "}");
    R.seq++; R.buf = []; R.size = 0; R.start = 0; R.clicks = 0; R.rage = 0; R.err = false;
    try { localStorage.setItem(RSTATE, JSON.stringify({ s: sessionId, q: R.seq })); } catch (e) {}
    if (unloading && body.length < 60000 && navigator.sendBeacon) { navigator.sendBeacon(replayUrl(), new Blob([body], { type: "text/plain" })); return; }
    try { fetch(replayUrl(), { method: "POST", body: body, keepalive: unloading && body.length < 60000, headers: { "Content-Type": "text/plain" } }).catch(function () {}); } catch (e) {}
  }
  function startReplay() {
    if (!global.MutationObserver || !global.WeakMap || !global.JSON) return;
    var rate = cfg.replaySampleRate == null ? 1 : cfg.replaySampleRate;
    if (parseInt(sessionId.slice(8, 16), 16) / 0xffffffff >= rate) return;
    try { var st = JSON.parse(localStorage.getItem(RSTATE) || "{}"); if (st.s === sessionId) R.seq = st.q || 0; } catch (e) {}
    R.on = true;
    snapshot();
    new MutationObserver(safe(function (ms) {
      var adds = [], rems = [], attrs = [], texts = [], seen = new Set();
      ms.forEach(function (m) {
        if (m.type === "childList") {
          m.removedNodes.forEach(function (n) { var i = R.ids.get(n); if (i) rems.push({ i: i, p: R.ids.get(m.target) }); });
          m.addedNodes.forEach(function (n) {
            if (seen.has(n) || !n.isConnected) return; seen.add(n);
            var s = ser(n); if (!s) return;
            var nx = n.nextSibling; while (nx && !R.ids.get(nx)) nx = nx.nextSibling;
            adds.push({ p: rid(m.target), nx: nx ? R.ids.get(nx) : 0, n: s });
          });
        } else if (m.type === "attributes") {
          var el = m.target, i = R.ids.get(el); if (!i || !el.getAttribute) return;
          var a = {}, all = cleanAttrs(el), nm = m.attributeName.toLowerCase(); a[nm] = all.hasOwnProperty(nm) ? all[nm] : null; attrs.push({ i: i, a: a });
        } else if (m.type === "characterData") {
          var ti = R.ids.get(m.target); if (ti) texts.push({ i: ti, x: maskText(m.target.nodeValue, m.target.parentNode) });
        }
      });
      if (adds.length || rems.length || attrs.length || texts.length) rec({ k: "m", ad: adds, rm: rems, at: attrs, tx: texts });
    })).observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    var lastMove = 0;
    addEventListener("mousemove", safe(function (e) { var t = Date.now(); if (t - lastMove < 60) return; lastMove = t; rec({ k: "mv", x: e.clientX, y: e.clientY }); }), { passive: true, capture: true });
    addEventListener("click", safe(function (e) {
      var t = Date.now(); R.clicks++;
      R.lastClicks = R.lastClicks.filter(function (c) { return t - c.t < 1000 && Math.abs(c.x - e.clientX) < 30 && Math.abs(c.y - e.clientY) < 30; });
      R.lastClicks.push({ t: t, x: e.clientX, y: e.clientY });
      var rage = R.lastClicks.length === 3; if (rage) R.rage++;
      rec({ k: "c", x: e.clientX, y: e.clientY, i: e.target && R.ids.get(e.target) || 0, r: rage ? 1 : 0 });
    }), true);
    addEventListener("scroll", safe(function (e) { var tg = e.target === document ? null : e.target; rec({ k: "s", i: tg ? R.ids.get(tg) || 0 : 0, x: tg ? tg.scrollLeft : scrollX, y: tg ? tg.scrollTop : scrollY }); }), { passive: true, capture: true });
    addEventListener("input", safe(function (e) { var el = e.target, i = R.ids.get(el); if (i && "value" in el) rec({ k: "i", i: i, v: inputValue(el) }); }), true);
    addEventListener("change", safe(function (e) { var el = e.target, i = R.ids.get(el); if (i && "value" in el) rec({ k: "i", i: i, v: inputValue(el) }); }), true);
    addEventListener("resize", safe(function () { rec({ k: "vp", w: innerWidth, h: innerHeight }); }));
    addEventListener("error", function () { R.err = true; rec({ k: "e" }); }, true);
    R.timer = setInterval(safe(function () { flushReplay(false); }), cfg.replayFlushInterval || 10000);
    addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flushReplay(true); });
    addEventListener("pagehide", function () { flushReplay(true); });
  }

  var Shravelle = {
    __loaded: true,
    init: safe(function (opts) {
      if (started) return;
      for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) cfg[k] = opts[k];
      if (!cfg.endpoint || !cfg.key) { console.warn("[shravelle] endpoint and key are required"); return; }
      sessionId = loadSession();
      // sampling is per session so a session is either fully kept or not
      sampled = parseInt(sessionId.slice(0, 8), 16) / 0xffffffff < cfg.sampleRate;
      started = true;
      restore();
      errors(); vitals(); patchHistory();
      if (cfg.captureAjax) ajax();
      if (cfg.captureClicks) clicks();
      // the first snapshot needs the parsed page (init usually runs in <head>)
      if (cfg.sessionReplay && sampled) { if (document.readyState === "loading") addEventListener("DOMContentLoaded", safe(startReplay)); else startReplay(); }
      if (document.readyState === "complete") pageView("initial");
      else addEventListener("load", safe(function () { setTimeout(function () { pageView("initial"); }, 0); }));
      setInterval(safe(function () { flush(); }), cfg.flushInterval);
      addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(true); });
      addEventListener("pagehide", function () { flush(true); });
      addEventListener("online", function () { flush(); });
    }),
    setUser: function (id) { userId = String(id || ""); },
    track: safe(function (name, attributes, value) { push({ type: "custom", name: String(name), attributes: attributes || {}, value: value || 0 }); }),
    error: safe(function (err, attributes) {
      err = err || {};
      push({ type: "js_error", name: err.name || "Error", message: err.message || String(err), stack: err.stack || "", attributes: attributes || {} });
    }),
    flush: function () { flush(); }
  };
  global.Shravelle = Shravelle;
  if (typeof module !== "undefined" && module.exports) module.exports = Shravelle;
})(typeof window !== "undefined" ? window : this);
