const test = require('node:test');
const assert = require('node:assert/strict');
const { edit, remove } = require('../movement-records.js');

function memoryStore(records) {
  return {
    put(value) { const request={};queueMicrotask(()=>{records.set(value.id,{...value});request.result=value;request.onsuccess?.()});return request; },
    delete(key) { const request={};queueMicrotask(()=>{records.delete(key);request.result=undefined;request.onsuccess?.()});return request; }
  };
}

test('editar moviment desa els camps i conserva id, propietats i data de creació',async()=>{
  const original={id:'movement-stable-1',productId:'p1',type:'contribution',flowNature:'external',date:'2024-01-01',amount:100,notes:'inicial',ownerId:'owner1',currency:'EUR',createdAt:'2024-01-02T12:00:00.000Z'};
  const records=new Map([[original.id,{...original}]]);
  const updated=await edit(memoryStore(records),original,{id:'movement-new-should-be-ignored',productId:'other',type:'withdrawal',date:'2024-02-03',amount:'37.5',notes:'nota corregida',flowNature:'unclassified',ownerId:'other'});
  assert.equal(updated.id,original.id);assert.equal(updated.createdAt,original.createdAt);assert.equal(records.size,1);
  assert.deepEqual(records.get(original.id),{...original,type:'withdrawal',date:'2024-02-03',amount:37.5,notes:'nota corregida'});
});

test('eliminar moviment persiste l’esborrat només per al seu identificador',async()=>{
  const records=new Map([['keep',{id:'keep'}],['delete',{id:'delete'}]]);
  await remove(memoryStore(records),'delete');
  assert.equal(records.has('delete'),false);assert.deepEqual(records.get('keep'),{id:'keep'});
});
