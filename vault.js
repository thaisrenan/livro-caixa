// Cofre do Livro-Caixa: chave guardada no aparelho (protegida pelo PIN), dados criptografados
// com AES-GCM antes de ir para o Supabase, fila local para funcionar sem internet.
(function () {
  const cfg = window.LC_CONFIG || {};
  const enc = new TextEncoder(), dec = new TextDecoder();
  const $ = (id) => document.getElementById(id);

  // ---------- utilidades ----------
  function b64(buf) {
    const u = new Uint8Array(buf); let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const toUrl = (s) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const fromUrl = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return s; };
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem("lc:" + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem("lc:" + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem("lc:" + k); } catch (e) {} },
  };
  const validSecret = (s) => /^[A-Za-z0-9_-]{43}$/.test(s || "");
  // aceita o link completo, só a chave, ou a chave com espaços e quebras de linha
  function extractSecret(text) {
    const t = String(text || "").trim();
    const m = t.match(/chave=([A-Za-z0-9_-]{43})/);
    if (m) return m[1];
    const c = t.replace(/\s+/g, "");
    return validSecret(c) ? c : null;
  }

  // ---------- PIN ----------
  async function pinKey(pin, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function wrapSecret(secret, pin) {
    const salt = rand(16), iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await pinKey(pin, salt), enc.encode(secret));
    LS.set("wrapped", { salt: b64(salt), iv: b64(iv), ct: b64(ct) });
  }
  async function unwrapSecret(pin) {
    const w = LS.get("wrapped");
    if (!w) return null;
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(w.iv) }, await pinKey(pin, unb64(w.salt)), unb64(w.ct));
      return dec.decode(pt);
    } catch (e) { return null; }
  }

  // ---------- sessão e criptografia dos dados ----------
  async function openSession(secret) {
    const key = await crypto.subtle.importKey("raw", unb64(fromUrl(secret)), "AES-GCM", false, ["encrypt", "decrypt"]);
    return { secret, key, vault: await sha("lc-id:" + secret), token: await sha("lc-w:" + secret) };
  }
  async function seal(s, obj) {
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, s.key, enc.encode(JSON.stringify(obj)));
    return { iv: b64(iv), data: b64(ct) };
  }
  async function unseal(s, row) {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(row.iv) }, s.key, unb64(row.data));
    return JSON.parse(dec.decode(pt));
  }

  async function rpc(name, body) {
    const r = await fetch(String(cfg.url).replace(/\/$/, "") + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.anonKey, Authorization: "Bearer " + cfg.anonKey },
      body: JSON.stringify(body),
    });
    if (!r.ok) { const e = new Error("Servidor respondeu " + r.status); e.status = r.status; e.body = await r.text().catch(() => ""); throw e; }
    return r.json();
  }

  // ---------- armazenamento sincronizado ----------
  function makeStore(s, hooks) {
    let cache = LS.get("cache") || {};     // doc -> {iv, data, deleted, ts} como está no servidor
    let pending = LS.get("pending") || {}; // doc -> {iv, data, deleted} ainda não enviado
    let since = LS.get("since") || null;
    const months = {}; let settings = {};
    const emit = () => { hooks.onData({ ...months }); hooks.onSettings({ ...settings }); };

    async function apply(doc, row) {
      if (row.deleted || !row.data) { if (doc === "settings") settings = {}; else delete months[doc]; return; }
      try {
        const v = await unseal(s, row);
        if (doc === "settings") settings = v || {};
        else if (Array.isArray(v.items) && v.items.length) months[doc] = v.items;
        else delete months[doc];
      } catch (e) { /* documento de outra chave ou corrompido: ignora */ }
    }

    let running = null, again = false;
    function sync() {
      if (running) { again = true; return running; }
      running = (async () => {
        hooks.onStatus("syncing");
        try {
          for (const doc of Object.keys(pending)) {
            const r = pending[doc];
            const ts = await rpc("lc_put", { p_vault: s.vault, p_token: s.token, p_doc: doc, p_iv: r.iv || null, p_data: r.data || null, p_deleted: !!r.deleted });
            cache[doc] = { iv: r.iv || null, data: r.data || null, deleted: !!r.deleted, ts };
            if (pending[doc] === r) delete pending[doc];
          }
          LS.set("pending", pending); LS.set("cache", cache);
          const rows = await rpc("lc_get", { p_vault: s.vault, p_since: since });
          let changed = false;
          for (const row of rows) {
            cache[row.doc_id] = { iv: row.iv, data: row.data, deleted: row.deleted, ts: row.updated_at };
            if (!pending[row.doc_id]) { await apply(row.doc_id, row); changed = true; }
            if (!since || row.updated_at > since) since = row.updated_at;
          }
          LS.set("cache", cache); LS.set("since", since);
          if (changed) emit();
          hooks.onStatus(Object.keys(pending).length ? "pending" : "ok");
        } catch (e) {
          hooks.onStatus(navigator.onLine === false || e instanceof TypeError ? "offline" : "error", e);
        } finally {
          running = null;
          if (again) { again = false; sync(); }
        }
      })();
      return running;
    }

    async function put(doc, obj, remove) {
      pending[doc] = remove ? { deleted: true } : await seal(s, obj);
      LS.set("pending", pending);
      hooks.onStatus("pending");
      sync();
    }

    return {
      kind: "vault",
      async start() {
        for (const [d, r] of Object.entries(cache)) await apply(d, r);
        for (const [d, r] of Object.entries(pending)) await apply(d, r);
        emit();
        sync();
        setInterval(() => { if (document.visibilityState === "visible") sync(); }, 20000);
        addEventListener("online", () => sync());
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
      },
      putMonth(ym, items) {
        if (items.length) months[ym] = items; else delete months[ym];
        hooks.onData({ ...months });
        return put(ym, { items, updatedAt: Date.now() }, !items.length);
      },
      putSettings(v) {
        settings = v || {};
        hooks.onSettings({ ...settings });
        return put("settings", settings);
      },
      async importAll(data) {
        const ms = data && data.months && typeof data.months === "object" ? data.months : null;
        if (!ms) throw new Error("formato");
        for (const [ym, items] of Object.entries(ms)) if (/^\d{4}-\d{2}$/.test(ym) && Array.isArray(items)) await this.putMonth(ym, items);
        if (data.settings && typeof data.settings === "object") await this.putSettings({ ...settings, ...data.settings });
        return Object.keys(ms).length;
      },
      exportAll() { return { app: "livro-caixa", version: 1, exportedAt: new Date().toISOString(), months: { ...months }, settings: { ...settings } }; },
      sync,
      pendingCount: () => Object.keys(pending).length,
    };
  }

  // ---------- telas de bloqueio e configuração ----------
  const lock = () => $("lock");
  function screen(html) { lock().hidden = false; document.documentElement.classList.add("locked"); $("lockBody").innerHTML = html; }
  function closeLock() { lock().hidden = true; document.documentElement.classList.remove("locked"); $("lockBody").innerHTML = ""; }

  // teclado numérico; resolve com o PIN digitado
  function askPin({ title, sub, links = [] }) {
    return new Promise((resolve) => {
      let pin = "";
      screen(`<h1 class="lock-title">${title}</h1><p class="lock-sub" id="pinSub">${sub || ""}</p>
        <div class="pin-dots" id="pinDots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <p class="lock-msg" id="pinMsg" role="alert"></p>
        <div class="keypad" id="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join("")}<span></span><button type="button" data-k="0">0</button><button type="button" data-k="del" aria-label="Apagar">⌫</button></div>
        <input id="pinInput" class="pin-input" inputmode="numeric" autocomplete="off" maxlength="4" aria-label="PIN de 4 dígitos">
        <div class="lock-links">${links.map((l, i) => `<button type="button" class="lock-link" data-link="${i}">${l.label}</button>`).join("")}</div>`);
      const dots = () => $("pinDots") && $("pinDots").querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", i < pin.length));
      const push = (k) => {
        if (k === "del") pin = pin.slice(0, -1);
        else if (pin.length < 4) pin += k;
        dots();
        if (pin.length === 4) { const p = pin; pin = ""; setTimeout(dots, 250); resolve({ pin: p, again: (msg) => { $("pinMsg").textContent = msg; $("pinDots").classList.add("shake"); setTimeout(() => $("pinDots") && $("pinDots").classList.remove("shake"), 400); return askPinAgain(); } }); }
      };
      // permite reutilizar a mesma tela depois de um PIN errado
      const askPinAgain = () => new Promise((res) => { resolve = res; });
      $("keypad").addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (b) push(b.dataset.k); });
      $("pinInput").addEventListener("input", (e) => { const v = e.target.value.replace(/\D/g, ""); e.target.value = ""; for (const c of v) push(c); });
      document.onkeydown = (e) => { if (lock().hidden) return; if (/^\d$/.test(e.key)) push(e.key); if (e.key === "Backspace") push("del"); };
      $("lockBody").querySelectorAll("[data-link]").forEach((b) => b.addEventListener("click", () => links[+b.dataset.link].run()));
    });
  }

  async function choosePin(title) {
    let first = await askPin({ title, sub: "Escolha 4 números. Você vai usar para abrir o app neste aparelho." });
    while (true) {
      const second = await askPin({ title: "Confirme o PIN", sub: "Digite os mesmos 4 números de novo." });
      if (second.pin === first.pin) return first.pin;
      first = await askPin({ title, sub: "Os PINs não bateram. Escolha de novo." });
    }
  }

  // resolve com a chave, ou null se a pessoa voltar
  function pasteKeyScreen() {
    return new Promise((resolve) => {
      screen(`<h1 class="lock-title">Conectar este aparelho</h1>
        <p class="lock-sub">No aparelho que já usa o Livro-Caixa, abra <b>Configurações → Conectar outro aparelho</b> e aponte a câmera para o QR code. Ou cole aqui o link ou o código de recuperação.</p>
        <textarea id="keyPaste" class="lock-text" rows="3" placeholder="Cole o link ou o código"></textarea>
        <p class="lock-msg" id="keyMsg" role="alert"></p>
        <div class="lock-actions"><button type="button" class="btn primary" id="keyGo">Conectar</button><button type="button" class="btn" id="keyBack">Voltar</button></div>`);
      $("keyGo").onclick = () => { const s = extractSecret($("keyPaste").value); if (s) resolve(s); else $("keyMsg").textContent = "Não reconheci esse código. Confira se copiou tudo."; };
      $("keyBack").onclick = () => resolve(null);
    });
  }

  function recoveryScreen(secret) {
    return new Promise((resolve) => {
      screen(`<h1 class="lock-title">Guarde seu código de recuperação</h1>
        <p class="lock-sub">Se você perder ou trocar todos os seus aparelhos, só este código traz seus dados de volta. Ninguém mais tem uma cópia, nem o servidor. Salve num lugar seguro, como o app de senhas ou as notas protegidas do celular.</p>
        <code class="recovery" id="recCode">${secret.match(/.{1,11}/g).join(" ")}</code>
        <div class="lock-actions"><button type="button" class="btn" id="recCopy">Copiar código</button></div>
        <label class="check lock-check"><input type="checkbox" id="recOk"> Guardei o código</label>
        <div class="lock-actions"><button type="button" class="btn primary" id="recGo" disabled>Continuar</button></div>`);
      $("recCopy").onclick = () => navigator.clipboard.writeText(secret).then(() => { $("recCopy").textContent = "Copiado"; }, () => { getSelection().selectAllChildren($("recCode")); });
      $("recOk").onchange = () => { $("recGo").disabled = !$("recOk").checked; };
      $("recGo").onclick = resolve;
    });
  }

  async function firstRun() {
    return new Promise((resolve) => {
      screen(`<div class="lock-logo" aria-hidden="true">R$</div><h1 class="lock-title">Livro-Caixa</h1>
        <p class="lock-sub">Seu controle de receitas, despesas e reserva. Os dados ficam criptografados e sincronizados entre os seus aparelhos.</p>
        <div class="lock-actions col"><button type="button" class="btn primary" id="frNew">Começar</button><button type="button" class="btn" id="frLink">Já uso em outro aparelho</button></div>`);
      $("frNew").onclick = () => resolve("new");
      $("frLink").onclick = () => resolve("link");
    });
  }

  function throttleWait() {
    const f = LS.get("fails") || { n: 0, until: 0 };
    return Math.max(0, f.until - Date.now());
  }
  function registerFail() {
    const f = LS.get("fails") || { n: 0, until: 0 };
    f.n++;
    if (f.n >= 5) f.until = Date.now() + Math.min(3600e3, 30e3 * 2 ** (f.n - 5));
    LS.set("fails", f);
  }

  async function unlockFlow() {
    let resetting = false;
    const links = [{ label: "Esqueci o PIN", run: () => { resetting = true; recover(); } }];
    let resolveRecovered;
    const recovered = new Promise((r) => { resolveRecovered = r; });
    async function recover() {
      const secret = await pasteKeyScreen();
      if (!secret) { resetting = false; start(); return; }
      const pin = await choosePin("Crie um PIN novo");
      resetLocal();
      await wrapSecret(secret, pin);
      resolveRecovered(secret);
    }
    let attempt;
    const start = () => { attempt = askPin({ title: "Digite seu PIN", sub: "Livro-Caixa", links }); loop(); };
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    async function loop() {
      let r = await attempt;
      while (!resetting) {
        const wait = throttleWait();
        if (wait > 0) { r = await r.again(`Muitas tentativas. Espere ${Math.ceil(wait / 1000)} segundos.`); continue; }
        const secret = await unwrapSecret(r.pin);
        if (secret) { LS.del("fails"); resolveDone(secret); return; }
        registerFail();
        r = await r.again("PIN incorreto.");
      }
    }
    start();
    return Promise.race([done, recovered]);
  }

  async function boot(hooks) {
    if (!cfg.url || !cfg.anonKey) {
      screen(`<h1 class="lock-title">Falta configurar o servidor</h1><p class="lock-sub">Preencha o endereço e a chave pública do Supabase no arquivo <code>config.js</code>.</p>`);
      return new Promise(() => {});
    }
    let secret = null;
    const m = location.hash.match(/chave=([A-Za-z0-9_-]{43})/);
    if (m) { history.replaceState(null, "", location.pathname + location.search); }

    if (m) {
      secret = m[1];
      const pin = await choosePin("Crie um PIN para este aparelho");
      resetLocal();
      await wrapSecret(secret, pin);
    } else if (LS.get("wrapped")) {
      secret = await unlockFlow();
    } else {
      while (!secret) {
        const how = await firstRun();
        if (how === "new") {
          const s = toUrl(b64(rand(32)));
          const pin = await choosePin("Crie seu PIN");
          await wrapSecret(s, pin);
          await recoveryScreen(s);
          secret = s;
        } else {
          const s = await pasteKeyScreen();
          if (s) { const pin = await choosePin("Crie um PIN para este aparelho"); await wrapSecret(s, pin); secret = s; }
        }
      }
    }
    closeLock();
    document.onkeydown = null;
    const s = await openSession(secret);
    const store = makeStore(s, hooks);
    await store.start();
    autoLock();
    return Object.assign(store, {
      secret: () => s.secret,
      linkUrl: () => location.origin + location.pathname + "#chave=" + s.secret,
      async changePin() { const pin = await choosePin("Crie um PIN novo"); await wrapSecret(s.secret, pin); closeLock(); document.onkeydown = null; },
      async lockNow() { await relock(); },
      disconnect() { resetLocal(); location.reload(); },
    });
  }

  function resetLocal() { ["wrapped", "cache", "pending", "since", "fails"].forEach(LS.del); }

  async function relock() {
    let r = await askPin({ title: "Digite seu PIN", sub: "Livro-Caixa" });
    while (true) {
      const wait = throttleWait();
      if (wait > 0) { r = await r.again(`Muitas tentativas. Espere ${Math.ceil(wait / 1000)} segundos.`); continue; }
      if (await unwrapSecret(r.pin)) { LS.del("fails"); break; }
      registerFail();
      r = await r.again("PIN incorreto.");
    }
    closeLock();
    document.onkeydown = null;
  }

  // bloqueia de novo depois de 5 minutos fora do app
  function autoLock() {
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 5 * 60e3 && lock().hidden) relock();
    });
  }

  window.LCVault = { boot, extractSecret };
})();
