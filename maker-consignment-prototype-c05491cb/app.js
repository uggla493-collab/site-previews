/* Offline maker consignment prototype. No network dependencies. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof document !== "undefined") api.mount(document);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MAX = BigInt(Number.MAX_SAFE_INTEGER);
  function safe(value, label) {
    if (value < -MAX || value > MAX) throw new Error(label + ": beloppet är för stort.");
    return Number(value);
  }
  function integer(value, label, max = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < 0 || value > max)
      throw new Error(label + ": ange ett giltigt, icke-negativt heltal.");
    return value;
  }
  function parseQuantity(value) {
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) throw new Error("Antal måste vara ett icke-negativt heltal.");
    return integer(Number(text), "Antal");
  }
  // Exact decimal parsing: no floating-point multiplication of money.
  function parseDecimal(value, label = "Belopp") {
    const text = String(value).trim().replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(text))
      throw new Error(label + ": använd ett positivt tal eller noll, med högst två decimaler.");
    const parts = text.split(".");
    return safe(BigInt(parts[0]) * 100n + BigInt((parts[1] || "").padEnd(2, "0")), label);
  }
  function decimal(value) {
    if (!Number.isSafeInteger(value)) throw new Error("Ogiltigt öresbelopp.");
    const n = BigInt(value);
    const abs = n < 0n ? -n : n;
    return (n < 0n ? "-" : "") + String(abs / 100n) + "," + String(abs % 100n).padStart(2, "0");
  }
  function money(value) { return decimal(value) + " SEK"; }
  function calculate(input) {
    if (!input || typeof input !== "object") throw new Error("Uppgifter saknas.");
    const q = {};
    for (const key of ["delivered", "sold", "returned"])
      q[key] = integer(input[key], key);
    for (const key of ["priceOre", "unitCostOre", "otherCostsOre", "paidOre"])
      integer(input[key], key);
    integer(input.commissionBps, "Provision", 10000);
    if (q.sold > q.delivered) throw new Error("Sålt antal får inte överstiga levererat antal i denna omgång.");
    if (q.returned > q.sold) throw new Error("Returer får inte överstiga sålt antal.");
    const netUnits = q.sold - q.returned;
    const grossSalesOre = safe(BigInt(q.sold) * BigInt(input.priceOre), "Bruttoförsäljning");
    const refundsOre = safe(BigInt(q.returned) * BigInt(input.priceOre), "Återbetalningar");
    const netSalesOre = grossSalesOre - refundsOre;
    // Round half up once on net sales for this entire batch, not per item.
    const commissionOre = safe((BigInt(netSalesOre) * BigInt(input.commissionBps) + 5000n) / 10000n, "Provision");
    const entitlementOre = netSalesOre - commissionOre;
    const costsOre = safe(BigInt(netUnits) * BigInt(input.unitCostOre) + BigInt(input.otherCostsOre), "Kostnader");
    const profitOre = safe(BigInt(entitlementOre) - BigInt(costsOre), "Resultat");
    const balanceOre = entitlementOre - input.paidOre;
    return {
      stock: q.delivered - q.sold + q.returned, netUnits,
      grossSalesOre, refundsOre, netSalesOre, commissionOre, entitlementOre,
      costsOre, profitOre, balanceOre,
      outstandingOre: Math.max(0, balanceOre), overpaidOre: Math.max(0, -balanceOre)
    };
  }
  function sample() {
    return { maker: "Fiktiva Formverkstan", product: "Keramikmugg – fiktivt exempel",
      delivered: 10, sold: 4, returned: 1, priceOre: 20000, commissionBps: 3000,
      unitCostOre: 5000, otherCostsOre: 0, paidOre: 30000 };
  }
  function csvCell(value) {
    let text = String(value);
    // Keep spreadsheet programs from interpreting user text as a formula.
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function toCSV(input) {
    const r = calculate(input);
    const rows = [
      ["Typ", "Lokalt räkneunderlag – uppgifter är inte verifierade"],
      ["Tillverkare", input.maker || ""], ["Produkt", input.product || ""],
      ["Levererat antal", input.delivered], ["Sålt före returer", input.sold],
      ["Återbetalda returer till lager", input.returned], ["Lager antal", r.stock],
      ["Pris SEK", decimal(input.priceOre)], ["Provision procent", decimal(input.commissionBps)],
      ["Bruttoförsäljning SEK", decimal(r.grossSalesOre)],
      ["Återbetalningar SEK", decimal(r.refundsOre)],
      ["Nettoförsäljning SEK", decimal(r.netSalesOre)],
      ["Provision SEK", decimal(r.commissionOre)],
      ["Tillverkarens ersättning före egna kostnader SEK", decimal(r.entitlementOre)],
      ["Kostnad per nettosåld vara SEK", decimal(input.unitCostOre)],
      ["Övriga egna kostnader SEK", decimal(input.otherCostsOre)],
      ["Egna kostnader totalt SEK", decimal(r.costsOre)],
      ["Resultat efter egna kostnader SEK", decimal(r.profitOre)],
      ["Redan utbetalt SEK", decimal(input.paidOre)],
      ["Kvar att betala SEK", decimal(r.outstandingOre)],
      ["Överbetalt SEK", decimal(r.overpaidOre)]
    ];
    return "\uFEFF" + rows.map(row => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
  }
  function mount(doc) {
    const form = doc.getElementById("calculator");
    if (!form) return;
    const field = name => form.elements.namedItem(name);
    const error = doc.getElementById("error");
    const status = doc.getElementById("status");
    const results = doc.getElementById("results");
    const exportButton = doc.getElementById("export");
    const storageKey = "maker-consignment-offline-v1";
    function read() {
      return {
        maker: field("maker").value.trim(), product: field("product").value.trim(),
        delivered: parseQuantity(field("delivered").value),
        sold: parseQuantity(field("sold").value), returned: parseQuantity(field("returned").value),
        priceOre: parseDecimal(field("price").value),
        commissionBps: parseDecimal(field("commission").value, "Provision"),
        unitCostOre: parseDecimal(field("unitCost").value),
        otherCostsOre: parseDecimal(field("otherCosts").value),
        paidOre: parseDecimal(field("paid").value)
      };
    }
    function fill(input) {
      calculate(input);
      for (const name of ["maker", "product", "delivered", "sold", "returned"])
        field(name).value = input[name] == null ? "" : String(input[name]);
      for (const [name, key] of [["price", "priceOre"], ["commission", "commissionBps"],
        ["unitCost", "unitCostOre"], ["otherCosts", "otherCostsOre"], ["paid", "paidOre"]])
        field(name).value = decimal(input[key]);
    }
    function render() {
      try {
        const input = read(), r = calculate(input);
        error.textContent = "";
        results.hidden = false; exportButton.disabled = false;
        doc.getElementById("save").disabled = false;
        for (const key of ["stock", "netSalesOre", "commissionOre", "entitlementOre",
          "outstandingOre", "profitOre", "grossSalesOre", "refundsOre", "costsOre", "overpaidOre"])
          doc.getElementById(key).textContent = key === "stock" ? String(r[key]) + " st" : money(r[key]);
        return input;
      } catch (e) {
        error.textContent = e.message; results.hidden = true; exportButton.disabled = true;
        doc.getElementById("save").disabled = true;
        return null;
      }
    }
    form.addEventListener("submit", event => { event.preventDefault(); render(); });
    form.addEventListener("input", () => { status.textContent = "Ändringar är inte sparade."; render(); });
    doc.getElementById("sample").addEventListener("click", () => {
      fill(sample()); render(); status.textContent = "Fiktivt exempel inläst. Inte sparat.";
    });
    doc.getElementById("clear").addEventListener("click", () => {
      fill({maker: "", product: "", delivered: 0, sold: 0, returned: 0, priceOre: 0,
        commissionBps: 3000, unitCostOre: 0, otherCostsOre: 0, paidOre: 0});
      render(); status.textContent = "Formuläret är nollställt. Sparade uppgifter finns kvar tills du sparar igen.";
    });
    doc.getElementById("save").addEventListener("click", () => {
      const input = render(); if (!input) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(input));
        status.textContent = "Sparat lokalt i denna webbläsare.";
      } catch (_) { status.textContent = "Kunde inte spara lokalt. Exportera CSV för ett underlag."; }
    });
    doc.getElementById("load").addEventListener("click", () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) { status.textContent = "Inga lokalt sparade uppgifter."; return; }
        fill(JSON.parse(raw)); render(); status.textContent = "Lokalt sparade uppgifter inlästa; beloppen är inte verifierade.";
      } catch (_) { status.textContent = "Kunde inte läsa giltiga lokala uppgifter. Formuläret behålls."; }
    });
    exportButton.addEventListener("click", () => {
      const input = render(); if (!input) return;
      const url = URL.createObjectURL(new Blob([toCSV(input)], {type: "text/csv;charset=utf-8"}));
      const link = doc.createElement("a");
      link.href = url; link.download = "konsignation-underlag.csv";
      doc.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "CSV-export begärd. Detta är ett räkneunderlag, inte ett betalningsbevis.";
    });
    fill(sample()); render();
    status.textContent = "Fiktivt exempel visas. Inget är sparat automatiskt.";
  }
  return { parseQuantity, parseDecimal, decimal, money, calculate, sample, csvCell, toCSV, mount };
});
