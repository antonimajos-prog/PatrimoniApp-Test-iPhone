(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PatrimoniMovementRecords = api;
})(globalThis, function () {
  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }
  async function edit(store, existing, changes) {
    if (!existing || !existing.id) throw new Error('El moviment no té un identificador estable.');
    const amount = Number(changes.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('L’import ha de ser superior a zero.');
    if (!['contribution','withdrawal'].includes(changes.type)) throw new Error('Tipus de moviment no vàlid.');
    const updated = { ...existing, id: existing.id, type: changes.type, date: changes.date, amount, notes: String(changes.notes || '') };
    await requestResult(store.put(updated));
    return updated;
  }
  async function remove(store, movementId) {
    if (!movementId) throw new Error('Falta l’identificador del moviment.');
    await requestResult(store.delete(movementId));
  }
  return { edit, remove };
});
