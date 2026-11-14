(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PatrimoniDatabase = api;
})(globalThis, function () {
  const VERSION = 4;
  function upgradeSchema(db, transaction) {
    for (const name of ['owners', 'institutions', 'products', 'valuations']) if (!db.objectStoreNames.contains(name)) {
      const store = db.createObjectStore(name, { keyPath: 'id' });
      if (name === 'products') { store.createIndex('ownerId', 'ownerId'); store.createIndex('institutionId', 'institutionId'); }
      if (name === 'valuations') { store.createIndex('productId', 'productId'); store.createIndex('date', 'date'); }
    }
    if (!db.objectStoreNames.contains('movements')) { const store = db.createObjectStore('movements', { keyPath: 'id' }); store.createIndex('productId', 'productId'); store.createIndex('date', 'date'); }
    const movementStore = transaction.objectStore('movements');
    if (!movementStore.indexNames.contains('flowNature')) movementStore.createIndex('flowNature', 'flowNature');
    if (!db.objectStoreNames.contains('transfers')) { const store = db.createObjectStore('transfers', { keyPath: 'id' }); store.createIndex('sourceProductId', 'sourceProductId'); store.createIndex('destinationProductId', 'destinationProductId'); store.createIndex('date', 'date'); }
    if (!db.objectStoreNames.contains('exchangeRates')) { const store = db.createObjectStore('exchangeRates', { keyPath: 'id' }); store.createIndex('currencyDate', ['currency', 'date'], { unique: true }); store.createIndex('date', 'date'); }
  }
  function open(indexedDB, name = 'patrimoni-local') {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, VERSION);
      request.onupgradeneeded = () => upgradeSchema(request.result, request.transaction);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return { VERSION, upgradeSchema, open };
});
