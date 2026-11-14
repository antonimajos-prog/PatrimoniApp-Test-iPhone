(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PatrimoniAggregate = api;
})(globalThis, function () {
  const DAY = 86400000;
  const fail = (message, diagnostics = null) => ({ ok: false, message, ...(diagnostics ? { diagnostics } : {}) });
  const isOpening = value => value === 'opening' || value === 'initial';
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const days = date => Date.parse(`${date}T00:00:00Z`);
  function solve(flows) {
    const origin = days(flows[0].date);
    const timed = flows.map(f => ({ amount: f.amount, years: (days(f.date) - origin) / DAY / 365 }));
    const npv = x => { const exponents = timed.map(f => -x * f.years), max = Math.max(...exponents); return timed.reduce((s, f, i) => s + f.amount * Math.exp(exponents[i] - max), 0); };
    const atZero = npv(0); if (Math.abs(atZero) < 1e-12) return 0;
    let lo, hi, ls, hs;
    if (atZero < 0) { hi = 0; hs = atZero; lo = -1; ls = npv(lo); while (ls < 0 && lo > -1024) { lo *= 2; ls = npv(lo); } }
    else { lo = 0; ls = atZero; hi = 1; hs = npv(hi); while (hs > 0 && hi < 1024) { hi *= 2; hs = npv(hi); } }
    if (ls < 0 || hs > 0) return null;
    for (let i = 0; i < 180; i++) { const mid = (lo + hi) / 2, sign = npv(mid); if (Math.abs(sign) < 1e-14 || hi - lo < 1e-13) return mid; if (sign > 0) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  function calculate({ scope = 'global', ownerId = null, products = [], valuations = [], movements = [], transfers = [], exchangeRates = [], startDate, endDate }) {
    if (!validDate(startDate) || !validDate(endDate) || startDate >= endDate) return fail('Selecciona un període vàlid amb data final posterior a la inicial.');
    const scopedProducts = products.filter(p => scope === 'global' || p.ownerId === ownerId);
    if (!scopedProducts.length) return fail('Aquest àmbit no té productes.');
    const productIds = new Set(scopedProducts.map(p => p.id));
    const productById = new Map(products.map(p => [p.id, p]));
    const rateMap = new Map(exchangeRates.map(r => [`${r.currency}|${r.date}`, Number(r.eurPerUnit)]));
    const warnings = [], missingRates = new Set(), flows = [], valuationDetails = [];
    const convert = (amount, currency, date) => {
      if (!currency) return { error: `Falta la moneda del registre del ${date}.` };
      if (currency === 'EUR') return { value: Number(amount) };
      const rate = rateMap.get(`${currency}|${date}`);
      if (!Number.isFinite(rate) || rate <= 0) { missingRates.add(`${currency} → EUR · ${date}`); return null; }
      return { value: Number(amount) * rate };
    };
    const productValues = new Map();
    for (const product of scopedProducts) {
      const values = valuations.filter(v => v.productId === product.id).sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      const datedValues = values.filter(v => validDate(v.date));
      const prior = datedValues.filter(v => v.date <= startDate);
      const final = datedValues.filter(v => v.date <= endDate).at(-1);
      const first = datedValues[0];
      if (scope === 'holder') {
        const startVal = prior.at(-1);
        if (startVal && (!startVal.ownerId || startVal.ownerId !== ownerId)) return fail(`No es pot atribuir amb seguretat a aquest titular la valoració inicial de «${product.name}» (${startVal.date}).`);
        if (final && (!final.ownerId || final.ownerId !== ownerId)) return fail(`No es pot atribuir amb seguretat a aquest titular l’última valoració de «${product.name}» (${final.date}).`);
      }
      if (prior.length) {
        const opening = prior.at(-1), currency = opening.currency || product.currency;
        const converted = convert(opening.value, currency, startDate); if (converted?.error) return fail(converted.error); if (!converted) continue;
        flows.push({ date:startDate,amount:-converted.value,kind:'valor inicial',productId:product.id,productName:product.name,concept:'Valoració de cartera a l’inici del període' });
        valuationDetails.push({ productId:product.id,name:product.name,point:'inici',date:opening.date,ageDays:(days(startDate)-days(opening.date))/DAY,valueEUR:converted.value });
        if ((days(startDate) - days(opening.date)) / DAY > 30) warnings.push(`La valoració inicial de «${product.name}» és del ${opening.date} (${Math.floor((days(startDate)-days(opening.date))/DAY)} dies d’antiguitat); el resultat no és plenament fiable.`);
      } else if (product.startDate && product.startDate <= startDate) {
        return fail(`Falta una valoració a l’inici del període per al producte «${product.name}».`);
      }
      if (!final) return fail(`Falta una valoració final del producte «${product.name}» a ${endDate} o abans.`);
      if (scope === 'holder' && !final.ownerId) return fail(`Falta el titular de referència de la valoració de «${product.name}» (${final.date}).`);
      const finalCurrency = final.currency || product.currency;
      const finalConverted = convert(final.value, finalCurrency, endDate); if (finalConverted?.error) return fail(finalConverted.error); if (!finalConverted) continue;
      const age = (days(endDate) - days(final.date)) / DAY;
      productValues.set(product.id, { valuation: final, valueEUR: finalConverted.value, product });
      valuationDetails.push({ productId:product.id,name:product.name,point:'final',date:final.date,ageDays:age,valueEUR:finalConverted.value });
      if (movements.some(m => m.productId === product.id && m.date > final.date && m.date <= endDate)) return fail(`Hi ha moviments de «${product.name}» posteriors a la seva última valoració (${final.date}); actualitza la posició abans de calcular.`);
      if (transfers.some(t => (t.sourceProductId === product.id || t.destinationProductId === product.id) && t.date > final.date && t.date <= endDate)) return fail(`Hi ha traspassos de «${product.name}» posteriors a la seva última valoració (${final.date}); actualitza la posició abans de calcular.`);
      if (age > 30) warnings.push(`La valoració final de «${product.name}» és del ${final.date} (${Math.floor(age)} dies d’antiguitat); el resultat no és plenament fiable.`);
      if (!prior.length) {
        const firstInbound = movements.some(m => m.productId === product.id && m.flowNature === 'external' && m.type === 'contribution' && m.date >= startDate && m.date <= first?.date)
          || transfers.some(t => t.destinationProductId === product.id && t.date >= startDate && t.date <= first?.date);
        if (!firstInbound && first && isOpening(first.valuationType) && first.date >= startDate) {
          const openingCurrency = first.currency || product.currency;
          const converted = convert(first.value, openingCurrency, first.date);
          if (converted?.error) return fail(converted.error);
          if (converted) {
            flows.push({ date:first.date,amount:-converted.value,kind:'capital inicial del producte',productId:product.id,productName:product.name,concept:'Capital inicial explícit (valoració opening)' });
            valuationDetails.push({ productId:product.id,name:product.name,point:'capital inicial',date:first.date,ageDays:0,valueEUR:converted.value });
          }
        } else if (!firstInbound) {
          return fail(`El producte «${product.name}» comença durant el període però no té una valoració inicial explícita ni un flux d’entrada identificat abans de la primera valoració.`);
        }
      }
    }
    if (missingRates.size) return fail(`Falten tipus de canvi manuals exactes: ${[...missingRates].join('; ')}. Registra EUR per unitat de moneda per a cada data indicada.`);

    if (movements.some(m => productIds.has(m.productId) && m.date === startDate)) return fail('Hi ha un moviment el mateix dia que l’inici del període; no es pot establir l’ordre respecte del valor inicial.');
    if (scope === 'holder' && transfers.some(t => t.date === startDate && (productIds.has(t.sourceProductId) || productIds.has(t.destinationProductId)))) return fail('Hi ha un traspàs el mateix dia que l’inici del període; no es pot establir l’ordre respecte del valor inicial.');
    for (const m of movements.filter(x => productIds.has(x.productId) && x.date > startDate && x.date <= endDate)) {
      if (m.flowNature !== 'external') return fail(`Hi ha un moviment pendent de classificar (${m.date}); no s’ha inferit la seva naturalesa.`);
      if (scope === 'holder' && (!m.ownerId || m.ownerId !== ownerId)) return fail(`No es pot atribuir amb seguretat al titular el moviment de ${m.date}.`);
      if (m.type !== 'contribution' && m.type !== 'withdrawal') return fail(`Hi ha un moviment amb tipus no reconegut (${m.date}).`);
      const p = scopedProducts.find(x => x.id === m.productId), currency = m.currency || p?.currency;
      const converted = convert(m.amount, currency, m.date); if (converted?.error) return fail(converted.error); if (!converted) continue;
      flows.push({ date:m.date,amount:converted.value*(m.type==='contribution'?-1:1),kind:m.type,productId:m.productId,productName:p?.name||m.productId,concept:m.type==='contribution'?'Aportació externa':'Retirada externa' });
    }
    if (scope === 'holder') for (const t of transfers.filter(x => x.date > startDate && x.date <= endDate)) {
      const sourceIn = productIds.has(t.sourceProductId), destIn = productIds.has(t.destinationProductId);
      if (!sourceIn && !destIn) continue;
      if (!t.sourceOwnerId || !t.destinationOwnerId) return fail(`Falten els titulars d’origen o destinació del traspàs de ${t.date}.`);
      if (t.sourceOwnerId === ownerId && t.destinationOwnerId === ownerId) continue;
      const transferFlows = [];
      if (t.sourceOwnerId === ownerId) transferFlows.push({ amount: t.sourceAmount, currency: t.sourceCurrency, sign: 1 });
      if (t.destinationOwnerId === ownerId) transferFlows.push({ amount: t.destinationAmount, currency: t.destinationCurrency, sign: -1 });
      for (const part of transferFlows) { const converted = convert(part.amount, part.currency, t.date); if (converted?.error) return fail(converted.error); if (!converted) continue;const isSource=part.sign===1,productId=isSource?t.sourceProductId:t.destinationProductId,productName=productById.get(productId)?.name||productId,otherName=productById.get(isSource?t.destinationProductId:t.sourceProductId)?.name||(isSource?t.destinationProductId:t.sourceProductId);flows.push({date:t.date,amount:converted.value*part.sign,kind:'traspàs entre titulars',productId,productName,concept:isSource?`Traspàs cap a ${otherName}`:`Traspàs rebut de ${otherName}`}); }
    }
    if (missingRates.size) return fail(`Falten tipus de canvi manuals exactes: ${[...missingRates].join('; ')}. Registra EUR per unitat de moneda per a cada data indicada.`);
    if (flows.some(f => f.date === startDate && f.kind !== 'valor inicial')) return fail('Hi ha un flux el mateix dia que l’inici del període; no es pot establir l’ordre respecte del valor inicial.');
    const finalValue = [...productValues.values()].reduce((sum, x) => sum + x.valueEUR, 0);
    for(const x of productValues.values())flows.push({date:endDate,amount:x.valueEUR,kind:'valor final',productId:x.product.id,productName:x.product.name,concept:`Valoració final (última dada ${x.valuation.date})`});
    const trace=flows.map(f=>({...f})).sort((a,b)=>a.date.localeCompare(b.date)||a.productName.localeCompare(b.productName)||a.concept.localeCompare(b.concept));
    const grouped = new Map(); for (const f of trace) { const day=grouped.get(f.date)||{date:f.date,amount:0,components:[]};day.amount+=f.amount;day.components.push(f);grouped.set(f.date,day); }
    const daily=[...grouped.values()].sort((a,b)=>a.date.localeCompare(b.date)).filter(f=>Math.abs(f.amount)>1e-10);
    const net=daily.map(({date,amount})=>({date,amount}));
    const signChanges=[];let previous=null;for(const f of daily){const sign=Math.sign(f.amount);if(previous&&sign!==previous.sign)signChanges.push({fromDate:previous.date,toDate:f.date,fromAmount:previous.amount,toAmount:f.amount,components:f.components});previous={date:f.date,amount:f.amount,sign}}
    const diagnostics={rawFlows:trace,dailyFlows:daily,signChanges};
    if (net.length < 2) return fail('No hi ha fluxos positius i negatius suficients en dates diferents per calcular una XIRR.',diagnostics);
    let changes=signChanges.length;
    if (!changes) return fail('No hi ha fluxos positius i negatius suficients per calcular una XIRR.');
    if (changes > 1) return fail('Els fluxos agregats canvien de signe més d’una vegada; la XIRR pot tenir resultats múltiples i no es mostra cap percentatge.',diagnostics);
    const logGrowth=solve(net); if(logGrowth===null||!Number.isFinite(logGrowth))return fail('No s’ha trobat una XIRR finita i fiable per als fluxos agregats.',diagnostics);
    const annualized=Math.expm1(logGrowth), cumulative=Math.expm1(logGrowth*((days(endDate)-days(net[0].date))/DAY/365));
    return {ok:true,cumulativeReturn:cumulative,annualizedReturn:annualized,startDate,endDate,finalValue,currency:'EUR',warnings:[...new Set(warnings)],flows:net,valuations:valuationDetails,diagnostics};
  }
  return { calculate };
});
