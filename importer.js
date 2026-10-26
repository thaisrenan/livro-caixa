// Lê a planilha "Controle Financeiro" (uma aba por mês, nomeada MMAAAA) e devolve os lançamentos por mês.
// Usado pela página (botão Importar planilha) e pelos scripts de importação.
(function (root) {
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  const SHEET_CATS = {
    "moradia": "Moradia", "celular": "Celular e internet", "assinatura": "Assinaturas", "saude": "Saúde",
    "educacao": "Educação", "moto": "Moto", "uber": "Transporte", "delivery": "Delivery e restaurantes",
    "cachorros": "Cachorros", "compras online": "Compras online", "itens para casa": "Itens para casa",
    "presentes": "Presentes", "viagem": "Viagem", "lazer": "Lazer", "outros": "Outros",
  };
  const RULES = [
    ["Moradia", ["aluguel", "luz", "agua", "condominio"]],
    ["Celular e internet", ["celular", "carregador", "claro", "internet"]],
    ["Assinaturas", ["gemini", "apple", "icloud", "xbox", "udemy", "e-mail", "livelo", "escavador", "kindle", "claude"]],
    ["Saúde", ["academia", "whey", "dentista", "ortho", "farmacia"]],
    ["Educação", ["faculdade", "curso"]],
    ["Moto", ["moto", "pneu", "capacete", "luva"]],
    ["Transporte", ["uber", "patinete", "estacionamento", "corrida", "combustivel", "gasolina"]],
    ["Delivery e restaurantes", ["ifood", "keeta", "delivery", "acai", "japinha", "madero", "restaurante", "padaria", "almoco", "liberdade", "paraiba"]],
    ["Mercado", ["mercado", "sacolao", "carrefour", "coop", "compras sto"]],
    ["Cachorros", ["racao", "pet"]],
    ["Presentes", ["presente", "mala stanley", "boticario", "netshoes"]],
    ["Viagem", ["viagem", "hotel", "hospedagem", "airb"]],
    ["Itens para casa", ["processador", "colchao", "porta escova"]],
    ["Compras online", ["shopee", "amazon", "shein", "havan", "outlet", "ttk", "camiseta", "garrafinha"]],
    ["Lazer", ["henrique e ju"]],
    ["Dívidas e taxas", ["serasa", "registro", "fatura"]],
  ];
  const IN_CATS = { "salario": "Salário", "bonus": "Bônus", "sobra do mes anterior": "Sobra do mês anterior", "dinheiro inesperado": "Dinheiro inesperado", "ajuste de saldo": "Ajuste de saldo" };

  function guessCat(desc, sheetCat) {
    const sc = SHEET_CATS[norm(sheetCat)];
    if (sc) return sc;
    const d = norm(desc);
    for (const [cat, keys] of RULES) if (keys.some(k => d.includes(k))) return cat;
    return "Outros";
  }

  function cents(v) {
    if (typeof v === "number") return Math.round(v * 100);
    if (typeof v === "string") {
      let s = v.replace(/[R$\s]/g, "");
      if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
      const n = Number(s);
      return Number.isFinite(n) ? Math.round(n * 100) : NaN;
    }
    return NaN;
  }

  // Excel converte "5/12" (parcela 5 de 12) em 5 de dezembro; "1/1" é à vista.
  function parcela(XLSX, v) {
    let cur, tot;
    if (typeof v === "number") { const d = XLSX.SSF.parse_date_code(v); if (d) { cur = d.d; tot = d.m; } }
    else if (v instanceof Date) { cur = v.getUTCDate(); tot = v.getUTCMonth() + 1; }
    else if (typeof v === "string") { const m = v.match(/(\d+)\s*\/\s*(\d+)/); if (m) { cur = +m[1]; tot = +m[2]; } }
    if (!cur || !tot || (cur === 1 && tot === 1)) return null;
    return `${cur}/${tot}`;
  }

  function dayIn(XLSX, v, ym) {
    if (typeof v !== "number") return null;
    const d = XLSX.SSF.parse_date_code(v);
    if (!d || String(d.m).padStart(2, "0") !== ym.slice(5)) return null;
    return d.d;
  }

  function parseStatus(v, ym, todayYM) {
    const s = norm(v);
    if (s === "pago" || v === true) return true;
    if (s.startsWith("aguard") || v === false) return false;
    return ym < todayYM;
  }

  function parseWorkbook(XLSX, wb, todayYM) {
    const months = {};
    let skipped = 0;
    for (const name of wb.SheetNames) {
      const m = String(name).trim().match(/^(\d{2})(\d{4})$/);
      if (!m || +m[1] < 1 || +m[1] > 12) continue;
      const ym = `${m[2]}-${m[1]}`;
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
      const h = rows.findIndex(r => r && r.some(c => norm(c) === "origem"));
      if (h < 1) continue;
      const head = rows[h].map(norm), sec = rows[h - 1].map(norm);
      const starts = [];
      sec.forEach((v, i) => { if (v.startsWith("receitas")) starts.push(["in", i]); if (v.startsWith("despesas fixas")) starts.push(["fixed", i]); if (v.startsWith("despesas variaveis")) starts.push(["var", i]); });
      const items = [];
      const col = (start, end, label) => { for (let i = start; i < end; i++) if (head[i] === label) return i; return -1; };
      starts.forEach(([kind, start], k) => {
        const end = k + 1 < starts.length ? starts[k + 1][1] : head.length;
        if (kind === "in") {
          let r = h + 1;
          for (; r < rows.length; r++) {
            const row = rows[r] || [];
            if (norm(row[start]).startsWith("investimento")) break;
            if (!row[start]) continue;
            const v = cents(row[start + 1]);
            if (!(v > 0)) { if (row[start + 1] != null && row[start + 1] !== 0) skipped++; continue; }
            const desc = String(row[start]).trim();
            items.push({ id: `xl-${ym}-in-${r}`, kind: "in", desc, amount: v, cat: IN_CATS[norm(desc)] || "Outros",
              method: null, day: dayIn(XLSX, row[start + 2], ym), paid: row[start + 3] === true || ym < todayYM, inst: null, src: "xlsx" });
          }
          for (r = r + 1; r < rows.length; r++) {
            const row = rows[r] || [];
            if (!row[start]) break;
            const v = cents(row[start + 2]);
            if (!(v > 0)) continue;
            const name = String(row[start]).trim();
            items.push({ id: `xl-${ym}-inv-${r}`, kind: "invest", desc: name, amount: v, cat: norm(name) === "renda fixa" ? "Renda fixa" : norm(name) === "renda variavel" ? "Renda variável" : "Outros",
              method: row[start + 1] || null, day: null, paid: parseStatus(row[start + 3], ym, todayYM), inst: null, src: "xlsx" });
          }
          return;
        }
        const cTipo = col(start, end, "tipo"), cForma = col(start, end, "forma de pagamento"), cCat = col(start, end, "categoria"),
          cParc = col(start, end, "parcela"), cVal = col(start, end, "valor"), cStat = col(start, end, "status");
        if (cTipo < 0 || cVal < 0) return;
        for (let r = h + 1; r < rows.length; r++) {
          const row = rows[r] || [];
          if (!row[cTipo]) continue;
          const v = cents(row[cVal]);
          if (!(v > 0)) { if (row[cVal] != null && row[cVal] !== 0) skipped++; continue; }
          const desc = String(row[cTipo]).trim();
          items.push({ id: `xl-${ym}-${kind}-${r}`, kind, desc, amount: v, cat: guessCat(desc, cCat >= 0 ? row[cCat] : null),
            method: row[cForma] ? (norm(row[cForma]) === "credito thais" ? "Crédito Thais Itaú" : String(row[cForma]).trim()) : null, day: null,
            paid: parseStatus(cStat >= 0 ? row[cStat] : null, ym, todayYM), inst: cParc >= 0 ? parcela(XLSX, row[cParc]) : null, src: "xlsx" });
        }
      });
      if (items.length) months[ym] = items;
    }
    return { months, skipped };
  }

  root.LivroCaixaImport = { parseWorkbook, guessCat };
  if (typeof module !== "undefined") module.exports = root.LivroCaixaImport;
})(typeof window !== "undefined" ? window : globalThis);
