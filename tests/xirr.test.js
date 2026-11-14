const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateProductXirr } = require('../returns.js');

const product = { id: 'p1', currency: 'EUR' };
const valuation = (id, date, value, valuationType, currency = 'EUR', extra = {}) => ({
  id, productId: 'p1', date, value, valuationType, currency, ...extra
});
const movement = (id, date, type, amount, extra = {}) => ({
  id, productId: 'p1', date, type, amount, flowNature: 'external', currency: 'EUR', ...extra
});

// Independent reference: direct discount-rate NPV and bisection in r (not log(1+r)).
function referenceXirr(flows) {
  const start = Date.parse(`${flows[0].date}T00:00:00Z`);
  const npv = rate => flows.reduce((sum, flow) => {
    const years = (Date.parse(`${flow.date}T00:00:00Z`) - start) / 86400000 / 365;
    return sum + flow.amount / Math.pow(1 + rate, years);
  }, 0);
  let low = -0.999999999, high = 1;
  while (npv(high) > 0 && high < 1e9) high = high * 2 + 1;
  assert.ok(npv(low) > 0 && npv(high) < 0, 'reference NPV must be bracketed');
  for (let i = 0; i < 220; i++) {
    const middle = (low + high) / 2;
    if (npv(middle) > 0) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function assertClose(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, received ${actual}`);
}

test('capital inicial i valor final: XIRR anualitzada i rendibilitat acumulada', () => {
  const days = (Date.parse('2025-01-01T00:00:00Z') - Date.parse('2023-01-01T00:00:00Z')) / 86400000;
  const finalValue = 1000 * Math.pow(1.1, days / 365);
  const result = calculateProductXirr(product, [
    valuation('v0', '2023-01-01', 1000, 'opening'),
    valuation('v1', '2025-01-01', finalValue, 'snapshot')
  ], [], []);
  assert.equal(result.ok, true);
  assertClose(result.annualizedReturn, 0.1);
  assertClose(result.cumulativeReturn, Math.pow(1.1, days / 365) - 1);
  assert.equal(result.startDate, '2023-01-01');
  assert.equal(result.endDate, '2025-01-01');
  assert.equal(result.currency, 'EUR');
  assertClose(result.finalValue, finalValue);
});

test('diverses aportacions en dates diferents: usa el signe i la data de cada flux', () => {
  const openingDate = '2023-01-01', contributionDate = '2023-07-02', endDate = '2024-01-01';
  const days = date => (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000;
  const finalValue = 1000 * Math.pow(1.1, days(openingDate) / 365) + 500 * Math.pow(1.1, days(contributionDate) / 365);
  const flows = [
    { date: openingDate, amount: -1000 },
    { date: contributionDate, amount: -500 },
    { date: endDate, amount: finalValue }
  ];
  const result = calculateProductXirr(product, [
    valuation('v0', openingDate, 1000, 'opening'),
    valuation('v1', endDate, finalValue, 'snapshot')
  ], [movement('m1', contributionDate, 'contribution', 500)], []);
  assert.equal(result.ok, true);
  assertClose(result.annualizedReturn, referenceXirr(flows));
  assertClose(result.annualizedReturn, 0.1);
});

test('retirada parcial: flux positiu i valoració intermèdia ignorada com a flux', () => {
  const flows = [
    { date: '2023-01-01', amount: -1000 },
    { date: '2023-07-02', amount: 200 },
    { date: '2024-01-01', amount: 900 }
  ];
  const valuations = [
    valuation('v0', '2023-01-01', 1000, 'opening'),
    valuation('vmid', '2023-09-01', 850, 'snapshot'),
    valuation('v1', '2024-01-01', 900, 'snapshot')
  ];
  const result = calculateProductXirr(product, valuations,
    [movement('m1', '2023-07-02', 'withdrawal', 200)], []);
  const withoutIntermediate = calculateProductXirr(product, [valuations[0], valuations[2]],
    [movement('m1', '2023-07-02', 'withdrawal', 200)], []);
  assert.equal(result.ok, true);
  assertClose(result.annualizedReturn, referenceXirr(flows));
  assertClose(result.annualizedReturn, withoutIntermediate.annualizedReturn);
});

test('una valoració vinculada a un moviment no torna a comptar el moviment', () => {
  const result = calculateProductXirr(product, [
    valuation('v0', '2023-01-01', 1000, 'opening'),
    valuation('v1', '2024-01-01', 1150, 'snapshot', 'EUR', { sourceMovementId: 'm1' })
  ], [movement('m1', '2023-07-02', 'contribution', 100)], []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.flows.map(flow => flow.amount), [-1000, -100, 1150]);
});

test('sense capital inicial ni moviments: no inventa una rendibilitat', () => {
  const result = calculateProductXirr(product, [valuation('v1', '2024-01-01', 1200, 'legacy_untyped')], [], []);
  assert.equal(result.ok, false);
  assert.match(result.message, /capital invertit/i);
});

test('moviment pendent de classificar: retorna explicació, no percentatge', () => {
  const result = calculateProductXirr(product,
    [valuation('v0', '2023-01-01', 1000, 'opening'), valuation('v1', '2024-01-01', 1200, 'snapshot')],
    [movement('m1', '2023-06-01', 'contribution', 100, { flowNature: 'unclassified' })], []);
  assert.equal(result.ok, false);
  assert.match(result.message, /pendents de classificar/i);
});

test('traspàs: sortida del producte és positiva i entrada és capital invertit negatiu', () => {
  const sourceProduct = { id: 'source', currency: 'USD' };
  const destinationProduct = { id: 'destination', currency: 'EUR' };
  const transfer = {
    id: 't1', date: '2023-07-02', sourceProductId: 'source', destinationProductId: 'destination',
    sourceAmount: 300, destinationAmount: 180, sourceCurrency: 'USD', destinationCurrency: 'EUR'
  };
  const source = calculateProductXirr(sourceProduct, [
    { id: 's0', productId: 'source', date: '2023-01-01', value: 1000, valuationType: 'opening', currency: 'USD' },
    { id: 's1', productId: 'source', date: '2024-01-01', value: 800, currency: 'USD' }
  ], [], [transfer]);
  const destination = calculateProductXirr(destinationProduct, [
    { id: 'd0', productId: 'destination', date: '2023-01-01', value: 500, valuationType: 'opening', currency: 'EUR' },
    { id: 'd1', productId: 'destination', date: '2024-01-01', value: 800, currency: 'EUR' }
  ], [], [transfer]);
  assert.equal(source.ok, true);
  assert.equal(destination.ok, true);
  assert.deepEqual(source.flows.map(flow => flow.amount), [-1000, 300, 800]);
  assert.deepEqual(destination.flows.map(flow => flow.amount), [-500, -180, 800]);
  assert.equal(source.currency, 'USD');
  assert.equal(destination.currency, 'EUR');
  assertClose(source.annualizedReturn, referenceXirr([
    { date: '2023-01-01', amount: -1000 }, { date: '2023-07-02', amount: 300 }, { date: '2024-01-01', amount: 800 }
  ]));
  assertClose(destination.annualizedReturn, referenceXirr([
    { date: '2023-01-01', amount: -500 }, { date: '2023-07-02', amount: -180 }, { date: '2024-01-01', amount: 800 }
  ]));
});

test('no barreja monedes ni assumeix cap tipus de canvi', () => {
  const result = calculateProductXirr({ id: 'p1', currency: 'EUR' }, [
    valuation('v0', '2023-01-01', 1000, 'opening'),
    valuation('v1', '2024-01-01', 1200, 'snapshot', 'EUR')
  ], [movement('m1', '2023-06-01', 'contribution', 100, { currency: 'USD' })], []);
  assert.equal(result.ok, false);
  assert.match(result.message, /no s’han fet conversions/i);
});

test('fluxos amb més d’un canvi de signe s’aturen com a potencialment ambigus', () => {
  const result = calculateProductXirr(product,
    [valuation('v0', '2023-01-01', 1000, 'opening'), valuation('v1', '2024-01-01', 1200, 'snapshot')],
    [movement('m1', '2023-04-01', 'withdrawal', 200), movement('m2', '2023-08-01', 'contribution', 100)], []);
  assert.equal(result.ok, false);
  assert.match(result.message, /més d’una vegada/i);
});
