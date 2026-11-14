(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PatrimoniReturns = api;
})(globalThis, function () {
  const DAY_MS = 86400000;
  const YEAR_DAYS = 365;

  function fail(message) { return { ok: false, message }; }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function dateNumber(value) { return Date.parse(`${value}T00:00:00.000Z`); }

  function sameCurrency(actual, expected) { return typeof actual === 'string' && actual === expected; }

  function calculateRate(flows) {
    const origin = dateNumber(flows[0].date);
    const timed = flows.map(flow => ({
      amount: flow.amount,
      years: (dateNumber(flow.date) - origin) / DAY_MS / YEAR_DAYS
    }));

    // Scale each NPV sum by its largest exponential term to avoid overflow.
    const npvSign = logGrossGrowth => {
      const exponents = timed.map(flow => -logGrossGrowth * flow.years);
      const maxExponent = Math.max(...exponents);
      return timed.reduce((sum, flow, index) =>
        sum + flow.amount * Math.exp(exponents[index] - maxExponent), 0);
    };

    const atZero = npvSign(0);
    if (Math.abs(atZero) < 1e-12) return { logGrossGrowth: 0 };

    let low, high, lowSign, highSign;
    if (atZero < 0) {
      high = 0; highSign = atZero; low = -1;
      lowSign = npvSign(low);
      while (lowSign < 0 && low > -1024) { low *= 2; lowSign = npvSign(low); }
    } else {
      low = 0; lowSign = atZero; high = 1;
      highSign = npvSign(high);
      while (highSign > 0 && high < 1024) { high *= 2; highSign = npvSign(high); }
    }
    if (lowSign === 0) return { logGrossGrowth: low };
    if (highSign === 0) return { logGrossGrowth: high };
    if (lowSign < 0 || highSign > 0) return null;

    for (let i = 0; i < 180; i++) {
      const middle = (low + high) / 2;
      const middleSign = npvSign(middle);
      if (Math.abs(middleSign) < 1e-14 || Math.abs(high - low) < 1e-13) {
        return { logGrossGrowth: middle };
      }
      if (middleSign > 0) low = middle;
      else high = middle;
    }
    return { logGrossGrowth: (low + high) / 2 };
  }

  function calculateProductXirr(product, valuations, movements, transfers) {
    if (!product || !product.id) return fail('No s’ha pogut identificar el producte.');
    const productValues = valuations.filter(value => value.productId === product.id);
    if (!productValues.length) return fail('Afegeix una valoració final abans de calcular la rendibilitat.');

    const sortedValues = [...productValues].sort((a, b) =>
      String(a.date || '').localeCompare(String(b.date || '')) ||
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    const finalValue = sortedValues[sortedValues.length - 1];
    if (!validDate(finalValue.date) || !Number.isFinite(Number(finalValue.value)) || Number(finalValue.value) <= 0) {
      return fail('La valoració més recent no té una data o un valor positiu vàlid.');
    }
    const currency = finalValue.currency || product.currency;
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      return fail('No consta una moneda vàlida per a la valoració final.');
    }

    const openingValues = productValues.filter(value => value.valuationType === 'opening');
    if (openingValues.length > 1) return fail('Hi ha més d’una valoració inicial. Deixa’n només una de marcada com a inicial.');
    const opening = openingValues[0] || null;
    if (opening && (!validDate(opening.date) || !Number.isFinite(Number(opening.value)) || Number(opening.value) <= 0)) {
      return fail('La valoració inicial no té una data o un valor positiu vàlid.');
    }
    if (opening?.sourceMovementId) {
      return fail('La valoració inicial està vinculada a un moviment. Revisa que no s’estigui comptant el mateix capital dues vegades.');
    }
    if (opening && productValues.some(value => dateNumber(value.date) < dateNumber(opening.date))) {
      return fail('Hi ha una valoració anterior a la marcada com a inicial. Revisa l’inici de l’històric.');
    }
    if (opening && opening.id === finalValue.id) {
      return fail('Cal una valoració posterior a la valoració inicial per calcular la rendibilitat.');
    }

    const flows = [];
    const addFlow = (date, amount, flowCurrency, description) => {
      if (!validDate(date)) return 'Hi ha un flux sense data vàlida.';
      if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return `L’import de ${description} no és vàlid.`;
      if (!sameCurrency(flowCurrency, currency)) return `La moneda de ${description} no coincideix amb la moneda del producte (${currency}); no s’han fet conversions.`;
      flows.push({ date, amount: Number(amount), description });
      return null;
    };

    if (opening) {
      const openingCurrency = opening.currency || product.currency;
      const error = addFlow(opening.date, Number(opening.value), openingCurrency, 'la valoració inicial');
      if (error) return fail(error);
      flows[flows.length - 1].amount *= -1;
    }

    const productMovements = movements.filter(movement => movement.productId === product.id);
    for (const movement of productMovements) {
      if (!validDate(movement.date)) return fail('Hi ha un moviment del producte sense data vàlida.');
      if (opening && dateNumber(movement.date) < dateNumber(opening.date)) continue;
      if (opening && dateNumber(movement.date) === dateNumber(opening.date)) {
        return fail('Hi ha un moviment el mateix dia que la valoració inicial; no es pot establir l’ordre dels fluxos.');
      }
      if (movement.flowNature !== 'external') {
        return fail('Hi ha moviments pendents de classificar. Classifica’ls abans de calcular la rendibilitat.');
      }
      if (dateNumber(movement.date) > dateNumber(finalValue.date)) {
        return fail('Hi ha moviments posteriors a l’última valoració. Actualitza primer la posició.');
      }
      if (movement.type !== 'contribution' && movement.type !== 'withdrawal') {
        return fail('Hi ha un moviment amb un tipus no reconegut.');
      }
      const signedAmount = Number(movement.amount) * (movement.type === 'contribution' ? -1 : 1);
      const error = addFlow(movement.date, Math.abs(signedAmount), movement.currency || product.currency, 'un moviment');
      if (error) return fail(error);
      flows[flows.length - 1].amount = signedAmount;
    }

    const productTransfers = transfers.filter(transfer =>
      transfer.sourceProductId === product.id || transfer.destinationProductId === product.id);
    for (const transfer of productTransfers) {
      if (!validDate(transfer.date)) return fail('Hi ha un traspàs del producte sense data vàlida.');
      if (opening && dateNumber(transfer.date) < dateNumber(opening.date)) continue;
      if (opening && dateNumber(transfer.date) === dateNumber(opening.date)) {
        return fail('Hi ha un traspàs el mateix dia que la valoració inicial; no es pot establir l’ordre dels fluxos.');
      }
      if (dateNumber(transfer.date) > dateNumber(finalValue.date)) {
        return fail('Hi ha traspassos posteriors a l’última valoració. Actualitza primer la posició.');
      }
      if (transfer.sourceProductId === transfer.destinationProductId) {
        return fail('Hi ha un traspàs amb el mateix producte d’origen i destinació.');
      }
      const isSource = transfer.sourceProductId === product.id;
      const amount = isSource ? transfer.sourceAmount : transfer.destinationAmount;
      const transferCurrency = isSource ? transfer.sourceCurrency : transfer.destinationCurrency;
      const signedAmount = Number(amount) * (isSource ? 1 : -1);
      const error = addFlow(transfer.date, Math.abs(signedAmount), transferCurrency, 'un traspàs intern');
      if (error) return fail(error);
      flows[flows.length - 1].amount = signedAmount;
    }

    if (!opening) {
      if (!flows.length) return fail('No hi ha una valoració inicial ni moviments classificats que defineixin el capital invertit.');
      const firstFlowDate = flows.reduce((earliest, flow) => flow.date < earliest ? flow.date : earliest, flows[0].date);
      if (productValues.some(value => validDate(value.date) && value.date <= firstFlowDate && value.id !== finalValue.id)) {
        return fail('Hi ha valoracions anteriors a l’inici dels fluxos sense una valoració inicial identificada. Marca la primera com a inicial.');
      }
    }

    if (flows.some(flow => flow.date > finalValue.date)) return fail('Hi ha fluxos posteriors a la valoració final.');
    flows.push({ date: finalValue.date, amount: Number(finalValue.value), description: 'valoració final' });
    flows.sort((a, b) => a.date.localeCompare(b.date));

    const byDate = new Map();
    for (const flow of flows) byDate.set(flow.date, (byDate.get(flow.date) || 0) + flow.amount);
    const netFlows = [...byDate].map(([date, amount]) => ({ date, amount })).filter(flow => Math.abs(flow.amount) > 1e-10);
    if (netFlows.length < 2 || netFlows[0].date === netFlows[netFlows.length - 1].date) {
      return fail('Calen fluxos en dates diferents per calcular una XIRR.');
    }
    let signChanges = 0, previousSign = 0;
    for (const flow of netFlows) {
      const sign = Math.sign(flow.amount);
      if (previousSign && sign !== previousSign) signChanges++;
      previousSign = sign;
    }
    if (signChanges === 0) return fail('No hi ha fluxos positius i negatius suficients per calcular una XIRR.');
    if (signChanges > 1) return fail('Els fluxos canvien de signe més d’una vegada; la XIRR podria tenir diversos resultats i no es mostra cap percentatge.');

    const rootResult = calculateRate(netFlows);
    if (!rootResult || !Number.isFinite(rootResult.logGrossGrowth)) return fail('No s’ha trobat una XIRR finita i fiable per a aquests fluxos.');
    const annualized = Math.expm1(rootResult.logGrossGrowth);
    const years = (dateNumber(finalValue.date) - dateNumber(netFlows[0].date)) / DAY_MS / YEAR_DAYS;
    const cumulative = Math.expm1(rootResult.logGrossGrowth * years);
    if (!Number.isFinite(annualized) || !Number.isFinite(cumulative)) return fail('La XIRR queda fora del rang numèric representable.');

    return {
      ok: true,
      cumulativeReturn: cumulative,
      annualizedReturn: annualized,
      startDate: netFlows[0].date,
      endDate: finalValue.date,
      finalValue: Number(finalValue.value),
      currency,
      flows: netFlows
    };
  }

  return { calculateProductXirr };
});
