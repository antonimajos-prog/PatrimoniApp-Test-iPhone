(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PatrimoniBackup = api;
})(globalThis, function () {
  const TABLES = ['owners','institutions','products','valuations','movements','transfers','exchangeRates'];
  function validateAndNormalize(data) {
    if (!data || data.format !== 'patrimoni-backup' || ![1,2,3,4].includes(data.version)) throw new Error('Format de còpia no compatible.');
    for (const key of ['owners','institutions','products','valuations']) if (!Array.isArray(data[key])) throw new Error(`Falta la col·lecció ${key}.`);
    if (data.version >= 2 && !Array.isArray(data.movements)) throw new Error('La còpia no conté els moviments.');
    if (data.version >= 3 && !Array.isArray(data.transfers)) throw new Error('La còpia no conté els traspassos.');
    if (data.version >= 4 && !Array.isArray(data.exchangeRates)) throw new Error('La còpia no conté els tipus de canvi.');
    return Object.fromEntries(TABLES.map(key => [key, Array.isArray(data[key]) ? data[key] : []]));
  }
  function create(records, exportedAt = new Date().toISOString()) {
    return { format: 'patrimoni-backup', version: 4, exportedAt, ...Object.fromEntries(TABLES.map(key => [key, records[key] || []])) };
  }
  return { TABLES, validateAndNormalize, create };
});
