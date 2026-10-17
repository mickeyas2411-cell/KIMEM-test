// staging-auth-gateway.js
var respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
var loginPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KIMEM Telegram Login Test</title><script src="https://telegram.org/js/telegram-web-app.js"><\/script><style>body{font-family:system-ui,sans-serif;background:#101827;color:#f8fafc;margin:0;padding:28px}main{max-width:430px;margin:12vh auto;padding:24px;border:1px solid #334155;border-radius:18px;background:#172338}h1{font-size:23px}p{line-height:1.6;color:#cbd5e1}button{padding:13px 18px;background:#22c55e;border:0;border-radius:10px;font-weight:700;color:#052e16}output{display:block;margin-top:20px;overflow-wrap:anywhere}small{color:#94a3b8}</style></head><body><main><h1>KIMEM \xB7 Telegram Login Test</h1><p>This staging page only verifies Telegram login. No payments, cards, or balances are changed.</p><button id="check">Verify Telegram login</button><output id="result" role="status">Ready</output><p><a href="/registration-test" style="display:inline-block;padding:13px 18px;background:#1d4ed8;color:white;border-radius:10px;text-decoration:none;font-weight:700">Continue to registration test \u2192</a></p><p><small>Open inside @Kimemtest_bot's Mini App. Never share Telegram initData.</small></p></main><script>const out=document.getElementById('result');const button=document.getElementById('check');button.addEventListener('click',async()=>{const t=window.Telegram?.WebApp;const initData=t?.initData;if(!initData){out.textContent='Not inside a Telegram Mini App, or no signed login data.';return}button.disabled=true;out.textContent='Checking Telegram signature\u2026';try{const r=await fetch('/diagnostics/auth',{headers:{Authorization:'tma '+initData},cache:'no-store'});const d=await r.json();if(r.ok&&d.ok===true){out.textContent='PASS: Telegram login verified.'}else{out.textContent='FAIL: '+String(d.reason||d.error||'unknown_auth_failure')}}catch{out.textContent='Network error contacting staging API.'}finally{button.disabled=false}});window.Telegram?.WebApp?.ready();<\/script></body></html>`;
var hex = (bytes) => [...new Uint8Array(bytes)].map((x2) => x2.toString(16).padStart(2, "0")).join("");
function constantEqual(a2, b2) {
  if (a2.length !== b2.length) return false;
  let diff = 0;
  for (let i = 0; i < a2.length; i++) diff |= a2.charCodeAt(i) ^ b2.charCodeAt(i);
  return diff === 0;
}
async function verifyTelegram(initData, token) {
  if (!initData || initData.length > 8192 || !token) return false;
  const pairs = [...new URLSearchParams(initData).entries()];
  if (new Set(pairs.map(([k]) => k)).size !== pairs.length) return false;
  const values = new Map(pairs), hash = values.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return false;
  const authDate = Number(values.get("auth_date")), now = Math.floor(Date.now() / 1e3);
  if (!Number.isSafeInteger(authDate) || authDate > now + 60 || now - authDate > 3600) return false;
  const data = pairs.filter(([k]) => k !== "hash").sort(([a2], [b2]) => a2 < b2 ? -1 : a2 > b2 ? 1 : 0).map(([k, v2]) => k + "=" + v2).join("\n");
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", base, enc.encode(token));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = hex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  if (!constantEqual(digest, hash.toLowerCase())) return false;
  try {
    const user = JSON.parse(values.get("user") || "null");
    return !!user && Number.isSafeInteger(user.id) && user.id > 0;
  } catch {
    return false;
  }
}
var staging_auth_gateway_default = { async fetch(request, env) {
  const path = new URL(request.url).pathname;
  if (path === "/health" && request.method === "GET") return respond({ ok: true, service: "kimem-player-api-staging", mode: "auth-only", database: env.STAGING_DATABASE_URL ? "secret_configured_connection_unverified" : "secret_missing", bonus_purchases_enabled: false });
  if (path === "/diagnostics/auth" && request.method === "GET") {
    const auth2 = request.headers.get("Authorization") || "";
    if (!auth2.startsWith("tma ")) return respond({ ok: false, reason: "missing_telegram_data" }, 401);
    if (!env.TELEGRAM_BOT_TOKEN) return respond({ ok: false, reason: "server_token_not_configured" }, 503);
    const raw = auth2.slice(4), pairs = [...new URLSearchParams(raw).entries()], values = new Map(pairs);
    if (!raw || raw.length > 8192 || values.size !== pairs.length) return respond({ ok: false, reason: "malformed_telegram_data" }, 401);
    const timestamp = Number(values.get("auth_date")), now = Math.floor(Date.now() / 1e3);
    if (!Number.isSafeInteger(timestamp) || timestamp > now + 60 || now - timestamp > 3600) return respond({ ok: false, reason: "telegram_data_expired" }, 401);
    if (!/^[a-f0-9]{64}$/i.test(values.get("hash") || "")) return respond({ ok: false, reason: "missing_or_invalid_hash" }, 401);
    const verified = await verifyTelegram(raw, env.TELEGRAM_BOT_TOKEN);
    if (!verified) {
      const userRaw = values.get("user");
      let validUser = false;
      try {
        const u = JSON.parse(userRaw || "null");
        validUser = !!u && Number.isSafeInteger(u.id) && u.id > 0;
      } catch {
      }
      return respond({ ok: false, reason: validUser ? "telegram_hash_mismatch" : "telegram_user_invalid_or_hash_mismatch" }, 401);
    }
    return respond({ ok: true, reason: "verified" });
  }
  if (path === "/login-test" && request.method === "GET") return new Response(loginPage, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
  const routes = { "/api/me/register": "POST", "/api/me/balances": "GET", "/api/me/bonus-balance": "GET", "/api/cards/buy-bonus": "POST" };
  if (!Object.hasOwn(routes, path)) return respond({ ok: false, error: "not_found" }, 404);
  if (request.method !== routes[path]) return respond({ ok: false, error: "method_not_allowed" }, 405);
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("tma ") || !await verifyTelegram(auth.slice(4), env.TELEGRAM_BOT_TOKEN))
    return respond({ ok: false, error: "unauthorized" }, 401);
  if (path === "/api/me/balances") return respond({ ok: false, error: "wallet_reconciliation_required" }, 503);
  if (path === "/api/cards/buy-bonus") return respond({ ok: false, error: "bonus_purchases_not_enabled" }, 503);
  return respond({ ok: false, error: "staging_database_not_connected" }, 503);
} };

// node_modules/@neondatabase/serverless/index.mjs
var Po = Object.create;
var Ie = Object.defineProperty;
var Ro = Object.getOwnPropertyDescriptor;
var Lo = Object.getOwnPropertyNames;
var Bo = Object.getPrototypeOf;
var Fo = Object.prototype.hasOwnProperty;
var Mo = (r, e, t) => e in r ? Ie(r, e, { enumerable: true, configurable: true, writable: true, value: t }) : r[e] = t;
var a = (r, e) => Ie(r, "name", { value: e, configurable: true });
var V = (r, e, t) => () => {
  if (t) throw t[0];
  try {
    return r && (e = r(r = 0)), e;
  } catch (n) {
    throw t = [n], n;
  }
};
var T = (r, e) => () => {
  try {
    return e || r((e = { exports: {} }).exports, e), e.exports;
  } catch (t) {
    throw e = 0, t;
  }
};
var se = (r, e) => {
  for (var t in e) Ie(r, t, { get: e[t], enumerable: true });
};
var Dn = (r, e, t, n) => {
  if (e && typeof e == "object" || typeof e == "function") for (let i of Lo(e)) !Fo.call(r, i) && i !== t && Ie(r, i, { get: () => e[i], enumerable: !(n = Ro(e, i)) || n.enumerable });
  return r;
};
var we = (r, e, t) => (t = r != null ? Po(Bo(r)) : {}, Dn(e || !r || !r.__esModule ? Ie(t, "default", { value: r, enumerable: true }) : t, r));
var O = (r) => Dn(Ie({}, "__esModule", { value: true }), r);
var E = (r, e, t) => Mo(r, typeof e != "symbol" ? e + "" : e, t);
var Wn = T((lt) => {
  "use strict";
  h();
  lt.byteLength = Oo;
  lt.toByteArray = Qo;
  lt.fromByteArray = No;
  var le = [], X = [], ko = typeof Uint8Array < "u" ? Uint8Array : Array, qt = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (Ae = 0, qn = qt.length; Ae < qn; ++Ae) le[Ae] = qt[Ae], X[qt.charCodeAt(Ae)] = Ae;
  var Ae, qn;
  X[45] = 62;
  X[95] = 63;
  function Nn(r) {
    var e = r.length;
    if (e % 4 > 0) throw new Error("Invalid string. Length must be a multiple of 4");
    var t = r.indexOf("=");
    t === -1 && (t = e);
    var n = t === e ? 0 : 4 - t % 4;
    return [t, n];
  }
  a(Nn, "getLens");
  function Oo(r) {
    var e = Nn(r), t = e[0], n = e[1];
    return (t + n) * 3 / 4 - n;
  }
  a(Oo, "byteLength");
  function Uo(r, e, t) {
    return (e + t) * 3 / 4 - t;
  }
  a(Uo, "_byteLength");
  function Qo(r) {
    var e, t = Nn(r), n = t[0], i = t[1], s = new ko(Uo(r, n, i)), o = 0, u = i > 0 ? n - 4 : n, c;
    for (c = 0; c < u; c += 4) e = X[r.charCodeAt(c)] << 18 | X[r.charCodeAt(c + 1)] << 12 | X[r.charCodeAt(c + 2)] << 6 | X[r.charCodeAt(
      c + 3
    )], s[o++] = e >> 16 & 255, s[o++] = e >> 8 & 255, s[o++] = e & 255;
    return i === 2 && (e = X[r.charCodeAt(c)] << 2 | X[r.charCodeAt(
      c + 1
    )] >> 4, s[o++] = e & 255), i === 1 && (e = X[r.charCodeAt(c)] << 10 | X[r.charCodeAt(c + 1)] << 4 | X[r.charCodeAt(c + 2)] >> 2, s[o++] = e >> 8 & 255, s[o++] = e & 255), s;
  }
  a(Qo, "toByteArray");
  function Do(r) {
    return le[r >> 18 & 63] + le[r >> 12 & 63] + le[r >> 6 & 63] + le[r & 63];
  }
  a(Do, "tripletToBase64");
  function qo(r, e, t) {
    for (var n, i = [], s = e; s < t; s += 3) n = (r[s] << 16 & 16711680) + (r[s + 1] << 8 & 65280) + (r[s + 2] & 255), i.push(Do(n));
    return i.join("");
  }
  a(qo, "encodeChunk");
  function No(r) {
    for (var e, t = r.length, n = t % 3, i = [], s = 16383, o = 0, u = t - n; o < u; o += s) i.push(qo(r, o, o + s > u ? u : o + s));
    return n === 1 ? (e = r[t - 1], i.push(le[e >> 2] + le[e << 4 & 63] + "==")) : n === 2 && (e = (r[t - 2] << 8) + r[t - 1], i.push(le[e >> 10] + le[e >> 4 & 63] + le[e << 2 & 63] + "=")), i.join("");
  }
  a(No, "fromByteArray");
});
var jn = T((Nt) => {
  h();
  Nt.read = function(r, e, t, n, i) {
    var s, o, u = i * 8 - n - 1, c = (1 << u) - 1, l = c >> 1, f = -7, m = t ? i - 1 : 0, g = t ? -1 : 1, w = r[e + m];
    for (m += g, s = w & (1 << -f) - 1, w >>= -f, f += u; f > 0; s = s * 256 + r[e + m], m += g, f -= 8) ;
    for (o = s & (1 << -f) - 1, s >>= -f, f += n; f > 0; o = o * 256 + r[e + m], m += g, f -= 8) ;
    if (s === 0) s = 1 - l;
    else {
      if (s === c) return o ? NaN : (w ? -1 : 1) * (1 / 0);
      o = o + Math.pow(2, n), s = s - l;
    }
    return (w ? -1 : 1) * o * Math.pow(2, s - n);
  };
  Nt.write = function(r, e, t, n, i, s) {
    var o, u, c, l = s * 8 - i - 1, f = (1 << l) - 1, m = f >> 1, g = i === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0, w = n ? 0 : s - 1, S = n ? 1 : -1, k = e < 0 || e === 0 && 1 / e < 0 ? 1 : 0;
    for (e = Math.abs(e), isNaN(e) || e === 1 / 0 ? (u = isNaN(e) ? 1 : 0, o = f) : (o = Math.floor(Math.log(e) / Math.LN2), e * (c = Math.pow(2, -o)) < 1 && (o--, c *= 2), o + m >= 1 ? e += g / c : e += g * Math.pow(2, 1 - m), e * c >= 2 && (o++, c /= 2), o + m >= f ? (u = 0, o = f) : o + m >= 1 ? (u = (e * c - 1) * Math.pow(2, i), o = o + m) : (u = e * Math.pow(2, m - 1) * Math.pow(2, i), o = 0)); i >= 8; r[t + w] = u & 255, w += S, u /= 256, i -= 8) ;
    for (o = o << i | u, l += i; l > 0; r[t + w] = o & 255, w += S, o /= 256, l -= 8) ;
    r[t + w - S] |= k * 128;
  };
});
var oi = T((Be) => {
  "use strict";
  h();
  var Wt = Wn(), Re = jn(), Hn = typeof Symbol == "function" && typeof Symbol.for == "function" ? Symbol.for("nodejs.util.inspect.custom") : null;
  Be.Buffer = d;
  Be.SlowBuffer = Vo;
  Be.INSPECT_MAX_BYTES = 50;
  var ft = 2147483647;
  Be.kMaxLength = ft;
  d.TYPED_ARRAY_SUPPORT = Wo();
  !d.TYPED_ARRAY_SUPPORT && typeof console < "u" && typeof console.error == "function" && console.error("This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support.");
  function Wo() {
    try {
      let r = new Uint8Array(1), e = { foo: a(function() {
        return 42;
      }, "foo") };
      return Object.setPrototypeOf(e, Uint8Array.prototype), Object.setPrototypeOf(r, e), r.foo() === 42;
    } catch {
      return false;
    }
  }
  a(Wo, "typedArraySupport");
  Object.defineProperty(d.prototype, "parent", { enumerable: true, get: a(function() {
    if (d.isBuffer(this)) return this.buffer;
  }, "get") });
  Object.defineProperty(d.prototype, "offset", { enumerable: true, get: a(function() {
    if (d.isBuffer(
      this
    )) return this.byteOffset;
  }, "get") });
  function de(r) {
    if (r > ft) throw new RangeError('The value "' + r + '" is invalid for option "size"');
    let e = new Uint8Array(r);
    return Object.setPrototypeOf(e, d.prototype), e;
  }
  a(de, "createBuffer");
  function d(r, e, t) {
    if (typeof r == "number") {
      if (typeof e == "string") throw new TypeError(
        'The "string" argument must be of type string. Received type number'
      );
      return Gt(r);
    }
    return zn(r, e, t);
  }
  a(d, "Buffer");
  d.poolSize = 8192;
  function zn(r, e, t) {
    if (typeof r == "string") return Ho(r, e);
    if (ArrayBuffer.isView(r)) return $o(r);
    if (r == null) throw new TypeError("The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof r);
    if (fe(r, ArrayBuffer) || r && fe(r.buffer, ArrayBuffer) || typeof SharedArrayBuffer < "u" && (fe(r, SharedArrayBuffer) || r && fe(
      r.buffer,
      SharedArrayBuffer
    ))) return Ht(r, e, t);
    if (typeof r == "number") throw new TypeError('The "value" argument must not be of type number. Received type number');
    let n = r.valueOf && r.valueOf();
    if (n != null && n !== r) return d.from(n, e, t);
    let i = Go(r);
    if (i) return i;
    if (typeof Symbol < "u" && Symbol.toPrimitive != null && typeof r[Symbol.toPrimitive] == "function") return d.from(r[Symbol.toPrimitive]("string"), e, t);
    throw new TypeError("The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof r);
  }
  a(zn, "from");
  d.from = function(r, e, t) {
    return zn(r, e, t);
  };
  Object.setPrototypeOf(
    d.prototype,
    Uint8Array.prototype
  );
  Object.setPrototypeOf(d, Uint8Array);
  function Kn(r) {
    if (typeof r != "number") throw new TypeError(
      '"size" argument must be of type number'
    );
    if (r < 0) throw new RangeError('The value "' + r + '" is invalid for option "size"');
  }
  a(Kn, "assertSize");
  function jo(r, e, t) {
    return Kn(r), r <= 0 ? de(r) : e !== void 0 ? typeof t == "string" ? de(r).fill(e, t) : de(r).fill(e) : de(r);
  }
  a(jo, "alloc");
  d.alloc = function(r, e, t) {
    return jo(r, e, t);
  };
  function Gt(r) {
    return Kn(r), de(r < 0 ? 0 : Vt(r) | 0);
  }
  a(Gt, "allocUnsafe");
  d.allocUnsafe = function(r) {
    return Gt(
      r
    );
  };
  d.allocUnsafeSlow = function(r) {
    return Gt(r);
  };
  function Ho(r, e) {
    if ((typeof e != "string" || e === "") && (e = "utf8"), !d.isEncoding(e)) throw new TypeError("Unknown encoding: " + e);
    let t = Yn(r, e) | 0, n = de(t), i = n.write(
      r,
      e
    );
    return i !== t && (n = n.slice(0, i)), n;
  }
  a(Ho, "fromString");
  function jt(r) {
    let e = r.length < 0 ? 0 : Vt(r.length) | 0, t = de(e);
    for (let n = 0; n < e; n += 1) t[n] = r[n] & 255;
    return t;
  }
  a(jt, "fromArrayLike");
  function $o(r) {
    if (fe(r, Uint8Array)) {
      let e = new Uint8Array(r);
      return Ht(e.buffer, e.byteOffset, e.byteLength);
    }
    return jt(r);
  }
  a($o, "fromArrayView");
  function Ht(r, e, t) {
    if (e < 0 || r.byteLength < e) throw new RangeError('"offset" is outside of buffer bounds');
    if (r.byteLength < e + (t || 0)) throw new RangeError('"length" is outside of buffer bounds');
    let n;
    return e === void 0 && t === void 0 ? n = new Uint8Array(r) : t === void 0 ? n = new Uint8Array(r, e) : n = new Uint8Array(
      r,
      e,
      t
    ), Object.setPrototypeOf(n, d.prototype), n;
  }
  a(Ht, "fromArrayBuffer");
  function Go(r) {
    if (d.isBuffer(r)) {
      let e = Vt(r.length) | 0, t = de(e);
      return t.length === 0 || r.copy(t, 0, 0, e), t;
    }
    if (r.length !== void 0) return typeof r.length != "number" || Kt(r.length) ? de(0) : jt(r);
    if (r.type === "Buffer" && Array.isArray(r.data)) return jt(r.data);
  }
  a(Go, "fromObject");
  function Vt(r) {
    if (r >= ft) throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + ft.toString(16) + " bytes");
    return r | 0;
  }
  a(Vt, "checked");
  function Vo(r) {
    return +r != r && (r = 0), d.alloc(+r);
  }
  a(Vo, "SlowBuffer");
  d.isBuffer = a(function(e) {
    return e != null && e._isBuffer === true && e !== d.prototype;
  }, "isBuffer");
  d.compare = a(function(e, t) {
    if (fe(e, Uint8Array) && (e = d.from(e, e.offset, e.byteLength)), fe(t, Uint8Array) && (t = d.from(t, t.offset, t.byteLength)), !d.isBuffer(e) || !d.isBuffer(t)) throw new TypeError(
      'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
    );
    if (e === t) return 0;
    let n = e.length, i = t.length;
    for (let s = 0, o = Math.min(n, i); s < o; ++s) if (e[s] !== t[s]) {
      n = e[s], i = t[s];
      break;
    }
    return n < i ? -1 : i < n ? 1 : 0;
  }, "compare");
  d.isEncoding = a(function(e) {
    switch (String(e).toLowerCase()) {
      case "hex":
      case "utf8":
      case "utf-8":
      case "ascii":
      case "latin1":
      case "binary":
      case "base64":
      case "ucs2":
      case "ucs-2":
      case "utf16le":
      case "utf-16le":
        return true;
      default:
        return false;
    }
  }, "isEncoding");
  d.concat = a(function(e, t) {
    if (!Array.isArray(e)) throw new TypeError(
      '"list" argument must be an Array of Buffers'
    );
    if (e.length === 0) return d.alloc(0);
    let n;
    if (t === void 0)
      for (t = 0, n = 0; n < e.length; ++n) t += e[n].length;
    let i = d.allocUnsafe(t), s = 0;
    for (n = 0; n < e.length; ++n) {
      let o = e[n];
      if (fe(o, Uint8Array)) s + o.length > i.length ? (d.isBuffer(o) || (o = d.from(o)), o.copy(i, s)) : Uint8Array.prototype.set.call(i, o, s);
      else if (d.isBuffer(o)) o.copy(i, s);
      else throw new TypeError('"list" argument must be an Array of Buffers');
      s += o.length;
    }
    return i;
  }, "concat");
  function Yn(r, e) {
    if (d.isBuffer(r)) return r.length;
    if (ArrayBuffer.isView(r) || fe(r, ArrayBuffer)) return r.byteLength;
    if (typeof r != "string") throw new TypeError(
      'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof r
    );
    let t = r.length, n = arguments.length > 2 && arguments[2] === true;
    if (!n && t === 0) return 0;
    let i = false;
    for (; ; ) switch (e) {
      case "ascii":
      case "latin1":
      case "binary":
        return t;
      case "utf8":
      case "utf-8":
        return $t(r).length;
      case "ucs2":
      case "ucs-2":
      case "utf16le":
      case "utf-16le":
        return t * 2;
      case "hex":
        return t >>> 1;
      case "base64":
        return si(r).length;
      default:
        if (i) return n ? -1 : $t(r).length;
        e = ("" + e).toLowerCase(), i = true;
    }
  }
  a(Yn, "byteLength");
  d.byteLength = Yn;
  function zo(r, e, t) {
    let n = false;
    if ((e === void 0 || e < 0) && (e = 0), e > this.length || ((t === void 0 || t > this.length) && (t = this.length), t <= 0) || (t >>>= 0, e >>>= 0, t <= e)) return "";
    for (r || (r = "utf8"); ; ) switch (r) {
      case "hex":
        return ia(this, e, t);
      case "utf8":
      case "utf-8":
        return Jn(this, e, t);
      case "ascii":
        return ra(this, e, t);
      case "latin1":
      case "binary":
        return na(
          this,
          e,
          t
        );
      case "base64":
        return ea(this, e, t);
      case "ucs2":
      case "ucs-2":
      case "utf16le":
      case "utf-16le":
        return sa(
          this,
          e,
          t
        );
      default:
        if (n) throw new TypeError("Unknown encoding: " + r);
        r = (r + "").toLowerCase(), n = true;
    }
  }
  a(
    zo,
    "slowToString"
  );
  d.prototype._isBuffer = true;
  function Ce(r, e, t) {
    let n = r[e];
    r[e] = r[t], r[t] = n;
  }
  a(Ce, "swap");
  d.prototype.swap16 = a(function() {
    let e = this.length;
    if (e % 2 !== 0) throw new RangeError("Buffer size must be a multiple of 16-bits");
    for (let t = 0; t < e; t += 2) Ce(this, t, t + 1);
    return this;
  }, "swap16");
  d.prototype.swap32 = a(function() {
    let e = this.length;
    if (e % 4 !== 0) throw new RangeError("Buffer size must be a multiple of 32-bits");
    for (let t = 0; t < e; t += 4) Ce(this, t, t + 3), Ce(this, t + 1, t + 2);
    return this;
  }, "swap32");
  d.prototype.swap64 = a(
    function() {
      let e = this.length;
      if (e % 8 !== 0) throw new RangeError("Buffer size must be a multiple of 64-bits");
      for (let t = 0; t < e; t += 8) Ce(this, t, t + 7), Ce(this, t + 1, t + 6), Ce(this, t + 2, t + 5), Ce(this, t + 3, t + 4);
      return this;
    },
    "swap64"
  );
  d.prototype.toString = a(function() {
    let e = this.length;
    return e === 0 ? "" : arguments.length === 0 ? Jn(
      this,
      0,
      e
    ) : zo.apply(this, arguments);
  }, "toString");
  d.prototype.toLocaleString = d.prototype.toString;
  d.prototype.equals = a(function(e) {
    if (!d.isBuffer(e)) throw new TypeError("Argument must be a Buffer");
    return this === e ? true : d.compare(this, e) === 0;
  }, "equals");
  d.prototype.inspect = a(function() {
    let e = "", t = Be.INSPECT_MAX_BYTES;
    return e = this.toString("hex", 0, t).replace(/(.{2})/g, "$1 ").trim(), this.length > t && (e += " ... "), "<Buffer " + e + ">";
  }, "inspect");
  Hn && (d.prototype[Hn] = d.prototype.inspect);
  d.prototype.compare = a(function(e, t, n, i, s) {
    if (fe(e, Uint8Array) && (e = d.from(e, e.offset, e.byteLength)), !d.isBuffer(e)) throw new TypeError('The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof e);
    if (t === void 0 && (t = 0), n === void 0 && (n = e ? e.length : 0), i === void 0 && (i = 0), s === void 0 && (s = this.length), t < 0 || n > e.length || i < 0 || s > this.length) throw new RangeError("out of range index");
    if (i >= s && t >= n) return 0;
    if (i >= s) return -1;
    if (t >= n) return 1;
    if (t >>>= 0, n >>>= 0, i >>>= 0, s >>>= 0, this === e) return 0;
    let o = s - i, u = n - t, c = Math.min(o, u), l = this.slice(
      i,
      s
    ), f = e.slice(t, n);
    for (let m = 0; m < c; ++m) if (l[m] !== f[m]) {
      o = l[m], u = f[m];
      break;
    }
    return o < u ? -1 : u < o ? 1 : 0;
  }, "compare");
  function Zn(r, e, t, n, i) {
    if (r.length === 0) return -1;
    if (typeof t == "string" ? (n = t, t = 0) : t > 2147483647 ? t = 2147483647 : t < -2147483648 && (t = -2147483648), t = +t, Kt(t) && (t = i ? 0 : r.length - 1), t < 0 && (t = r.length + t), t >= r.length) {
      if (i) return -1;
      t = r.length - 1;
    } else if (t < 0) if (i) t = 0;
    else return -1;
    if (typeof e == "string" && (e = d.from(
      e,
      n
    )), d.isBuffer(e)) return e.length === 0 ? -1 : $n(r, e, t, n, i);
    if (typeof e == "number") return e = e & 255, typeof Uint8Array.prototype.indexOf == "function" ? i ? Uint8Array.prototype.indexOf.call(r, e, t) : Uint8Array.prototype.lastIndexOf.call(r, e, t) : $n(r, [e], t, n, i);
    throw new TypeError("val must be string, number or Buffer");
  }
  a(Zn, "bidirectionalIndexOf");
  function $n(r, e, t, n, i) {
    let s = 1, o = r.length, u = e.length;
    if (n !== void 0 && (n = String(n).toLowerCase(), n === "ucs2" || n === "ucs-2" || n === "utf16le" || n === "utf-16le")) {
      if (r.length < 2 || e.length < 2) return -1;
      s = 2, o /= 2, u /= 2, t /= 2;
    }
    function c(f, m) {
      return s === 1 ? f[m] : f.readUInt16BE(m * s);
    }
    a(c, "read");
    let l;
    if (i) {
      let f = -1;
      for (l = t; l < o; l++) if (c(r, l) === c(e, f === -1 ? 0 : l - f)) {
        if (f === -1 && (f = l), l - f + 1 === u) return f * s;
      } else f !== -1 && (l -= l - f), f = -1;
    } else for (t + u > o && (t = o - u), l = t; l >= 0; l--) {
      let f = true;
      for (let m = 0; m < u; m++) if (c(r, l + m) !== c(e, m)) {
        f = false;
        break;
      }
      if (f) return l;
    }
    return -1;
  }
  a($n, "arrayIndexOf");
  d.prototype.includes = a(function(e, t, n) {
    return this.indexOf(
      e,
      t,
      n
    ) !== -1;
  }, "includes");
  d.prototype.indexOf = a(function(e, t, n) {
    return Zn(this, e, t, n, true);
  }, "indexOf");
  d.prototype.lastIndexOf = a(function(e, t, n) {
    return Zn(this, e, t, n, false);
  }, "lastIndexOf");
  function Ko(r, e, t, n) {
    t = Number(t) || 0;
    let i = r.length - t;
    n ? (n = Number(n), n > i && (n = i)) : n = i;
    let s = e.length;
    n > s / 2 && (n = s / 2);
    let o;
    for (o = 0; o < n; ++o) {
      let u = parseInt(e.substr(o * 2, 2), 16);
      if (Kt(u)) return o;
      r[t + o] = u;
    }
    return o;
  }
  a(Ko, "hexWrite");
  function Yo(r, e, t, n) {
    return ht($t(e, r.length - t), r, t, n);
  }
  a(Yo, "utf8Write");
  function Zo(r, e, t, n) {
    return ht(ca(e), r, t, n);
  }
  a(
    Zo,
    "asciiWrite"
  );
  function Jo(r, e, t, n) {
    return ht(si(e), r, t, n);
  }
  a(Jo, "base64Write");
  function Xo(r, e, t, n) {
    return ht(
      la(e, r.length - t),
      r,
      t,
      n
    );
  }
  a(Xo, "ucs2Write");
  d.prototype.write = a(function(e, t, n, i) {
    if (t === void 0) i = "utf8", n = this.length, t = 0;
    else if (n === void 0 && typeof t == "string") i = t, n = this.length, t = 0;
    else if (isFinite(t))
      t = t >>> 0, isFinite(n) ? (n = n >>> 0, i === void 0 && (i = "utf8")) : (i = n, n = void 0);
    else throw new Error("Buffer.write(string, encoding, offset[, length]) is no longer supported");
    let s = this.length - t;
    if ((n === void 0 || n > s) && (n = s), e.length > 0 && (n < 0 || t < 0) || t > this.length) throw new RangeError("Attempt to write outside buffer bounds");
    i || (i = "utf8");
    let o = false;
    for (; ; ) switch (i) {
      case "hex":
        return Ko(this, e, t, n);
      case "utf8":
      case "utf-8":
        return Yo(this, e, t, n);
      case "ascii":
      case "latin1":
      case "binary":
        return Zo(this, e, t, n);
      case "base64":
        return Jo(this, e, t, n);
      case "ucs2":
      case "ucs-2":
      case "utf16le":
      case "utf-16le":
        return Xo(this, e, t, n);
      default:
        if (o) throw new TypeError("Unknown encoding: " + i);
        i = ("" + i).toLowerCase(), o = true;
    }
  }, "write");
  d.prototype.toJSON = a(function() {
    return { type: "Buffer", data: Array.prototype.slice.call(this._arr || this, 0) };
  }, "toJSON");
  function ea(r, e, t) {
    return e === 0 && t === r.length ? Wt.fromByteArray(r) : Wt.fromByteArray(r.slice(e, t));
  }
  a(ea, "base64Slice");
  function Jn(r, e, t) {
    t = Math.min(r.length, t);
    let n = [], i = e;
    for (; i < t; ) {
      let s = r[i], o = null, u = s > 239 ? 4 : s > 223 ? 3 : s > 191 ? 2 : 1;
      if (i + u <= t) {
        let c, l, f, m;
        switch (u) {
          case 1:
            s < 128 && (o = s);
            break;
          case 2:
            c = r[i + 1], (c & 192) === 128 && (m = (s & 31) << 6 | c & 63, m > 127 && (o = m));
            break;
          case 3:
            c = r[i + 1], l = r[i + 2], (c & 192) === 128 && (l & 192) === 128 && (m = (s & 15) << 12 | (c & 63) << 6 | l & 63, m > 2047 && (m < 55296 || m > 57343) && (o = m));
            break;
          case 4:
            c = r[i + 1], l = r[i + 2], f = r[i + 3], (c & 192) === 128 && (l & 192) === 128 && (f & 192) === 128 && (m = (s & 15) << 18 | (c & 63) << 12 | (l & 63) << 6 | f & 63, m > 65535 && m < 1114112 && (o = m));
        }
      }
      o === null ? (o = 65533, u = 1) : o > 65535 && (o -= 65536, n.push(o >>> 10 & 1023 | 55296), o = 56320 | o & 1023), n.push(o), i += u;
    }
    return ta(n);
  }
  a(Jn, "utf8Slice");
  var Gn = 4096;
  function ta(r) {
    let e = r.length;
    if (e <= Gn) return String.fromCharCode.apply(String, r);
    let t = "", n = 0;
    for (; n < e; ) t += String.fromCharCode.apply(String, r.slice(n, n += Gn));
    return t;
  }
  a(ta, "decodeCodePointsArray");
  function ra(r, e, t) {
    let n = "";
    t = Math.min(r.length, t);
    for (let i = e; i < t; ++i) n += String.fromCharCode(r[i] & 127);
    return n;
  }
  a(ra, "asciiSlice");
  function na(r, e, t) {
    let n = "";
    t = Math.min(r.length, t);
    for (let i = e; i < t; ++i) n += String.fromCharCode(r[i]);
    return n;
  }
  a(na, "latin1Slice");
  function ia(r, e, t) {
    let n = r.length;
    (!e || e < 0) && (e = 0), (!t || t < 0 || t > n) && (t = n);
    let i = "";
    for (let s = e; s < t; ++s) i += fa[r[s]];
    return i;
  }
  a(ia, "hexSlice");
  function sa(r, e, t) {
    let n = r.slice(e, t), i = "";
    for (let s = 0; s < n.length - 1; s += 2) i += String.fromCharCode(n[s] + n[s + 1] * 256);
    return i;
  }
  a(sa, "utf16leSlice");
  d.prototype.slice = a(function(e, t) {
    let n = this.length;
    e = ~~e, t = t === void 0 ? n : ~~t, e < 0 ? (e += n, e < 0 && (e = 0)) : e > n && (e = n), t < 0 ? (t += n, t < 0 && (t = 0)) : t > n && (t = n), t < e && (t = e);
    let i = this.subarray(e, t);
    return Object.setPrototypeOf(i, d.prototype), i;
  }, "slice");
  function U(r, e, t) {
    if (r % 1 !== 0 || r < 0) throw new RangeError("offset is not uint");
    if (r + e > t) throw new RangeError("Trying to access beyond buffer length");
  }
  a(U, "checkOffset");
  d.prototype.readUintLE = d.prototype.readUIntLE = a(
    function(e, t, n) {
      e = e >>> 0, t = t >>> 0, n || U(e, t, this.length);
      let i = this[e], s = 1, o = 0;
      for (; ++o < t && (s *= 256); ) i += this[e + o] * s;
      return i;
    },
    "readUIntLE"
  );
  d.prototype.readUintBE = d.prototype.readUIntBE = a(function(e, t, n) {
    e = e >>> 0, t = t >>> 0, n || U(
      e,
      t,
      this.length
    );
    let i = this[e + --t], s = 1;
    for (; t > 0 && (s *= 256); ) i += this[e + --t] * s;
    return i;
  }, "readUIntBE");
  d.prototype.readUint8 = d.prototype.readUInt8 = a(
    function(e, t) {
      return e = e >>> 0, t || U(e, 1, this.length), this[e];
    },
    "readUInt8"
  );
  d.prototype.readUint16LE = d.prototype.readUInt16LE = a(function(e, t) {
    return e = e >>> 0, t || U(
      e,
      2,
      this.length
    ), this[e] | this[e + 1] << 8;
  }, "readUInt16LE");
  d.prototype.readUint16BE = d.prototype.readUInt16BE = a(function(e, t) {
    return e = e >>> 0, t || U(e, 2, this.length), this[e] << 8 | this[e + 1];
  }, "readUInt16BE");
  d.prototype.readUint32LE = d.prototype.readUInt32LE = a(function(e, t) {
    return e = e >>> 0, t || U(e, 4, this.length), (this[e] | this[e + 1] << 8 | this[e + 2] << 16) + this[e + 3] * 16777216;
  }, "readUInt32LE");
  d.prototype.readUint32BE = d.prototype.readUInt32BE = a(function(e, t) {
    return e = e >>> 0, t || U(e, 4, this.length), this[e] * 16777216 + (this[e + 1] << 16 | this[e + 2] << 8 | this[e + 3]);
  }, "readUInt32BE");
  d.prototype.readBigUInt64LE = be(a(function(e) {
    e = e >>> 0, Le(e, "offset");
    let t = this[e], n = this[e + 7];
    (t === void 0 || n === void 0) && We(e, this.length - 8);
    let i = t + this[++e] * 2 ** 8 + this[++e] * 2 ** 16 + this[++e] * 2 ** 24, s = this[++e] + this[++e] * 2 ** 8 + this[++e] * 2 ** 16 + n * 2 ** 24;
    return BigInt(i) + (BigInt(s) << BigInt(32));
  }, "readBigUInt64LE"));
  d.prototype.readBigUInt64BE = be(a(function(e) {
    e = e >>> 0, Le(e, "offset");
    let t = this[e], n = this[e + 7];
    (t === void 0 || n === void 0) && We(e, this.length - 8);
    let i = t * 2 ** 24 + this[++e] * 2 ** 16 + this[++e] * 2 ** 8 + this[++e], s = this[++e] * 2 ** 24 + this[++e] * 2 ** 16 + this[++e] * 2 ** 8 + n;
    return (BigInt(i) << BigInt(
      32
    )) + BigInt(s);
  }, "readBigUInt64BE"));
  d.prototype.readIntLE = a(function(e, t, n) {
    e = e >>> 0, t = t >>> 0, n || U(
      e,
      t,
      this.length
    );
    let i = this[e], s = 1, o = 0;
    for (; ++o < t && (s *= 256); ) i += this[e + o] * s;
    return s *= 128, i >= s && (i -= Math.pow(2, 8 * t)), i;
  }, "readIntLE");
  d.prototype.readIntBE = a(function(e, t, n) {
    e = e >>> 0, t = t >>> 0, n || U(e, t, this.length);
    let i = t, s = 1, o = this[e + --i];
    for (; i > 0 && (s *= 256); ) o += this[e + --i] * s;
    return s *= 128, o >= s && (o -= Math.pow(2, 8 * t)), o;
  }, "readIntBE");
  d.prototype.readInt8 = a(function(e, t) {
    return e = e >>> 0, t || U(e, 1, this.length), this[e] & 128 ? (255 - this[e] + 1) * -1 : this[e];
  }, "readInt8");
  d.prototype.readInt16LE = a(function(e, t) {
    e = e >>> 0, t || U(
      e,
      2,
      this.length
    );
    let n = this[e] | this[e + 1] << 8;
    return n & 32768 ? n | 4294901760 : n;
  }, "readInt16LE");
  d.prototype.readInt16BE = a(function(e, t) {
    e = e >>> 0, t || U(e, 2, this.length);
    let n = this[e + 1] | this[e] << 8;
    return n & 32768 ? n | 4294901760 : n;
  }, "readInt16BE");
  d.prototype.readInt32LE = a(function(e, t) {
    return e = e >>> 0, t || U(e, 4, this.length), this[e] | this[e + 1] << 8 | this[e + 2] << 16 | this[e + 3] << 24;
  }, "readInt32LE");
  d.prototype.readInt32BE = a(function(e, t) {
    return e = e >>> 0, t || U(e, 4, this.length), this[e] << 24 | this[e + 1] << 16 | this[e + 2] << 8 | this[e + 3];
  }, "readInt32BE");
  d.prototype.readBigInt64LE = be(a(function(e) {
    e = e >>> 0, Le(e, "offset");
    let t = this[e], n = this[e + 7];
    (t === void 0 || n === void 0) && We(e, this.length - 8);
    let i = this[e + 4] + this[e + 5] * 2 ** 8 + this[e + 6] * 2 ** 16 + (n << 24);
    return (BigInt(i) << BigInt(
      32
    )) + BigInt(t + this[++e] * 2 ** 8 + this[++e] * 2 ** 16 + this[++e] * 2 ** 24);
  }, "readBigInt64LE"));
  d.prototype.readBigInt64BE = be(a(function(e) {
    e = e >>> 0, Le(e, "offset");
    let t = this[e], n = this[e + 7];
    (t === void 0 || n === void 0) && We(e, this.length - 8);
    let i = (t << 24) + this[++e] * 2 ** 16 + this[++e] * 2 ** 8 + this[++e];
    return (BigInt(i) << BigInt(32)) + BigInt(
      this[++e] * 2 ** 24 + this[++e] * 2 ** 16 + this[++e] * 2 ** 8 + n
    );
  }, "readBigInt64BE"));
  d.prototype.readFloatLE = a(function(e, t) {
    return e = e >>> 0, t || U(e, 4, this.length), Re.read(this, e, true, 23, 4);
  }, "readFloatLE");
  d.prototype.readFloatBE = a(function(e, t) {
    return e = e >>> 0, t || U(e, 4, this.length), Re.read(this, e, false, 23, 4);
  }, "readFloatBE");
  d.prototype.readDoubleLE = a(function(e, t) {
    return e = e >>> 0, t || U(e, 8, this.length), Re.read(this, e, true, 52, 8);
  }, "readDoubleLE");
  d.prototype.readDoubleBE = a(function(e, t) {
    return e = e >>> 0, t || U(e, 8, this.length), Re.read(
      this,
      e,
      false,
      52,
      8
    );
  }, "readDoubleBE");
  function z(r, e, t, n, i, s) {
    if (!d.isBuffer(r)) throw new TypeError('"buffer" argument must be a Buffer instance');
    if (e > i || e < s) throw new RangeError('"value" argument is out of bounds');
    if (t + n > r.length) throw new RangeError("Index out of range");
  }
  a(z, "checkInt");
  d.prototype.writeUintLE = d.prototype.writeUIntLE = a(function(e, t, n, i) {
    if (e = +e, t = t >>> 0, n = n >>> 0, !i) {
      let u = Math.pow(2, 8 * n) - 1;
      z(
        this,
        e,
        t,
        n,
        u,
        0
      );
    }
    let s = 1, o = 0;
    for (this[t] = e & 255; ++o < n && (s *= 256); ) this[t + o] = e / s & 255;
    return t + n;
  }, "writeUIntLE");
  d.prototype.writeUintBE = d.prototype.writeUIntBE = a(function(e, t, n, i) {
    if (e = +e, t = t >>> 0, n = n >>> 0, !i) {
      let u = Math.pow(2, 8 * n) - 1;
      z(this, e, t, n, u, 0);
    }
    let s = n - 1, o = 1;
    for (this[t + s] = e & 255; --s >= 0 && (o *= 256); ) this[t + s] = e / o & 255;
    return t + n;
  }, "writeUIntBE");
  d.prototype.writeUint8 = d.prototype.writeUInt8 = a(function(e, t, n) {
    return e = +e, t = t >>> 0, n || z(this, e, t, 1, 255, 0), this[t] = e & 255, t + 1;
  }, "writeUInt8");
  d.prototype.writeUint16LE = d.prototype.writeUInt16LE = a(function(e, t, n) {
    return e = +e, t = t >>> 0, n || z(this, e, t, 2, 65535, 0), this[t] = e & 255, this[t + 1] = e >>> 8, t + 2;
  }, "writeUInt16LE");
  d.prototype.writeUint16BE = d.prototype.writeUInt16BE = a(function(e, t, n) {
    return e = +e, t = t >>> 0, n || z(this, e, t, 2, 65535, 0), this[t] = e >>> 8, this[t + 1] = e & 255, t + 2;
  }, "writeUInt16BE");
  d.prototype.writeUint32LE = d.prototype.writeUInt32LE = a(function(e, t, n) {
    return e = +e, t = t >>> 0, n || z(
      this,
      e,
      t,
      4,
      4294967295,
      0
    ), this[t + 3] = e >>> 24, this[t + 2] = e >>> 16, this[t + 1] = e >>> 8, this[t] = e & 255, t + 4;
  }, "writeUInt32LE");
  d.prototype.writeUint32BE = d.prototype.writeUInt32BE = a(function(e, t, n) {
    return e = +e, t = t >>> 0, n || z(
      this,
      e,
      t,
      4,
      4294967295,
      0
    ), this[t] = e >>> 24, this[t + 1] = e >>> 16, this[t + 2] = e >>> 8, this[t + 3] = e & 255, t + 4;
  }, "writeUInt32BE");
  function Xn(r, e, t, n, i) {
    ii(e, n, i, r, t, 7);
    let s = Number(e & BigInt(4294967295));
    r[t++] = s, s = s >> 8, r[t++] = s, s = s >> 8, r[t++] = s, s = s >> 8, r[t++] = s;
    let o = Number(e >> BigInt(32) & BigInt(4294967295));
    return r[t++] = o, o = o >> 8, r[t++] = o, o = o >> 8, r[t++] = o, o = o >> 8, r[t++] = o, t;
  }
  a(Xn, "wrtBigUInt64LE");
  function ei(r, e, t, n, i) {
    ii(e, n, i, r, t, 7);
    let s = Number(e & BigInt(4294967295));
    r[t + 7] = s, s = s >> 8, r[t + 6] = s, s = s >> 8, r[t + 5] = s, s = s >> 8, r[t + 4] = s;
    let o = Number(e >> BigInt(32) & BigInt(4294967295));
    return r[t + 3] = o, o = o >> 8, r[t + 2] = o, o = o >> 8, r[t + 1] = o, o = o >> 8, r[t] = o, t + 8;
  }
  a(ei, "wrtBigUInt64BE");
  d.prototype.writeBigUInt64LE = be(a(function(e, t = 0) {
    return Xn(this, e, t, BigInt(0), BigInt("0xffffffffffffffff"));
  }, "writeBigUInt64LE"));
  d.prototype.writeBigUInt64BE = be(a(function(e, t = 0) {
    return ei(this, e, t, BigInt(0), BigInt(
      "0xffffffffffffffff"
    ));
  }, "writeBigUInt64BE"));
  d.prototype.writeIntLE = a(function(e, t, n, i) {
    if (e = +e, t = t >>> 0, !i) {
      let c = Math.pow(2, 8 * n - 1);
      z(this, e, t, n, c - 1, -c);
    }
    let s = 0, o = 1, u = 0;
    for (this[t] = e & 255; ++s < n && (o *= 256); )
      e < 0 && u === 0 && this[t + s - 1] !== 0 && (u = 1), this[t + s] = (e / o >> 0) - u & 255;
    return t + n;
  }, "writeIntLE");
  d.prototype.writeIntBE = a(function(e, t, n, i) {
    if (e = +e, t = t >>> 0, !i) {
      let c = Math.pow(2, 8 * n - 1);
      z(this, e, t, n, c - 1, -c);
    }
    let s = n - 1, o = 1, u = 0;
    for (this[t + s] = e & 255; --s >= 0 && (o *= 256); ) e < 0 && u === 0 && this[t + s + 1] !== 0 && (u = 1), this[t + s] = (e / o >> 0) - u & 255;
    return t + n;
  }, "writeIntBE");
  d.prototype.writeInt8 = a(function(e, t, n) {
    return e = +e, t = t >>> 0, n || z(this, e, t, 1, 127, -128), e < 0 && (e = 255 + e + 1), this[t] = e & 255, t + 1;
  }, "writeInt8");
  d.prototype.writeInt16LE = a(function(e, t, n) {
    return e = +e, t = t >>> 0, n || z(this, e, t, 2, 32767, -32768), this[t] = e & 255, this[t + 1] = e >>> 8, t + 2;
  }, "writeInt16LE");
  d.prototype.writeInt16BE = a(function(e, t, n) {
    return e = +e, t = t >>> 0, n || z(this, e, t, 2, 32767, -32768), this[t] = e >>> 8, this[t + 1] = e & 255, t + 2;
  }, "writeInt16BE");
  d.prototype.writeInt32LE = a(function(e, t, n) {
    return e = +e, t = t >>> 0, n || z(
      this,
      e,
      t,
      4,
      2147483647,
      -2147483648
    ), this[t] = e & 255, this[t + 1] = e >>> 8, this[t + 2] = e >>> 16, this[t + 3] = e >>> 24, t + 4;
  }, "writeInt32LE");
  d.prototype.writeInt32BE = a(function(e, t, n) {
    return e = +e, t = t >>> 0, n || z(
      this,
      e,
      t,
      4,
      2147483647,
      -2147483648
    ), e < 0 && (e = 4294967295 + e + 1), this[t] = e >>> 24, this[t + 1] = e >>> 16, this[t + 2] = e >>> 8, this[t + 3] = e & 255, t + 4;
  }, "writeInt32BE");
  d.prototype.writeBigInt64LE = be(a(function(e, t = 0) {
    return Xn(this, e, t, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
  }, "writeBigInt64LE"));
  d.prototype.writeBigInt64BE = be(
    a(function(e, t = 0) {
      return ei(this, e, t, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    }, "writeBigInt64BE")
  );
  function ti(r, e, t, n, i, s) {
    if (t + n > r.length) throw new RangeError("Index out of range");
    if (t < 0) throw new RangeError("Index out of range");
  }
  a(ti, "checkIEEE754");
  function ri(r, e, t, n, i) {
    return e = +e, t = t >>> 0, i || ti(r, e, t, 4, 34028234663852886e22, -34028234663852886e22), Re.write(r, e, t, n, 23, 4), t + 4;
  }
  a(
    ri,
    "writeFloat"
  );
  d.prototype.writeFloatLE = a(function(e, t, n) {
    return ri(this, e, t, true, n);
  }, "writeFloatLE");
  d.prototype.writeFloatBE = a(function(e, t, n) {
    return ri(this, e, t, false, n);
  }, "writeFloatBE");
  function ni(r, e, t, n, i) {
    return e = +e, t = t >>> 0, i || ti(r, e, t, 8, 17976931348623157e292, -17976931348623157e292), Re.write(
      r,
      e,
      t,
      n,
      52,
      8
    ), t + 8;
  }
  a(ni, "writeDouble");
  d.prototype.writeDoubleLE = a(function(e, t, n) {
    return ni(this, e, t, true, n);
  }, "writeDoubleLE");
  d.prototype.writeDoubleBE = a(function(e, t, n) {
    return ni(this, e, t, false, n);
  }, "writeDoubleBE");
  d.prototype.copy = a(function(e, t, n, i) {
    if (!d.isBuffer(e)) throw new TypeError("argument should be a Buffer");
    if (n || (n = 0), !i && i !== 0 && (i = this.length), t >= e.length && (t = e.length), t || (t = 0), i > 0 && i < n && (i = n), i === n || e.length === 0 || this.length === 0) return 0;
    if (t < 0) throw new RangeError("targetStart out of bounds");
    if (n < 0 || n >= this.length) throw new RangeError("Index out of range");
    if (i < 0) throw new RangeError("sourceEnd out of bounds");
    i > this.length && (i = this.length), e.length - t < i - n && (i = e.length - t + n);
    let s = i - n;
    return this === e && typeof Uint8Array.prototype.copyWithin == "function" ? this.copyWithin(t, n, i) : Uint8Array.prototype.set.call(e, this.subarray(n, i), t), s;
  }, "copy");
  d.prototype.fill = a(function(e, t, n, i) {
    if (typeof e == "string") {
      if (typeof t == "string" ? (i = t, t = 0, n = this.length) : typeof n == "string" && (i = n, n = this.length), i !== void 0 && typeof i != "string") throw new TypeError("encoding must be a string");
      if (typeof i == "string" && !d.isEncoding(i)) throw new TypeError(
        "Unknown encoding: " + i
      );
      if (e.length === 1) {
        let o = e.charCodeAt(0);
        (i === "utf8" && o < 128 || i === "latin1") && (e = o);
      }
    } else typeof e == "number" ? e = e & 255 : typeof e == "boolean" && (e = Number(e));
    if (t < 0 || this.length < t || this.length < n) throw new RangeError("Out of range index");
    if (n <= t) return this;
    t = t >>> 0, n = n === void 0 ? this.length : n >>> 0, e || (e = 0);
    let s;
    if (typeof e == "number") for (s = t; s < n; ++s) this[s] = e;
    else {
      let o = d.isBuffer(e) ? e : d.from(
        e,
        i
      ), u = o.length;
      if (u === 0) throw new TypeError('The value "' + e + '" is invalid for argument "value"');
      for (s = 0; s < n - t; ++s) this[s + t] = o[s % u];
    }
    return this;
  }, "fill");
  var Pe = {};
  function zt(r, e, t) {
    var n;
    Pe[r] = (n = class extends t {
      constructor() {
        super(), Object.defineProperty(this, "message", { value: e.apply(this, arguments), writable: true, configurable: true }), this.name = `${this.name} [${r}]`, this.stack, delete this.name;
      }
      get code() {
        return r;
      }
      set code(s) {
        Object.defineProperty(
          this,
          "code",
          { configurable: true, enumerable: true, value: s, writable: true }
        );
      }
      toString() {
        return `${this.name} [${r}]: ${this.message}`;
      }
    }, a(n, "NodeError"), n);
  }
  a(zt, "E");
  zt("ERR_BUFFER_OUT_OF_BOUNDS", function(r) {
    return r ? `${r} is outside of buffer bounds` : "Attempt to access memory outside buffer bounds";
  }, RangeError);
  zt(
    "ERR_INVALID_ARG_TYPE",
    function(r, e) {
      return `The "${r}" argument must be of type number. Received type ${typeof e}`;
    },
    TypeError
  );
  zt("ERR_OUT_OF_RANGE", function(r, e, t) {
    let n = `The value of "${r}" is out of range.`, i = t;
    return Number.isInteger(t) && Math.abs(t) > 2 ** 32 ? i = Vn(String(t)) : typeof t == "bigint" && (i = String(
      t
    ), (t > BigInt(2) ** BigInt(32) || t < -(BigInt(2) ** BigInt(32))) && (i = Vn(i)), i += "n"), n += ` It must be ${e}. Received ${i}`, n;
  }, RangeError);
  function Vn(r) {
    let e = "", t = r.length, n = r[0] === "-" ? 1 : 0;
    for (; t >= n + 4; t -= 3) e = `_${r.slice(t - 3, t)}${e}`;
    return `${r.slice(0, t)}${e}`;
  }
  a(Vn, "addNumericalSeparator");
  function oa(r, e, t) {
    Le(e, "offset"), (r[e] === void 0 || r[e + t] === void 0) && We(e, r.length - (t + 1));
  }
  a(oa, "checkBounds");
  function ii(r, e, t, n, i, s) {
    if (r > t || r < e) {
      let o = typeof e == "bigint" ? "n" : "", u;
      throw s > 3 ? e === 0 || e === BigInt(0) ? u = `>= 0${o} and < 2${o} ** ${(s + 1) * 8}${o}` : u = `>= -(2${o} ** ${(s + 1) * 8 - 1}${o}) and < 2 ** ${(s + 1) * 8 - 1}${o}` : u = `>= ${e}${o} and <= ${t}${o}`, new Pe.ERR_OUT_OF_RANGE("value", u, r);
    }
    oa(n, i, s);
  }
  a(ii, "checkIntBI");
  function Le(r, e) {
    if (typeof r != "number") throw new Pe.ERR_INVALID_ARG_TYPE(e, "number", r);
  }
  a(Le, "validateNumber");
  function We(r, e, t) {
    throw Math.floor(r) !== r ? (Le(r, t), new Pe.ERR_OUT_OF_RANGE(t || "offset", "an integer", r)) : e < 0 ? new Pe.ERR_BUFFER_OUT_OF_BOUNDS() : new Pe.ERR_OUT_OF_RANGE(t || "offset", `>= ${t ? 1 : 0} and <= ${e}`, r);
  }
  a(We, "boundsError");
  var aa = /[^+/0-9A-Za-z-_]/g;
  function ua(r) {
    if (r = r.split("=")[0], r = r.trim().replace(aa, ""), r.length < 2) return "";
    for (; r.length % 4 !== 0; ) r = r + "=";
    return r;
  }
  a(ua, "base64clean");
  function $t(r, e) {
    e = e || 1 / 0;
    let t, n = r.length, i = null, s = [];
    for (let o = 0; o < n; ++o) {
      if (t = r.charCodeAt(o), t > 55295 && t < 57344) {
        if (!i) {
          if (t > 56319) {
            (e -= 3) > -1 && s.push(239, 191, 189);
            continue;
          } else if (o + 1 === n) {
            (e -= 3) > -1 && s.push(239, 191, 189);
            continue;
          }
          i = t;
          continue;
        }
        if (t < 56320) {
          (e -= 3) > -1 && s.push(239, 191, 189), i = t;
          continue;
        }
        t = (i - 55296 << 10 | t - 56320) + 65536;
      } else i && (e -= 3) > -1 && s.push(239, 191, 189);
      if (i = null, t < 128) {
        if ((e -= 1) < 0) break;
        s.push(t);
      } else if (t < 2048) {
        if ((e -= 2) < 0) break;
        s.push(t >> 6 | 192, t & 63 | 128);
      } else if (t < 65536) {
        if ((e -= 3) < 0) break;
        s.push(t >> 12 | 224, t >> 6 & 63 | 128, t & 63 | 128);
      } else if (t < 1114112) {
        if ((e -= 4) < 0) break;
        s.push(t >> 18 | 240, t >> 12 & 63 | 128, t >> 6 & 63 | 128, t & 63 | 128);
      } else throw new Error("Invalid code point");
    }
    return s;
  }
  a($t, "utf8ToBytes");
  function ca(r) {
    let e = [];
    for (let t = 0; t < r.length; ++t) e.push(r.charCodeAt(t) & 255);
    return e;
  }
  a(
    ca,
    "asciiToBytes"
  );
  function la(r, e) {
    let t, n, i, s = [];
    for (let o = 0; o < r.length && !((e -= 2) < 0); ++o) t = r.charCodeAt(
      o
    ), n = t >> 8, i = t % 256, s.push(i), s.push(n);
    return s;
  }
  a(la, "utf16leToBytes");
  function si(r) {
    return Wt.toByteArray(
      ua(r)
    );
  }
  a(si, "base64ToBytes");
  function ht(r, e, t, n) {
    let i;
    for (i = 0; i < n && !(i + t >= e.length || i >= r.length); ++i)
      e[i + t] = r[i];
    return i;
  }
  a(ht, "blitBuffer");
  function fe(r, e) {
    return r instanceof e || r != null && r.constructor != null && r.constructor.name != null && r.constructor.name === e.name;
  }
  a(fe, "isInstance");
  function Kt(r) {
    return r !== r;
  }
  a(Kt, "numberIsNaN");
  var fa = (function() {
    let r = "0123456789abcdef", e = new Array(256);
    for (let t = 0; t < 16; ++t) {
      let n = t * 16;
      for (let i = 0; i < 16; ++i) e[n + i] = r[t] + r[i];
    }
    return e;
  })();
  function be(r) {
    return typeof BigInt > "u" ? ha : r;
  }
  a(be, "defineBigIntMethod");
  function ha() {
    throw new Error("BigInt not supported");
  }
  a(ha, "BufferBigIntNotDefined");
});
var b;
var x;
var v;
var p;
var y;
var h = V(() => {
  "use strict";
  b = globalThis, x = globalThis.setImmediate ?? ((r) => setTimeout(r, 0)), v = globalThis.clearImmediate ?? ((r) => clearTimeout(r)), p = typeof globalThis.Buffer == "function" && typeof globalThis.Buffer.allocUnsafe == "function" ? globalThis.Buffer : oi().Buffer, y = globalThis.process ?? {};
  y.env ?? (y.env = {});
  try {
    y.nextTick(() => {
    });
  } catch {
    let e = Promise.resolve();
    y.nextTick = e.then.bind(e);
  }
});
var ve = T((Ef, Xt) => {
  "use strict";
  h();
  var Fe = typeof Reflect == "object" ? Reflect : null, mi = Fe && typeof Fe.apply == "function" ? Fe.apply : a(function(e, t, n) {
    return Function.prototype.apply.call(e, t, n);
  }, "ReflectApply"), bt;
  Fe && typeof Fe.ownKeys == "function" ? bt = Fe.ownKeys : Object.getOwnPropertySymbols ? bt = a(function(e) {
    return Object.getOwnPropertyNames(e).concat(Object.getOwnPropertySymbols(e));
  }, "ReflectOwnKeys") : bt = a(function(e) {
    return Object.getOwnPropertyNames(e);
  }, "ReflectOwnKeys");
  function Ia(r) {
    console && console.warn && console.warn(r);
  }
  a(
    Ia,
    "ProcessEmitWarning"
  );
  var wi = Number.isNaN || a(function(e) {
    return e !== e;
  }, "NumberIsNaN");
  function P() {
    P.init.call(this);
  }
  a(P, "EventEmitter");
  Xt.exports = P;
  Xt.exports.once = Ba;
  P.EventEmitter = P;
  P.prototype._events = void 0;
  P.prototype._eventsCount = 0;
  P.prototype._maxListeners = void 0;
  var gi = 10;
  function xt(r) {
    if (typeof r != "function") throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof r);
  }
  a(xt, "checkListener");
  Object.defineProperty(P, "defaultMaxListeners", { enumerable: true, get: a(function() {
    return gi;
  }, "get"), set: a(
    function(r) {
      if (typeof r != "number" || r < 0 || wi(r)) throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + r + ".");
      gi = r;
    },
    "set"
  ) });
  P.init = function() {
    (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) && (this._events = /* @__PURE__ */ Object.create(null), this._eventsCount = 0), this._maxListeners = this._maxListeners || void 0;
  };
  P.prototype.setMaxListeners = a(function(e) {
    if (typeof e != "number" || e < 0 || wi(e)) throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + e + ".");
    return this._maxListeners = e, this;
  }, "setMaxListeners");
  function bi(r) {
    return r._maxListeners === void 0 ? P.defaultMaxListeners : r._maxListeners;
  }
  a(bi, "_getMaxListeners");
  P.prototype.getMaxListeners = a(function() {
    return bi(this);
  }, "getMaxListeners");
  P.prototype.emit = a(function(e) {
    for (var t = [], n = 1; n < arguments.length; n++) t.push(arguments[n]);
    var i = e === "error", s = this._events;
    if (s !== void 0) i = i && s.error === void 0;
    else if (!i) return false;
    if (i) {
      var o;
      if (t.length > 0 && (o = t[0]), o instanceof Error) throw o;
      var u = new Error("Unhandled error." + (o ? " (" + o.message + ")" : ""));
      throw u.context = o, u;
    }
    var c = s[e];
    if (c === void 0) return false;
    if (typeof c == "function") mi(c, this, t);
    else for (var l = c.length, f = Ai(c, l), n = 0; n < l; ++n) mi(f[n], this, t);
    return true;
  }, "emit");
  function xi(r, e, t, n) {
    var i, s, o;
    if (xt(
      t
    ), s = r._events, s === void 0 ? (s = r._events = /* @__PURE__ */ Object.create(null), r._eventsCount = 0) : (s.newListener !== void 0 && (r.emit("newListener", e, t.listener ? t.listener : t), s = r._events), o = s[e]), o === void 0) o = s[e] = t, ++r._eventsCount;
    else if (typeof o == "function" ? o = s[e] = n ? [t, o] : [o, t] : n ? o.unshift(t) : o.push(t), i = bi(r), i > 0 && o.length > i && !o.warned) {
      o.warned = true;
      var u = new Error("Possible EventEmitter memory leak detected. " + o.length + " " + String(e) + " listeners added. Use emitter.setMaxListeners() to increase limit");
      u.name = "MaxListenersExceededWarning", u.emitter = r, u.type = e, u.count = o.length, Ia(u);
    }
    return r;
  }
  a(xi, "_addListener");
  P.prototype.addListener = a(function(e, t) {
    return xi(this, e, t, false);
  }, "addListener");
  P.prototype.on = P.prototype.addListener;
  P.prototype.prependListener = a(function(e, t) {
    return xi(this, e, t, true);
  }, "prependListener");
  function Pa() {
    if (!this.fired) return this.target.removeListener(this.type, this.wrapFn), this.fired = true, arguments.length === 0 ? this.listener.call(this.target) : this.listener.apply(this.target, arguments);
  }
  a(Pa, "onceWrapper");
  function vi(r, e, t) {
    var n = {
      fired: false,
      wrapFn: void 0,
      target: r,
      type: e,
      listener: t
    }, i = Pa.bind(n);
    return i.listener = t, n.wrapFn = i, i;
  }
  a(vi, "_onceWrap");
  P.prototype.once = a(function(e, t) {
    return xt(t), this.on(e, vi(this, e, t)), this;
  }, "once");
  P.prototype.prependOnceListener = a(function(e, t) {
    return xt(t), this.prependListener(e, vi(this, e, t)), this;
  }, "prependOnceListener");
  P.prototype.removeListener = a(function(e, t) {
    var n, i, s, o, u;
    if (xt(t), i = this._events, i === void 0) return this;
    if (n = i[e], n === void 0) return this;
    if (n === t || n.listener === t) --this._eventsCount === 0 ? this._events = /* @__PURE__ */ Object.create(null) : (delete i[e], i.removeListener && this.emit("removeListener", e, n.listener || t));
    else if (typeof n != "function") {
      for (s = -1, o = n.length - 1; o >= 0; o--) if (n[o] === t || n[o].listener === t) {
        u = n[o].listener, s = o;
        break;
      }
      if (s < 0) return this;
      s === 0 ? n.shift() : Ra(n, s), n.length === 1 && (i[e] = n[0]), i.removeListener !== void 0 && this.emit("removeListener", e, u || t);
    }
    return this;
  }, "removeListener");
  P.prototype.off = P.prototype.removeListener;
  P.prototype.removeAllListeners = a(function(e) {
    var t, n, i;
    if (n = this._events, n === void 0) return this;
    if (n.removeListener === void 0) return arguments.length === 0 ? (this._events = /* @__PURE__ */ Object.create(null), this._eventsCount = 0) : n[e] !== void 0 && (--this._eventsCount === 0 ? this._events = /* @__PURE__ */ Object.create(null) : delete n[e]), this;
    if (arguments.length === 0) {
      var s = Object.keys(n), o;
      for (i = 0; i < s.length; ++i) o = s[i], o !== "removeListener" && this.removeAllListeners(
        o
      );
      return this.removeAllListeners("removeListener"), this._events = /* @__PURE__ */ Object.create(null), this._eventsCount = 0, this;
    }
    if (t = n[e], typeof t == "function") this.removeListener(e, t);
    else if (t !== void 0) for (i = t.length - 1; i >= 0; i--) this.removeListener(e, t[i]);
    return this;
  }, "removeAllListeners");
  function Si(r, e, t) {
    var n = r._events;
    if (n === void 0) return [];
    var i = n[e];
    return i === void 0 ? [] : typeof i == "function" ? t ? [i.listener || i] : [i] : t ? La(i) : Ai(i, i.length);
  }
  a(Si, "_listeners");
  P.prototype.listeners = a(function(e) {
    return Si(this, e, true);
  }, "listeners");
  P.prototype.rawListeners = a(function(e) {
    return Si(this, e, false);
  }, "rawListeners");
  P.listenerCount = function(r, e) {
    return typeof r.listenerCount == "function" ? r.listenerCount(e) : Ei.call(r, e);
  };
  P.prototype.listenerCount = Ei;
  function Ei(r) {
    var e = this._events;
    if (e !== void 0) {
      var t = e[r];
      if (typeof t == "function")
        return 1;
      if (t !== void 0) return t.length;
    }
    return 0;
  }
  a(Ei, "listenerCount");
  P.prototype.eventNames = a(function() {
    return this._eventsCount > 0 ? bt(this._events) : [];
  }, "eventNames");
  function Ai(r, e) {
    for (var t = new Array(e), n = 0; n < e; ++n) t[n] = r[n];
    return t;
  }
  a(Ai, "arrayClone");
  function Ra(r, e) {
    for (; e + 1 < r.length; e++) r[e] = r[e + 1];
    r.pop();
  }
  a(Ra, "spliceOne");
  function La(r) {
    for (var e = new Array(r.length), t = 0; t < e.length; ++t) e[t] = r[t].listener || r[t];
    return e;
  }
  a(La, "unwrapListeners");
  function Ba(r, e) {
    return new Promise(function(t, n) {
      function i(o) {
        r.removeListener(e, s), n(o);
      }
      a(i, "errorListener");
      function s() {
        typeof r.removeListener == "function" && r.removeListener("error", i), t([].slice.call(arguments));
      }
      a(s, "resolver"), Ci(r, e, s, { once: true }), e !== "error" && Fa(r, i, { once: true });
    });
  }
  a(Ba, "once");
  function Fa(r, e, t) {
    typeof r.on == "function" && Ci(r, "error", e, t);
  }
  a(
    Fa,
    "addErrorHandlerIfEventEmitter"
  );
  function Ci(r, e, t, n) {
    if (typeof r.on == "function") n.once ? r.once(e, t) : r.on(e, t);
    else if (typeof r.addEventListener == "function") r.addEventListener(e, a(function i(s) {
      n.once && r.removeEventListener(e, i), t(s);
    }, "wrapListener"));
    else throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof r);
  }
  a(Ci, "eventTargetAgnosticAddListener");
});
var Ii = {};
se(Ii, { Socket: () => pe, isIP: () => Ma });
function Ma(r) {
  return 0;
}
var Ti;
var _i;
var A;
var pe;
var Ge = V(() => {
  "use strict";
  h();
  Ti = we(ve(), 1);
  a(Ma, "isIP");
  _i = /^[^.]+\./, A = class A2 extends Ti.EventEmitter {
    constructor() {
      super(...arguments);
      E(this, "opts", {});
      E(this, "connecting", false);
      E(this, "pending", true);
      E(
        this,
        "writable",
        true
      );
      E(this, "encrypted", false);
      E(this, "authorized", false);
      E(this, "destroyed", false);
      E(this, "ws", null);
      E(this, "writeBuffer");
      E(this, "tlsState", 0);
      E(this, "tlsRead");
      E(this, "tlsWrite");
    }
    static get poolQueryViaFetch() {
      return A2.opts.poolQueryViaFetch ?? A2.defaults.poolQueryViaFetch;
    }
    static set poolQueryViaFetch(t) {
      A2.opts.poolQueryViaFetch = t;
    }
    static get fetchEndpoint() {
      return A2.opts.fetchEndpoint ?? A2.defaults.fetchEndpoint;
    }
    static set fetchEndpoint(t) {
      A2.opts.fetchEndpoint = t;
    }
    static get fetchConnectionCache() {
      return true;
    }
    static set fetchConnectionCache(t) {
      console.warn("The `fetchConnectionCache` option is deprecated (now always `true`)");
    }
    static get fetchFunction() {
      return A2.opts.fetchFunction ?? A2.defaults.fetchFunction;
    }
    static set fetchFunction(t) {
      A2.opts.fetchFunction = t;
    }
    static get webSocketConstructor() {
      return A2.opts.webSocketConstructor ?? A2.defaults.webSocketConstructor;
    }
    static set webSocketConstructor(t) {
      A2.opts.webSocketConstructor = t;
    }
    get webSocketConstructor() {
      return this.opts.webSocketConstructor ?? A2.webSocketConstructor;
    }
    set webSocketConstructor(t) {
      this.opts.webSocketConstructor = t;
    }
    static get wsProxy() {
      return A2.opts.wsProxy ?? A2.defaults.wsProxy;
    }
    static set wsProxy(t) {
      A2.opts.wsProxy = t;
    }
    get wsProxy() {
      return this.opts.wsProxy ?? A2.wsProxy;
    }
    set wsProxy(t) {
      this.opts.wsProxy = t;
    }
    static get coalesceWrites() {
      return A2.opts.coalesceWrites ?? A2.defaults.coalesceWrites;
    }
    static set coalesceWrites(t) {
      A2.opts.coalesceWrites = t;
    }
    get coalesceWrites() {
      return this.opts.coalesceWrites ?? A2.coalesceWrites;
    }
    set coalesceWrites(t) {
      this.opts.coalesceWrites = t;
    }
    static get useSecureWebSocket() {
      return A2.opts.useSecureWebSocket ?? A2.defaults.useSecureWebSocket;
    }
    static set useSecureWebSocket(t) {
      A2.opts.useSecureWebSocket = t;
    }
    get useSecureWebSocket() {
      return this.opts.useSecureWebSocket ?? A2.useSecureWebSocket;
    }
    set useSecureWebSocket(t) {
      this.opts.useSecureWebSocket = t;
    }
    static get forceDisablePgSSL() {
      return A2.opts.forceDisablePgSSL ?? A2.defaults.forceDisablePgSSL;
    }
    static set forceDisablePgSSL(t) {
      A2.opts.forceDisablePgSSL = t;
    }
    get forceDisablePgSSL() {
      return this.opts.forceDisablePgSSL ?? A2.forceDisablePgSSL;
    }
    set forceDisablePgSSL(t) {
      this.opts.forceDisablePgSSL = t;
    }
    static get disableSNI() {
      return A2.opts.disableSNI ?? A2.defaults.disableSNI;
    }
    static set disableSNI(t) {
      A2.opts.disableSNI = t;
    }
    get disableSNI() {
      return this.opts.disableSNI ?? A2.disableSNI;
    }
    set disableSNI(t) {
      this.opts.disableSNI = t;
    }
    static get disableWarningInBrowsers() {
      return A2.opts.disableWarningInBrowsers ?? A2.defaults.disableWarningInBrowsers;
    }
    static set disableWarningInBrowsers(t) {
      A2.opts.disableWarningInBrowsers = t;
    }
    get disableWarningInBrowsers() {
      return this.opts.disableWarningInBrowsers ?? A2.disableWarningInBrowsers;
    }
    set disableWarningInBrowsers(t) {
      this.opts.disableWarningInBrowsers = t;
    }
    static get pipelineConnect() {
      return A2.opts.pipelineConnect ?? A2.defaults.pipelineConnect;
    }
    static set pipelineConnect(t) {
      A2.opts.pipelineConnect = t;
    }
    get pipelineConnect() {
      return this.opts.pipelineConnect ?? A2.pipelineConnect;
    }
    set pipelineConnect(t) {
      this.opts.pipelineConnect = t;
    }
    static get subtls() {
      return A2.opts.subtls ?? A2.defaults.subtls;
    }
    static set subtls(t) {
      A2.opts.subtls = t;
    }
    get subtls() {
      return this.opts.subtls ?? A2.subtls;
    }
    set subtls(t) {
      this.opts.subtls = t;
    }
    static get pipelineTLS() {
      return A2.opts.pipelineTLS ?? A2.defaults.pipelineTLS;
    }
    static set pipelineTLS(t) {
      A2.opts.pipelineTLS = t;
    }
    get pipelineTLS() {
      return this.opts.pipelineTLS ?? A2.pipelineTLS;
    }
    set pipelineTLS(t) {
      this.opts.pipelineTLS = t;
    }
    static get rootCerts() {
      return A2.opts.rootCerts ?? A2.defaults.rootCerts;
    }
    static set rootCerts(t) {
      A2.opts.rootCerts = t;
    }
    get rootCerts() {
      return this.opts.rootCerts ?? A2.rootCerts;
    }
    set rootCerts(t) {
      this.opts.rootCerts = t;
    }
    wsProxyAddrForHost(t, n) {
      let i = this.wsProxy;
      if (i === void 0) throw new Error("No WebSocket proxy is configured. Please see https://github.com/neondatabase/serverless/blob/main/CONFIG.md#wsproxy-string--host-string-port-number--string--string");
      return typeof i == "function" ? i(t, n) : `${i}?address=${t}:${n}`;
    }
    setNoDelay() {
      return this;
    }
    setKeepAlive() {
      return this;
    }
    ref() {
      return this;
    }
    unref() {
      return this;
    }
    connect(t, n, i) {
      this.connecting = true, i && this.once("connect", i);
      let s = a(() => {
        this.connecting = false, this.pending = false, this.emit("connect"), this.emit("ready");
      }, "handleWebSocketOpen"), o = a((c, l = false) => {
        c.binaryType = "arraybuffer", c.addEventListener("error", (f) => {
          this.emit("error", f), this.emit("close");
        }), c.addEventListener("message", (f) => {
          if (this.tlsState === 0) {
            let m = p.from(f.data);
            this.emit("data", m);
          }
        }), c.addEventListener("close", () => {
          this.destroyed = true, this.emit("close");
        }), l ? s() : c.addEventListener("open", s);
      }, "configureWebSocket"), u;
      try {
        u = this.wsProxyAddrForHost(n, typeof t == "string" ? parseInt(t, 10) : t);
      } catch (c) {
        this.emit("error", c), this.emit("close");
        return;
      }
      try {
        let l = (this.useSecureWebSocket ? "wss:" : "ws:") + "//" + u;
        if (this.webSocketConstructor !== void 0) this.ws = new this.webSocketConstructor(l), o(this.ws);
        else try {
          this.ws = new WebSocket(l), o(this.ws);
        } catch {
          this.ws = new __unstable_WebSocket(l), o(
            this.ws
          );
        }
      } catch (c) {
        let f = (this.useSecureWebSocket ? "https:" : "http:") + "//" + u;
        fetch(f, { headers: { Upgrade: "websocket" } }).then((m) => {
          if (this.ws = m.webSocket, this.ws == null) throw c;
          this.ws.accept(), o(this.ws, true);
        }).catch((m) => {
          this.emit("error", new Error(`All attempts to open a WebSocket to connect to the database failed. Please refer to https://github.com/neondatabase/serverless/blob/main/CONFIG.md#websocketconstructor-typeof-websocket--undefined. Details: ${m}`)), this.emit("close");
        });
      }
    }
    async startTls(t) {
      if (this.subtls === void 0) throw new Error("For Postgres SSL connections, you must set `neonConfig.subtls` to the subtls library. See https://github.com/neondatabase/serverless/blob/main/CONFIG.md for more information.");
      this.tlsState = 1;
      let n = await this.subtls.TrustedCert.databaseFromPEM(this.rootCerts), i = new this.subtls.WebSocketReadQueue(this.ws), s = i.read.bind(i), o = this.rawWrite.bind(this), { read: u, write: c } = await this.subtls.startTls(t, n, s, o, { useSNI: !this.disableSNI, expectPreData: this.pipelineTLS ? new Uint8Array([83]) : void 0 });
      this.tlsRead = u, this.tlsWrite = c, this.tlsState = 2, this.encrypted = true, this.authorized = true, this.emit(
        "secureConnection",
        this
      ), this.tlsReadLoop().catch((l) => {
        this.destroyed || (this.destroyed = true, this.emit("error", l), this.ws?.close());
      });
    }
    async tlsReadLoop() {
      for (; ; ) {
        let t = await this.tlsRead();
        if (t === void 0) break;
        {
          let n = p.from(t);
          this.emit("data", n);
        }
      }
    }
    rawWrite(t) {
      if (!this.coalesceWrites) {
        this.ws && this.ws.send(t);
        return;
      }
      if (this.writeBuffer === void 0) this.writeBuffer = t, setTimeout(() => {
        this.ws && this.ws.send(this.writeBuffer), this.writeBuffer = void 0;
      }, 0);
      else {
        let n = new Uint8Array(this.writeBuffer.length + t.length);
        n.set(this.writeBuffer), n.set(t, this.writeBuffer.length), this.writeBuffer = n;
      }
    }
    write(t, n = "utf8", i = (s) => {
    }) {
      return t.length === 0 ? (i(), true) : (typeof t == "string" && (t = p.from(t, n)), this.tlsState === 0 ? (this.rawWrite(t), i()) : this.tlsState === 1 ? this.once("secureConnection", () => {
        this.write(t, n, i);
      }) : (this.tlsWrite(t), i()), true);
    }
    end(t = p.alloc(0), n = "utf8", i = () => {
    }) {
      return this.write(t, n, () => {
        this.ws?.close(), i();
      }), this;
    }
    destroy() {
      return this.destroyed = true, this.end();
    }
  };
  a(A, "Socket"), E(A, "defaults", {
    poolQueryViaFetch: false,
    fetchEndpoint: a((t, n, i) => {
      let s;
      return i?.jwtAuth ? s = t.replace(_i, "apiauth.") : s = t.replace(_i, "api."), "https://" + s + "/sql";
    }, "fetchEndpoint"),
    fetchConnectionCache: true,
    fetchFunction: void 0,
    webSocketConstructor: void 0,
    wsProxy: a((t) => t + "/v2", "wsProxy"),
    useSecureWebSocket: true,
    forceDisablePgSSL: true,
    coalesceWrites: true,
    pipelineConnect: "password",
    subtls: void 0,
    rootCerts: "",
    pipelineTLS: false,
    disableSNI: false,
    disableWarningInBrowsers: false
  }), E(A, "opts", {});
  pe = A;
});
var tr = T((Pi) => {
  "use strict";
  h();
  Pi.parse = function(r, e) {
    return new er(r, e).parse();
  };
  var St = class St2 {
    constructor(e, t) {
      this.source = e, this.transform = t || ka, this.position = 0, this.entries = [], this.recorded = [], this.dimension = 0;
    }
    isEof() {
      return this.position >= this.source.length;
    }
    nextCharacter() {
      var e = this.source[this.position++];
      return e === "\\" ? { value: this.source[this.position++], escaped: true } : { value: e, escaped: false };
    }
    record(e) {
      this.recorded.push(
        e
      );
    }
    newEntry(e) {
      var t;
      (this.recorded.length > 0 || e) && (t = this.recorded.join(""), t === "NULL" && !e && (t = null), t !== null && (t = this.transform(t)), this.entries.push(t), this.recorded = []);
    }
    consumeDimensions() {
      if (this.source[0] === "[") for (; !this.isEof(); ) {
        var e = this.nextCharacter();
        if (e.value === "=") break;
      }
    }
    parse(e) {
      var t, n, i;
      for (this.consumeDimensions(); !this.isEof(); ) if (t = this.nextCharacter(), t.value === "{" && !i) this.dimension++, this.dimension > 1 && (n = new St2(this.source.substr(this.position - 1), this.transform), this.entries.push(n.parse(
        true
      )), this.position += n.position - 2);
      else if (t.value === "}" && !i) {
        if (this.dimension--, !this.dimension && (this.newEntry(), e)) return this.entries;
      } else t.value === '"' && !t.escaped ? (i && this.newEntry(true), i = !i) : t.value === "," && !i ? this.newEntry() : this.record(t.value);
      if (this.dimension !== 0) throw new Error("array dimension not balanced");
      return this.entries;
    }
  };
  a(St, "ArrayParser");
  var er = St;
  function ka(r) {
    return r;
  }
  a(ka, "identity");
});
var rr = T((Ff, Ri) => {
  h();
  var Oa = tr();
  Ri.exports = { create: a(function(r, e) {
    return { parse: a(function() {
      return Oa.parse(r, e);
    }, "parse") };
  }, "create") };
});
var Fi = T((Of, Bi) => {
  "use strict";
  h();
  var Ua = /(\d{1,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,})?.*?( BC)?$/, Qa = /^(\d{1,})-(\d{2})-(\d{2})( BC)?$/, Da = /([Z+-])(\d{2})?:?(\d{2})?:?(\d{2})?/, qa = /^-?infinity$/;
  Bi.exports = a(function(e) {
    if (qa.test(e)) return Number(e.replace("i", "I"));
    var t = Ua.exec(e);
    if (!t) return Na(
      e
    ) || null;
    var n = !!t[8], i = parseInt(t[1], 10);
    n && (i = Li(i));
    var s = parseInt(t[2], 10) - 1, o = t[3], u = parseInt(
      t[4],
      10
    ), c = parseInt(t[5], 10), l = parseInt(t[6], 10), f = t[7];
    f = f ? 1e3 * parseFloat(f) : 0;
    var m, g = Wa(e);
    return g != null ? (m = new Date(Date.UTC(i, s, o, u, c, l, f)), nr(i) && m.setUTCFullYear(i), g !== 0 && m.setTime(m.getTime() - g)) : (m = new Date(i, s, o, u, c, l, f), nr(i) && m.setFullYear(i)), m;
  }, "parseDate");
  function Na(r) {
    var e = Qa.exec(r);
    if (e) {
      var t = parseInt(e[1], 10), n = !!e[4];
      n && (t = Li(t));
      var i = parseInt(e[2], 10) - 1, s = e[3], o = new Date(t, i, s);
      return nr(
        t
      ) && o.setFullYear(t), o;
    }
  }
  a(Na, "getDate");
  function Wa(r) {
    if (r.endsWith("+00")) return 0;
    var e = Da.exec(r.split(" ")[1]);
    if (e) {
      var t = e[1];
      if (t === "Z") return 0;
      var n = t === "-" ? -1 : 1, i = parseInt(e[2], 10) * 3600 + parseInt(
        e[3] || 0,
        10
      ) * 60 + parseInt(e[4] || 0, 10);
      return i * n * 1e3;
    }
  }
  a(Wa, "timeZoneOffset");
  function Li(r) {
    return -(r - 1);
  }
  a(Li, "bcYearToNegativeYear");
  function nr(r) {
    return r >= 0 && r < 100;
  }
  a(nr, "is0To99");
});
var ki = T((Df, Mi) => {
  h();
  Mi.exports = Ha;
  var ja = Object.prototype.hasOwnProperty;
  function Ha(r) {
    for (var e = 1; e < arguments.length; e++) {
      var t = arguments[e];
      for (var n in t) ja.call(t, n) && (r[n] = t[n]);
    }
    return r;
  }
  a(Ha, "extend");
});
var Qi = T((Wf, Ui) => {
  "use strict";
  h();
  var $a = ki();
  Ui.exports = Me;
  function Me(r) {
    if (!(this instanceof Me))
      return new Me(r);
    $a(this, nu(r));
  }
  a(Me, "PostgresInterval");
  var Ga = [
    "seconds",
    "minutes",
    "hours",
    "days",
    "months",
    "years"
  ];
  Me.prototype.toPostgres = function() {
    var r = Ga.filter(this.hasOwnProperty, this);
    return this.milliseconds && r.indexOf("seconds") < 0 && r.push("seconds"), r.length === 0 ? "0" : r.map(function(e) {
      var t = this[e] || 0;
      return e === "seconds" && this.milliseconds && (t = (t + this.milliseconds / 1e3).toFixed(6).replace(
        /\.?0+$/,
        ""
      )), t + " " + e;
    }, this).join(" ");
  };
  var Va = { years: "Y", months: "M", days: "D", hours: "H", minutes: "M", seconds: "S" }, za = ["years", "months", "days"], Ka = ["hours", "minutes", "seconds"];
  Me.prototype.toISOString = Me.prototype.toISO = function() {
    var r = za.map(t, this).join(""), e = Ka.map(t, this).join("");
    return "P" + r + "T" + e;
    function t(n) {
      var i = this[n] || 0;
      return n === "seconds" && this.milliseconds && (i = (i + this.milliseconds / 1e3).toFixed(6).replace(
        /0+$/,
        ""
      )), i + Va[n];
    }
  };
  var ir = "([+-]?\\d+)", Ya = ir + "\\s+years?", Za = ir + "\\s+mons?", Ja = ir + "\\s+days?", Xa = "([+-])?([\\d]*):(\\d\\d):(\\d\\d)\\.?(\\d{1,6})?", eu = new RegExp([Ya, Za, Ja, Xa].map(function(r) {
    return "(" + r + ")?";
  }).join("\\s*")), Oi = { years: 2, months: 4, days: 6, hours: 9, minutes: 10, seconds: 11, milliseconds: 12 }, tu = ["hours", "minutes", "seconds", "milliseconds"];
  function ru(r) {
    var e = r + "000000".slice(r.length);
    return parseInt(
      e,
      10
    ) / 1e3;
  }
  a(ru, "parseMilliseconds");
  function nu(r) {
    if (!r) return {};
    var e = eu.exec(r), t = e[8] === "-";
    return Object.keys(Oi).reduce(function(n, i) {
      var s = Oi[i], o = e[s];
      return !o || (o = i === "milliseconds" ? ru(o) : parseInt(o, 10), !o) || (t && ~tu.indexOf(i) && (o *= -1), n[i] = o), n;
    }, {});
  }
  a(nu, "parse");
});
var Ni = T(($f, qi) => {
  "use strict";
  h();
  var Di = p.from || p;
  qi.exports = a(function(e) {
    if (/^\\x/.test(e)) return Di(
      e.substr(2),
      "hex"
    );
    for (var t = "", n = 0; n < e.length; ) if (e[n] !== "\\") t += e[n], ++n;
    else if (/[0-7]{3}/.test(e.substr(n + 1, 3))) t += String.fromCharCode(parseInt(e.substr(n + 1, 3), 8)), n += 4;
    else {
      for (var i = 1; n + i < e.length && e[n + i] === "\\"; ) i++;
      for (var s = 0; s < Math.floor(i / 2); ++s) t += "\\";
      n += Math.floor(i / 2) * 2;
    }
    return Di(t, "binary");
  }, "parseBytea");
});
var zi = T((zf, Vi) => {
  h();
  var Ve = tr(), ze = rr(), Et = Fi(), ji = Qi(), Hi = Ni();
  function At(r) {
    return a(function(t) {
      return t === null ? t : r(t);
    }, "nullAllowed");
  }
  a(At, "allowNull");
  function $i(r) {
    return r === null ? r : r === "TRUE" || r === "t" || r === "true" || r === "y" || r === "yes" || r === "on" || r === "1";
  }
  a($i, "parseBool");
  function iu(r) {
    return r ? Ve.parse(r, $i) : null;
  }
  a(iu, "parseBoolArray");
  function su(r) {
    return parseInt(r, 10);
  }
  a(su, "parseBaseTenInt");
  function sr(r) {
    return r ? Ve.parse(r, At(su)) : null;
  }
  a(sr, "parseIntegerArray");
  function ou(r) {
    return r ? Ve.parse(r, At(function(e) {
      return Gi(e).trim();
    })) : null;
  }
  a(ou, "parseBigIntegerArray");
  var au = a(function(r) {
    if (!r) return null;
    var e = ze.create(r, function(t) {
      return t !== null && (t = cr(t)), t;
    });
    return e.parse();
  }, "parsePointArray"), or = a(function(r) {
    if (!r) return null;
    var e = ze.create(r, function(t) {
      return t !== null && (t = parseFloat(t)), t;
    });
    return e.parse();
  }, "parseFloatArray"), ee = a(function(r) {
    if (!r) return null;
    var e = ze.create(r);
    return e.parse();
  }, "parseStringArray"), ar = a(function(r) {
    if (!r) return null;
    var e = ze.create(
      r,
      function(t) {
        return t !== null && (t = Et(t)), t;
      }
    );
    return e.parse();
  }, "parseDateArray"), uu = a(function(r) {
    if (!r)
      return null;
    var e = ze.create(r, function(t) {
      return t !== null && (t = ji(t)), t;
    });
    return e.parse();
  }, "parseIntervalArray"), cu = a(function(r) {
    return r ? Ve.parse(r, At(Hi)) : null;
  }, "parseByteAArray"), ur = a(function(r) {
    return parseInt(r, 10);
  }, "parseInteger"), Gi = a(function(r) {
    var e = String(r);
    return /^\d+$/.test(e) ? e : r;
  }, "parseBigInteger"), Wi = a(function(r) {
    return r ? Ve.parse(r, At(JSON.parse)) : null;
  }, "parseJsonArray"), cr = a(
    function(r) {
      return r[0] !== "(" ? null : (r = r.substring(1, r.length - 1).split(","), { x: parseFloat(r[0]), y: parseFloat(
        r[1]
      ) });
    },
    "parsePoint"
  ), lu = a(function(r) {
    if (r[0] !== "<" && r[1] !== "(") return null;
    for (var e = "(", t = "", n = false, i = 2; i < r.length - 1; i++) {
      if (n || (e += r[i]), r[i] === ")") {
        n = true;
        continue;
      } else if (!n) continue;
      r[i] !== "," && (t += r[i]);
    }
    var s = cr(e);
    return s.radius = parseFloat(t), s;
  }, "parseCircle"), fu = a(function(r) {
    r(20, Gi), r(21, ur), r(23, ur), r(26, ur), r(700, parseFloat), r(701, parseFloat), r(16, $i), r(1082, Et), r(1114, Et), r(1184, Et), r(
      600,
      cr
    ), r(651, ee), r(718, lu), r(1e3, iu), r(1001, cu), r(1005, sr), r(1007, sr), r(1028, sr), r(1016, ou), r(1017, au), r(1021, or), r(1022, or), r(1231, or), r(1014, ee), r(1015, ee), r(1008, ee), r(1009, ee), r(1040, ee), r(1041, ee), r(
      1115,
      ar
    ), r(1182, ar), r(1185, ar), r(1186, ji), r(1187, uu), r(17, Hi), r(114, JSON.parse.bind(JSON)), r(3802, JSON.parse.bind(JSON)), r(199, Wi), r(3807, Wi), r(3907, ee), r(2951, ee), r(791, ee), r(1183, ee), r(1270, ee);
  }, "init");
  Vi.exports = { init: fu };
});
var Yi = T((Zf, Ki) => {
  "use strict";
  h();
  var K = 1e6;
  function hu(r) {
    var e = r.readInt32BE(0), t = r.readUInt32BE(
      4
    ), n = "";
    e < 0 && (e = ~e + (t === 0), t = ~t + 1 >>> 0, n = "-");
    var i = "", s, o, u, c, l, f;
    {
      if (s = e % K, e = e / K >>> 0, o = 4294967296 * s + t, t = o / K >>> 0, u = "" + (o - K * t), t === 0 && e === 0) return n + u + i;
      for (c = "", l = 6 - u.length, f = 0; f < l; f++) c += "0";
      i = c + u + i;
    }
    {
      if (s = e % K, e = e / K >>> 0, o = 4294967296 * s + t, t = o / K >>> 0, u = "" + (o - K * t), t === 0 && e === 0) return n + u + i;
      for (c = "", l = 6 - u.length, f = 0; f < l; f++) c += "0";
      i = c + u + i;
    }
    {
      if (s = e % K, e = e / K >>> 0, o = 4294967296 * s + t, t = o / K >>> 0, u = "" + (o - K * t), t === 0 && e === 0) return n + u + i;
      for (c = "", l = 6 - u.length, f = 0; f < l; f++) c += "0";
      i = c + u + i;
    }
    return s = e % K, o = 4294967296 * s + t, u = "" + o % K, n + u + i;
  }
  a(hu, "readInt8");
  Ki.exports = hu;
});
var ts = T((eh, es) => {
  h();
  var du = Yi(), B = a(function(r, e, t, n, i) {
    t = t || 0, n = n || false, i = i || function(w, S, k) {
      return w * Math.pow(2, k) + S;
    };
    var s = t >> 3, o = a(function(w) {
      return n ? ~w & 255 : w;
    }, "inv"), u = 255, c = 8 - t % 8;
    e < c && (u = 255 << 8 - e & 255, c = e), t && (u = u >> t % 8);
    var l = 0;
    t % 8 + e >= 8 && (l = i(0, o(r[s]) & u, c));
    for (var f = e + t >> 3, m = s + 1; m < f; m++) l = i(l, o(
      r[m]
    ), 8);
    var g = (e + t) % 8;
    return g > 0 && (l = i(l, o(r[f]) >> 8 - g, g)), l;
  }, "parseBits"), Xi = a(function(r, e, t) {
    var n = Math.pow(2, t - 1) - 1, i = B(r, 1), s = B(r, t, 1);
    if (s === 0) return 0;
    var o = 1, u = a(function(l, f, m) {
      l === 0 && (l = 1);
      for (var g = 1; g <= m; g++) o /= 2, (f & 1 << m - g) > 0 && (l += o);
      return l;
    }, "parsePrecisionBits"), c = B(r, e, t + 1, false, u);
    return s == Math.pow(
      2,
      t + 1
    ) - 1 ? c === 0 ? i === 0 ? 1 / 0 : -1 / 0 : NaN : (i === 0 ? 1 : -1) * Math.pow(2, s - n) * c;
  }, "parseFloatFromBits"), pu = a(function(r) {
    return B(r, 1) == 1 ? -1 * (B(r, 15, 1, true) + 1) : B(r, 15, 1);
  }, "parseInt16"), Zi = a(function(r) {
    return B(r, 1) == 1 ? -1 * (B(
      r,
      31,
      1,
      true
    ) + 1) : B(r, 31, 1);
  }, "parseInt32"), yu = a(function(r) {
    return Xi(r, 23, 8);
  }, "parseFloat32"), mu = a(function(r) {
    return Xi(r, 52, 11);
  }, "parseFloat64"), gu = a(function(r) {
    var e = B(r, 16, 32);
    if (e == 49152) return NaN;
    for (var t = Math.pow(1e4, B(r, 16, 16)), n = 0, i = [], s = B(r, 16), o = 0; o < s; o++) n += B(r, 16, 64 + 16 * o) * t, t /= 1e4;
    var u = Math.pow(10, B(
      r,
      16,
      48
    ));
    return (e === 0 ? 1 : -1) * Math.round(n * u) / u;
  }, "parseNumeric"), Ji = a(function(r, e) {
    var t = B(e, 1), n = B(
      e,
      63,
      1
    ), i = new Date((t === 0 ? 1 : -1) * n / 1e3 + 9466848e5);
    return r || i.setTime(i.getTime() + i.getTimezoneOffset() * 6e4), i.usec = n % 1e3, i.getMicroSeconds = function() {
      return this.usec;
    }, i.setMicroSeconds = function(s) {
      this.usec = s;
    }, i.getUTCMicroSeconds = function() {
      return this.usec;
    }, i;
  }, "parseDate"), Ke = a(
    function(r) {
      for (var e = B(
        r,
        32
      ), t = B(r, 32, 32), n = B(r, 32, 64), i = 96, s = [], o = 0; o < e; o++) s[o] = B(r, 32, i), i += 32, i += 32;
      var u = a(function(l) {
        var f = B(r, 32, i);
        if (i += 32, f == 4294967295) return null;
        var m;
        if (l == 23 || l == 20) return m = B(r, f * 8, i), i += f * 8, m;
        if (l == 25) return m = r.toString(this.encoding, i >> 3, (i += f << 3) >> 3), m;
        console.log("ERROR: ElementType not implemented: " + l);
      }, "parseElement"), c = a(function(l, f) {
        var m = [], g;
        if (l.length > 1) {
          var w = l.shift();
          for (g = 0; g < w; g++) m[g] = c(l, f);
          l.unshift(w);
        } else for (g = 0; g < l[0]; g++) m[g] = u(f);
        return m;
      }, "parse");
      return c(s, n);
    },
    "parseArray"
  ), wu = a(function(r) {
    return r.toString("utf8");
  }, "parseText"), bu = a(function(r) {
    return r === null ? null : B(r, 8) > 0;
  }, "parseBool"), xu = a(function(r) {
    r(20, du), r(21, pu), r(23, Zi), r(26, Zi), r(1700, gu), r(700, yu), r(701, mu), r(16, bu), r(1114, Ji.bind(null, false)), r(1184, Ji.bind(null, true)), r(1e3, Ke), r(1007, Ke), r(1016, Ke), r(1008, Ke), r(1009, Ke), r(25, wu);
  }, "init");
  es.exports = { init: xu };
});
var ns = T((nh, rs) => {
  h();
  rs.exports = {
    BOOL: 16,
    BYTEA: 17,
    CHAR: 18,
    INT8: 20,
    INT2: 21,
    INT4: 23,
    REGPROC: 24,
    TEXT: 25,
    OID: 26,
    TID: 27,
    XID: 28,
    CID: 29,
    JSON: 114,
    XML: 142,
    PG_NODE_TREE: 194,
    SMGR: 210,
    PATH: 602,
    POLYGON: 604,
    CIDR: 650,
    FLOAT4: 700,
    FLOAT8: 701,
    ABSTIME: 702,
    RELTIME: 703,
    TINTERVAL: 704,
    CIRCLE: 718,
    MACADDR8: 774,
    MONEY: 790,
    MACADDR: 829,
    INET: 869,
    ACLITEM: 1033,
    BPCHAR: 1042,
    VARCHAR: 1043,
    DATE: 1082,
    TIME: 1083,
    TIMESTAMP: 1114,
    TIMESTAMPTZ: 1184,
    INTERVAL: 1186,
    TIMETZ: 1266,
    BIT: 1560,
    VARBIT: 1562,
    NUMERIC: 1700,
    REFCURSOR: 1790,
    REGPROCEDURE: 2202,
    REGOPER: 2203,
    REGOPERATOR: 2204,
    REGCLASS: 2205,
    REGTYPE: 2206,
    UUID: 2950,
    TXID_SNAPSHOT: 2970,
    PG_LSN: 3220,
    PG_NDISTINCT: 3361,
    PG_DEPENDENCIES: 3402,
    TSVECTOR: 3614,
    TSQUERY: 3615,
    GTSVECTOR: 3642,
    REGCONFIG: 3734,
    REGDICTIONARY: 3769,
    JSONB: 3802,
    REGNAMESPACE: 4089,
    REGROLE: 4096
  };
});
var Je = T((Ze) => {
  h();
  var vu = zi(), Su = ts(), Eu = rr(), Au = ns();
  Ze.getTypeParser = Cu;
  Ze.setTypeParser = _u;
  Ze.arrayParser = Eu;
  Ze.builtins = Au;
  var Ye = { text: {}, binary: {} };
  function is(r) {
    return String(r);
  }
  a(is, "noParse");
  function Cu(r, e) {
    return e = e || "text", Ye[e] && Ye[e][r] || is;
  }
  a(Cu, "getTypeParser");
  function _u(r, e, t) {
    typeof e == "function" && (t = e, e = "text"), Ye[e][r] = t;
  }
  a(_u, "setTypeParser");
  vu.init(function(r, e) {
    Ye.text[r] = e;
  });
  Su.init(function(r, e) {
    Ye.binary[r] = e;
  });
});
var _t = T((uh, ss) => {
  "use strict";
  h();
  var Tu = Je();
  function Ct(r) {
    this._types = r || Tu, this.text = {}, this.binary = {};
  }
  a(Ct, "TypeOverrides");
  Ct.prototype.getOverrides = function(r) {
    switch (r) {
      case "text":
        return this.text;
      case "binary":
        return this.binary;
      default:
        return {};
    }
  };
  Ct.prototype.setTypeParser = function(r, e, t) {
    typeof e == "function" && (t = e, e = "text"), this.getOverrides(e)[r] = t;
  };
  Ct.prototype.getTypeParser = function(r, e) {
    return e = e || "text", this.getOverrides(e)[r] || this._types.getTypeParser(r, e);
  };
  ss.exports = Ct;
});
function Xe(r) {
  let e = 1779033703, t = 3144134277, n = 1013904242, i = 2773480762, s = 1359893119, o = 2600822924, u = 528734635, c = 1541459225, l = 0, f = 0, m = [
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ], g = a((I, C) => I >>> C | I << 32 - C, "rrot"), w = new Uint32Array(64), S = new Uint8Array(64), k = a(() => {
    for (let R = 0, $ = 0; R < 16; R++, $ += 4) w[R] = S[$] << 24 | S[$ + 1] << 16 | S[$ + 2] << 8 | S[$ + 3];
    for (let R = 16; R < 64; R++) {
      let $ = g(w[R - 15], 7) ^ g(w[R - 15], 18) ^ w[R - 15] >>> 3, Ee = g(
        w[R - 2],
        17
      ) ^ g(w[R - 2], 19) ^ w[R - 2] >>> 10;
      w[R] = w[R - 16] + $ + w[R - 7] + Ee | 0;
    }
    let I = e, C = t, re = n, ne = i, H = s, oe = o, ae = u, me = c;
    for (let R = 0; R < 64; R++) {
      let $ = g(H, 6) ^ g(H, 11) ^ g(H, 25), Ee = H & oe ^ ~H & ae, ue = me + $ + Ee + m[R] + w[R] | 0, Te = g(I, 2) ^ g(
        I,
        13
      ) ^ g(I, 22), ce = I & C ^ I & re ^ C & re, G = Te + ce | 0;
      me = ae, ae = oe, oe = H, H = ne + ue | 0, ne = re, re = C, C = I, I = ue + G | 0;
    }
    e = e + I | 0, t = t + C | 0, n = n + re | 0, i = i + ne | 0, s = s + H | 0, o = o + oe | 0, u = u + ae | 0, c = c + me | 0, f = 0;
  }, "process"), D = a(
    (I) => {
      typeof I == "string" && (I = new TextEncoder().encode(I));
      for (let C = 0; C < I.length; C++) S[f++] = I[C], f === 64 && k();
      l += I.length;
    },
    "add"
  ), he = a(() => {
    if (S[f++] = 128, f == 64 && k(), f + 8 > 64) {
      for (; f < 64; ) S[f++] = 0;
      k();
    }
    for (; f < 58; ) S[f++] = 0;
    let I = l * 8;
    S[f++] = I / 1099511627776 & 255, S[f++] = I / 4294967296 & 255, S[f++] = I >>> 24, S[f++] = I >>> 16 & 255, S[f++] = I >>> 8 & 255, S[f++] = I & 255, k();
    let C = new Uint8Array(32);
    return C[0] = e >>> 24, C[1] = e >>> 16 & 255, C[2] = e >>> 8 & 255, C[3] = e & 255, C[4] = t >>> 24, C[5] = t >>> 16 & 255, C[6] = t >>> 8 & 255, C[7] = t & 255, C[8] = n >>> 24, C[9] = n >>> 16 & 255, C[10] = n >>> 8 & 255, C[11] = n & 255, C[12] = i >>> 24, C[13] = i >>> 16 & 255, C[14] = i >>> 8 & 255, C[15] = i & 255, C[16] = s >>> 24, C[17] = s >>> 16 & 255, C[18] = s >>> 8 & 255, C[19] = s & 255, C[20] = o >>> 24, C[21] = o >>> 16 & 255, C[22] = o >>> 8 & 255, C[23] = o & 255, C[24] = u >>> 24, C[25] = u >>> 16 & 255, C[26] = u >>> 8 & 255, C[27] = u & 255, C[28] = c >>> 24, C[29] = c >>> 16 & 255, C[30] = c >>> 8 & 255, C[31] = c & 255, C;
  }, "digest");
  return r === void 0 ? { add: D, digest: he } : (D(r), he());
}
var os = V(() => {
  "use strict";
  h();
  a(Xe, "sha256");
});
var M;
var et;
var as = V(() => {
  "use strict";
  h();
  M = class M2 {
    constructor() {
      E(this, "_dataLength", 0);
      E(this, "_bufferLength", 0);
      E(this, "_state", new Int32Array(4));
      E(this, "_buffer", new ArrayBuffer(68));
      E(this, "_buffer8");
      E(this, "_buffer32");
      this._buffer8 = new Uint8Array(this._buffer, 0, 68), this._buffer32 = new Uint32Array(this._buffer, 0, 17), this.start();
    }
    static hashByteArray(e, t = false) {
      return this.onePassHasher.start().appendByteArray(
        e
      ).end(t);
    }
    static hashStr(e, t = false) {
      return this.onePassHasher.start().appendStr(e).end(t);
    }
    static hashAsciiStr(e, t = false) {
      return this.onePassHasher.start().appendAsciiStr(e).end(t);
    }
    static _hex(e) {
      let t = M2.hexChars, n = M2.hexOut, i, s, o, u;
      for (u = 0; u < 4; u += 1) for (s = u * 8, i = e[u], o = 0; o < 8; o += 2) n[s + 1 + o] = t.charAt(i & 15), i >>>= 4, n[s + 0 + o] = t.charAt(
        i & 15
      ), i >>>= 4;
      return n.join("");
    }
    static _md5cycle(e, t) {
      let n = e[0], i = e[1], s = e[2], o = e[3];
      n += (i & s | ~i & o) + t[0] - 680876936 | 0, n = (n << 7 | n >>> 25) + i | 0, o += (n & i | ~n & s) + t[1] - 389564586 | 0, o = (o << 12 | o >>> 20) + n | 0, s += (o & n | ~o & i) + t[2] + 606105819 | 0, s = (s << 17 | s >>> 15) + o | 0, i += (s & o | ~s & n) + t[3] - 1044525330 | 0, i = (i << 22 | i >>> 10) + s | 0, n += (i & s | ~i & o) + t[4] - 176418897 | 0, n = (n << 7 | n >>> 25) + i | 0, o += (n & i | ~n & s) + t[5] + 1200080426 | 0, o = (o << 12 | o >>> 20) + n | 0, s += (o & n | ~o & i) + t[6] - 1473231341 | 0, s = (s << 17 | s >>> 15) + o | 0, i += (s & o | ~s & n) + t[7] - 45705983 | 0, i = (i << 22 | i >>> 10) + s | 0, n += (i & s | ~i & o) + t[8] + 1770035416 | 0, n = (n << 7 | n >>> 25) + i | 0, o += (n & i | ~n & s) + t[9] - 1958414417 | 0, o = (o << 12 | o >>> 20) + n | 0, s += (o & n | ~o & i) + t[10] - 42063 | 0, s = (s << 17 | s >>> 15) + o | 0, i += (s & o | ~s & n) + t[11] - 1990404162 | 0, i = (i << 22 | i >>> 10) + s | 0, n += (i & s | ~i & o) + t[12] + 1804603682 | 0, n = (n << 7 | n >>> 25) + i | 0, o += (n & i | ~n & s) + t[13] - 40341101 | 0, o = (o << 12 | o >>> 20) + n | 0, s += (o & n | ~o & i) + t[14] - 1502002290 | 0, s = (s << 17 | s >>> 15) + o | 0, i += (s & o | ~s & n) + t[15] + 1236535329 | 0, i = (i << 22 | i >>> 10) + s | 0, n += (i & o | s & ~o) + t[1] - 165796510 | 0, n = (n << 5 | n >>> 27) + i | 0, o += (n & s | i & ~s) + t[6] - 1069501632 | 0, o = (o << 9 | o >>> 23) + n | 0, s += (o & i | n & ~i) + t[11] + 643717713 | 0, s = (s << 14 | s >>> 18) + o | 0, i += (s & n | o & ~n) + t[0] - 373897302 | 0, i = (i << 20 | i >>> 12) + s | 0, n += (i & o | s & ~o) + t[5] - 701558691 | 0, n = (n << 5 | n >>> 27) + i | 0, o += (n & s | i & ~s) + t[10] + 38016083 | 0, o = (o << 9 | o >>> 23) + n | 0, s += (o & i | n & ~i) + t[15] - 660478335 | 0, s = (s << 14 | s >>> 18) + o | 0, i += (s & n | o & ~n) + t[4] - 405537848 | 0, i = (i << 20 | i >>> 12) + s | 0, n += (i & o | s & ~o) + t[9] + 568446438 | 0, n = (n << 5 | n >>> 27) + i | 0, o += (n & s | i & ~s) + t[14] - 1019803690 | 0, o = (o << 9 | o >>> 23) + n | 0, s += (o & i | n & ~i) + t[3] - 187363961 | 0, s = (s << 14 | s >>> 18) + o | 0, i += (s & n | o & ~n) + t[8] + 1163531501 | 0, i = (i << 20 | i >>> 12) + s | 0, n += (i & o | s & ~o) + t[13] - 1444681467 | 0, n = (n << 5 | n >>> 27) + i | 0, o += (n & s | i & ~s) + t[2] - 51403784 | 0, o = (o << 9 | o >>> 23) + n | 0, s += (o & i | n & ~i) + t[7] + 1735328473 | 0, s = (s << 14 | s >>> 18) + o | 0, i += (s & n | o & ~n) + t[12] - 1926607734 | 0, i = (i << 20 | i >>> 12) + s | 0, n += (i ^ s ^ o) + t[5] - 378558 | 0, n = (n << 4 | n >>> 28) + i | 0, o += (n ^ i ^ s) + t[8] - 2022574463 | 0, o = (o << 11 | o >>> 21) + n | 0, s += (o ^ n ^ i) + t[11] + 1839030562 | 0, s = (s << 16 | s >>> 16) + o | 0, i += (s ^ o ^ n) + t[14] - 35309556 | 0, i = (i << 23 | i >>> 9) + s | 0, n += (i ^ s ^ o) + t[1] - 1530992060 | 0, n = (n << 4 | n >>> 28) + i | 0, o += (n ^ i ^ s) + t[4] + 1272893353 | 0, o = (o << 11 | o >>> 21) + n | 0, s += (o ^ n ^ i) + t[7] - 155497632 | 0, s = (s << 16 | s >>> 16) + o | 0, i += (s ^ o ^ n) + t[10] - 1094730640 | 0, i = (i << 23 | i >>> 9) + s | 0, n += (i ^ s ^ o) + t[13] + 681279174 | 0, n = (n << 4 | n >>> 28) + i | 0, o += (n ^ i ^ s) + t[0] - 358537222 | 0, o = (o << 11 | o >>> 21) + n | 0, s += (o ^ n ^ i) + t[3] - 722521979 | 0, s = (s << 16 | s >>> 16) + o | 0, i += (s ^ o ^ n) + t[6] + 76029189 | 0, i = (i << 23 | i >>> 9) + s | 0, n += (i ^ s ^ o) + t[9] - 640364487 | 0, n = (n << 4 | n >>> 28) + i | 0, o += (n ^ i ^ s) + t[12] - 421815835 | 0, o = (o << 11 | o >>> 21) + n | 0, s += (o ^ n ^ i) + t[15] + 530742520 | 0, s = (s << 16 | s >>> 16) + o | 0, i += (s ^ o ^ n) + t[2] - 995338651 | 0, i = (i << 23 | i >>> 9) + s | 0, n += (s ^ (i | ~o)) + t[0] - 198630844 | 0, n = (n << 6 | n >>> 26) + i | 0, o += (i ^ (n | ~s)) + t[7] + 1126891415 | 0, o = (o << 10 | o >>> 22) + n | 0, s += (n ^ (o | ~i)) + t[14] - 1416354905 | 0, s = (s << 15 | s >>> 17) + o | 0, i += (o ^ (s | ~n)) + t[5] - 57434055 | 0, i = (i << 21 | i >>> 11) + s | 0, n += (s ^ (i | ~o)) + t[12] + 1700485571 | 0, n = (n << 6 | n >>> 26) + i | 0, o += (i ^ (n | ~s)) + t[3] - 1894986606 | 0, o = (o << 10 | o >>> 22) + n | 0, s += (n ^ (o | ~i)) + t[10] - 1051523 | 0, s = (s << 15 | s >>> 17) + o | 0, i += (o ^ (s | ~n)) + t[1] - 2054922799 | 0, i = (i << 21 | i >>> 11) + s | 0, n += (s ^ (i | ~o)) + t[8] + 1873313359 | 0, n = (n << 6 | n >>> 26) + i | 0, o += (i ^ (n | ~s)) + t[15] - 30611744 | 0, o = (o << 10 | o >>> 22) + n | 0, s += (n ^ (o | ~i)) + t[6] - 1560198380 | 0, s = (s << 15 | s >>> 17) + o | 0, i += (o ^ (s | ~n)) + t[13] + 1309151649 | 0, i = (i << 21 | i >>> 11) + s | 0, n += (s ^ (i | ~o)) + t[4] - 145523070 | 0, n = (n << 6 | n >>> 26) + i | 0, o += (i ^ (n | ~s)) + t[11] - 1120210379 | 0, o = (o << 10 | o >>> 22) + n | 0, s += (n ^ (o | ~i)) + t[2] + 718787259 | 0, s = (s << 15 | s >>> 17) + o | 0, i += (o ^ (s | ~n)) + t[9] - 343485551 | 0, i = (i << 21 | i >>> 11) + s | 0, e[0] = n + e[0] | 0, e[1] = i + e[1] | 0, e[2] = s + e[2] | 0, e[3] = o + e[3] | 0;
    }
    start() {
      return this._dataLength = 0, this._bufferLength = 0, this._state.set(M2.stateIdentity), this;
    }
    appendStr(e) {
      let t = this._buffer8, n = this._buffer32, i = this._bufferLength, s, o;
      for (o = 0; o < e.length; o += 1) {
        if (s = e.charCodeAt(o), s < 128) t[i++] = s;
        else if (s < 2048) t[i++] = (s >>> 6) + 192, t[i++] = s & 63 | 128;
        else if (s < 55296 || s > 56319) t[i++] = (s >>> 12) + 224, t[i++] = s >>> 6 & 63 | 128, t[i++] = s & 63 | 128;
        else {
          if (s = (s - 55296) * 1024 + (e.charCodeAt(++o) - 56320) + 65536, s > 1114111) throw new Error(
            "Unicode standard supports code points up to U+10FFFF"
          );
          t[i++] = (s >>> 18) + 240, t[i++] = s >>> 12 & 63 | 128, t[i++] = s >>> 6 & 63 | 128, t[i++] = s & 63 | 128;
        }
        i >= 64 && (this._dataLength += 64, M2._md5cycle(this._state, n), i -= 64, n[0] = n[16]);
      }
      return this._bufferLength = i, this;
    }
    appendAsciiStr(e) {
      let t = this._buffer8, n = this._buffer32, i = this._bufferLength, s, o = 0;
      for (; ; ) {
        for (s = Math.min(e.length - o, 64 - i); s--; ) t[i++] = e.charCodeAt(o++);
        if (i < 64) break;
        this._dataLength += 64, M2._md5cycle(this._state, n), i = 0;
      }
      return this._bufferLength = i, this;
    }
    appendByteArray(e) {
      let t = this._buffer8, n = this._buffer32, i = this._bufferLength, s, o = 0;
      for (; ; ) {
        for (s = Math.min(e.length - o, 64 - i); s--; ) t[i++] = e[o++];
        if (i < 64) break;
        this._dataLength += 64, M2._md5cycle(this._state, n), i = 0;
      }
      return this._bufferLength = i, this;
    }
    getState() {
      let e = this._state;
      return { buffer: String.fromCharCode.apply(null, Array.from(this._buffer8)), buflen: this._bufferLength, length: this._dataLength, state: [e[0], e[1], e[2], e[3]] };
    }
    setState(e) {
      let t = e.buffer, n = e.state, i = this._state, s;
      for (this._dataLength = e.length, this._bufferLength = e.buflen, i[0] = n[0], i[1] = n[1], i[2] = n[2], i[3] = n[3], s = 0; s < t.length; s += 1) this._buffer8[s] = t.charCodeAt(s);
    }
    end(e = false) {
      let t = this._bufferLength, n = this._buffer8, i = this._buffer32, s = (t >> 2) + 1;
      this._dataLength += t;
      let o = this._dataLength * 8;
      if (n[t] = 128, n[t + 1] = n[t + 2] = n[t + 3] = 0, i.set(M2.buffer32Identity.subarray(s), s), t > 55 && (M2._md5cycle(this._state, i), i.set(M2.buffer32Identity)), o <= 4294967295) i[14] = o;
      else {
        let u = o.toString(16).match(/(.*?)(.{0,8})$/);
        if (u === null) return;
        let c = parseInt(
          u[2],
          16
        ), l = parseInt(u[1], 16) || 0;
        i[14] = c, i[15] = l;
      }
      return M2._md5cycle(this._state, i), e ? this._state : M2._hex(
        this._state
      );
    }
  };
  a(M, "Md5"), E(M, "stateIdentity", new Int32Array([1732584193, -271733879, -1732584194, 271733878])), E(M, "buffer32Identity", new Int32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), E(M, "hexChars", "0123456789abcdef"), E(M, "hexOut", []), E(M, "onePassHasher", new M());
  et = M;
});
var lr = {};
se(lr, { createHash: () => Pu, createHmac: () => Ru, randomBytes: () => Iu });
function Iu(r) {
  return crypto.getRandomValues(p.alloc(r));
}
function Pu(r) {
  if (r === "sha256") return { update: a(function(e) {
    return { digest: a(
      function() {
        return p.from(Xe(e));
      },
      "digest"
    ) };
  }, "update") };
  if (r === "md5") return { update: a(function(e) {
    return {
      digest: a(function() {
        return typeof e == "string" ? et.hashStr(e) : et.hashByteArray(e);
      }, "digest")
    };
  }, "update") };
  throw new Error(`Hash type '${r}' not supported`);
}
function Ru(r, e) {
  if (r !== "sha256") throw new Error(`Only sha256 is supported (requested: '${r}')`);
  return { update: a(function(t) {
    return { digest: a(
      function() {
        typeof e == "string" && (e = new TextEncoder().encode(e)), typeof t == "string" && (t = new TextEncoder().encode(
          t
        ));
        let n = e.length;
        if (n > 64) e = Xe(e);
        else if (n < 64) {
          let c = new Uint8Array(64);
          c.set(e), e = c;
        }
        let i = new Uint8Array(
          64
        ), s = new Uint8Array(64);
        for (let c = 0; c < 64; c++) i[c] = 54 ^ e[c], s[c] = 92 ^ e[c];
        let o = new Uint8Array(t.length + 64);
        o.set(i, 0), o.set(t, 64);
        let u = new Uint8Array(96);
        return u.set(s, 0), u.set(Xe(o), 64), p.from(Xe(u));
      },
      "digest"
    ) };
  }, "update") };
}
var fr = V(() => {
  "use strict";
  h();
  os();
  as();
  a(Iu, "randomBytes");
  a(Pu, "createHash");
  a(Ru, "createHmac");
});
var tt = T((vh, hr) => {
  "use strict";
  h();
  hr.exports = {
    host: "localhost",
    user: y.platform === "win32" ? y.env.USERNAME : y.env.USER,
    database: void 0,
    password: null,
    connectionString: void 0,
    port: 5432,
    rows: 0,
    binary: false,
    max: 10,
    idleTimeoutMillis: 3e4,
    client_encoding: "",
    ssl: false,
    application_name: void 0,
    fallback_application_name: void 0,
    options: void 0,
    parseInputDatesAsUTC: false,
    statement_timeout: false,
    lock_timeout: false,
    idle_in_transaction_session_timeout: false,
    query_timeout: false,
    connect_timeout: 0,
    keepalives: 1,
    keepalives_idle: 0
  };
  var ke = Je(), Lu = ke.getTypeParser(20, "text"), Bu = ke.getTypeParser(
    1016,
    "text"
  );
  hr.exports.__defineSetter__("parseInt8", function(r) {
    ke.setTypeParser(20, "text", r ? ke.getTypeParser(
      23,
      "text"
    ) : Lu), ke.setTypeParser(1016, "text", r ? ke.getTypeParser(1007, "text") : Bu);
  });
});
var rt = T((Eh, cs) => {
  "use strict";
  h();
  var Fu = (fr(), O(lr)), Mu = tt();
  function ku(r) {
    var e = r.replace(
      /\\/g,
      "\\\\"
    ).replace(/"/g, '\\"');
    return '"' + e + '"';
  }
  a(ku, "escapeElement");
  function us(r) {
    for (var e = "{", t = 0; t < r.length; t++) t > 0 && (e = e + ","), r[t] === null || typeof r[t] > "u" ? e = e + "NULL" : Array.isArray(r[t]) ? e = e + us(r[t]) : r[t] instanceof p ? e += "\\\\x" + r[t].toString("hex") : e += ku(Tt(r[t]));
    return e = e + "}", e;
  }
  a(us, "arrayString");
  var Tt = a(function(r, e) {
    if (r == null) return null;
    if (r instanceof p) return r;
    if (ArrayBuffer.isView(r)) {
      var t = p.from(r.buffer, r.byteOffset, r.byteLength);
      return t.length === r.byteLength ? t : t.slice(r.byteOffset, r.byteOffset + r.byteLength);
    }
    return r instanceof Date ? Mu.parseInputDatesAsUTC ? Qu(r) : Uu(r) : Array.isArray(r) ? us(r) : typeof r == "object" ? Ou(r, e) : r.toString();
  }, "prepareValue");
  function Ou(r, e) {
    if (r && typeof r.toPostgres == "function") {
      if (e = e || [], e.indexOf(r) !== -1) throw new Error('circular reference detected while preparing "' + r + '" for query');
      return e.push(r), Tt(r.toPostgres(Tt), e);
    }
    return JSON.stringify(r);
  }
  a(Ou, "prepareObject");
  function W(r, e) {
    for (r = "" + r; r.length < e; ) r = "0" + r;
    return r;
  }
  a(W, "pad");
  function Uu(r) {
    var e = -r.getTimezoneOffset(), t = r.getFullYear(), n = t < 1;
    n && (t = Math.abs(t) + 1);
    var i = W(t, 4) + "-" + W(r.getMonth() + 1, 2) + "-" + W(r.getDate(), 2) + "T" + W(
      r.getHours(),
      2
    ) + ":" + W(r.getMinutes(), 2) + ":" + W(r.getSeconds(), 2) + "." + W(r.getMilliseconds(), 3);
    return e < 0 ? (i += "-", e *= -1) : i += "+", i += W(Math.floor(e / 60), 2) + ":" + W(e % 60, 2), n && (i += " BC"), i;
  }
  a(Uu, "dateToString");
  function Qu(r) {
    var e = r.getUTCFullYear(), t = e < 1;
    t && (e = Math.abs(e) + 1);
    var n = W(e, 4) + "-" + W(r.getUTCMonth() + 1, 2) + "-" + W(r.getUTCDate(), 2) + "T" + W(r.getUTCHours(), 2) + ":" + W(r.getUTCMinutes(), 2) + ":" + W(r.getUTCSeconds(), 2) + "." + W(
      r.getUTCMilliseconds(),
      3
    );
    return n += "+00:00", t && (n += " BC"), n;
  }
  a(Qu, "dateToStringUTC");
  function Du(r, e, t) {
    return r = typeof r == "string" ? { text: r } : r, e && (typeof e == "function" ? r.callback = e : r.values = e), t && (r.callback = t), r;
  }
  a(Du, "normalizeQueryConfig");
  var dr = a(function(r) {
    return Fu.createHash("md5").update(r, "utf-8").digest("hex");
  }, "md5"), qu = a(
    function(r, e, t) {
      var n = dr(e + r), i = dr(p.concat([p.from(n), t]));
      return "md5" + i;
    },
    "postgresMd5PasswordHash"
  );
  cs.exports = {
    prepareValue: a(function(e) {
      return Tt(e);
    }, "prepareValueWrapper"),
    normalizeQueryConfig: Du,
    postgresMd5PasswordHash: qu,
    md5: dr
  };
});
var nt = {};
se(nt, { default: () => ju });
var ju;
var it = V(() => {
  "use strict";
  h();
  ju = {};
});
var xs = T((Dh, bs) => {
  "use strict";
  h();
  var pr = (fr(), O(lr));
  function Hu(r) {
    if (r.indexOf("SCRAM-SHA-256") === -1) throw new Error("SASL: Only mechanism SCRAM-SHA-256 is currently supported");
    let e = pr.randomBytes(
      18
    ).toString("base64");
    return { mechanism: "SCRAM-SHA-256", clientNonce: e, response: "n,,n=*,r=" + e, message: "SASLInitialResponse" };
  }
  a(Hu, "startSession");
  function $u(r, e, t) {
    if (r.message !== "SASLInitialResponse") throw new Error(
      "SASL: Last message was not SASLInitialResponse"
    );
    if (typeof e != "string") throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string");
    if (typeof t != "string") throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: serverData must be a string");
    let n = zu(t);
    if (n.nonce.startsWith(r.clientNonce)) {
      if (n.nonce.length === r.clientNonce.length) throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce is too short");
    } else throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce does not start with client nonce");
    var i = p.from(n.salt, "base64"), s = Zu(e, i, n.iteration), o = Oe(s, "Client Key"), u = Yu(
      o
    ), c = "n=*,r=" + r.clientNonce, l = "r=" + n.nonce + ",s=" + n.salt + ",i=" + n.iteration, f = "c=biws,r=" + n.nonce, m = c + "," + l + "," + f, g = Oe(u, m), w = ws(o, g), S = w.toString("base64"), k = Oe(s, "Server Key"), D = Oe(k, m);
    r.message = "SASLResponse", r.serverSignature = D.toString("base64"), r.response = f + ",p=" + S;
  }
  a($u, "continueSession");
  function Gu(r, e) {
    if (r.message !== "SASLResponse") throw new Error("SASL: Last message was not SASLResponse");
    if (typeof e != "string") throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: serverData must be a string");
    let { serverSignature: t } = Ku(
      e
    );
    if (t !== r.serverSignature) throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature does not match");
  }
  a(Gu, "finalizeSession");
  function Vu(r) {
    if (typeof r != "string") throw new TypeError("SASL: text must be a string");
    return r.split("").map((e, t) => r.charCodeAt(t)).every((e) => e >= 33 && e <= 43 || e >= 45 && e <= 126);
  }
  a(Vu, "isPrintableChars");
  function ms(r) {
    return /^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(r);
  }
  a(ms, "isBase64");
  function gs(r) {
    if (typeof r != "string") throw new TypeError("SASL: attribute pairs text must be a string");
    return new Map(r.split(",").map((e) => {
      if (!/^.=/.test(e)) throw new Error("SASL: Invalid attribute pair entry");
      let t = e[0], n = e.substring(2);
      return [t, n];
    }));
  }
  a(gs, "parseAttributePairs");
  function zu(r) {
    let e = gs(r), t = e.get("r");
    if (t) {
      if (!Vu(t)) throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: nonce must only contain printable characters");
    } else throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: nonce missing");
    let n = e.get("s");
    if (n) {
      if (!ms(n)) throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: salt must be base64");
    } else throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: salt missing");
    let i = e.get("i");
    if (i) {
      if (!/^[1-9][0-9]*$/.test(i)) throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: invalid iteration count");
    } else throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: iteration missing");
    let s = parseInt(i, 10);
    return { nonce: t, salt: n, iteration: s };
  }
  a(zu, "parseServerFirstMessage");
  function Ku(r) {
    let t = gs(r).get("v");
    if (t) {
      if (!ms(t)) throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature must be base64");
    } else throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature is missing");
    return { serverSignature: t };
  }
  a(Ku, "parseServerFinalMessage");
  function ws(r, e) {
    if (!p.isBuffer(r)) throw new TypeError("first argument must be a Buffer");
    if (!p.isBuffer(e)) throw new TypeError(
      "second argument must be a Buffer"
    );
    if (r.length !== e.length) throw new Error("Buffer lengths must match");
    if (r.length === 0) throw new Error("Buffers cannot be empty");
    return p.from(r.map((t, n) => r[n] ^ e[n]));
  }
  a(ws, "xorBuffers");
  function Yu(r) {
    return pr.createHash("sha256").update(r).digest();
  }
  a(Yu, "sha256");
  function Oe(r, e) {
    return pr.createHmac("sha256", r).update(e).digest();
  }
  a(Oe, "hmacSha256");
  function Zu(r, e, t) {
    for (var n = Oe(
      r,
      p.concat([e, p.from([0, 0, 0, 1])])
    ), i = n, s = 0; s < t - 1; s++) n = Oe(r, n), i = ws(i, n);
    return i;
  }
  a(Zu, "Hi");
  bs.exports = { startSession: Hu, continueSession: $u, finalizeSession: Gu };
});
var yr = {};
se(yr, { join: () => Ju });
function Ju(...r) {
  return r.join("/");
}
var mr = V(() => {
  "use strict";
  h();
  a(
    Ju,
    "join"
  );
});
var gr = {};
se(gr, { stat: () => Xu });
function Xu(r, e) {
  e(new Error("No filesystem"));
}
var wr = V(() => {
  "use strict";
  h();
  a(Xu, "stat");
});
var br = {};
se(br, { default: () => ec });
var ec;
var xr = V(() => {
  "use strict";
  h();
  ec = {};
});
var vs = {};
se(vs, { StringDecoder: () => vr });
var Sr;
var vr;
var Ss = V(() => {
  "use strict";
  h();
  Sr = class Sr {
    constructor(e) {
      E(this, "td");
      this.td = new TextDecoder(e);
    }
    write(e) {
      return this.td.decode(e, { stream: true });
    }
    end(e) {
      return this.td.decode(e);
    }
  };
  a(Sr, "StringDecoder");
  vr = Sr;
});
var _s = T((Kh, Cs) => {
  "use strict";
  h();
  var { Transform: tc } = (xr(), O(br)), { StringDecoder: rc } = (Ss(), O(vs)), Se = Symbol(
    "last"
  ), It = Symbol("decoder");
  function nc(r, e, t) {
    let n;
    if (this.overflow) {
      if (n = this[It].write(r).split(
        this.matcher
      ), n.length === 1) return t();
      n.shift(), this.overflow = false;
    } else this[Se] += this[It].write(r), n = this[Se].split(this.matcher);
    this[Se] = n.pop();
    for (let i = 0; i < n.length; i++) try {
      As(this, this.mapper(n[i]));
    } catch (s) {
      return t(s);
    }
    if (this.overflow = this[Se].length > this.maxLength, this.overflow && !this.skipOverflow) {
      t(new Error(
        "maximum buffer reached"
      ));
      return;
    }
    t();
  }
  a(nc, "transform");
  function ic(r) {
    if (this[Se] += this[It].end(), this[Se])
      try {
        As(this, this.mapper(this[Se]));
      } catch (e) {
        return r(e);
      }
    r();
  }
  a(ic, "flush");
  function As(r, e) {
    e !== void 0 && r.push(e);
  }
  a(As, "push");
  function Es(r) {
    return r;
  }
  a(Es, "noop");
  function sc(r, e, t) {
    switch (r = r || /\r?\n/, e = e || Es, t = t || {}, arguments.length) {
      case 1:
        typeof r == "function" ? (e = r, r = /\r?\n/) : typeof r == "object" && !(r instanceof RegExp) && !r[Symbol.split] && (t = r, r = /\r?\n/);
        break;
      case 2:
        typeof r == "function" ? (t = e, e = r, r = /\r?\n/) : typeof e == "object" && (t = e, e = Es);
    }
    t = Object.assign({}, t), t.autoDestroy = true, t.transform = nc, t.flush = ic, t.readableObjectMode = true;
    let n = new tc(t);
    return n[Se] = "", n[It] = new rc("utf8"), n.matcher = r, n.mapper = e, n.maxLength = t.maxLength, n.skipOverflow = t.skipOverflow || false, n.overflow = false, n._destroy = function(i, s) {
      this._writableState.errorEmitted = false, s(i);
    }, n;
  }
  a(sc, "split");
  Cs.exports = sc;
});
var Ps = T((Jh, ye) => {
  "use strict";
  h();
  var Ts = (mr(), O(yr)), oc = (xr(), O(br)).Stream, ac = _s(), Is = (it(), O(nt)), uc = 5432, Pt = y.platform === "win32", st = y.stderr, cc = 56, lc = 7, fc = 61440, hc = 32768;
  function dc(r) {
    return (r & fc) == hc;
  }
  a(dc, "isRegFile");
  var Ue = ["host", "port", "database", "user", "password"], Er = Ue.length, pc = Ue[Er - 1];
  function Ar() {
    var r = st instanceof oc && st.writable === true;
    if (r) {
      var e = Array.prototype.slice.call(arguments).concat(`
`);
      st.write(Is.format.apply(Is, e));
    }
  }
  a(Ar, "warn");
  Object.defineProperty(ye.exports, "isWin", { get: a(function() {
    return Pt;
  }, "get"), set: a(function(r) {
    Pt = r;
  }, "set") });
  ye.exports.warnTo = function(r) {
    var e = st;
    return st = r, e;
  };
  ye.exports.getFileName = function(r) {
    var e = r || y.env, t = e.PGPASSFILE || (Pt ? Ts.join(e.APPDATA || "./", "postgresql", "pgpass.conf") : Ts.join(e.HOME || "./", ".pgpass"));
    return t;
  };
  ye.exports.usePgPass = function(r, e) {
    return Object.prototype.hasOwnProperty.call(y.env, "PGPASSWORD") ? false : Pt ? true : (e = e || "<unkn>", dc(r.mode) ? r.mode & (cc | lc) ? (Ar('WARNING: password file "%s" has group or world access; permissions should be u=rw (0600) or less', e), false) : true : (Ar('WARNING: password file "%s" is not a plain file', e), false));
  };
  var yc = ye.exports.match = function(r, e) {
    return Ue.slice(0, -1).reduce(function(t, n, i) {
      return i == 1 && Number(r[n] || uc) === Number(
        e[n]
      ) ? t && true : t && (e[n] === "*" || e[n] === r[n]);
    }, true);
  };
  ye.exports.getPassword = function(r, e, t) {
    var n, i = e.pipe(
      ac()
    );
    function s(c) {
      var l = mc(c);
      l && gc(l) && yc(r, l) && (n = l[pc], i.end());
    }
    a(s, "onLine");
    var o = a(function() {
      e.destroy(), t(n);
    }, "onEnd"), u = a(function(c) {
      e.destroy(), Ar("WARNING: error on reading file: %s", c), t(
        void 0
      );
    }, "onErr");
    e.on("error", u), i.on("data", s).on("end", o).on("error", u);
  };
  var mc = ye.exports.parseLine = function(r) {
    if (r.length < 11 || r.match(/^\s+#/)) return null;
    for (var e = "", t = "", n = 0, i = 0, s = 0, o = {}, u = false, c = a(
      function(f, m, g) {
        var w = r.substring(m, g);
        Object.hasOwnProperty.call(y.env, "PGPASS_NO_DEESCAPE") || (w = w.replace(/\\([:\\])/g, "$1")), o[Ue[f]] = w;
      },
      "addToObj"
    ), l = 0; l < r.length - 1; l += 1) {
      if (e = r.charAt(l + 1), t = r.charAt(
        l
      ), u = n == Er - 1, u) {
        c(n, i);
        break;
      }
      l >= 0 && e == ":" && t !== "\\" && (c(n, i, l + 1), i = l + 2, n += 1);
    }
    return o = Object.keys(o).length === Er ? o : null, o;
  }, gc = ye.exports.isValidEntry = function(r) {
    for (var e = { 0: function(o) {
      return o.length > 0;
    }, 1: function(o) {
      return o === "*" ? true : (o = Number(o), isFinite(o) && o > 0 && o < 9007199254740992 && Math.floor(o) === o);
    }, 2: function(o) {
      return o.length > 0;
    }, 3: function(o) {
      return o.length > 0;
    }, 4: function(o) {
      return o.length > 0;
    } }, t = 0; t < Ue.length; t += 1) {
      var n = e[t], i = r[Ue[t]] || "", s = n(i);
      if (!s) return false;
    }
    return true;
  };
});
var Ls = T((rd, Cr) => {
  "use strict";
  h();
  var td = (mr(), O(yr)), Rs = (wr(), O(gr)), Rt = Ps();
  Cr.exports = function(r, e) {
    var t = Rt.getFileName();
    Rs.stat(t, function(n, i) {
      if (n || !Rt.usePgPass(i, t)) return e(void 0);
      var s = Rs.createReadStream(
        t
      );
      Rt.getPassword(r, s, e);
    });
  };
  Cr.exports.warnTo = Rt.warnTo;
});
var Bs = {};
se(Bs, { default: () => wc });
var wc;
var Fs = V(() => {
  "use strict";
  h();
  wc = {};
});
var Ms = {};
se(Ms, { parse: () => bc });
function bc(r, e = false) {
  let { protocol: t } = new URL(r), n = "http:" + r.substring(
    t.length
  ), { username: i, password: s, host: o, hostname: u, port: c, pathname: l, search: f, searchParams: m, hash: g } = new URL(
    n
  );
  s = decodeURIComponent(s), i = decodeURIComponent(i), l = decodeURIComponent(l);
  let w = i + ":" + s, S = e ? Object.fromEntries(m.entries()) : f;
  return {
    href: r,
    protocol: t,
    auth: w,
    username: i,
    password: s,
    host: o,
    hostname: u,
    port: c,
    pathname: l,
    search: f,
    query: S,
    hash: g
  };
}
var ks = V(() => {
  "use strict";
  h();
  a(bc, "parse");
});
var Ir = T((ad, Os) => {
  "use strict";
  h();
  var xc = (ks(), O(Ms)), _r = (wr(), O(gr));
  function Tr(r) {
    if (r.charAt(0) === "/") {
      var t = r.split(" ");
      return { host: t[0], database: t[1] };
    }
    var e = xc.parse(/ |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(r) ? encodeURI(r).replace(/\%25(\d\d)/g, "%$1") : r, true), t = e.query;
    for (var n in t) Array.isArray(t[n]) && (t[n] = t[n][t[n].length - 1]);
    var i = (e.auth || ":").split(":");
    if (t.user = i[0], t.password = i.splice(1).join(
      ":"
    ), t.port = e.port, e.protocol == "socket:") return t.host = decodeURI(e.pathname), t.database = e.query.db, t.client_encoding = e.query.encoding, t;
    t.host || (t.host = e.hostname);
    var s = e.pathname;
    if (!t.host && s && /^%2f/i.test(s)) {
      var o = s.split("/");
      t.host = decodeURIComponent(o[0]), s = o.splice(1).join("/");
    }
    switch (s && s.charAt(
      0
    ) === "/" && (s = s.slice(1) || null), t.database = s && decodeURI(s), (t.ssl === "true" || t.ssl === "1") && (t.ssl = true), t.ssl === "0" && (t.ssl = false), (t.sslcert || t.sslkey || t.sslrootcert || t.sslmode) && (t.ssl = {}), t.sslcert && (t.ssl.cert = _r.readFileSync(t.sslcert).toString()), t.sslkey && (t.ssl.key = _r.readFileSync(t.sslkey).toString()), t.sslrootcert && (t.ssl.ca = _r.readFileSync(t.sslrootcert).toString()), t.sslmode) {
      case "disable": {
        t.ssl = false;
        break;
      }
      case "prefer":
      case "require":
      case "verify-ca":
      case "verify-full":
        break;
      case "no-verify": {
        t.ssl.rejectUnauthorized = false;
        break;
      }
    }
    return t;
  }
  a(Tr, "parse");
  Os.exports = Tr;
  Tr.parse = Tr;
});
var Lt = T((ld, Ds) => {
  "use strict";
  h();
  var vc = (Fs(), O(Bs)), Qs = tt(), Us = Ir().parse, j = a(function(r, e, t) {
    return t === void 0 ? t = y.env["PG" + r.toUpperCase()] : t === false || (t = y.env[t]), e[r] || t || Qs[r];
  }, "val"), Sc = a(function() {
    switch (y.env.PGSSLMODE) {
      case "disable":
        return false;
      case "prefer":
      case "require":
      case "verify-ca":
      case "verify-full":
        return true;
      case "no-verify":
        return { rejectUnauthorized: false };
    }
    return Qs.ssl;
  }, "readSSLConfigFromEnvironment"), Qe = a(function(r) {
    return "'" + ("" + r).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  }, "quoteParamValue"), te = a(function(r, e, t) {
    var n = e[t];
    n != null && r.push(t + "=" + Qe(n));
  }, "add"), Rr = class Rr {
    constructor(e) {
      e = typeof e == "string" ? Us(e) : e || {}, e.connectionString && (e = Object.assign({}, e, Us(e.connectionString))), this.user = j("user", e), this.database = j("database", e), this.database === void 0 && (this.database = this.user), this.port = parseInt(j("port", e), 10), this.host = j("host", e), Object.defineProperty(this, "password", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: j("password", e)
      }), this.binary = j("binary", e), this.options = j("options", e), this.ssl = typeof e.ssl > "u" ? Sc() : e.ssl, typeof this.ssl == "string" && this.ssl === "true" && (this.ssl = true), this.ssl === "no-verify" && (this.ssl = { rejectUnauthorized: false }), this.ssl && this.ssl.key && Object.defineProperty(this.ssl, "key", { enumerable: false }), this.client_encoding = j("client_encoding", e), this.replication = j("replication", e), this.isDomainSocket = !(this.host || "").indexOf("/"), this.application_name = j("application_name", e, "PGAPPNAME"), this.fallback_application_name = j("fallback_application_name", e, false), this.statement_timeout = j("statement_timeout", e, false), this.lock_timeout = j("lock_timeout", e, false), this.idle_in_transaction_session_timeout = j("idle_in_transaction_session_timeout", e, false), this.query_timeout = j("query_timeout", e, false), e.connectionTimeoutMillis === void 0 ? this.connect_timeout = y.env.PGCONNECT_TIMEOUT || 0 : this.connect_timeout = Math.floor(e.connectionTimeoutMillis / 1e3), e.keepAlive === false ? this.keepalives = 0 : e.keepAlive === true && (this.keepalives = 1), typeof e.keepAliveInitialDelayMillis == "number" && (this.keepalives_idle = Math.floor(e.keepAliveInitialDelayMillis / 1e3));
    }
    getLibpqConnectionString(e) {
      var t = [];
      te(t, this, "user"), te(t, this, "password"), te(t, this, "port"), te(t, this, "application_name"), te(
        t,
        this,
        "fallback_application_name"
      ), te(t, this, "connect_timeout"), te(t, this, "options");
      var n = typeof this.ssl == "object" ? this.ssl : this.ssl ? { sslmode: this.ssl } : {};
      if (te(t, n, "sslmode"), te(t, n, "sslca"), te(t, n, "sslkey"), te(t, n, "sslcert"), te(t, n, "sslrootcert"), this.database && t.push("dbname=" + Qe(this.database)), this.replication && t.push("replication=" + Qe(this.replication)), this.host && t.push("host=" + Qe(this.host)), this.isDomainSocket) return e(null, t.join(" "));
      this.client_encoding && t.push("client_encoding=" + Qe(this.client_encoding)), vc.lookup(this.host, function(i, s) {
        return i ? e(i, null) : (t.push("hostaddr=" + Qe(s)), e(null, t.join(" ")));
      });
    }
  };
  a(Rr, "ConnectionParameters");
  var Pr = Rr;
  Ds.exports = Pr;
});
var Ws = T((dd, Ns) => {
  "use strict";
  h();
  var Ec = Je(), qs = /^([A-Za-z]+)(?: (\d+))?(?: (\d+))?/, Br = class Br {
    constructor(e, t) {
      this.command = null, this.rowCount = null, this.oid = null, this.rows = [], this.fields = [], this._parsers = void 0, this._types = t, this.RowCtor = null, this.rowAsArray = e === "array", this.rowAsArray && (this.parseRow = this._parseRowAsArray);
    }
    addCommandComplete(e) {
      var t;
      e.text ? t = qs.exec(e.text) : t = qs.exec(e.command), t && (this.command = t[1], t[3] ? (this.oid = parseInt(
        t[2],
        10
      ), this.rowCount = parseInt(t[3], 10)) : t[2] && (this.rowCount = parseInt(t[2], 10)));
    }
    _parseRowAsArray(e) {
      for (var t = new Array(
        e.length
      ), n = 0, i = e.length; n < i; n++) {
        var s = e[n];
        s !== null ? t[n] = this._parsers[n](s) : t[n] = null;
      }
      return t;
    }
    parseRow(e) {
      for (var t = {}, n = 0, i = e.length; n < i; n++) {
        var s = e[n], o = this.fields[n].name;
        s !== null ? t[o] = this._parsers[n](
          s
        ) : t[o] = null;
      }
      return t;
    }
    addRow(e) {
      this.rows.push(e);
    }
    addFields(e) {
      this.fields = e, this.fields.length && (this._parsers = new Array(e.length));
      for (var t = 0; t < e.length; t++) {
        var n = e[t];
        this._types ? this._parsers[t] = this._types.getTypeParser(n.dataTypeID, n.format || "text") : this._parsers[t] = Ec.getTypeParser(n.dataTypeID, n.format || "text");
      }
    }
  };
  a(Br, "Result");
  var Lr = Br;
  Ns.exports = Lr;
});
var Gs = T((md, $s) => {
  "use strict";
  h();
  var { EventEmitter: Ac } = ve(), js = Ws(), Hs = rt(), Mr = class Mr extends Ac {
    constructor(e, t, n) {
      super(), e = Hs.normalizeQueryConfig(e, t, n), this.text = e.text, this.values = e.values, this.rows = e.rows, this.types = e.types, this.name = e.name, this.binary = e.binary, this.portal = e.portal || "", this.callback = e.callback, this._rowMode = e.rowMode, y.domain && e.callback && (this.callback = y.domain.bind(e.callback)), this._result = new js(this._rowMode, this.types), this._results = this._result, this.isPreparedStatement = false, this._canceledDueToError = false, this._promise = null;
    }
    requiresPreparation() {
      return this.name || this.rows ? true : !this.text || !this.values ? false : this.values.length > 0;
    }
    _checkForMultirow() {
      this._result.command && (Array.isArray(this._results) || (this._results = [this._result]), this._result = new js(this._rowMode, this.types), this._results.push(this._result));
    }
    handleRowDescription(e) {
      this._checkForMultirow(), this._result.addFields(e.fields), this._accumulateRows = this.callback || !this.listeners("row").length;
    }
    handleDataRow(e) {
      let t;
      if (!this._canceledDueToError) {
        try {
          t = this._result.parseRow(
            e.fields
          );
        } catch (n) {
          this._canceledDueToError = n;
          return;
        }
        this.emit("row", t, this._result), this._accumulateRows && this._result.addRow(t);
      }
    }
    handleCommandComplete(e, t) {
      this._checkForMultirow(), this._result.addCommandComplete(
        e
      ), this.rows && t.sync();
    }
    handleEmptyQuery(e) {
      this.rows && e.sync();
    }
    handleError(e, t) {
      if (this._canceledDueToError && (e = this._canceledDueToError, this._canceledDueToError = false), this.callback) return this.callback(e);
      this.emit("error", e);
    }
    handleReadyForQuery(e) {
      if (this._canceledDueToError) return this.handleError(
        this._canceledDueToError,
        e
      );
      if (this.callback) try {
        this.callback(null, this._results);
      } catch (t) {
        y.nextTick(() => {
          throw t;
        });
      }
      this.emit(
        "end",
        this._results
      );
    }
    submit(e) {
      if (typeof this.text != "string" && typeof this.name != "string") return new Error(
        "A query must have either text or a name. Supplying neither is unsupported."
      );
      let t = e.parsedStatements[this.name];
      return this.text && t && this.text !== t ? new Error(`Prepared statements must be unique - '${this.name}' was used for a different statement`) : this.values && !Array.isArray(this.values) ? new Error("Query values must be an array") : (this.requiresPreparation() ? this.prepare(e) : e.query(this.text), null);
    }
    hasBeenParsed(e) {
      return this.name && e.parsedStatements[this.name];
    }
    handlePortalSuspended(e) {
      this._getRows(e, this.rows);
    }
    _getRows(e, t) {
      e.execute({ portal: this.portal, rows: t }), t ? e.flush() : e.sync();
    }
    prepare(e) {
      this.isPreparedStatement = true, this.hasBeenParsed(e) || e.parse({ text: this.text, name: this.name, types: this.types });
      try {
        e.bind({ portal: this.portal, statement: this.name, values: this.values, binary: this.binary, valueMapper: Hs.prepareValue });
      } catch (t) {
        this.handleError(t, e);
        return;
      }
      e.describe({ type: "P", name: this.portal || "" }), this._getRows(e, this.rows);
    }
    handleCopyInResponse(e) {
      e.sendCopyFail("No source stream defined");
    }
    handleCopyData(e, t) {
    }
  };
  a(Mr, "Query");
  var Fr = Mr;
  $s.exports = Fr;
});
var ln = T((_) => {
  "use strict";
  h();
  Object.defineProperty(_, "__esModule", { value: true });
  _.NoticeMessage = _.DataRowMessage = _.CommandCompleteMessage = _.ReadyForQueryMessage = _.NotificationResponseMessage = _.BackendKeyDataMessage = _.AuthenticationMD5Password = _.ParameterStatusMessage = _.ParameterDescriptionMessage = _.RowDescriptionMessage = _.Field = _.CopyResponse = _.CopyDataMessage = _.DatabaseError = _.copyDone = _.emptyQuery = _.replicationStart = _.portalSuspended = _.noData = _.closeComplete = _.bindComplete = _.parseComplete = void 0;
  _.parseComplete = { name: "parseComplete", length: 5 };
  _.bindComplete = { name: "bindComplete", length: 5 };
  _.closeComplete = { name: "closeComplete", length: 5 };
  _.noData = { name: "noData", length: 5 };
  _.portalSuspended = { name: "portalSuspended", length: 5 };
  _.replicationStart = { name: "replicationStart", length: 4 };
  _.emptyQuery = { name: "emptyQuery", length: 4 };
  _.copyDone = { name: "copyDone", length: 4 };
  var Kr = class Kr extends Error {
    constructor(e, t, n) {
      super(e), this.length = t, this.name = n;
    }
  };
  a(Kr, "DatabaseError");
  var kr = Kr;
  _.DatabaseError = kr;
  var Yr = class Yr {
    constructor(e, t) {
      this.length = e, this.chunk = t, this.name = "copyData";
    }
  };
  a(Yr, "CopyDataMessage");
  var Or = Yr;
  _.CopyDataMessage = Or;
  var Zr = class Zr {
    constructor(e, t, n, i) {
      this.length = e, this.name = t, this.binary = n, this.columnTypes = new Array(i);
    }
  };
  a(Zr, "CopyResponse");
  var Ur = Zr;
  _.CopyResponse = Ur;
  var Jr = class Jr {
    constructor(e, t, n, i, s, o, u) {
      this.name = e, this.tableID = t, this.columnID = n, this.dataTypeID = i, this.dataTypeSize = s, this.dataTypeModifier = o, this.format = u;
    }
  };
  a(Jr, "Field");
  var Qr = Jr;
  _.Field = Qr;
  var Xr = class Xr {
    constructor(e, t) {
      this.length = e, this.fieldCount = t, this.name = "rowDescription", this.fields = new Array(this.fieldCount);
    }
  };
  a(Xr, "RowDescriptionMessage");
  var Dr = Xr;
  _.RowDescriptionMessage = Dr;
  var en = class en {
    constructor(e, t) {
      this.length = e, this.parameterCount = t, this.name = "parameterDescription", this.dataTypeIDs = new Array(this.parameterCount);
    }
  };
  a(en, "ParameterDescriptionMessage");
  var qr = en;
  _.ParameterDescriptionMessage = qr;
  var tn = class tn {
    constructor(e, t, n) {
      this.length = e, this.parameterName = t, this.parameterValue = n, this.name = "parameterStatus";
    }
  };
  a(tn, "ParameterStatusMessage");
  var Nr = tn;
  _.ParameterStatusMessage = Nr;
  var rn = class rn {
    constructor(e, t) {
      this.length = e, this.salt = t, this.name = "authenticationMD5Password";
    }
  };
  a(rn, "AuthenticationMD5Password");
  var Wr = rn;
  _.AuthenticationMD5Password = Wr;
  var nn = class nn {
    constructor(e, t, n) {
      this.length = e, this.processID = t, this.secretKey = n, this.name = "backendKeyData";
    }
  };
  a(nn, "BackendKeyDataMessage");
  var jr = nn;
  _.BackendKeyDataMessage = jr;
  var sn = class sn {
    constructor(e, t, n, i) {
      this.length = e, this.processId = t, this.channel = n, this.payload = i, this.name = "notification";
    }
  };
  a(sn, "NotificationResponseMessage");
  var Hr = sn;
  _.NotificationResponseMessage = Hr;
  var on = class on {
    constructor(e, t) {
      this.length = e, this.status = t, this.name = "readyForQuery";
    }
  };
  a(on, "ReadyForQueryMessage");
  var $r = on;
  _.ReadyForQueryMessage = $r;
  var an = class an {
    constructor(e, t) {
      this.length = e, this.text = t, this.name = "commandComplete";
    }
  };
  a(an, "CommandCompleteMessage");
  var Gr = an;
  _.CommandCompleteMessage = Gr;
  var un = class un {
    constructor(e, t) {
      this.length = e, this.fields = t, this.name = "dataRow", this.fieldCount = t.length;
    }
  };
  a(un, "DataRowMessage");
  var Vr = un;
  _.DataRowMessage = Vr;
  var cn = class cn {
    constructor(e, t) {
      this.length = e, this.message = t, this.name = "notice";
    }
  };
  a(cn, "NoticeMessage");
  var zr = cn;
  _.NoticeMessage = zr;
});
var Vs = T((Bt) => {
  "use strict";
  h();
  Object.defineProperty(Bt, "__esModule", { value: true });
  Bt.Writer = void 0;
  var hn = class hn {
    constructor(e = 256) {
      this.size = e, this.offset = 5, this.headerPosition = 0, this.buffer = p.allocUnsafe(e);
    }
    ensure(e) {
      if (this.buffer.length - this.offset < e) {
        let n = this.buffer, i = n.length + (n.length >> 1) + e;
        this.buffer = p.allocUnsafe(i), n.copy(
          this.buffer
        );
      }
    }
    addInt32(e) {
      return this.ensure(4), this.buffer[this.offset++] = e >>> 24 & 255, this.buffer[this.offset++] = e >>> 16 & 255, this.buffer[this.offset++] = e >>> 8 & 255, this.buffer[this.offset++] = e >>> 0 & 255, this;
    }
    addInt16(e) {
      return this.ensure(2), this.buffer[this.offset++] = e >>> 8 & 255, this.buffer[this.offset++] = e >>> 0 & 255, this;
    }
    addCString(e) {
      if (!e) this.ensure(1);
      else {
        let t = p.byteLength(e);
        this.ensure(t + 1), this.buffer.write(e, this.offset, "utf-8"), this.offset += t;
      }
      return this.buffer[this.offset++] = 0, this;
    }
    addString(e = "") {
      let t = p.byteLength(e);
      return this.ensure(t), this.buffer.write(e, this.offset), this.offset += t, this;
    }
    addInt32PrefixedString(e) {
      let t = p.byteLength(e);
      this.ensure(4 + t);
      let n = this.buffer, i = this.offset;
      return n[i++] = t >>> 24 & 255, n[i++] = t >>> 16 & 255, n[i++] = t >>> 8 & 255, n[i++] = t >>> 0 & 255, n.write(e, i, "utf-8"), this.offset = i + t, this;
    }
    add(e) {
      return this.ensure(e.length), e.copy(this.buffer, this.offset), this.offset += e.length, this;
    }
    join(e) {
      if (e) {
        this.buffer[this.headerPosition] = e;
        let t = this.offset - (this.headerPosition + 1);
        this.buffer.writeInt32BE(t, this.headerPosition + 1);
      }
      return this.buffer.slice(e ? 0 : 5, this.offset);
    }
    flush(e) {
      let t = this.join(e);
      return this.offset = 5, this.headerPosition = 0, this.buffer = p.allocUnsafe(this.size), t;
    }
    clear() {
      this.offset = 5, this.headerPosition = 0;
    }
  };
  a(hn, "Writer");
  var fn = hn;
  Bt.Writer = fn;
});
var Ks = T((Mt) => {
  "use strict";
  h();
  Object.defineProperty(Mt, "__esModule", { value: true });
  Mt.serialize = void 0;
  var dn = Vs(), L = new dn.Writer(), Cc = a((r) => {
    L.addInt16(3).addInt16(0);
    for (let n of Object.keys(r)) L.addCString(
      n
    ).addCString(r[n]);
    L.addCString("client_encoding").addCString("UTF8");
    let e = L.addCString("").flush(), t = e.length + 4;
    return new dn.Writer().addInt32(t).add(e).flush();
  }, "startup"), _c = a(() => {
    let r = p.allocUnsafe(
      8
    );
    return r.writeInt32BE(8, 0), r.writeInt32BE(80877103, 4), r;
  }, "requestSsl"), Tc = a((r) => L.addCString(r).flush(
    112
  ), "password"), Ic = a(function(r, e) {
    return L.addCString(r).addInt32PrefixedString(e), L.flush(112);
  }, "sendSASLInitialResponseMessage"), Pc = a(function(r) {
    return L.addString(r).flush(112);
  }, "sendSCRAMClientFinalMessage"), Rc = a((r) => L.addCString(r).flush(81), "query"), zs = [], Lc = a((r) => {
    let e = r.name || "";
    e.length > 63 && (console.error("Warning! Postgres only supports 63 characters for query names."), console.error("You supplied %s (%s)", e, e.length), console.error("This can cause conflicts and silent errors executing queries"));
    let t = r.types || zs, n = t.length, i = L.addCString(e).addCString(r.text).addInt16(n);
    for (let s = 0; s < n; s++) i.addInt32(t[s]);
    return L.flush(80);
  }, "parse"), De = new dn.Writer(), Bc = a(function(r, e) {
    for (let t = 0; t < r.length; t++) {
      let n = e ? e(r[t], t) : r[t];
      n == null ? (L.addInt16(0), De.addInt32(-1)) : n instanceof p ? (L.addInt16(
        1
      ), De.addInt32(n.length), De.add(n)) : (L.addInt16(0), De.addInt32PrefixedString(n));
    }
  }, "writeValues"), Fc = a(
    (r = {}) => {
      let e = r.portal || "", t = r.statement || "", n = r.binary || false, i = r.values || zs, s = i.length;
      L.addCString(
        e
      ).addCString(t), L.addInt16(s);
      try {
        Bc(i, r.valueMapper);
      } catch (o) {
        throw L.clear(), De.clear(), o;
      }
      return L.addInt16(s), L.add(De.flush()), L.addInt16(1), L.addInt16(n ? 1 : 0), L.flush(66);
    },
    "bind"
  ), Mc = p.from([
    69,
    0,
    0,
    0,
    9,
    0,
    0,
    0,
    0,
    0
  ]), kc = a((r) => {
    if (!r || !r.portal && !r.rows) return Mc;
    let e = r.portal || "", t = r.rows || 0, n = p.byteLength(
      e
    ), i = 4 + n + 1 + 4, s = p.allocUnsafe(1 + i);
    return s[0] = 69, s.writeInt32BE(i, 1), s.write(e, 5, "utf-8"), s[n + 5] = 0, s.writeUInt32BE(t, s.length - 4), s;
  }, "execute"), Oc = a((r, e) => {
    let t = p.allocUnsafe(16);
    return t.writeInt32BE(
      16,
      0
    ), t.writeInt16BE(1234, 4), t.writeInt16BE(5678, 6), t.writeInt32BE(r, 8), t.writeInt32BE(e, 12), t;
  }, "cancel"), pn = a((r, e) => {
    let n = 4 + p.byteLength(e) + 1, i = p.allocUnsafe(1 + n);
    return i[0] = r, i.writeInt32BE(n, 1), i.write(e, 5, "utf-8"), i[n] = 0, i;
  }, "cstringMessage"), Uc = L.addCString("P").flush(68), Qc = L.addCString("S").flush(68), Dc = a((r) => r.name ? pn(68, `${r.type}${r.name || ""}`) : r.type === "P" ? Uc : Qc, "describe"), qc = a((r) => {
    let e = `${r.type}${r.name || ""}`;
    return pn(67, e);
  }, "close"), Nc = a((r) => L.add(r).flush(100), "copyData"), Wc = a((r) => pn(
    102,
    r
  ), "copyFail"), Ft = a((r) => p.from([r, 0, 0, 0, 4]), "codeOnlyBuffer"), jc = Ft(72), Hc = Ft(83), $c = Ft(88), Gc = Ft(99), Vc = {
    startup: Cc,
    password: Tc,
    requestSsl: _c,
    sendSASLInitialResponseMessage: Ic,
    sendSCRAMClientFinalMessage: Pc,
    query: Rc,
    parse: Lc,
    bind: Fc,
    execute: kc,
    describe: Dc,
    close: qc,
    flush: a(() => jc, "flush"),
    sync: a(() => Hc, "sync"),
    end: a(() => $c, "end"),
    copyData: Nc,
    copyDone: a(() => Gc, "copyDone"),
    copyFail: Wc,
    cancel: Oc
  };
  Mt.serialize = Vc;
});
var Ys = T((kt) => {
  "use strict";
  h();
  Object.defineProperty(kt, "__esModule", { value: true });
  kt.BufferReader = void 0;
  var mn = class mn {
    constructor(e = 0) {
      this.offset = e, this.buffer = p.allocUnsafe(0), this.encoding = "utf-8";
    }
    setBuffer(e, t) {
      this.offset = e, this.buffer = t;
    }
    int16() {
      let e = this.buffer.readInt16BE(this.offset);
      return this.offset += 2, e;
    }
    byte() {
      let e = this.buffer[this.offset];
      return this.offset++, e;
    }
    int32() {
      let e = this.buffer.readInt32BE(
        this.offset
      );
      return this.offset += 4, e;
    }
    uint32() {
      let e = this.buffer.readUInt32BE(this.offset);
      return this.offset += 4, e;
    }
    string(e) {
      let t = this.buffer.toString(this.encoding, this.offset, this.offset + e);
      return this.offset += e, t;
    }
    cstring() {
      let e = this.offset, t = e;
      for (; this.buffer[t++]; ) ;
      return this.offset = t, this.buffer.toString(this.encoding, e, t - 1);
    }
    bytes(e) {
      let t = this.buffer.slice(this.offset, this.offset + e);
      return this.offset += e, t;
    }
  };
  a(mn, "BufferReader");
  var yn = mn;
  kt.BufferReader = yn;
});
var eo = T((Ot) => {
  "use strict";
  h();
  Object.defineProperty(Ot, "__esModule", { value: true });
  Ot.Parser = void 0;
  var F = ln(), zc = Ys(), wn = 1, Kc = 4, Zs = wn + Kc, Z = -1, gn = p.allocUnsafe(0), xn = class xn {
    constructor(e) {
      if (this.buffer = gn, this.bufferLength = 0, this.bufferOffset = 0, this.reader = new zc.BufferReader(), e?.mode === "binary") throw new Error(
        "Binary mode not supported yet"
      );
      this.mode = e?.mode || "text";
    }
    parse(e, t) {
      this.mergeBuffer(e);
      let n = this.bufferOffset + this.bufferLength, i = this.bufferOffset;
      for (; i + Zs <= n; ) {
        let s = this.buffer[i], o = this.buffer.readUInt32BE(i + wn), u = wn + o;
        if (u + i <= n) {
          let c = this.handlePacket(i + Zs, s, o, this.buffer);
          t(c), i += u;
        } else break;
      }
      i === n ? (this.buffer = gn, this.bufferLength = 0, this.bufferOffset = 0) : (this.bufferLength = n - i, this.bufferOffset = i);
    }
    mergeBuffer(e) {
      if (this.bufferLength > 0) {
        let t = this.bufferLength + e.byteLength;
        if (t + this.bufferOffset > this.buffer.byteLength) {
          let i;
          if (t <= this.buffer.byteLength && this.bufferOffset >= this.bufferLength) i = this.buffer;
          else {
            let s = this.buffer.byteLength * 2;
            for (; t >= s; ) s *= 2;
            i = p.allocUnsafe(s);
          }
          this.buffer.copy(i, 0, this.bufferOffset, this.bufferOffset + this.bufferLength), this.buffer = i, this.bufferOffset = 0;
        }
        e.copy(
          this.buffer,
          this.bufferOffset + this.bufferLength
        ), this.bufferLength = t;
      } else this.buffer = e, this.bufferOffset = 0, this.bufferLength = e.byteLength;
    }
    handlePacket(e, t, n, i) {
      let { reader: s } = this;
      s.setBuffer(e, i);
      let o;
      switch (t) {
        case 50:
          o = F.bindComplete;
          break;
        case 49:
          o = F.parseComplete;
          break;
        case 51:
          o = F.closeComplete;
          break;
        case 110:
          o = F.noData;
          break;
        case 115:
          o = F.portalSuspended;
          break;
        case 99:
          o = F.copyDone;
          break;
        case 87:
          o = F.replicationStart;
          break;
        case 73:
          o = F.emptyQuery;
          break;
        case 68:
          o = sl(s);
          break;
        case 67:
          o = Zc(s);
          break;
        case 90:
          o = Yc(s);
          break;
        case 65:
          o = tl(s);
          break;
        case 82:
          o = ul(s, n);
          break;
        case 83:
          o = ol(s);
          break;
        case 75:
          o = al(s);
          break;
        case 69:
          o = Js(s, "error");
          break;
        case 78:
          o = Js(s, "notice");
          break;
        case 84:
          o = rl(s);
          break;
        case 116:
          o = il(s);
          break;
        case 71:
          o = Xc(
            s
          );
          break;
        case 72:
          o = el(s);
          break;
        case 100:
          o = Jc(s, n);
          break;
        default:
          return new F.DatabaseError("received invalid response: " + t.toString(16), n, "error");
      }
      return s.setBuffer(0, gn), o.length = n, o;
    }
  };
  a(xn, "Parser");
  var bn = xn;
  Ot.Parser = bn;
  var Yc = a((r) => {
    let e = r.string(1);
    return new F.ReadyForQueryMessage(Z, e);
  }, "parseReadyForQueryMessage"), Zc = a((r) => {
    let e = r.cstring();
    return new F.CommandCompleteMessage(Z, e);
  }, "parseCommandCompleteMessage"), Jc = a((r, e) => {
    let t = r.bytes(e - 4);
    return new F.CopyDataMessage(Z, t);
  }, "parseCopyData"), Xc = a((r) => Xs(r, "copyInResponse"), "parseCopyInMessage"), el = a((r) => Xs(r, "copyOutResponse"), "parseCopyOutMessage"), Xs = a((r, e) => {
    let t = r.byte() !== 0, n = r.int16(), i = new F.CopyResponse(Z, e, t, n);
    for (let s = 0; s < n; s++) i.columnTypes[s] = r.int16();
    return i;
  }, "parseCopyMessage"), tl = a((r) => {
    let e = r.int32(), t = r.cstring(), n = r.cstring();
    return new F.NotificationResponseMessage(Z, e, t, n);
  }, "parseNotificationMessage"), rl = a((r) => {
    let e = r.int16(), t = new F.RowDescriptionMessage(Z, e);
    for (let n = 0; n < e; n++) t.fields[n] = nl(r);
    return t;
  }, "parseRowDescriptionMessage"), nl = a((r) => {
    let e = r.cstring(), t = r.uint32(), n = r.int16(), i = r.uint32(), s = r.int16(), o = r.int32(), u = r.int16() === 0 ? "text" : "binary";
    return new F.Field(e, t, n, i, s, o, u);
  }, "parseField"), il = a((r) => {
    let e = r.int16(), t = new F.ParameterDescriptionMessage(Z, e);
    for (let n = 0; n < e; n++) t.dataTypeIDs[n] = r.uint32();
    return t;
  }, "parseParameterDescriptionMessage"), sl = a((r) => {
    let e = r.int16(), t = new Array(e);
    for (let n = 0; n < e; n++) {
      let i = r.int32();
      t[n] = i === -1 ? null : r.string(i);
    }
    return new F.DataRowMessage(Z, t);
  }, "parseDataRowMessage"), ol = a((r) => {
    let e = r.cstring(), t = r.cstring();
    return new F.ParameterStatusMessage(Z, e, t);
  }, "parseParameterStatusMessage"), al = a((r) => {
    let e = r.int32(), t = r.int32();
    return new F.BackendKeyDataMessage(
      Z,
      e,
      t
    );
  }, "parseBackendKeyData"), ul = a((r, e) => {
    let t = r.int32(), n = { name: "authenticationOk", length: e };
    switch (t) {
      case 0:
        break;
      case 3:
        n.length === 8 && (n.name = "authenticationCleartextPassword");
        break;
      case 5:
        if (n.length === 12) {
          n.name = "authenticationMD5Password";
          let i = r.bytes(4);
          return new F.AuthenticationMD5Password(Z, i);
        }
        break;
      case 10:
        {
          n.name = "authenticationSASL", n.mechanisms = [];
          let i;
          do
            i = r.cstring(), i && n.mechanisms.push(i);
          while (i);
        }
        break;
      case 11:
        n.name = "authenticationSASLContinue", n.data = r.string(e - 8);
        break;
      case 12:
        n.name = "authenticationSASLFinal", n.data = r.string(e - 8);
        break;
      default:
        throw new Error("Unknown authenticationOk message type " + t);
    }
    return n;
  }, "parseAuthenticationResponse"), Js = a((r, e) => {
    let t = {}, n = r.string(1);
    for (; n !== "\0"; ) t[n] = r.cstring(), n = r.string(1);
    let i = t.M, s = e === "notice" ? new F.NoticeMessage(Z, i) : new F.DatabaseError(
      i,
      Z,
      e
    );
    return s.severity = t.S, s.code = t.C, s.detail = t.D, s.hint = t.H, s.position = t.P, s.internalPosition = t.p, s.internalQuery = t.q, s.where = t.W, s.schema = t.s, s.table = t.t, s.column = t.c, s.dataType = t.d, s.constraint = t.n, s.file = t.F, s.line = t.L, s.routine = t.R, s;
  }, "parseErrorMessage");
});
var vn = T((_e) => {
  "use strict";
  h();
  Object.defineProperty(_e, "__esModule", { value: true });
  _e.DatabaseError = _e.serialize = void 0;
  _e.parse = hl;
  var cl = ln();
  Object.defineProperty(_e, "DatabaseError", { enumerable: true, get: a(
    function() {
      return cl.DatabaseError;
    },
    "get"
  ) });
  var ll = Ks();
  Object.defineProperty(_e, "serialize", {
    enumerable: true,
    get: a(function() {
      return ll.serialize;
    }, "get")
  });
  var fl = eo();
  function hl(r, e) {
    let t = new fl.Parser();
    return r.on("data", (n) => t.parse(n, e)), new Promise((n) => r.on("end", () => n()));
  }
  a(hl, "parse");
});
var to = {};
se(to, { connect: () => dl });
function dl({ socket: r, servername: e }) {
  return r.startTls(e), r;
}
var ro = V(
  () => {
    "use strict";
    h();
    a(dl, "connect");
  }
);
var An = T((Dd, so) => {
  "use strict";
  h();
  var no = (Ge(), O(Ii)), pl = ve().EventEmitter, { parse: yl, serialize: Q } = vn(), io = Q.flush(), ml = Q.sync(), gl = Q.end(), En = class En extends pl {
    constructor(e) {
      super(), e = e || {}, this.stream = e.stream || new no.Socket(), this._keepAlive = e.keepAlive, this._keepAliveInitialDelayMillis = e.keepAliveInitialDelayMillis, this.lastBuffer = false, this.parsedStatements = {}, this.ssl = e.ssl || false, this._ending = false, this._emitMessage = false;
      var t = this;
      this.on("newListener", function(n) {
        n === "message" && (t._emitMessage = true);
      });
    }
    connect(e, t) {
      var n = this;
      this._connecting = true, this.stream.setNoDelay(true), this.stream.connect(e, t), this.stream.once("connect", function() {
        n._keepAlive && n.stream.setKeepAlive(true, n._keepAliveInitialDelayMillis), n.emit("connect");
      });
      let i = a(function(s) {
        n._ending && (s.code === "ECONNRESET" || s.code === "EPIPE") || n.emit("error", s);
      }, "reportStreamError");
      if (this.stream.on("error", i), this.stream.on("close", function() {
        n.emit("end");
      }), !this.ssl) return this.attachListeners(
        this.stream
      );
      this.stream.once("data", function(s) {
        var o = s.toString("utf8");
        switch (o) {
          case "S":
            break;
          case "N":
            return n.stream.end(), n.emit("error", new Error("The server does not support SSL connections"));
          default:
            return n.stream.end(), n.emit("error", new Error("There was an error establishing an SSL connection"));
        }
        var u = (ro(), O(to));
        let c = { socket: n.stream };
        n.ssl !== true && (Object.assign(c, n.ssl), "key" in n.ssl && (c.key = n.ssl.key)), no.isIP(t) === 0 && (c.servername = t);
        try {
          n.stream = u.connect(c);
        } catch (l) {
          return n.emit(
            "error",
            l
          );
        }
        n.attachListeners(n.stream), n.stream.on("error", i), n.emit("sslconnect");
      });
    }
    attachListeners(e) {
      e.on(
        "end",
        () => {
          this.emit("end");
        }
      ), yl(e, (t) => {
        var n = t.name === "error" ? "errorMessage" : t.name;
        this._emitMessage && this.emit("message", t), this.emit(n, t);
      });
    }
    requestSsl() {
      this.stream.write(Q.requestSsl());
    }
    startup(e) {
      this.stream.write(Q.startup(e));
    }
    cancel(e, t) {
      this._send(Q.cancel(e, t));
    }
    password(e) {
      this._send(Q.password(e));
    }
    sendSASLInitialResponseMessage(e, t) {
      this._send(Q.sendSASLInitialResponseMessage(e, t));
    }
    sendSCRAMClientFinalMessage(e) {
      this._send(Q.sendSCRAMClientFinalMessage(
        e
      ));
    }
    _send(e) {
      return this.stream.writable ? this.stream.write(e) : false;
    }
    query(e) {
      this._send(Q.query(e));
    }
    parse(e) {
      this._send(Q.parse(e));
    }
    bind(e) {
      this._send(Q.bind(e));
    }
    execute(e) {
      this._send(Q.execute(e));
    }
    flush() {
      this.stream.writable && this.stream.write(io);
    }
    sync() {
      this._ending = true, this._send(io), this._send(ml);
    }
    ref() {
      this.stream.ref();
    }
    unref() {
      this.stream.unref();
    }
    end() {
      if (this._ending = true, !this._connecting || !this.stream.writable) {
        this.stream.end();
        return;
      }
      return this.stream.write(gl, () => {
        this.stream.end();
      });
    }
    close(e) {
      this._send(Q.close(e));
    }
    describe(e) {
      this._send(Q.describe(e));
    }
    sendCopyFromChunk(e) {
      this._send(Q.copyData(e));
    }
    endCopyFrom() {
      this._send(Q.copyDone());
    }
    sendCopyFail(e) {
      this._send(Q.copyFail(e));
    }
  };
  a(En, "Connection");
  var Sn = En;
  so.exports = Sn;
});
var uo = T((jd, ao) => {
  "use strict";
  h();
  var wl = ve().EventEmitter, Wd = (it(), O(nt)), bl = rt(), Cn = xs(), xl = Ls(), vl = _t(), Sl = Lt(), oo = Gs(), El = tt(), Al = An(), _n = class _n extends wl {
    constructor(e) {
      super(), this.connectionParameters = new Sl(e), this.user = this.connectionParameters.user, this.database = this.connectionParameters.database, this.port = this.connectionParameters.port, this.host = this.connectionParameters.host, Object.defineProperty(
        this,
        "password",
        { configurable: true, enumerable: false, writable: true, value: this.connectionParameters.password }
      ), this.replication = this.connectionParameters.replication;
      var t = e || {};
      this._Promise = t.Promise || b.Promise, this._types = new vl(t.types), this._ending = false, this._connecting = false, this._connected = false, this._connectionError = false, this._queryable = true, this.connection = t.connection || new Al({ stream: t.stream, ssl: this.connectionParameters.ssl, keepAlive: t.keepAlive || false, keepAliveInitialDelayMillis: t.keepAliveInitialDelayMillis || 0, encoding: this.connectionParameters.client_encoding || "utf8" }), this.queryQueue = [], this.binary = t.binary || El.binary, this.processID = null, this.secretKey = null, this.ssl = this.connectionParameters.ssl || false, this.ssl && this.ssl.key && Object.defineProperty(this.ssl, "key", { enumerable: false }), this._connectionTimeoutMillis = t.connectionTimeoutMillis || 0;
    }
    _errorAllQueries(e) {
      let t = a((n) => {
        y.nextTick(() => {
          n.handleError(e, this.connection);
        });
      }, "enqueueError");
      this.activeQuery && (t(this.activeQuery), this.activeQuery = null), this.queryQueue.forEach(t), this.queryQueue.length = 0;
    }
    _connect(e) {
      var t = this, n = this.connection;
      if (this._connectionCallback = e, this._connecting || this._connected) {
        let i = new Error("Client has already been connected. You cannot reuse a client.");
        y.nextTick(
          () => {
            e(i);
          }
        );
        return;
      }
      this._connecting = true, this.connectionTimeoutHandle, this._connectionTimeoutMillis > 0 && (this.connectionTimeoutHandle = setTimeout(() => {
        n._ending = true, n.stream.destroy(new Error("timeout expired"));
      }, this._connectionTimeoutMillis)), this.host && this.host.indexOf("/") === 0 ? n.connect(this.host + "/.s.PGSQL." + this.port) : n.connect(this.port, this.host), n.on("connect", function() {
        t.ssl ? n.requestSsl() : n.startup(t.getStartupConf());
      }), n.on("sslconnect", function() {
        n.startup(t.getStartupConf());
      }), this._attachListeners(
        n
      ), n.once("end", () => {
        let i = this._ending ? new Error("Connection terminated") : new Error("Connection terminated unexpectedly");
        clearTimeout(this.connectionTimeoutHandle), this._errorAllQueries(i), this._ending || (this._connecting && !this._connectionError ? this._connectionCallback ? this._connectionCallback(i) : this._handleErrorEvent(i) : this._connectionError || this._handleErrorEvent(i)), y.nextTick(() => {
          this.emit("end");
        });
      });
    }
    connect(e) {
      if (e) {
        this._connect(e);
        return;
      }
      return new this._Promise((t, n) => {
        this._connect((i) => {
          i ? n(i) : t();
        });
      });
    }
    _attachListeners(e) {
      e.on("authenticationCleartextPassword", this._handleAuthCleartextPassword.bind(this)), e.on("authenticationMD5Password", this._handleAuthMD5Password.bind(this)), e.on("authenticationSASL", this._handleAuthSASL.bind(this)), e.on("authenticationSASLContinue", this._handleAuthSASLContinue.bind(this)), e.on("authenticationSASLFinal", this._handleAuthSASLFinal.bind(this)), e.on("backendKeyData", this._handleBackendKeyData.bind(this)), e.on("error", this._handleErrorEvent.bind(this)), e.on("errorMessage", this._handleErrorMessage.bind(this)), e.on("readyForQuery", this._handleReadyForQuery.bind(this)), e.on("notice", this._handleNotice.bind(this)), e.on("rowDescription", this._handleRowDescription.bind(this)), e.on("dataRow", this._handleDataRow.bind(this)), e.on("portalSuspended", this._handlePortalSuspended.bind(
        this
      )), e.on("emptyQuery", this._handleEmptyQuery.bind(this)), e.on("commandComplete", this._handleCommandComplete.bind(this)), e.on("parseComplete", this._handleParseComplete.bind(this)), e.on("copyInResponse", this._handleCopyInResponse.bind(this)), e.on("copyData", this._handleCopyData.bind(this)), e.on("notification", this._handleNotification.bind(this));
    }
    _checkPgPass(e) {
      let t = this.connection;
      typeof this.password == "function" ? this._Promise.resolve().then(() => this.password()).then((n) => {
        if (n !== void 0) {
          if (typeof n != "string") {
            t.emit("error", new TypeError(
              "Password must be a string"
            ));
            return;
          }
          this.connectionParameters.password = this.password = n;
        } else this.connectionParameters.password = this.password = null;
        e();
      }).catch((n) => {
        t.emit("error", n);
      }) : this.password !== null ? e() : xl(
        this.connectionParameters,
        (n) => {
          n !== void 0 && (this.connectionParameters.password = this.password = n), e();
        }
      );
    }
    _handleAuthCleartextPassword(e) {
      this._checkPgPass(() => {
        this.connection.password(this.password);
      });
    }
    _handleAuthMD5Password(e) {
      this._checkPgPass(
        () => {
          let t = bl.postgresMd5PasswordHash(this.user, this.password, e.salt);
          this.connection.password(t);
        }
      );
    }
    _handleAuthSASL(e) {
      this._checkPgPass(() => {
        this.saslSession = Cn.startSession(e.mechanisms), this.connection.sendSASLInitialResponseMessage(
          this.saslSession.mechanism,
          this.saslSession.response
        );
      });
    }
    _handleAuthSASLContinue(e) {
      Cn.continueSession(
        this.saslSession,
        this.password,
        e.data
      ), this.connection.sendSCRAMClientFinalMessage(this.saslSession.response);
    }
    _handleAuthSASLFinal(e) {
      Cn.finalizeSession(this.saslSession, e.data), this.saslSession = null;
    }
    _handleBackendKeyData(e) {
      this.processID = e.processID, this.secretKey = e.secretKey;
    }
    _handleReadyForQuery(e) {
      this._connecting && (this._connecting = false, this._connected = true, clearTimeout(this.connectionTimeoutHandle), this._connectionCallback && (this._connectionCallback(null, this), this._connectionCallback = null), this.emit("connect"));
      let { activeQuery: t } = this;
      this.activeQuery = null, this.readyForQuery = true, t && t.handleReadyForQuery(this.connection), this._pulseQueryQueue();
    }
    _handleErrorWhileConnecting(e) {
      if (!this._connectionError) {
        if (this._connectionError = true, clearTimeout(this.connectionTimeoutHandle), this._connectionCallback) return this._connectionCallback(e);
        this.emit("error", e);
      }
    }
    _handleErrorEvent(e) {
      if (this._connecting) return this._handleErrorWhileConnecting(e);
      this._queryable = false, this._errorAllQueries(e), this.emit("error", e);
    }
    _handleErrorMessage(e) {
      if (this._connecting) return this._handleErrorWhileConnecting(e);
      let t = this.activeQuery;
      if (!t) {
        this._handleErrorEvent(e);
        return;
      }
      this.activeQuery = null, t.handleError(
        e,
        this.connection
      );
    }
    _handleRowDescription(e) {
      this.activeQuery.handleRowDescription(e);
    }
    _handleDataRow(e) {
      this.activeQuery.handleDataRow(e);
    }
    _handlePortalSuspended(e) {
      this.activeQuery.handlePortalSuspended(this.connection);
    }
    _handleEmptyQuery(e) {
      this.activeQuery.handleEmptyQuery(this.connection);
    }
    _handleCommandComplete(e) {
      this.activeQuery.handleCommandComplete(e, this.connection);
    }
    _handleParseComplete(e) {
      this.activeQuery.name && (this.connection.parsedStatements[this.activeQuery.name] = this.activeQuery.text);
    }
    _handleCopyInResponse(e) {
      this.activeQuery.handleCopyInResponse(this.connection);
    }
    _handleCopyData(e) {
      this.activeQuery.handleCopyData(
        e,
        this.connection
      );
    }
    _handleNotification(e) {
      this.emit("notification", e);
    }
    _handleNotice(e) {
      this.emit("notice", e);
    }
    getStartupConf() {
      var e = this.connectionParameters, t = { user: e.user, database: e.database }, n = e.application_name || e.fallback_application_name;
      return n && (t.application_name = n), e.replication && (t.replication = "" + e.replication), e.statement_timeout && (t.statement_timeout = String(parseInt(e.statement_timeout, 10))), e.lock_timeout && (t.lock_timeout = String(parseInt(e.lock_timeout, 10))), e.idle_in_transaction_session_timeout && (t.idle_in_transaction_session_timeout = String(parseInt(e.idle_in_transaction_session_timeout, 10))), e.options && (t.options = e.options), t;
    }
    cancel(e, t) {
      if (e.activeQuery === t) {
        var n = this.connection;
        this.host && this.host.indexOf("/") === 0 ? n.connect(this.host + "/.s.PGSQL." + this.port) : n.connect(this.port, this.host), n.on("connect", function() {
          n.cancel(
            e.processID,
            e.secretKey
          );
        });
      } else e.queryQueue.indexOf(t) !== -1 && e.queryQueue.splice(e.queryQueue.indexOf(t), 1);
    }
    setTypeParser(e, t, n) {
      return this._types.setTypeParser(e, t, n);
    }
    getTypeParser(e, t) {
      return this._types.getTypeParser(e, t);
    }
    escapeIdentifier(e) {
      return '"' + e.replace(/"/g, '""') + '"';
    }
    escapeLiteral(e) {
      for (var t = false, n = "'", i = 0; i < e.length; i++) {
        var s = e[i];
        s === "'" ? n += s + s : s === "\\" ? (n += s + s, t = true) : n += s;
      }
      return n += "'", t === true && (n = " E" + n), n;
    }
    _pulseQueryQueue() {
      if (this.readyForQuery === true) if (this.activeQuery = this.queryQueue.shift(), this.activeQuery) {
        this.readyForQuery = false, this.hasExecuted = true;
        let e = this.activeQuery.submit(this.connection);
        e && y.nextTick(() => {
          this.activeQuery.handleError(e, this.connection), this.readyForQuery = true, this._pulseQueryQueue();
        });
      } else this.hasExecuted && (this.activeQuery = null, this.emit("drain"));
    }
    query(e, t, n) {
      var i, s, o, u, c;
      if (e == null) throw new TypeError(
        "Client was passed a null or undefined query"
      );
      return typeof e.submit == "function" ? (o = e.query_timeout || this.connectionParameters.query_timeout, s = i = e, typeof t == "function" && (i.callback = i.callback || t)) : (o = this.connectionParameters.query_timeout, i = new oo(e, t, n), i.callback || (s = new this._Promise((l, f) => {
        i.callback = (m, g) => m ? f(m) : l(g);
      }))), o && (c = i.callback, u = setTimeout(() => {
        var l = new Error("Query read timeout");
        y.nextTick(
          () => {
            i.handleError(l, this.connection);
          }
        ), c(l), i.callback = () => {
        };
        var f = this.queryQueue.indexOf(i);
        f > -1 && this.queryQueue.splice(f, 1), this._pulseQueryQueue();
      }, o), i.callback = (l, f) => {
        clearTimeout(u), c(l, f);
      }), this.binary && !i.binary && (i.binary = true), i._result && !i._result._types && (i._result._types = this._types), this._queryable ? this._ending ? (y.nextTick(() => {
        i.handleError(new Error("Client was closed and is not queryable"), this.connection);
      }), s) : (this.queryQueue.push(i), this._pulseQueryQueue(), s) : (y.nextTick(() => {
        i.handleError(new Error("Client has encountered a connection error and is not queryable"), this.connection);
      }), s);
    }
    ref() {
      this.connection.ref();
    }
    unref() {
      this.connection.unref();
    }
    end(e) {
      if (this._ending = true, !this.connection._connecting) if (e) e();
      else return this._Promise.resolve();
      if (this.activeQuery || !this._queryable ? this.connection.stream.destroy() : this.connection.end(), e) this.connection.once("end", e);
      else return new this._Promise((t) => {
        this.connection.once("end", t);
      });
    }
  };
  a(_n, "Client");
  var Ut = _n;
  Ut.Query = oo;
  ao.exports = Ut;
});
var fo = T((Gd, lo) => {
  "use strict";
  h();
  var Cl = ve().EventEmitter, Tn = a(function() {
  }, "NOOP"), co = a((r, e) => {
    let t = r.findIndex(e);
    return t === -1 ? void 0 : r.splice(t, 1)[0];
  }, "removeWhere"), Rn = class Rn {
    constructor(e, t, n) {
      this.client = e, this.idleListener = t, this.timeoutId = n;
    }
  };
  a(Rn, "IdleItem");
  var In = Rn, Ln = class Ln {
    constructor(e) {
      this.callback = e;
    }
  };
  a(Ln, "PendingItem");
  var qe = Ln;
  function _l() {
    throw new Error("Release called on client which has already been released to the pool.");
  }
  a(_l, "throwOnDoubleRelease");
  function Qt(r, e) {
    if (e)
      return { callback: e, result: void 0 };
    let t, n, i = a(function(o, u) {
      o ? t(o) : n(u);
    }, "cb"), s = new r(function(o, u) {
      n = o, t = u;
    }).catch((o) => {
      throw Error.captureStackTrace(o), o;
    });
    return { callback: i, result: s };
  }
  a(Qt, "promisify");
  function Tl(r, e) {
    return a(function t(n) {
      n.client = e, e.removeListener("error", t), e.on("error", () => {
        r.log(
          "additional client error after disconnection due to error",
          n
        );
      }), r._remove(e), r.emit("error", n, e);
    }, "idleListener");
  }
  a(Tl, "makeIdleListener");
  var Bn = class Bn extends Cl {
    constructor(e, t) {
      super(), this.options = Object.assign({}, e), e != null && "password" in e && Object.defineProperty(this.options, "password", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: e.password
      }), e != null && e.ssl && e.ssl.key && Object.defineProperty(this.options.ssl, "key", { enumerable: false }), this.options.max = this.options.max || this.options.poolSize || 10, this.options.min = this.options.min || 0, this.options.maxUses = this.options.maxUses || 1 / 0, this.options.allowExitOnIdle = this.options.allowExitOnIdle || false, this.options.maxLifetimeSeconds = this.options.maxLifetimeSeconds || 0, this.log = this.options.log || function() {
      }, this.Client = this.options.Client || t || ot().Client, this.Promise = this.options.Promise || b.Promise, typeof this.options.idleTimeoutMillis > "u" && (this.options.idleTimeoutMillis = 1e4), this._clients = [], this._idle = [], this._expired = /* @__PURE__ */ new WeakSet(), this._pendingQueue = [], this._endCallback = void 0, this.ending = false, this.ended = false;
    }
    _promiseTry(e) {
      let t = this.Promise;
      return typeof t.try == "function" ? t.try(e) : new t((n) => n(e()));
    }
    _isFull() {
      return this._clients.length >= this.options.max;
    }
    _isAboveMin() {
      return this._clients.length > this.options.min;
    }
    _pulseQueue() {
      if (this.log("pulse queue"), this.ended) {
        this.log("pulse queue ended");
        return;
      }
      if (this.ending) {
        this.log("pulse queue on ending"), this._idle.length && this._idle.slice().map((t) => {
          this._remove(t.client);
        }), this._clients.length || (this.ended = true, this._endCallback());
        return;
      }
      if (!this._pendingQueue.length) {
        this.log("no queued requests");
        return;
      }
      if (!this._idle.length && this._isFull())
        return;
      let e = this._pendingQueue.shift();
      if (this._idle.length) {
        let t = this._idle.pop();
        clearTimeout(t.timeoutId);
        let n = t.client;
        n.ref && n.ref();
        let i = t.idleListener;
        return this._acquireClient(n, e, i, false);
      }
      if (!this._isFull()) return this.newClient(e);
      throw new Error("unexpected condition");
    }
    _remove(e, t) {
      let n = co(this._idle, (s) => s.client === e);
      n !== void 0 && clearTimeout(n.timeoutId), this._clients = this._clients.filter((s) => s !== e);
      let i = this;
      e.end(() => {
        i.emit("remove", e), typeof t == "function" && t();
      });
    }
    connect(e) {
      if (this.ending) {
        let i = new Error(
          "Cannot use a pool after calling end on the pool"
        );
        return e ? e(i) : this.Promise.reject(i);
      }
      let t = Qt(this.Promise, e), n = t.result;
      if (this._isFull() || this._idle.length) {
        if (this._idle.length && y.nextTick(() => this._pulseQueue()), !this.options.connectionTimeoutMillis) return this._pendingQueue.push(new qe(t.callback)), n;
        let i = a((u, c, l) => {
          clearTimeout(o), t.callback(u, c, l);
        }, "queueCallback"), s = new qe(i), o = setTimeout(() => {
          co(this._pendingQueue, (u) => u.callback === i), s.timedOut = true, t.callback(new Error("timeout exceeded when trying to connect"));
        }, this.options.connectionTimeoutMillis);
        return o.unref && o.unref(), this._pendingQueue.push(s), n;
      }
      return this.newClient(new qe(t.callback)), n;
    }
    newClient(e) {
      let t = new this.Client(this.options);
      this._clients.push(t);
      let n = Tl(this, t);
      this.log("checking client timeout");
      let i, s = false;
      this.options.connectionTimeoutMillis && (i = setTimeout(() => {
        t.connection ? (this.log("ending client due to timeout"), s = true, t.connection.stream.destroy()) : t.isConnected() || (this.log("ending client due to timeout"), s = true, t.end());
      }, this.options.connectionTimeoutMillis)), this.log("connecting new client"), t.connect((o) => {
        if (i && clearTimeout(i), t.on("error", n), o) this.log("client failed to connect", o), this._clients = this._clients.filter((u) => u !== t), s && (o = new Error("Connection terminated due to connection timeout", { cause: o })), this._pulseQueue(), e.timedOut || e.callback(
          o,
          void 0,
          Tn
        );
        else {
          if (this.log("new client connected"), this.options.onConnect) {
            this._promiseTry(() => this.options.onConnect(t)).then(() => {
              this._afterConnect(t, e, n);
            }, (u) => {
              this._clients = this._clients.filter((c) => c !== t), t.end(() => {
                this._pulseQueue(), e.timedOut || e.callback(u, void 0, Tn);
              });
            });
            return;
          }
          return this._afterConnect(
            t,
            e,
            n
          );
        }
      });
    }
    _afterConnect(e, t, n) {
      if (this.options.maxLifetimeSeconds !== 0) {
        let i = setTimeout(() => {
          this.log(
            "ending client due to expired lifetime"
          ), this._expired.add(e), this._idle.findIndex((o) => o.client === e) !== -1 && this._acquireClient(e, new qe((o, u, c) => c()), n, false);
        }, this.options.maxLifetimeSeconds * 1e3);
        i.unref(), e.once("end", () => clearTimeout(i));
      }
      return this._acquireClient(e, t, n, true);
    }
    _acquireClient(e, t, n, i) {
      i && this.emit("connect", e), this.emit("acquire", e), e.release = this._releaseOnce(e, n), e.removeListener("error", n), t.timedOut ? i && this.options.verify ? this.options.verify(e, e.release) : e.release() : i && this.options.verify ? this.options.verify(e, (s) => {
        if (s) return e.release(s), t.callback(s, void 0, Tn);
        t.callback(void 0, e, e.release);
      }) : t.callback(void 0, e, e.release);
    }
    _releaseOnce(e, t) {
      let n = false;
      return (i) => {
        n && _l(), n = true, this._release(
          e,
          t,
          i
        );
      };
    }
    _release(e, t, n) {
      if (e.on("error", t), e._poolUseCount = (e._poolUseCount || 0) + 1, this.emit(
        "release",
        n,
        e
      ), n || this.ending || !e._queryable || e._ending || e._poolUseCount >= this.options.maxUses) return e._poolUseCount >= this.options.maxUses && this.log("remove expended client"), this._remove(e, this._pulseQueue.bind(this));
      if (this._expired.has(e)) return this.log("remove expired client"), this._expired.delete(e), this._remove(
        e,
        this._pulseQueue.bind(this)
      );
      let s;
      this.options.idleTimeoutMillis && this._isAboveMin() && (s = setTimeout(
        () => {
          this._isAboveMin() && (this.log("remove idle client"), this._remove(e, this._pulseQueue.bind(this)));
        },
        this.options.idleTimeoutMillis
      ), this.options.allowExitOnIdle && s.unref()), this.options.allowExitOnIdle && e.unref(), this._idle.push(new In(e, t, s)), this._pulseQueue();
    }
    query(e, t, n) {
      if (typeof e == "function") {
        let s = Qt(
          this.Promise,
          e
        );
        return x(function() {
          return s.callback(new Error("Passing a function as the first parameter to pool.query is not supported"));
        }), s.result;
      }
      typeof t == "function" && (n = t, t = void 0);
      let i = Qt(this.Promise, n);
      return n = i.callback, this.connect((s, o) => {
        if (s) return n(s);
        let u = false, c = a((l) => {
          u || (u = true, o.release(
            l
          ), n(l));
        }, "onError");
        o.once("error", c), this.log("dispatching query");
        try {
          o.query(e, t, (l, f) => {
            if (this.log("query dispatched"), o.removeListener("error", c), !u) return u = true, o.release(l), l ? n(l) : n(void 0, f);
          });
        } catch (l) {
          return o.release(l), n(l);
        }
      }), i.result;
    }
    end(e) {
      if (this.log("ending"), this.ending) {
        let n = new Error("Called end on pool more than once");
        return e ? e(n) : this.Promise.reject(n);
      }
      this.ending = true;
      let t = Qt(
        this.Promise,
        e
      );
      return this._endCallback = t.callback, this._pulseQueue(), t.result;
    }
    get waitingCount() {
      return this._pendingQueue.length;
    }
    get idleCount() {
      return this._idle.length;
    }
    get expiredCount() {
      return this._clients.reduce((e, t) => e + (this._expired.has(t) ? 1 : 0), 0);
    }
    get totalCount() {
      return this._clients.length;
    }
  };
  a(Bn, "Pool");
  var Pn = Bn;
  lo.exports = Pn;
});
var ho = {};
se(ho, { default: () => Il });
var Il;
var po = V(() => {
  "use strict";
  h();
  Il = {};
});
var yo = T((Yd, Pl) => {
  Pl.exports = { name: "pg", version: "8.8.0", description: "PostgreSQL client - pure javascript & libpq with the same API", keywords: [
    "database",
    "libpq",
    "pg",
    "postgre",
    "postgres",
    "postgresql",
    "rdbms"
  ], homepage: "https://github.com/brianc/node-postgres", repository: { type: "git", url: "git://github.com/brianc/node-postgres.git", directory: "packages/pg" }, author: "Brian Carlson <brian.m.carlson@gmail.com>", main: "./lib", dependencies: { "buffer-writer": "2.0.0", "packet-reader": "1.0.0", "pg-connection-string": "^2.5.0", "pg-pool": "^3.5.2", "pg-protocol": "^1.5.0", "pg-types": "^2.1.0", pgpass: "1.x" }, devDependencies: {
    async: "2.6.4",
    bluebird: "3.5.2",
    co: "4.6.0",
    "pg-copy-streams": "0.3.0"
  }, peerDependencies: { "pg-native": ">=3.0.1" }, peerDependenciesMeta: { "pg-native": { optional: true } }, scripts: { test: "make test-all" }, files: ["lib", "SPONSORS.md"], license: "MIT", engines: { node: ">= 8.0.0" }, gitHead: "c99fb2c127ddf8d712500db2c7b9a5491a178655" };
});
var wo = T((Zd, go) => {
  "use strict";
  h();
  var mo = ve().EventEmitter, Rl = (it(), O(nt)), Fn = rt(), Ne = go.exports = function(r, e, t) {
    mo.call(this), r = Fn.normalizeQueryConfig(r, e, t), this.text = r.text, this.values = r.values, this.name = r.name, this.callback = r.callback, this.state = "new", this._arrayMode = r.rowMode === "array", this._emitRowEvents = false, this.on("newListener", function(n) {
      n === "row" && (this._emitRowEvents = true);
    }.bind(this));
  };
  Rl.inherits(Ne, mo);
  var Ll = { sqlState: "code", statementPosition: "position", messagePrimary: "message", context: "where", schemaName: "schema", tableName: "table", columnName: "column", dataTypeName: "dataType", constraintName: "constraint", sourceFile: "file", sourceLine: "line", sourceFunction: "routine" };
  Ne.prototype.handleError = function(r) {
    var e = this.native.pq.resultErrorFields();
    if (e) for (var t in e) {
      var n = Ll[t] || t;
      r[n] = e[t];
    }
    this.callback ? this.callback(r) : this.emit("error", r), this.state = "error";
  };
  Ne.prototype.then = function(r, e) {
    return this._getPromise().then(
      r,
      e
    );
  };
  Ne.prototype.catch = function(r) {
    return this._getPromise().catch(r);
  };
  Ne.prototype._getPromise = function() {
    return this._promise ? this._promise : (this._promise = new Promise(function(r, e) {
      this._once("end", r), this._once("error", e);
    }.bind(this)), this._promise);
  };
  Ne.prototype.submit = function(r) {
    this.state = "running";
    var e = this;
    this.native = r.native, r.native.arrayMode = this._arrayMode;
    var t = a(function(s, o, u) {
      if (r.native.arrayMode = false, x(function() {
        e.emit("_done");
      }), s) return e.handleError(s);
      e._emitRowEvents && (u.length > 1 ? o.forEach(
        (c, l) => {
          c.forEach((f) => {
            e.emit("row", f, u[l]);
          });
        }
      ) : o.forEach(function(c) {
        e.emit("row", c, u);
      })), e.state = "end", e.emit("end", u), e.callback && e.callback(null, u);
    }, "after");
    if (y.domain && (t = y.domain.bind(t)), this.name) {
      this.name.length > 63 && (console.error("Warning! Postgres only supports 63 characters for query names."), console.error("You supplied %s (%s)", this.name, this.name.length), console.error("This can cause conflicts and silent errors executing queries"));
      var n = (this.values || []).map(Fn.prepareValue);
      if (r.namedQueries[this.name]) {
        if (this.text && r.namedQueries[this.name] !== this.text) {
          let s = new Error(`Prepared statements must be unique - '${this.name}' was used for a different statement`);
          return t(s);
        }
        return r.native.execute(this.name, n, t);
      }
      return r.native.prepare(this.name, this.text, n.length, function(s) {
        return s ? t(s) : (r.namedQueries[e.name] = e.text, e.native.execute(e.name, n, t));
      });
    } else if (this.values) {
      if (!Array.isArray(
        this.values
      )) {
        let s = new Error("Query values must be an array");
        return t(s);
      }
      var i = this.values.map(Fn.prepareValue);
      r.native.query(this.text, i, t);
    } else r.native.query(this.text, t);
  };
});
var So = T((tp, vo) => {
  "use strict";
  h();
  var Bl = (po(), O(ho)), Fl = _t(), ep = yo(), bo = ve().EventEmitter, Ml = (it(), O(nt)), kl = Lt(), xo = wo(), Y = vo.exports = function(r) {
    bo.call(this), r = r || {}, this._Promise = r.Promise || b.Promise, this._types = new Fl(r.types), this.native = new Bl({ types: this._types }), this._queryQueue = [], this._ending = false, this._connecting = false, this._connected = false, this._queryable = true;
    var e = this.connectionParameters = new kl(r);
    this.user = e.user, Object.defineProperty(this, "password", { configurable: true, enumerable: false, writable: true, value: e.password }), this.database = e.database, this.host = e.host, this.port = e.port, this.namedQueries = {};
  };
  Y.Query = xo;
  Ml.inherits(Y, bo);
  Y.prototype._errorAllQueries = function(r) {
    let e = a((t) => {
      y.nextTick(() => {
        t.native = this.native, t.handleError(r);
      });
    }, "enqueueError");
    this._hasActiveQuery() && (e(this._activeQuery), this._activeQuery = null), this._queryQueue.forEach(e), this._queryQueue.length = 0;
  };
  Y.prototype._connect = function(r) {
    var e = this;
    if (this._connecting) {
      y.nextTick(() => r(new Error("Client has already been connected. You cannot reuse a client.")));
      return;
    }
    this._connecting = true, this.connectionParameters.getLibpqConnectionString(function(t, n) {
      if (t) return r(t);
      e.native.connect(n, function(i) {
        if (i) return e.native.end(), r(i);
        e._connected = true, e.native.on("error", function(s) {
          e._queryable = false, e._errorAllQueries(s), e.emit("error", s);
        }), e.native.on("notification", function(s) {
          e.emit("notification", { channel: s.relname, payload: s.extra });
        }), e.emit("connect"), e._pulseQueryQueue(true), r();
      });
    });
  };
  Y.prototype.connect = function(r) {
    if (r) {
      this._connect(r);
      return;
    }
    return new this._Promise((e, t) => {
      this._connect((n) => {
        n ? t(n) : e();
      });
    });
  };
  Y.prototype.query = function(r, e, t) {
    var n, i, s, o, u;
    if (r == null) throw new TypeError("Client was passed a null or undefined query");
    if (typeof r.submit == "function") s = r.query_timeout || this.connectionParameters.query_timeout, i = n = r, typeof e == "function" && (r.callback = e);
    else if (s = this.connectionParameters.query_timeout, n = new xo(r, e, t), !n.callback) {
      let c, l;
      i = new this._Promise((f, m) => {
        c = f, l = m;
      }), n.callback = (f, m) => f ? l(f) : c(m);
    }
    return s && (u = n.callback, o = setTimeout(() => {
      var c = new Error(
        "Query read timeout"
      );
      y.nextTick(() => {
        n.handleError(c, this.connection);
      }), u(c), n.callback = () => {
      };
      var l = this._queryQueue.indexOf(n);
      l > -1 && this._queryQueue.splice(l, 1), this._pulseQueryQueue();
    }, s), n.callback = (c, l) => {
      clearTimeout(o), u(c, l);
    }), this._queryable ? this._ending ? (n.native = this.native, y.nextTick(() => {
      n.handleError(
        new Error("Client was closed and is not queryable")
      );
    }), i) : (this._queryQueue.push(n), this._pulseQueryQueue(), i) : (n.native = this.native, y.nextTick(() => {
      n.handleError(new Error("Client has encountered a connection error and is not queryable"));
    }), i);
  };
  Y.prototype.end = function(r) {
    var e = this;
    this._ending = true, this._connected || this.once("connect", this.end.bind(this, r));
    var t;
    return r || (t = new this._Promise(function(n, i) {
      r = a((s) => s ? i(s) : n(), "cb");
    })), this.native.end(function() {
      e._errorAllQueries(new Error("Connection terminated")), y.nextTick(() => {
        e.emit("end"), r && r();
      });
    }), t;
  };
  Y.prototype._hasActiveQuery = function() {
    return this._activeQuery && this._activeQuery.state !== "error" && this._activeQuery.state !== "end";
  };
  Y.prototype._pulseQueryQueue = function(r) {
    if (this._connected && !this._hasActiveQuery()) {
      var e = this._queryQueue.shift();
      if (!e) {
        r || this.emit("drain");
        return;
      }
      this._activeQuery = e, e.submit(this);
      var t = this;
      e.once("_done", function() {
        t._pulseQueryQueue();
      });
    }
  };
  Y.prototype.cancel = function(r) {
    this._activeQuery === r ? this.native.cancel(function() {
    }) : this._queryQueue.indexOf(r) !== -1 && this._queryQueue.splice(this._queryQueue.indexOf(r), 1);
  };
  Y.prototype.ref = function() {
  };
  Y.prototype.unref = function() {
  };
  Y.prototype.setTypeParser = function(r, e, t) {
    return this._types.setTypeParser(
      r,
      e,
      t
    );
  };
  Y.prototype.getTypeParser = function(r, e) {
    return this._types.getTypeParser(r, e);
  };
});
var Mn = T((ip, Eo) => {
  "use strict";
  h();
  Eo.exports = So();
});
var ot = T((op, at) => {
  "use strict";
  h();
  var Ol = uo(), Ul = tt(), Ql = An(), Dl = fo(), { DatabaseError: ql } = vn(), Nl = a(
    (r) => {
      var e;
      return e = class extends Dl {
        constructor(n) {
          super(n, r);
        }
      }, a(e, "BoundPool"), e;
    },
    "poolFactory"
  ), kn = a(
    function(r) {
      this.defaults = Ul, this.Client = r, this.Query = this.Client.Query, this.Pool = Nl(this.Client), this._pools = [], this.Connection = Ql, this.types = Je(), this.DatabaseError = ql;
    },
    "PG"
  );
  typeof y.env.NODE_PG_FORCE_NATIVE < "u" ? at.exports = new kn(Mn()) : (at.exports = new kn(Ol), Object.defineProperty(at.exports, "native", {
    configurable: true,
    enumerable: false,
    get() {
      var r = null;
      try {
        r = new kn(Mn());
      } catch (e) {
        if (e.code !== "MODULE_NOT_FOUND") throw e;
      }
      return Object.defineProperty(at.exports, "native", { value: r }), r;
    }
  }));
});
h();
h();
h();
var da = Object.defineProperty;
var pa = Object.defineProperties;
var ya = Object.getOwnPropertyDescriptors;
var ai = Object.getOwnPropertySymbols;
var ma = Object.prototype.hasOwnProperty;
var ga = Object.prototype.propertyIsEnumerable;
var ui = a(
  (r, e, t) => e in r ? da(r, e, { enumerable: true, configurable: true, writable: true, value: t }) : r[e] = t,
  "__defNormalProp"
);
var wa = a((r, e) => {
  for (var t in e || (e = {})) ma.call(e, t) && ui(r, t, e[t]);
  if (ai) for (var t of ai(e)) ga.call(e, t) && ui(r, t, e[t]);
  return r;
}, "__spreadValues");
var ba = a((r, e) => pa(r, ya(e)), "__spreadProps");
var xa = 1008e3;
var ci = new Uint8Array(
  new Uint16Array([258]).buffer
)[0] === 2;
var va = new TextDecoder();
var Yt = new TextEncoder();
var dt = Yt.encode("0123456789abcdef");
var pt = Yt.encode("0123456789ABCDEF");
var Sa = Yt.encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
var li = Sa.slice();
li[62] = 45;
li[63] = 95;
var je;
var yt;
function Ea(r, { alphabet: e, scratchArr: t } = {}) {
  if (!je) if (je = new Uint16Array(256), yt = new Uint16Array(256), ci) for (let S = 0; S < 256; S++) je[S] = dt[S & 15] << 8 | dt[S >>> 4], yt[S] = pt[S & 15] << 8 | pt[S >>> 4];
  else for (let S = 0; S < 256; S++) je[S] = dt[S & 15] | dt[S >>> 4] << 8, yt[S] = pt[S & 15] | pt[S >>> 4] << 8;
  r.byteOffset % 4 !== 0 && (r = new Uint8Array(r));
  let n = r.length, i = n >>> 1, s = n >>> 2, o = t || new Uint16Array(n), u = new Uint32Array(
    r.buffer,
    r.byteOffset,
    s
  ), c = new Uint32Array(o.buffer, o.byteOffset, i), l = e === "upper" ? yt : je, f = 0, m = 0, g;
  if (ci)
    for (; f < s; ) g = u[f++], c[m++] = l[g >>> 8 & 255] << 16 | l[g & 255], c[m++] = l[g >>> 24] << 16 | l[g >>> 16 & 255];
  else for (; f < s; )
    g = u[f++], c[m++] = l[g >>> 24] << 16 | l[g >>> 16 & 255], c[m++] = l[g >>> 8 & 255] << 16 | l[g & 255];
  for (f <<= 2; f < n; ) o[f] = l[r[f++]];
  return va.decode(o.subarray(0, n));
}
a(Ea, "_toHex");
function Aa(r, e = {}) {
  let t = "", n = r.length, i = xa >>> 1, s = Math.ceil(n / i), o = new Uint16Array(s > 1 ? i : n), u = ba(wa({}, e), { scratchArr: o });
  for (let c = 0; c < s; c++) {
    let l = c * i, f = l + i;
    t += Ea(r.subarray(l, f), u);
  }
  return t;
}
a(Aa, "_toHexChunked");
function fi(r, e = {}) {
  return e.alphabet !== "upper" && typeof r.toHex == "function" ? r.toHex() : Aa(r, e);
}
a(fi, "toHex");
h();
h();
var Zt = class Zt2 {
  constructor(e, t, n) {
    E(this, "execute", e);
    E(this, "queryData", t);
    E(this, "opts", n);
  }
  then(e, t) {
    return this.execute(this.queryData, this.opts).then(e, t);
  }
  catch(e) {
    return this.execute(
      this.queryData,
      this.opts
    ).catch(e);
  }
  finally(e) {
    return this.execute(this.queryData, this.opts).finally(e);
  }
};
a(Zt, "NeonQueryPromise");
var xe = Zt;
var mt = class mt2 {
  constructor(e, t) {
    E(this, "strings", e);
    E(this, "values", t);
  }
  toParameterizedQuery(e = {
    query: "",
    params: []
  }) {
    let { strings: t, values: n } = this;
    for (let i = 0, s = t.length; i < s; i++) if (e.query += t[i], i < n.length) {
      let o = n[i];
      if (o instanceof $e) e.query += o.sql;
      else if (o instanceof xe) if (o.queryData instanceof mt2) o.queryData.toParameterizedQuery(e);
      else {
        if (o.queryData.params?.length) throw new Error("This query is not composable");
        e.query += o.queryData.query;
      }
      else {
        let { params: u } = e;
        u.push(o), e.query += "$" + u.length, (o instanceof p || ArrayBuffer.isView(o)) && (e.query += "::bytea");
      }
    }
    return e;
  }
};
a(mt, "SqlTemplate");
var He = mt;
var Jt = class Jt2 {
  constructor(e) {
    E(this, "sql", e);
  }
};
a(Jt, "UnsafeRawSql");
var $e = Jt;
h();
function gt() {
  typeof window < "u" && typeof document < "u" && typeof console < "u" && typeof console.warn == "function" && console.warn(`          
        ************************************************************
        *                                                          *
        *  WARNING: Running SQL directly from the browser can have *
        *  security implications. Even if your database is         *
        *  protected by Row-Level Security (RLS), use it at your   *
        *  own risk. This approach is great for fast prototyping,  *
        *  but ensure proper safeguards are in place to prevent    *
        *  misuse or execution of expensive SQL queries by your    *
        *  end users.                                              *
        *                                                          *
        *  If you've assessed the risks, suppress this message     *
        *  using the disableWarningInBrowsers configuration        *
        *  parameter.                                              *
        *                                                          *
        ************************************************************`);
}
a(gt, "warnIfBrowser");
h();
h();
var wt = class wt2 extends Error {
  constructor(t) {
    super(t);
    E(this, "name", "NeonDbError");
    E(this, "severity");
    E(this, "code");
    E(this, "detail");
    E(this, "hint");
    E(this, "position");
    E(this, "internalPosition");
    E(
      this,
      "internalQuery"
    );
    E(this, "where");
    E(this, "schema");
    E(this, "table");
    E(this, "column");
    E(this, "dataType");
    E(this, "constraint");
    E(this, "file");
    E(this, "line");
    E(this, "routine");
    E(this, "sourceError");
    "captureStackTrace" in Error && typeof Error.captureStackTrace == "function" && Error.captureStackTrace(this, wt2);
  }
};
a(
  wt,
  "NeonDbError"
);
var N = wt;
var hi = ["severity", "code", "detail", "hint", "position", "internalPosition", "internalQuery", "where", "schema", "table", "column", "dataType", "constraint", "file", "line", "routine"];
function di(r, e) {
  let t, n;
  try {
    t = new URL(r).protocol, n = new URL("http:" + r.slice(t.length));
  } catch {
    throw new N(
      `Database connection string provided to neon() is not a valid URL (connection string: ${r})`
    );
  }
  let {
    username: i,
    hostname: s,
    pathname: o
  } = n;
  if (t !== "postgres:" && t !== "postgresql:" || e && (!i || !s || s === "-" || !o || o === "/")) throw new N(
    "Wrong URL scheme or missing user, host or database in connection parameters"
  );
  return n;
}
a(di, "URLFromPgConnectionString");
function Ca(r) {
  return "postgresql:" + r.href.slice(r.protocol.length);
}
a(Ca, "pgConnectionStringFromURL");
var _a = ["connectionString", "user", "username", "password", "host", "hostname", "port", "database"];
var Ta = { database: "pathname", user: "username", host: "hostname" };
function pi(...r) {
  let e = {};
  for (let t of r) e = t.connectionString !== void 0 ? t : { ...e, ...t };
  return e;
}
a(pi, "mergeConnectionParams");
async function yi(r = "postgresql://-", e = {}, t = {}) {
  if (e.connectionString !== void 0 && (r = e.connectionString), typeof r == "function" && (r = await r()), typeof r != "string") throw new N("Connection string must be a string or a function resolving to one");
  if (e.user !== void 0 && e.username !== void 0) throw new N("Please specify one only of user and username");
  if (e.host !== void 0 && e.hostname !== void 0) throw new N("Please specify one only of host and hostname");
  let n = di(r, false);
  await Promise.all(_a.map(async (u) => {
    if (u === "connectionString") return;
    let c = e[u];
    if (typeof c == "function" && (c = await c()), c === void 0) return;
    if (typeof c != "string" && !(u === "port" && typeof c == "number")) {
      let f = u === "port" ? " or a number" : "";
      throw new N(`Connection parameter "${u}" must be a string${f} or a function resolving to one`);
    }
    let l = Ta[u] ?? u;
    n[l] = c;
  }));
  let { searchParams: i } = n;
  for (let u in t) i.has(u) || i.append(u, t[u]);
  let s = Ca(n), o = di(s, true);
  return { resolvedConnectionString: s, resolvedURL: o };
}
a(yi, "resolveConnectionParams");
Ge();
h();
var vt = "pkg:npm/%40neondatabase/serverless@1.2.0";
var ds = we(_t());
var ps = we(rt());
var ls = "transaction() expects an array of queries, or a function returning an array of queries";
function Nu(r) {
  return r instanceof p ? "\\x" + fi(r) : r;
}
a(Nu, "encodeBuffersAsBytea");
function fs(r) {
  let { query: e, params: t } = r instanceof He ? r.toParameterizedQuery() : r;
  return { query: e, params: t.map((n) => Nu((0, ps.prepareValue)(n))) };
}
a(fs, "prepareQuery");
function ys(r, e = {}) {
  typeof r != "string" && (e = r ?? {}, r = void 0);
  let {
    arrayMode: t,
    fullResults: n,
    fetchOptions: i,
    isolationLevel: s,
    readOnly: o,
    deferrable: u,
    authToken: c,
    disableWarningInBrowsers: l
  } = e;
  function f(g, ...w) {
    if (!(Array.isArray(g) && Array.isArray(g.raw) && Array.isArray(w))) throw new Error('This function can now be called only as a tagged-template function: sql`SELECT ${value}`, not sql("SELECT $1", [value], options). For a conventional function call with value placeholders ($1, $2, etc.), use sql.query("SELECT $1", [value], options).');
    return new xe(m, new He(g, w));
  }
  a(f, "templateFn"), f.query = (g, w, S) => new xe(
    m,
    { query: g, params: w ?? [] },
    S
  ), f.unsafe = (g) => new $e(g), f.transaction = async (g, w) => {
    if (typeof g == "function" && (g = g(f)), !Array.isArray(g)) throw new Error(ls);
    g.forEach((D) => {
      if (!(D instanceof xe)) throw new Error(ls);
    });
    let S = g.map((D) => D.queryData), k = g.map((D) => D.opts ?? {});
    return m(S, k, w);
  };
  async function m(g, w, S) {
    let {
      fetchEndpoint: k,
      fetchFunction: D
    } = pe, he = Array.isArray(g) ? { queries: g.map((G) => fs(G)) } : fs(g), I = i ?? {}, C = t ?? false, re = n ?? false, ne = s, H = o, oe = u;
    S !== void 0 && (S.fetchOptions !== void 0 && (I = { ...I, ...S.fetchOptions }), S.arrayMode !== void 0 && (C = S.arrayMode), S.fullResults !== void 0 && (re = S.fullResults), S.isolationLevel !== void 0 && (ne = S.isolationLevel), S.readOnly !== void 0 && (H = S.readOnly), S.deferrable !== void 0 && (oe = S.deferrable)), w !== void 0 && !Array.isArray(
      w
    ) && w.fetchOptions !== void 0 && (I = { ...I, ...w.fetchOptions });
    let ae = c;
    !Array.isArray(w) && w?.authToken !== void 0 && (ae = w.authToken);
    let me = pi(e, S ?? {}, Array.isArray(w) || !w ? {} : w), { resolvedConnectionString: R, resolvedURL: $ } = await yi(
      r,
      me,
      { application_name: vt }
    ), Ee = typeof k == "function" ? k($.hostname, $.port, { jwtAuth: ae !== void 0 }) : k, ue = {
      "Neon-Connection-String": R,
      "Neon-Raw-Text-Output": "true",
      "Neon-Array-Mode": "true"
    }, Te = await Wu(ae);
    Te && (ue.Authorization = `Bearer ${Te}`), Array.isArray(g) && (ne !== void 0 && (ue["Neon-Batch-Isolation-Level"] = ne), H !== void 0 && (ue["Neon-Batch-Read-Only"] = String(H)), oe !== void 0 && (ue["Neon-Batch-Deferrable"] = String(
      oe
    ))), l || pe.disableWarningInBrowsers || gt();
    let ce;
    try {
      ce = await (D ?? fetch)(Ee, { method: "POST", body: JSON.stringify(he), headers: ue, ...I });
    } catch (G) {
      let q = new N(`Error connecting to database: ${G}`);
      throw q.sourceError = G, q;
    }
    if (ce.ok) {
      let G = await ce.json();
      if (Array.isArray(g)) {
        let q = G.results;
        if (!Array.isArray(q)) throw new N(
          "Neon internal error: unexpected result format"
        );
        return q.map((ge, J) => {
          let ie = w[J] ?? {}, Dt = ie.arrayMode ?? C, Io = ie.fullResults ?? re;
          return hs(ge, { arrayMode: Dt, fullResults: Io, types: ie.types });
        });
      } else {
        let q = w ?? {}, ge = q.arrayMode ?? C, J = q.fullResults ?? re;
        return hs(G, { arrayMode: ge, fullResults: J, types: q.types });
      }
    } else {
      let { status: G } = ce;
      if (G === 400) {
        let q = await ce.json(), ge = new N(q.message);
        for (let J of hi) ge[J] = q[J] ?? void 0;
        throw ge;
      } else {
        let q = await ce.text();
        throw new N(`Server error (HTTP status ${G}): ${q}`);
      }
    }
  }
  return a(
    m,
    "execute"
  ), f;
}
a(ys, "neon");
function hs(r, { arrayMode: e, fullResults: t, types: n }) {
  let i = new ds.default(
    n
  ), s = r.fields.map((c) => c.name), o = r.fields.map((c) => i.getTypeParser(c.dataTypeID)), u = e === true ? r.rows.map((c) => c.map((l, f) => l === null ? null : o[f](l))) : r.rows.map((c) => Object.fromEntries(c.map((l, f) => [s[f], l === null ? null : o[f](l)])));
  return t ? (r.viaNeonFetch = true, r.rowAsArray = e, r.rows = u, r._parsers = o, r._types = i, r) : u;
}
a(hs, "processQueryResult");
async function Wu(r) {
  if (typeof r == "string") return r;
  if (typeof r == "function") try {
    return await Promise.resolve(r());
  } catch (e) {
    let t = new N("Error getting auth token.");
    throw e instanceof Error && (t = new N(`Error getting auth token: ${e.message}`)), t;
  }
}
a(Wu, "getAuthToken");
h();
h();
var Co = we(ot());
h();
var Ao = we(ot());
var On = class On2 extends Ao.Client {
  constructor(t) {
    let n = typeof t == "string" ? { connectionString: t } : {
      ...t,
      ...t && "password" in t ? { password: t.password } : {}
    };
    super({ fallback_application_name: vt, ...n });
    E(this, "config", t);
  }
  get neonConfig() {
    return this.connection.stream;
  }
  connect(t) {
    let { neonConfig: n } = this;
    n.forceDisablePgSSL && (this.ssl = this.connection.ssl = false), this.ssl && n.useSecureWebSocket && console.warn("SSL is enabled for both Postgres (e.g. ?sslmode=require in the connection string + forceDisablePgSSL = false) and the WebSocket tunnel (useSecureWebSocket = true). Double encryption will increase latency and CPU usage. It may be appropriate to disable SSL in the Postgres connection parameters or set forceDisablePgSSL = true.");
    let i = typeof this.config != "string" && this.config?.host !== void 0 || typeof this.config != "string" && this.config?.connectionString !== void 0 || y.env.PGHOST !== void 0, s = y.env.USER ?? y.env.USERNAME;
    if (!i && this.host === "localhost" && this.user === s && this.database === s && this.password === null) throw new Error(`No database host or connection string was set, and key parameters have default values (host: localhost, user: ${s}, db: ${s}, password: null). Is an environment variable missing? Alternatively, if you intended to connect with these parameters, please set the host to 'localhost' explicitly.`);
    let o = super.connect(
      t
    ), u = n.pipelineTLS && this.ssl, c = n.pipelineConnect === "password";
    if (!u && !n.pipelineConnect) return o;
    let l = this.connection;
    if (u && l.on("connect", () => l.stream.emit("data", "S")), c) {
      l.removeAllListeners("authenticationCleartextPassword"), l.removeAllListeners("readyForQuery"), l.once("readyForQuery", () => l.on("readyForQuery", this._handleReadyForQuery.bind(this)));
      let f = this.password, m = Promise.resolve(typeof f == "function" ? f() : f), g = this.ssl ? "sslconnect" : "connect";
      l.on(g, () => {
        this.neonConfig.disableWarningInBrowsers || gt(), m.then((w) => {
          this.password = w, this._handleAuthCleartextPassword(), this._handleReadyForQuery();
        }).catch(
          (w) => l.emit("error", w)
        );
      });
    }
    return o;
  }
  async _handleAuthSASLContinue(t) {
    if (typeof crypto > "u" || crypto.subtle === void 0 || crypto.subtle.importKey === void 0) throw new Error("Cannot use SASL auth when `crypto.subtle` is not defined");
    let n = crypto.subtle, i = this.saslSession, s = this.password, o = t.data;
    if (i.message !== "SASLInitialResponse" || typeof s != "string" || typeof o != "string") throw new Error("SASL: protocol error");
    let u = Object.fromEntries(o.split(",").map((J) => {
      if (!/^.=/.test(J)) throw new Error("SASL: Invalid attribute pair entry");
      let ie = J[0], Dt = J.substring(2);
      return [ie, Dt];
    })), c = u.r, l = u.s, f = u.i;
    if (!c || !/^[!-+--~]+$/.test(c))
      throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: nonce missing/unprintable");
    if (!l || !/^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(l)) throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: salt missing/not base64");
    if (!f || !/^[1-9][0-9]*$/.test(f)) throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: missing/invalid iteration count");
    if (!c.startsWith(
      i.clientNonce
    )) throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce does not start with client nonce");
    if (c.length === i.clientNonce.length) throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce is too short");
    let m = parseInt(f, 10), g = p.from(l, "base64"), w = new TextEncoder(), S = w.encode(s), k = await n.importKey("raw", S, { name: "HMAC", hash: { name: "SHA-256" } }, false, ["sign"]), D = new Uint8Array(await n.sign("HMAC", k, p.concat([g, p.from([0, 0, 0, 1])]))), he = D;
    for (var I = 0; I < m - 1; I++) D = new Uint8Array(await n.sign("HMAC", k, D)), he = p.from(he.map((J, ie) => he[ie] ^ D[ie]));
    let C = he, re = await n.importKey("raw", C, { name: "HMAC", hash: { name: "SHA-256" } }, false, ["sign"]), ne = new Uint8Array(await n.sign("HMAC", re, w.encode("Client Key"))), H = await n.digest("SHA-256", ne), oe = "n=*,r=" + i.clientNonce, ae = "r=" + c + ",s=" + l + ",i=" + m, me = "c=biws,r=" + c, R = oe + "," + ae + "," + me, $ = await n.importKey("raw", H, { name: "HMAC", hash: { name: "SHA-256" } }, false, ["sign"]);
    var Ee = new Uint8Array(await n.sign("HMAC", $, w.encode(R))), ue = p.from(ne.map((J, ie) => ne[ie] ^ Ee[ie])), Te = ue.toString("base64");
    let ce = await n.importKey("raw", C, { name: "HMAC", hash: { name: "SHA-256" } }, false, ["sign"]), G = await n.sign("HMAC", ce, w.encode("Server Key")), q = await n.importKey("raw", G, { name: "HMAC", hash: { name: "SHA-256" } }, false, ["sign"]);
    var ge = p.from(await n.sign("HMAC", q, w.encode(R)));
    i.message = "SASLResponse", i.serverSignature = ge.toString("base64"), i.response = me + ",p=" + Te, this.connection.sendSCRAMClientFinalMessage(
      this.saslSession.response
    );
  }
};
a(On, "NeonClient");
var ut = On;
Ge();
var _o = we(Lt());
function Wl(r, e) {
  if (e) return { callback: e, result: void 0 };
  let t, n, i = a(function(o, u) {
    o ? t(o) : n(u);
  }, "cb"), s = new r(function(o, u) {
    n = o, t = u;
  });
  return { callback: i, result: s };
}
a(Wl, "promisify");
var Qn = class Qn2 extends Co.Pool {
  constructor() {
    super(...arguments);
    E(this, "Client", ut);
    E(this, "hasFetchUnsupportedListeners", false);
    E(this, "addListener", this.on);
  }
  on(t, n) {
    return t !== "error" && (this.hasFetchUnsupportedListeners = true), super.on(t, n);
  }
  query(t, n, i) {
    if (!pe.poolQueryViaFetch || this.hasFetchUnsupportedListeners || typeof t == "function") return super.query(
      t,
      n,
      i
    );
    typeof n == "function" && (i = n, n = void 0);
    let s = Wl(this.Promise, i);
    i = s.callback;
    try {
      let o = new _o.default(
        this.options
      ), u = encodeURIComponent, c = encodeURI, l = `postgresql://${u(o.user)}:${u(o.password)}@${u(o.host)}/${c(o.database)}`, f = typeof t == "string" ? t : t.text, m = n ?? t.values ?? [];
      ys(l, { fullResults: true, arrayMode: t.rowMode === "array" }).query(f, m, { types: t.types ?? this.options?.types }).then((w) => i(void 0, w)).catch((w) => i(
        w
      ));
    } catch (o) {
      i(o);
    }
    return s.result;
  }
};
a(Qn, "NeonPool");
Ge();
var ct = we(ot());
h();
var To = we(Ir());
function jl(r) {
  return Object.entries(r).reduce((t, [n, i]) => (i != null && (t[n] = i), t), /* @__PURE__ */ Object.create(null));
}
a(jl, "toConnectionOptions");
function Hl(r) {
  return Object.entries(r).reduce((t, [n, i]) => {
    if (n === "ssl") {
      let s = i;
      typeof s == "boolean" && (t[n] = s), typeof s == "object" && (t[n] = jl(s));
    } else if (i != null) if (n === "port") {
      if (i !== "") {
        let s = parseInt(i, 10);
        if (isNaN(s)) throw new Error(`Invalid ${n}: ${i}`);
        t[n] = s;
      }
    } else t[n] = i;
    return t;
  }, /* @__PURE__ */ Object.create(null));
}
a(Hl, "toClientConfig");
function $l(r) {
  return Hl((0, To.parse)(r));
}
a(
  $l,
  "parseIntoClientConfig"
);
var export_DatabaseError = ct.DatabaseError;
var export_defaults = ct.defaults;
var export_escapeIdentifier = ct.escapeIdentifier;
var export_escapeLiteral = ct.escapeLiteral;
var export_types = ct.types;

// player-api-worker.js
var BONUS_PURCHASES_READY = false;
var json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});
function hex2(bytes) {
  return [...new Uint8Array(bytes)].map((b2) => b2.toString(16).padStart(2, "0")).join("");
}
function constantTimeHexEqual(a2, b2) {
  if (a2.length !== b2.length) return false;
  let diff = 0;
  for (let i = 0; i < a2.length; i++) diff |= a2.charCodeAt(i) ^ b2.charCodeAt(i);
  return diff === 0;
}
async function verifyTelegram2(initData, token) {
  if (!initData || initData.length > 8192 || !token) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  const pairs = [...params.entries()];
  if (new Set(pairs.map(([k]) => k)).size !== pairs.length) return null;
  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1e3);
  if (!Number.isSafeInteger(authDate) || authDate > now + 60 || now - authDate > 3600) return null;
  const check = pairs.filter(([k]) => k !== "hash").sort(([a2], [b2]) => a2 < b2 ? -1 : a2 > b2 ? 1 : 0).map(([k, v2]) => k + "=" + v2).join("\n");
  const enc = new TextEncoder();
  const secret = await crypto.subtle.sign(
    "HMAC",
    await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    enc.encode(token)
  );
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = hex2(await crypto.subtle.sign("HMAC", key, enc.encode(check)));
  if (!constantTimeHexEqual(digest, hash.toLowerCase())) return null;
  let user;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  return user;
}
function formatMoney(v2) {
  const s = String(v2);
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(s)) throw new Error("invalid money");
  return Number(s).toFixed(2);
}
var player_api_worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET")
      return json({ ok: true, service: "kimem-player-api-staging", mode: "api-source", database: "not_checked", bonus_purchases_enabled: BONUS_PURCHASES_READY });
    if (url.pathname === "/health/database" && request.method === "GET") {
      if (!env.STAGING_DATABASE_URL) return json({ ok: false, database: "secret_missing" }, 503);
      let host;
      try {
        const parsed = new URL(env.STAGING_DATABASE_URL);
        if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("protocol");
        host = parsed.hostname.toLowerCase();
      } catch {
        return json({ ok: false, database: "staging_target_unverified" }, 503);
      }
      if (!(/* @__PURE__ */ new Set([
        "ep-dawn-poetry-b5lh24kv.c-7.us-east-2.aws.neon.tech",
        "ep-dawn-poetry-b5lh24kv-pooler.c-7.us-east-2.aws.neon.tech"
      ])).has(host)) return json({ ok: false, database: "staging_target_unverified" }, 503);
      try {
        const rows = await ys(env.STAGING_DATABASE_URL)`SELECT 1 AS connected`;
        return json({ ok: rows[0]?.connected === 1, database: "staging_connected", bonus_purchases_enabled: false });
      } catch {
        return json({ ok: false, database: "staging_connection_failed" }, 503);
      }
    }
    if (!["/api/me/register", "/api/me/balances", "/api/me/bonus-balance", "/api/cards/buy-bonus"].includes(url.pathname))
      return json({ ok: false, error: "not_found" }, 404);
    if (request.method !== (["/api/me/balances", "/api/me/bonus-balance"].includes(url.pathname) ? "GET" : "POST"))
      return json({ ok: false, error: "method_not_allowed" }, 405);
    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("tma ")) return json({ ok: false, error: "unauthorized" }, 401);
    const user = await verifyTelegram2(auth.slice(4), env.TELEGRAM_BOT_TOKEN);
    if (!user) return json({ ok: false, error: "unauthorized" }, 401);
    if (url.pathname === "/api/me/balances")
      return json({ ok: false, error: "wallet_reconciliation_required" }, 503);
    if (!env.STAGING_DATABASE_URL) return json({ ok: false, error: "not_configured" }, 503);
    const STAGING_NEON_HOSTS = /* @__PURE__ */ new Set([
      "ep-dawn-poetry-b5lh24kv.c-7.us-east-2.aws.neon.tech",
      "ep-dawn-poetry-b5lh24kv-pooler.c-7.us-east-2.aws.neon.tech"
    ]);
    let configuredHost;
    try {
      const databaseUrl = new URL(env.STAGING_DATABASE_URL);
      if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) throw new Error("invalid protocol");
      configuredHost = databaseUrl.hostname.toLowerCase();
    } catch {
      return json({ ok: false, error: "staging_database_target_unverified" }, 503);
    }
    if (!STAGING_NEON_HOSTS.has(configuredHost))
      return json({ ok: false, error: "staging_database_target_unverified" }, 503);
    try {
      const sql = ys(env.STAGING_DATABASE_URL);
      if (url.pathname.endsWith("/register")) {
        const rows = await sql`
          WITH player AS (
            INSERT INTO qimem_players(telegram_id,username,first_name,last_name)
            VALUES (${user.id},${user.username || null},${user.first_name || null},${user.last_name || null})
            ON CONFLICT(telegram_id) DO UPDATE SET
              username=EXCLUDED.username,first_name=EXCLUDED.first_name,
              last_name=EXCLUDED.last_name,updated_at=now()
            RETURNING id
          ),
          wallet AS (
            INSERT INTO qimem_wallets(player_id,available_balance,held_balance)
            SELECT id,0,0 FROM player ON CONFLICT(player_id) DO NOTHING
            RETURNING player_id
          ),
          bonus AS (
            INSERT INTO qimem_registration_bonus_accounts(player_id,granted_amount,available_amount)
            SELECT id,10.00,10.00 FROM player ON CONFLICT(player_id) DO NOTHING
            RETURNING player_id,granted_amount,available_amount
          ),
          bonus_log AS (
            INSERT INTO qimem_registration_bonus_transactions(player_id,amount,reason)
            SELECT player_id,granted_amount,'registration_grant' FROM bonus
            RETURNING player_id
          )
          SELECT player.id,EXISTS(SELECT 1 FROM bonus_log) AS bonus_newly_granted
          FROM player
        `;
        return json({ ok: true, registered: true, bonus_newly_granted: rows[0]?.bonus_newly_granted === true });
      }
      if (url.pathname === "/api/cards/buy-bonus") {
        if (!BONUS_PURCHASES_READY)
          return json({ ok: false, error: "bonus_purchases_not_enabled" }, 503);
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
          return json({ ok: false, error: "invalid_content_type" }, 415);
        const raw = await request.text();
        if (raw.length > 2048) return json({ ok: false, error: "payload_too_large" }, 413);
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return json({ ok: false, error: "invalid_json" }, 400);
        }
        const { round_id, card_number, request_key } = body || {};
        if (!Number.isSafeInteger(round_id) || round_id <= 0 || !Number.isSafeInteger(card_number) || card_number <= 0 || typeof request_key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(request_key))
          return json({ ok: false, error: "invalid_purchase_request" }, 400);
        const players = await sql`SELECT id FROM qimem_players WHERE telegram_id=${user.id}`;
        if (players.length !== 1) return json({ ok: false, error: "registration_required" }, 409);
        try {
          const rows = await sql`
            SELECT purchase_id,card_id,charged
            FROM qimem_buy_10etb_bonus_card(${players[0].id},${round_id},${card_number},${request_key})
          `;
          if (rows.length !== 1) return json({ ok: false, error: "purchase_not_completed" }, 503);
          return json({ ok: true, purchase: {
            id: String(rows[0].purchase_id),
            card_id: String(rows[0].card_id),
            charged: rows[0].charged === true
          } });
        } catch (e) {
          console.error("QIMEM bonus purchase failed", e?.name || "Error");
          return json({ ok: false, error: "purchase_rejected" }, 409);
        }
      }
      if (url.pathname === "/api/me/bonus-balance") {
        const rows = await sql`
          SELECT a.available_amount::text AS bonus_etb
          FROM qimem_players p
          JOIN qimem_registration_bonus_accounts a ON a.player_id=p.id
          WHERE p.telegram_id=${user.id}
        `;
        if (rows.length !== 1) return json({ ok: false, error: "registration_required" }, 409);
        return json({ ok: true, bonus_etb: formatMoney(rows[0].bonus_etb) });
      }
      return json({ ok: false, error: "wallet_reconciliation_required" }, 503);
    } catch (e) {
      console.error("QIMEM player API failure", e?.name || "Error");
      return json({ ok: false, error: "service_unavailable" }, 503);
    }
  }
};

// staging-combined-worker.js
var staging_combined_worker_default = {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") {
      const response = await staging_auth_gateway_default.fetch(request, env, ctx);
      const health = await response.json();
      return new Response(JSON.stringify({
        ...health,
        mode: "combined-staging",
        database: env.STAGING_DATABASE_URL ? "secret_configured_connection_unverified" : "secret_missing",
        bonus_purchases_enabled: false
      }), { status: response.status, headers: response.headers });
    }
    if (path === "/health/database" && request.method === "GET") {
      return player_api_worker_default.fetch(request, env, ctx);
    }
    if (path === "/lobby-bonus-test" && request.method === "GET") return new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><title>KIMEM BINGO - Mini App</title>
<script src="https://telegram.org/js/telegram-web-app.js"><\/script><script src="https://cdn.tailwindcss.com"><\/script><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<style>
*{box-sizing:border-box}body{font-family:Inter,sans-serif;background:#02050e;color:#fff;margin:0;-webkit-user-select:none;user-select:none}.cosmic-bg{background:radial-gradient(circle at 50% 0%,rgba(0,102,255,.35),transparent 60%),radial-gradient(circle at 50% 100%,rgba(0,60,180,.25),transparent 50%),linear-gradient(180deg,#020716,#030a21 50%,#010410)}.neon-panel{background:rgba(6,18,46,.75);backdrop-filter:blur(12px);border:1px solid rgba(0,140,255,.4);box-shadow:0 0 15px rgba(0,100,255,.15),inset 0 0 12px rgba(0,120,255,.1)}.hero-banner{background:linear-gradient(135deg,rgba(3,20,65,.9),rgba(10,40,110,.95) 50%,rgba(2,15,50,.9));border:1.5px solid #0099ff;box-shadow:0 0 25px rgba(0,140,255,.4),inset 0 0 15px rgba(0,150,255,.2)}.glow-text-white{text-shadow:0 0 10px #ffffff80,0 0 20px #00b4ff99}.glow-text-gold{background:linear-gradient(180deg,#fff7ad,#ffa800 50%,#d17a00);-webkit-background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 0 8px #ffb40099)}
.card-scroll-area{height:288px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#0077ff #020a1e}.card-scroll-area::-webkit-scrollbar{width:3px}.card-scroll-area::-webkit-scrollbar-thumb{background:#0077ff;border-radius:5px}.card-grid-item{min-width:0;height:34px;position:relative;border-radius:7px;background:linear-gradient(180deg,#102850,#030f2b);border:1px solid rgba(66,153,255,.48);box-shadow:inset 0 1px 0 #ffffff25,0 2px 3px #0005;color:white;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;cursor:pointer}.card-grid-item.soft-match:not(.selected){border-color:#5de3ff;box-shadow:0 0 0 1px #63ddff99,0 0 10px #26c8ff50;background:linear-gradient(180deg,#1a4770,#0b2247)}.card-grid-item.selected{background:linear-gradient(180deg,#ffe985,#d9961d)!important;border:1px solid #fff0a1!important;color:#4b3200!important;box-shadow:0 0 9px #ffbf42a6,inset 0 1px 0 #fff9!important}.card-grid-item .lock{font-size:8px;margin-left:2px;color:#7b560c}.card-grid-item:focus-visible{outline:2px solid #fff;outline-offset:1px}
.locked-row{display:flex;gap:6px;overflow-x:auto;min-height:31px;align-items:center}.locked-chip{flex-shrink:0;border:1px solid #4465a5;border-radius:8px;padding:5px 8px;background:#07142f;color:#d9e5ff;font-size:11px;font-weight:800}.locked-chip.active{border-color:#ffc24e;background:linear-gradient(180deg,#6b511e,#27203a);color:#ffe49a}.locked-chip span{margin-left:8px;opacity:.7}
.bingo-tile{height:24px;min-width:0;border-radius:7px;background:linear-gradient(180deg,#f0f0ed,#a7a7a6 52%,#777777);border:1px solid #34373f;color:#292a2f;box-shadow:inset 0 2px 1px #fff9,0 2px 2px #0009;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900}.bingo-hdr{height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;background:linear-gradient(180deg,#243456,#0a1228);border:1px solid currentColor;box-shadow:inset 0 2px 1px #ffffff36,0 2px 4px #0009}.tile-free{background:linear-gradient(180deg,#ffe47e,#b8872b);color:#51380d;border-color:#f7d269}.btn-action-glow{background:linear-gradient(90deg,#1264ed,#8030e5);border:1px solid #66c2ff;box-shadow:0 0 16px #0088ff77}.btn-action-glow:active{transform:scale(.98)}.live-pulse{background:linear-gradient(180deg,#e52c47,#971329);border:1px solid #ff8b9c;box-shadow:0 0 8px #ed334766;animation:liveGlow 1.2s ease-in-out infinite alternate}@keyframes liveGlow{from{box-shadow:0 0 3px #e3294477;opacity:.8}to{box-shadow:0 0 14px #ff3959;opacity:1}}.stats-panel{padding:9px 4px!important;min-height:65px}.stat-icon{display:block;margin:0 auto 4px;font-size:14px}.stat-label{font-size:8px;font-weight:800;color:#74b6ff}.stat-value{font-size:11px;font-weight:900;margin-top:3px}.bonus-row button{padding:4px!important;gap:4px}.bonus-row button>div:first-child{width:19px;height:19px;flex-shrink:0}.bonus-row button>div:last-child>div:last-child{font-size:9px}.footer-actions{display:grid;grid-template-columns:88px minmax(0,1fr);gap:8px}.footer-actions button{min-height:31px;padding:6px 8px;font-size:10px;border-radius:8px}
@media(max-width:350px){.card-grid-item{font-size:10px;height:30px}.bingo-tile{height:27px;font-size:12px}.bingo-hdr{height:29px}}@media(min-height:780px){.card-scroll-area{height:clamp(235px,36dvh,410px)}}
/* Full-screen, balanced mobile and desktop proportions */
html,body{width:100%;height:100%;overflow:hidden}
body>div{height:100dvh;max-height:100dvh;width:100%;max-width:none}
.card-scroll-area{height:clamp(180px,30dvh,360px)}
main{scrollbar-width:thin;scrollbar-color:#1767be #06102a}
@media(min-width:700px){main{width:min(100%,960px);margin-inline:auto}.card-scroll-area{height:clamp(200px,32dvh,390px)}.card-grid-item{height:38px}.bingo-tile{height:29px}.bingo-hdr{height:31px}}
@media(max-height:700px){.card-scroll-area{height:clamp(140px,25dvh,210px)}.hero-banner{padding:8px}.stats-panel{min-height:57px}.bingo-tile{height:22px}.bingo-hdr{height:24px}}


/* Card matrix priority: ten columns x at least nine visible rows (90 cards). */
.card-scroll-area{height:310px!important;min-height:310px!important;flex-shrink:0;gap:3px!important;grid-auto-rows:28px;align-content:start}
.card-grid-item{height:28px!important;font-size:11px!important;border-radius:5px}
/* Miniature preview frees space for the card selection matrix. */
#bingo-board,#bingo-header{gap:2px!important}
.bingo-tile{height:15px!important;font-size:9px!important;border-radius:3px}
.bingo-hdr{height:17px!important;font-size:11px!important;border-radius:3px}
#bingo-board{max-width:220px;margin-inline:auto}
#bingo-header{max-width:220px;margin-inline:auto}
@media(min-width:700px){.card-scroll-area{height:340px!important;min-height:340px!important;grid-auto-rows:30px}.card-grid-item{height:30px!important}}

/* Approved update: inline locked-card chips and readable preview; card matrix untouched. */
.locked-inline{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:nowrap}
.locked-inline .locked-label{flex-shrink:0;margin:0;font-size:10px;letter-spacing:.08em;color:#93c5fd;font-weight:900}
.locked-inline .locked-row{min-width:0;flex:1;white-space:nowrap;min-height:31px}
.locked-inline .locked-chip{padding:5px 7px;font-size:10px}
#bingo-board,#bingo-header{max-width:370px!important;width:100%;gap:3px!important;margin-inline:auto}
.bingo-tile{height:clamp(26px,4.3dvh,39px)!important;font-size:clamp(13px,3.5vw,18px)!important;border-radius:6px!important}
.bingo-hdr{height:clamp(27px,4dvh,37px)!important;font-size:clamp(16px,4vw,22px)!important;border-radius:6px!important}
/* Full viewport cinematic five-second countdown. */
#countdown-scene{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;flex-direction:column;padding:20px;background:radial-gradient(ellipse at center,#14377b 0%,#07142e 45%,#01040e 100%);overflow:hidden;isolation:isolate}
#countdown-scene.visible{display:flex;animation:sceneEnter .45s ease-out both}
#countdown-scene::before{content:'';position:absolute;width:130vmax;height:130vmax;border-radius:50%;background:repeating-conic-gradient(from 10deg,#20adff11 0deg 10deg,transparent 10deg 25deg);animation:slowSpin 18s linear infinite;pointer-events:none}
#countdown-scene::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at center,transparent 25%,#01030b88 90%);pointer-events:none}
.scene-heading{position:relative;z-index:2;font-size:clamp(20px,5.7vw,42px);letter-spacing:.15em;text-align:center;font-weight:900;color:#fff;text-shadow:0 0 14px #43baff,0 0 35px #007bff;margin-bottom:clamp(30px,8vh,75px)}
.countdown-balls{position:relative;z-index:2;display:flex;align-items:center;justify-content:center;gap:clamp(5px,1.6vw,20px);width:100%;max-width:740px;perspective:900px}
.countdown-ball{--tone:#ee424c;position:relative;flex:0 1 125px;aspect-ratio:1;min-width:0;max-width:125px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 31% 22%,#ffffffed 0%,#ffffff66 8%,transparent 29%),radial-gradient(circle at 32% 26%,color-mix(in srgb,var(--tone),white 35%),var(--tone) 50%,color-mix(in srgb,var(--tone),black 62%) 100%);border:2px solid #ffffff80;box-shadow:inset -11px -16px 19px #0008,inset 5px 6px 12px #fff7,0 13px 17px #000b,0 0 19px var(--tone);transform-style:preserve-3d}
.countdown-ball::after{content:'';position:absolute;top:9%;left:16%;width:49%;height:24%;border-radius:50%;background:linear-gradient(#fff9,#fff0);transform:rotate(-25deg);filter:blur(2px)}
.ball-face{font-size:clamp(22px,7vw,65px);font-weight:1000;color:#fff;text-shadow:0 3px 5px #0008,0 0 9px #fff9;backface-visibility:hidden;line-height:1;position:relative;z-index:1}
.countdown-ball.is-active{animation:ballBounce .9s cubic-bezier(.2,.6,.3,1) both;box-shadow:inset -11px -16px 19px #0008,inset 5px 6px 12px #fff9,0 24px 27px #0009,0 0 28px 10px var(--tone),0 0 70px var(--tone)}
.countdown-ball.is-active .ball-face{animation:faceFlip .7s ease-in-out both}
.countdown-ball.is-done{filter:brightness(1.1)}
.scene-footer{z-index:2;position:relative;color:#b7d5ff;font-size:clamp(11px,2.7vw,16px);font-weight:800;letter-spacing:.2em;margin-top:clamp(30px,7vh,65px)}
@keyframes sceneEnter{from{opacity:0;transform:scale(.87)}to{opacity:1;transform:scale(1)}}
@keyframes ballBounce{0%{transform:translateY(0) rotateY(0) scale(1)}30%{transform:translateY(-35px) rotateY(90deg) scale(1.16)}55%{transform:translateY(-47px) rotateY(180deg) scale(1.22)}75%{transform:translateY(6px) rotateY(300deg) scale(1.08)}100%{transform:translateY(0) rotateY(360deg) scale(1.05)}}
@keyframes faceFlip{0%,42%{opacity:1}48%,60%{opacity:.05}75%,100%{opacity:1}}
@keyframes slowSpin{to{transform:rotate(360deg)}}
@media(max-width:370px){.locked-inline{gap:5px}.locked-inline .locked-label{font-size:9px}.locked-inline .locked-chip{font-size:9px;padding:4px 5px}.countdown-balls{gap:5px}.countdown-ball{border-width:1px}}
@media(prefers-reduced-motion:reduce){#countdown-scene.visible,.countdown-ball.is-active,.countdown-ball.is-active .ball-face{animation:none}}
/* Full viewport on phones and inside Telegram; keep the approved layout unchanged. */
html,body{width:100%;height:100%;height:100dvh;margin:0;padding:0;overflow:hidden}
body{min-height:100dvh!important;max-height:100dvh!important}
body>div{height:100dvh!important;min-height:100dvh!important;max-height:100dvh!important;border-radius:0!important}

/* Compact Telegram lobby: preserve bonus, jackpot, locked cards & actual 5x5 preview */
:root{--kimem-vh:100dvh;--kimem-top:0px;--kimem-bottom:0px}
html,body{width:100%;height:100%;margin:0;overflow:hidden!important;overscroll-behavior:none}
body{height:var(--kimem-vh)!important;min-height:0!important;padding:0!important;display:block!important}
body>div:first-child{display:flex!important;flex-direction:column!important;height:var(--kimem-vh)!important;max-height:var(--kimem-vh)!important;min-height:0!important;overflow:hidden!important;border-radius:0!important}
body>div:first-child>div:first-child{flex-shrink:0!important;min-height:42px;padding:6px 12px!important}
#lobby-main{display:flex!important;flex-direction:column!important;flex:1 1 0!important;min-height:0!important;overflow:hidden!important;gap:4px!important;padding:4px 9px 2px!important}
#lobby-main>*{margin:0!important;flex-shrink:0!important;min-width:0}
#lobby-main .hero-banner{padding:6px 9px!important;min-height:72px!important;padding-bottom:18px!important;border-radius:12px!important}
#lobby-main .hero-banner h1{font-size:clamp(15px,4.8vw,21px)!important}
#lobby-main .stats-panel{padding:4px 1px!important;min-height:49px!important}
#lobby-main .stat-icon{font-size:12px!important}
#lobby-main .stat-label{font-size:8px!important}
#lobby-main .stat-value{font-size:clamp(10px,3vw,15px)!important}
#lobby-main .bonus-row{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:5px!important;min-height:35px!important}
#lobby-main .bonus-row button{display:flex!important;min-width:0!important;padding:4px!important;gap:4px!important}
#lobby-main .bonus-row button>div:first-child{width:21px!important;height:21px!important;flex-shrink:0}
#lobby-main .bonus-row button>div:last-child{min-width:0}
#lobby-main section:has(#card-matrix){display:flex!important;flex-direction:column!important;flex:1 1 0!important;min-height:60px!important;overflow:hidden!important;gap:4px!important;padding:6px!important}
#lobby-main section:has(#card-matrix)>*{flex-shrink:0!important;margin:0!important}
#card-matrix{display:grid!important;grid-template-columns:repeat(10,minmax(0,1fr))!important;align-content:start!important;flex:1 1 0!important;height:0!important;min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y}
.card-grid-item{height:clamp(24px,3.8dvh,34px)!important}
#lobby-main .locked-inline{display:flex!important;align-items:center!important;gap:7px!important;padding:2px 4px!important;min-height:27px!important}
#lobby-main .locked-inline .locked-row{min-height:27px!important}
#lobby-main section:has(#bingo-board){display:block!important;min-height:0!important;overflow:hidden!important;padding:5px!important}
#lobby-main section:has(#bingo-board)>div:first-child{margin:0 0 3px!important}
#lobby-main section:has(#bingo-board)>div:last-child{padding:3px!important}
#bingo-board,#bingo-header{max-width:100%!important;gap:2px!important}
#bingo-header .bingo-hdr{height:clamp(16px,2.35dvh,23px)!important;font-size:clamp(11px,3vw,15px)!important}
#bingo-board .bingo-tile{height:clamp(16px,2.35dvh,23px)!important;font-size:clamp(10px,2.75vw,14px)!important}
body>div:first-child>div:has(.footer-actions){position:relative!important;inset:auto!important;flex-shrink:0!important;padding:4px 9px max(6px,var(--kimem-bottom))!important}
@media(max-height:730px){#lobby-main{gap:3px!important;padding-top:3px!important}#lobby-main .hero-banner{min-height:62px!important;padding:3px 8px 17px!important}#lobby-main .stats-panel{min-height:38px!important}#lobby-main .bonus-row{min-height:30px!important}#bingo-header .bingo-hdr,#bingo-board .bingo-tile{height:16px!important}#lobby-main section:has(#bingo-board){padding:3px!important}}
@media(max-height:560px){#lobby-main .hero-banner{min-height:53px!important}#lobby-main .hero-banner p{display:none!important}#lobby-main .bonus-row button>div:first-child{display:none!important}#lobby-main .bonus-row{min-height:25px!important}#lobby-main .locked-inline{min-height:22px!important}#bingo-header .bingo-hdr,#bingo-board .bingo-tile{height:14px!important}}

/* Compact in-lobby countdown card: retain existing five-ball animation */
#countdown-scene{inset:auto!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;width:min(92vw,430px)!important;height:auto!important;min-height:195px!important;max-height:45dvh!important;padding:17px 12px!important;border:1px solid #d6ac49!important;border-radius:20px!important;background:linear-gradient(145deg,#102c59,#08172e)!important;box-shadow:0 14px 45px #000c,0 0 0 100vmax #01050b80!important}
#countdown-scene.visible{animation:none!important}
#countdown-scene::before{width:100%!important;height:100%!important;opacity:.18!important}
#countdown-scene::after{border-radius:20px!important}
#countdown-scene .scene-heading{font-size:clamp(15px,4vw,20px)!important;letter-spacing:.09em!important}
#countdown-scene .countdown-balls{gap:clamp(4px,1.3vw,10px)!important;margin:8px 0!important}
#countdown-scene .countdown-ball{max-width:62px!important;flex:0 1 62px!important}
#countdown-scene .scene-footer{font-size:11px!important;margin-top:6px!important}
</style><link rel="prefetch" href="./KIMEM_BINGO_Live_Game.html" as="document"></head>
<body class="h-[100dvh] flex items-center justify-center p-0 cosmic-bg"><div class="w-full min-h-0 h-[100dvh] w-full bg-[#020716] border-0 flex flex-col relative overflow-hidden">
<div class="flex items-center justify-between px-3.5 py-2.5 bg-[#02081a]/90 border-b border-blue-900/40 z-30 shrink-0"><button onclick="leaveToLobby()" class="text-cyan-400 font-semibold text-xs"><i class="fa-solid fa-arrow-left mr-1.5"></i> Leave</button><div class="text-center"><div class="font-black text-xs tracking-wider">KIMEM GAMES</div><div class="text-[8px] font-bold tracking-widest text-blue-400">MINI APP</div></div><button onclick="triggerToast('Menu opened')" class="w-7 h-7 rounded-full bg-blue-950/80 border border-blue-600/50 text-blue-300"><i class="fa-solid fa-ellipsis"></i></button></div>
<main class="flex-1 min-h-0 overflow-hidden px-2 py-1 space-y-1 pb-1" id="lobby-main">
<div class="hero-banner rounded-xl p-3 relative overflow-hidden flex items-center justify-between"><div style="position:absolute;left:0;right:0;bottom:3px;text-align:center;font:700 10px Inter,sans-serif;color:#f2c66e;z-index:12;pointer-events:none">Balance: <span id="lobby-balance">100.00</span> ETB</div><div class="z-10 max-w-[65%]"><div class="text-amber-400 text-[9px] font-black tracking-widest mb-0.5">PREMIUM LIVE ARENA</div><h1 class="text-xl font-black italic tracking-wide leading-none my-0.5"><span class="glow-text-white">KIMEM </span><span class="glow-text-gold">BINGO</span></h1><p class="text-[8px] font-bold text-blue-200/90 tracking-wider">THE ULTIMATE BINGO EXPERIENCE</p></div><div class="relative z-10 flex -space-x-2 items-center"><div class="w-7 h-7 rounded-full bg-gradient-to-b from-red-400 to-red-700 border border-red-200 flex items-center justify-center font-black text-[11px]">B</div><div class="w-7 h-7 rounded-full bg-gradient-to-b from-blue-400 to-blue-700 border border-blue-200 flex items-center justify-center font-black text-[11px]">I</div><div class="w-7 h-7 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 border border-amber-100 flex items-center justify-center font-black text-[11px]">N</div><div class="w-7 h-7 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-700 border border-emerald-200 flex items-center justify-center font-black text-[11px]">G</div><div class="w-7 h-7 rounded-full bg-gradient-to-b from-purple-400 to-purple-700 border border-purple-200 flex items-center justify-center font-black text-[11px]">O</div></div></div>
<div class="neon-panel rounded-lg grid grid-cols-5 gap-0.5 text-center items-center stats-panel"><div><i class="fa-solid fa-gamepad stat-icon text-sky-400"></i><div class="stat-label">GAME ID</div><div class="stat-value" style="font-size:11px;white-space:nowrap;letter-spacing:-0.35px"><span style="color:#fbbf24">AA</span>000000</div></div><div class="border-l border-blue-900/50"><i class="fa-solid fa-money-bill-wave stat-icon text-amber-400"></i><div class="stat-label">DERASH</div><div class="stat-value text-amber-400">15K ETB</div></div><div class="border-l border-blue-900/50"><i class="fa-solid fa-users stat-icon text-cyan-300"></i><div class="stat-label">PLAYERS</div><div class="stat-value">2,500</div></div><div class="border-l border-blue-900/50"><i class="fa-solid fa-coins stat-icon text-amber-400"></i><div class="stat-label">STAKE</div><div class="stat-value text-amber-400">10 ETB</div></div><div class="border-l border-blue-900/50"><i class="fa-solid fa-clock stat-icon text-yellow-300"></i><div class="stat-label">STARTS IN</div><div id="countdown" class="stat-value text-yellow-300">35s</div></div></div>
<div class="grid grid-cols-3 gap-1.5 bonus-row"><button onclick="triggerToast('Daily Reward Active')" class="neon-panel rounded-lg p-1.5 flex items-center space-x-1.5 text-left"><div class="w-6 h-6 rounded bg-red-600/30 text-red-400 flex items-center justify-center text-[10px]"><i class="fa-solid fa-gift"></i></div><div><div class="text-[7px] font-extrabold text-blue-300">DAILY</div><div class="text-[10px] font-black">+50 ETB</div></div></button><button onclick="triggerToast('Weekly Reward Active')" class="neon-panel rounded-lg p-1.5 flex items-center space-x-1.5 text-left"><div class="w-6 h-6 rounded bg-purple-600/30 text-purple-300 flex items-center justify-center text-[10px]"><i class="fa-solid fa-gift"></i></div><div><div class="text-[7px] font-extrabold text-blue-300">WEEKLY</div><div class="text-[10px] font-black">+250 ETB</div></div></button><button onclick="triggerToast('Jackpot Pool: 100K ETB')" class="bg-gradient-to-r from-amber-950/80 to-yellow-900/80 border border-amber-500/60 rounded-lg p-1.5 flex items-center space-x-1.5 text-left"><div class="w-6 h-6 rounded bg-amber-500/30 text-amber-300 flex items-center justify-center text-[10px]"><i class="fa-solid fa-coins"></i></div><div><div class="text-[7px] font-extrabold text-amber-300">JACKPOT</div><div class="text-[10px] font-black text-amber-300">100K ETB</div></div></button></div>
<section class="neon-panel rounded-xl p-2.5 space-y-2"><div class="flex items-center justify-between"><h2 class="text-xs font-black tracking-wide">Choose cards (1 \u2013 1000)</h2><div id="selected-badge" class="px-2 py-0.5 rounded-full bg-blue-600/30 border border-blue-400/60 text-blue-200 text-[9px] font-extrabold">0 / 3 SELECTED</div></div><div class="relative flex items-center"><i class="fa-solid fa-magnifying-glass absolute left-2.5 text-blue-400 text-[10px] pointer-events-none"></i><input type="text" inputmode="numeric" id="card-search-input" placeholder="Search card number (1-1000)..." oninput="handleSearch()" class="w-full bg-[#030d29] border border-blue-800/80 rounded-lg pl-7 pr-7 py-1.5 text-[11px] text-white placeholder-blue-400/60 focus:outline-none focus:border-cyan-400"><button onclick="clearSearch()" class="absolute right-2.5 text-blue-400" aria-label="Clear search"><i class="fa-solid fa-xmark text-xs"></i></button></div><div id="card-matrix" class="card-scroll-area grid grid-cols-10 gap-1 content-start p-1 bg-[#01081f]/80 rounded-lg border border-blue-900/60" aria-label="Choose cards 1 to 1000"></div><div class="text-center text-[8px] font-bold text-cyan-400 tracking-tight">SCROLL TO VIEW ALL CARDS (1\u20131000) \u2022 TAP GOLD CARD TO UNMARK</div></section>
<section aria-label="Locked cards" class="locked-inline"><div class="locked-label">LOCKED CARDS</div><div id="locked-cards" class="locked-row"><span class="text-[10px] text-slate-500">No cards selected</span></div></section>
<section class="neon-panel rounded-xl p-2 space-y-1.5"><div class="flex items-center justify-between px-0.5"><h2 class="text-xs font-black tracking-wide">CARD PREVIEW</h2><div id="preview-title" class="text-[9px] font-black text-blue-400 tracking-wider uppercase">NO CARD SELECTED</div></div><div class="bg-[#020a22] border border-blue-900/80 rounded-lg p-1.5 space-y-1"><div id="bingo-header" class="grid grid-cols-5 gap-1 text-center"></div><div id="bingo-board" class="grid grid-cols-5 gap-1 text-center"></div></div></section>
</main><div id="toast-msg" role="status" class="absolute top-12 left-1/2 -translate-x-1/2 bg-blue-900/95 border border-cyan-400 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shadow-2xl opacity-0 pointer-events-none transition-all duration-300 z-50 whitespace-nowrap max-w-[95%] overflow-hidden text-ellipsis">Notification</div></div>
<div id="countdown-scene" role="dialog" aria-label="Game starts in countdown" aria-modal="true" aria-hidden="true"><div class="scene-heading">GAME STARTS IN</div><div class="countdown-balls" id="countdown-balls"><div class="countdown-ball" style="--tone:#f0444f"><span class="ball-face">B</span></div><div class="countdown-ball" style="--tone:#318bff"><span class="ball-face">I</span></div><div class="countdown-ball" style="--tone:#f5ac2c"><span class="ball-face">N</span></div><div class="countdown-ball" style="--tone:#19b97b"><span class="ball-face">G</span></div><div class="countdown-ball" style="--tone:#a45df6"><span class="ball-face">O</span></div></div><div class="scene-footer">KIMEM BINGO</div></div>
<script>
'use strict';
const selectedCards=[];let searchQuery='';let activeCard=null;let toastTimer;
const $=id=>document.getElementById(id);
function generateDeterministicCard(id){let seed=(Math.imul(id,2654435761)>>>0);const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};const columns=[];for(let c=0;c<5;c++){const pool=Array.from({length:15},(_,i)=>c*15+i+1);for(let i=14;i>0;i--){const j=Math.floor(rand()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}columns.push(pool.slice(0,5))}return Array.from({length:5},(_,r)=>Array.from({length:5},(_,c)=>r===2&&c===2?'FREE':columns[c][r]))}
function renderCardGrid(){const container=$('card-matrix');const scrollTop=container.scrollTop;const frag=document.createDocumentFragment();for(let i=1;i<=1000;i++){const btn=document.createElement('button');btn.type='button';btn.id='card-btn-'+i;btn.className='card-grid-item'+(selectedCards.includes(i)?' selected':'')+(searchQuery&&String(i)===String(Number(searchQuery))?' soft-match':'');btn.setAttribute('aria-pressed',String(selectedCards.includes(i)));btn.innerHTML=String(i)+(selectedCards.includes(i)?'<span class="lock" aria-label="locked">\u{1F512}</span>':'');btn.addEventListener('click',()=>toggleCard(i));frag.appendChild(btn)}container.replaceChildren(frag);container.scrollTop=scrollTop}
function toggleCard(id){const index=selectedCards.indexOf(id);if(index!==-1){selectedCards.splice(index,1);if(activeCard===id)activeCard=selectedCards[selectedCards.length-1]||null;triggerToast('Unmarked Card #'+id)}else{if(selectedCards.length>=3){triggerToast('Maximum 3 cards allowed!');return}selectedCards.push(id);activeCard=id;triggerToast('Selected Card #'+id)}updateUI()}
function renderLockedCards(){const row=$('locked-cards');row.replaceChildren();if(!selectedCards.length){const msg=document.createElement('span');msg.className='text-[10px] text-slate-500';msg.textContent='No cards selected';row.appendChild(msg);return}for(const id of selectedCards){const btn=document.createElement('button');btn.type='button';btn.className='locked-chip'+(id===activeCard?' active':'');btn.innerHTML='\u{1F512} #'+String(id).padStart(4,'0')+' <span>\xD7</span>';btn.title='Unmark card '+id;btn.addEventListener('click',()=>toggleCard(id));row.appendChild(btn)}}
function renderBingoPreview(){const hdr=$('bingo-header');if(!hdr.childElementCount){const colors=['#ffae4e','#60a5fa','#48d7a4','#cf83f7','#ff6484'];'BINGO'.split('').forEach((letter,i)=>{const div=document.createElement('div');div.className='bingo-hdr';div.style.color=colors[i];div.textContent=letter;hdr.appendChild(div)})}const board=$('bingo-board');const grid=activeCard?generateDeterministicCard(activeCard):Array.from({length:5},()=>Array(5).fill("-"));const frag=document.createDocumentFragment();for(let r=0;r<5;r++)for(let c=0;c<5;c++){const div=document.createElement('div');div.className='bingo-tile'+(grid[r][c]==='FREE'?' tile-free':'');div.textContent=grid[r][c];frag.appendChild(div)}board.replaceChildren(frag)}
function updateUI(){renderCardGrid();renderLockedCards();renderBingoPreview();$('selected-badge').textContent=selectedCards.length+' / 3 SELECTED';$('preview-title').textContent=activeCard?'CARD #'+String(activeCard).padStart(4,'0'):'NO CARD SELECTED';$('preview-title').className='text-[9px] font-black tracking-wider uppercase '+(activeCard?'text-amber-400':'text-blue-400')}
function handleSearch(){searchQuery=$('card-search-input').value.replace(/[^0-9]/g,'').slice(0,4);$('card-search-input').value=searchQuery;renderCardGrid();if(searchQuery){const target=Number(searchQuery);if(target>=1&&target<=1000){const el=$('card-btn-'+target);if(el){const area=$('card-matrix');area.scrollTop=Math.max(0,el.offsetTop-area.offsetTop-area.clientHeight/2+el.offsetHeight/2)}}}}
function clearSearch(){$('card-search-input').value='';searchQuery='';renderCardGrid()}
function leaveToLobby(){window.location.href='./index.html'}
function enterLiveGame(){
 if(!selectedCards.length){triggerToast('Select at least 1 card to play!');return}
 const ids=selectedCards.slice(0,3);
 try{sessionStorage.setItem('kimemSelectedCards',JSON.stringify(ids));localStorage.setItem('kimemSelectedCards',JSON.stringify(ids))}catch(e){}
 window.location.href='./KIMEM_BINGO_Live_Game.html?cards='+encodeURIComponent(ids.join(','));
}
function handleActionSubmit(){enterLiveGame()}
function triggerToast(text){const el=$('toast-msg');el.textContent=text;el.style.opacity='1';clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.style.opacity='0',2200)}
const KIMEM_COUNTDOWN_SOUND='https://good-bingo-telegram.floot.app/_cdn/static/23b33aa8-da40-4604-b45f-8a2cf1b2a7c4-qimem-countdown-final.wav';
const kimemCountdownAudio=new Audio(KIMEM_COUNTDOWN_SOUND);
kimemCountdownAudio.preload='auto';kimemCountdownAudio.volume=.78;
function kimemPlayCountdown(){try{kimemCountdownAudio.pause();kimemCountdownAudio.currentTime=0;kimemCountdownAudio.play().catch(()=>{});}catch(e){}}
document.addEventListener('pointerdown',function primeKimemAudio(){try{kimemCountdownAudio.load()}catch(e){}},{once:true});
let timerHandle=null,secondsRemaining=35;
function resetCountdownScene(){const scene=$('countdown-scene');scene.classList.remove('visible');scene.setAttribute('aria-hidden','true');const balls=[...scene.querySelectorAll('.countdown-ball')];balls.forEach((ball,i)=>{ball.classList.remove('is-active','is-done');ball.querySelector('.ball-face').textContent='BINGO'[i]})}
function showCountdownSecond(n){const scene=$('countdown-scene');if(!scene.classList.contains('visible')){scene.classList.add('visible');scene.setAttribute('aria-hidden','false')};const balls=[...scene.querySelectorAll('.countdown-ball')];const idx=5-n;balls.forEach((ball,i)=>{ball.classList.remove('is-active');if(i<idx)ball.classList.add('is-done')});const ball=balls[idx];if(ball){ball.classList.remove('is-done');void ball.offsetWidth;ball.classList.add('is-active');setTimeout(()=>{if(ball.classList.contains('is-active'))ball.querySelector('.ball-face').textContent=String(n)},350)}}
function startTimer(){if(timerHandle)clearInterval(timerHandle);secondsRemaining=35;$('countdown').textContent='35s';resetCountdownScene();timerHandle=setInterval(()=>{secondsRemaining--;$('countdown').textContent=Math.max(0,secondsRemaining)+'s';if(secondsRemaining===5){kimemPlayCountdown();const link=document.createElement('link');link.rel='prefetch';link.href='./KIMEM_BINGO_Live_Game.html?cards='+encodeURIComponent(selectedCards.slice(0,3).join(','));document.head.append(link)}if(secondsRemaining>=1&&secondsRemaining<=5)showCountdownSecond(secondsRemaining);if(secondsRemaining===0){resetCountdownScene();clearInterval(timerHandle);timerHandle=null;if(selectedCards.length){enterLiveGame()}else{try{sessionStorage.removeItem('kimemSelectedCards');localStorage.removeItem('kimemSelectedCards')}catch(e){}window.location.href='./KIMEM_BINGO_Live_Game.html?cards='}}},1000)}
// Opt-in server synchronization for testing; existing lobby remains unchanged by default.
const kimemSyncEnabled=new URLSearchParams(location.search).get('sync')!=='0';
const kimemRoundEndpoint='https://kimem-bingo-backend.mickeyas2411.workers.dev/api/bingo/round?stake=10';
let kimemSyncTimer=null,kimemSyncRound=null,kimemSyncClockOffset=0,kimemSyncLastSecond=null,kimemSyncMoving=false;
function kimemSyncGameId(gameId){
 const node=[...document.querySelectorAll('.stat-label')].find(el=>el.textContent.trim()==='GAME ID')?.parentElement?.querySelector('.stat-value');
 if(node&&/^AA\\d{6}$/.test(gameId))node.innerHTML='<span style="color:#fbbf24">AA</span>'+gameId.slice(2);
}
let kimemAwaitNextLobby=new URLSearchParams(location.search).get('returned')==='1';
let kimemPreviousLiveRound=null;
if(kimemAwaitNextLobby){try{kimemPreviousLiveRound=sessionStorage.getItem('kimemLastLiveRound10')}catch(e){}}
function kimemSyncRender(){
 const r=kimemSyncRound;
 if(!r)return;
 if(kimemAwaitNextLobby){
  if(kimemPreviousLiveRound!==null&&String(r.roundNumber)===kimemPreviousLiveRound){
   $('countdown').textContent='WAIT';resetCountdownScene();return;
  }
  kimemAwaitNextLobby=false;
 }
 if(r.phase==='finished'){$('countdown').textContent='WAIT';resetCountdownScene();return;}
 const now=Date.now()+kimemSyncClockOffset;
 if(r.phase==='lobby'&&now<r.liveStartsAt){
  const left=Math.max(0,Math.ceil((r.liveStartsAt-now)/1000));
  if(left!==kimemSyncLastSecond){
   kimemSyncLastSecond=left;
   $('countdown').textContent=left+'s';
   if(left===5)kimemPlayCountdown();
   if(left>=1&&left<=5)showCountdownSecond(left);
   else resetCountdownScene();
  }
 }else if(!kimemSyncMoving){
  kimemSyncMoving=true;
  resetCountdownScene();
  const ids=selectedCards.slice(0,3);
  try{sessionStorage.setItem('kimemSelectedCards',JSON.stringify(ids))}catch(e){}
  window.location.href='./KIMEM_BINGO_Live_Game.html?cards='+encodeURIComponent(ids.join(','))+'&sync=1';
 }
}
async function kimemSyncPoll(){
 try{
  const response=await fetch(kimemRoundEndpoint,{cache:'no-store'});
  if(!response.ok)throw Error('Round service unavailable');
  const payload=await response.json();
  if(!payload.ok||!payload.round)throw Error('Round not initialized');
  const r=payload.round;
  if(r.stake!=='10'||!/^AA\\d{6}$/.test(r.gameId))throw Error('Invalid round');
  kimemSyncClockOffset=payload.serverTime-Date.now();
  kimemSyncRound=r;
  kimemSyncGameId(r.gameId);
  kimemSyncRender();
 }catch(e){
  // Keep the last authoritative round visible during transient network errors.
  console.warn('KIMEM round sync:',e);
  if(!kimemSyncRound){
   $('countdown').textContent='RETRY';
   $('countdown').title='Server connection unavailable; retrying';
  }
 }
}
function kimemStartSyncedLobby(){
 if(timerHandle)clearInterval(timerHandle);
 $('countdown').textContent='WAIT';
 resetCountdownScene();
 kimemSyncPoll();
 kimemSyncTimer=setInterval(kimemSyncPoll,2000);
 setInterval(kimemSyncRender,200);
}
// Read-only current Game ID for ordinary lobby visits and returns from Live.
// Does not alter countdown, card selection, payment, or navigation.
async function kimemRefreshGameIdOnly(){
 try{
  const response=await fetch(kimemRoundEndpoint,{cache:'no-store'});
  if(!response.ok)return;
  const payload=await response.json();
  if(payload.ok&&payload.round&&/^AA\\d{6}$/.test(payload.round.gameId)){
   kimemSyncGameId(payload.round.gameId);
  }
 }catch(e){console.warn('KIMEM Game ID refresh:',e)}
}
function kimemStartGameIdOnlySync(){
 kimemRefreshGameIdOnly();
 setInterval(kimemRefreshGameIdOnly,3000);
}
function syncTelegramViewport(){
 const tg=window.Telegram?.WebApp;
 const height=(tg&&tg.viewportStableHeight&&tg.viewportStableHeight>250)?tg.viewportStableHeight:(window.visualViewport?.height||window.innerHeight);
 document.documentElement.style.setProperty('--kimem-vh',Math.round(height)+'px');
 const fullscreen=!!tg?.isFullscreen;
 const safeTop=fullscreen?(tg?.safeAreaInset?.top||0)+(tg?.contentSafeAreaInset?.top||0):0;
 const safeBottom=fullscreen?(tg?.safeAreaInset?.bottom||0)+(tg?.contentSafeAreaInset?.bottom||0):0;
 document.documentElement.style.setProperty('--kimem-top',Math.max(0,safeTop)+'px');
 document.documentElement.style.setProperty('--kimem-bottom',Math.max(6,safeBottom)+'px');
}

function refreshLobbyBalance(){try{const w=JSON.parse(localStorage.getItem('qimem-wallet-preview-v1')||'null');const v=w&&Number.isInteger(w.balance)?w.balance:10000;document.getElementById('lobby-balance').textContent=(v/100).toFixed(2)}catch(e){document.getElementById('lobby-balance').textContent='100.00'}}
window.addEventListener('storage',refreshLobbyBalance);
function init(){
 const tg=window.Telegram?.WebApp;
 try{if(tg){tg.ready();tg.expand();tg.onEvent('viewportChanged',syncTelegramViewport);tg.onEvent('safeAreaChanged',syncTelegramViewport);tg.onEvent('contentSafeAreaChanged',syncTelegramViewport);/* Avoid Telegram system overlay obscuring title; expand only. */}}catch(e){}
 syncTelegramViewport();window.addEventListener('resize',syncTelegramViewport);window.visualViewport?.addEventListener('resize',syncTelegramViewport);
 refreshLobbyBalance();updateUI();if(kimemSyncEnabled)kimemStartSyncedLobby();else{startTimer();kimemStartGameIdOnlySync();}
}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
<\/script><div id="staging-bonus" style="position:fixed;right:12px;top:calc(42px + env(safe-area-inset-top));z-index:99999;background:#102e31;color:#d7fff1;border:1px solid #24c989;border-radius:9px;padding:7px 10px;font:700 12px system-ui;box-shadow:0 4px 20px #0008">Welcome Bonus: <span id="staging-bonus-value">Checking\u2026</span></div><script>(async()=>{const el=document.getElementById('staging-bonus-value');const init=window.Telegram?.WebApp?.initData;if(!init){el.textContent='Telegram login required';return;}try{const r=await fetch('/api/me/bonus-balance',{headers:{Authorization:'tma '+init},cache:'no-store'});const d=await r.json();el.textContent=r.ok&&d.ok?d.bonus_etb+' ETB':'Unavailable';}catch{el.textContent='Unavailable';}})();<\/script></body></html>

`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    if (path === "/registration-test" && request.method === "GET") {
      return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KIMEM Registration Staging Test</title><script src="https://telegram.org/js/telegram-web-app.js"><\/script><style>body{background:#101827;color:#f8fafc;font:16px system-ui;margin:0;padding:22px}main{max-width:440px;margin:9vh auto;padding:24px;background:#172338;border:1px solid #334155;border-radius:18px}h1{font-size:23px}p{color:#cbd5e1;line-height:1.6}button{background:#22c55e;color:#052e16;border:0;border-radius:10px;padding:14px 18px;font-weight:700}button:disabled{opacity:.5}output{display:block;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:20px}</style></head><body><main><h1>KIMEM \xB7 Registration Test</h1><p>Staging only. Register your Telegram account and check the one-time 10 ETB welcome bonus. No card purchases or real-money transactions.</p><button id="register">Register and check bonus</button><output id="result" role="status">Open inside @Kimemtest_bot Mini App.</output><p><a href="/lobby-bonus-test">Open staging Bingo Lobby</a></p></main><script>const b=document.getElementById('register'),o=document.getElementById('result');b.addEventListener('click',async()=>{const d=window.Telegram?.WebApp?.initData;if(!d){o.textContent='Open this page inside the Telegram Mini App.';return}b.disabled=true;o.textContent='Verifying and registering\u2026';try{const headers={Authorization:'tma '+d};const r=await fetch('/api/me/register',{method:'POST',headers,cache:'no-store'});const x=await r.json();if(!r.ok||!x.ok){o.textContent='Registration failed: '+String(x.error||r.status);return}const bal=await fetch('/api/me/bonus-balance',{headers,cache:'no-store'});const y=await bal.json();o.textContent=bal.ok&&y.ok?'Registration verified. Welcome bonus: '+String(y.bonus_etb)+' ETB. '+(x.bonus_newly_granted?'First-time grant.':'Existing bonus account.'):'Registered; balance check failed: '+String(y.error||bal.status)}catch{o.textContent='Network error. Try again.'}finally{b.disabled=false}});window.Telegram?.WebApp?.ready();<\/script></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
    }
    if (path === "/login-test" || path === "/diagnostics/auth") {
      return staging_auth_gateway_default.fetch(request, env, ctx);
    }
    if (path === "/api/me/register" || path === "/api/me/bonus-balance" || path === "/api/me/balances" || path === "/api/cards/buy-bonus") {
      return player_api_worker_default.fetch(request, env, ctx);
    }
    return staging_auth_gateway_default.fetch(request, env, ctx);
  }
};
export {
  staging_combined_worker_default as default
};
/*! Bundled license information:

@neondatabase/serverless/index.mjs:
  (*! Bundled license information:
  
  ieee754/index.js:
    (*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> *)
  
  buffer/index.js:
    (*!
     * The buffer module from node.js, for the browser.
     *
     * @author   Feross Aboukhadijeh <https://feross.org>
     * @license  MIT
     *)
  *)
*/
