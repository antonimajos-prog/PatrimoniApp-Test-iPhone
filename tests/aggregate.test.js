const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate } = require('../aggregate.js');
const { upgradeSchema, VERSION } = require('../database.js');
const Backup = require('../backup.js');
const DiagnosticsUI = require('../diagnostics-ui.js');

const A='owner-a', B='owner-b';
const products=[{id:'p1',name:'Producte A1',ownerId:A,currency:'EUR',startDate:'2023-01-01'},{id:'p2',name:'Producte A2',ownerId:A,currency:'EUR',startDate:'2023-01-01'},{id:'p3',name:'Producte B1',ownerId:B,currency:'EUR',startDate:'2023-01-01'}];
const vals=[['p1',1000,1150,A],['p2',500,600,A],['p3',400,450,B]].flatMap(([productId,start,end,ownerId])=>[
  {id:`${productId}-o`,productId,date:'2023-01-01',value:start,currency:'EUR',valuationType:'opening',ownerId},
  {id:`${productId}-f`,productId,date:'2024-01-01',value:end,currency:'EUR',valuationType:'snapshot',ownerId}
]);
function input(extra={}) { return {scope:'global',products,valuations:vals,movements:[],transfers:[],exchangeRates:[],startDate:'2023-01-01',endDate:'2024-01-01',...extra}; }
function referenceXirr(flows) {
  const origin=Date.parse(`${flows[0].date}T00:00:00Z`),npv=r=>flows.reduce((sum,f)=>sum+f.amount/Math.pow(1+r,(Date.parse(`${f.date}T00:00:00Z`)-origin)/86400000/365),0);
  let lo=-.999999999,hi=1;while(npv(hi)>0)hi=hi*2+1;for(let i=0;i<200;i++){const mid=(lo+hi)/2;if(npv(mid)>0)lo=mid;else hi=mid}return (lo+hi)/2;
}
function close(a,b,tol=1e-9){assert.ok(Math.abs(a-b)<tol,`expected ${b}, got ${a}`)}

test('XIRR agregada combina els valors i aportacions, no percentatges de producte',()=>{
  const movement={id:'m1',productId:'p1',ownerId:A,date:'2023-06-01',type:'contribution',flowNature:'external',amount:100,currency:'EUR'};
  const result=calculate(input({movements:[movement]}));assert.equal(result.ok,true);
  const expected=referenceXirr([{date:'2023-01-01',amount:-1900},{date:'2023-06-01',amount:-100},{date:'2024-01-01',amount:2200}]);
  close(result.annualizedReturn,expected);close(result.finalValue,2200);assert.equal(result.currency,'EUR');
});

test('valoració opening d’un producte iniciat dins del període és el seu capital inicial',()=>{
  const p1={id:'base',name:'Producte preexistent',ownerId:B,currency:'EUR',startDate:'2018-11-14'};
  const p2={id:'p2',name:'p2',ownerId:A,currency:'EUR',startDate:'2019-11-14'};
  const valuations=[
    {id:'b0',productId:'base',date:'2018-11-14',value:500,currency:'EUR',valuationType:'opening',ownerId:B},
    {id:'b1',productId:'base',date:'2026-11-14',value:500,currency:'EUR',valuationType:'snapshot',ownerId:B},
    {id:'p20',productId:'p2',date:'2019-11-14',value:100,currency:'EUR',valuationType:'opening',ownerId:A},
    {id:'p21',productId:'p2',date:'2026-11-14',value:2500,currency:'EUR',valuationType:'snapshot',ownerId:A}
  ];
  const movements=[
    {id:'p2-2021',productId:'p2',ownerId:A,date:'2021-06-01',type:'contribution',flowNature:'external',amount:100,currency:'EUR'},
    {id:'p2-2024',productId:'p2',ownerId:A,date:'2024-06-01',type:'contribution',flowNature:'external',amount:1200,currency:'EUR'}
  ];
  const data={products:[p1,p2],valuations,movements,transfers:[],exchangeRates:[],startDate:'2018-11-14',endDate:'2026-11-14'};
  for(const scope of [{scope:'global'},{scope:'holder',ownerId:A}]){
    const result=calculate({...data,...scope});assert.equal(result.ok,true,result.message);
    assert.ok(result.flows.some(f=>f.date==='2019-11-14'&&f.amount===-100),'opening is included once on its actual date');
    const expectedFlows=scope.scope==='global'?
      [{date:'2018-11-14',amount:-500},{date:'2019-11-14',amount:-100},{date:'2021-06-01',amount:-100},{date:'2024-06-01',amount:-1200},{date:'2026-11-14',amount:3000}]:
      [{date:'2019-11-14',amount:-100},{date:'2021-06-01',amount:-100},{date:'2024-06-01',amount:-1200},{date:'2026-11-14',amount:2500}];
    close(result.annualizedReturn,referenceXirr(expectedFlows));
    const initialAlias=calculate({...data,...scope,valuations:valuations.map(v=>v.id==='p20'?{...v,valuationType:'initial'}:v)});
    assert.equal(initialAlias.ok,true,initialAlias.message);close(initialAlias.annualizedReturn,result.annualizedReturn);
  }
});

test('un moviment d’entrada registrat el dia de l’opening evita duplicar el capital inicial',()=>{
  const p={id:'p2',name:'p2',ownerId:A,currency:'EUR',startDate:'2019-11-14'};
  const data={scope:'holder',ownerId:A,products:[p],valuations:[
    {id:'start',productId:'p2',date:'2019-11-14',value:100,currency:'EUR',valuationType:'opening',ownerId:A},
    {id:'end',productId:'p2',date:'2026-11-14',value:200,currency:'EUR',valuationType:'snapshot',ownerId:A}
  ],movements:[{id:'m',productId:'p2',ownerId:A,date:'2019-11-14',type:'contribution',flowNature:'external',amount:100,currency:'EUR'}],transfers:[],exchangeRates:[],startDate:'2018-11-14',endDate:'2026-11-14'};
  const result=calculate(data);assert.equal(result.ok,true,result.message);
  assert.equal(result.flows.find(f=>f.date==='2019-11-14').amount,-100);
});

test('traspàs entre titulars és intern globalment i oposat en les dues vistes individuals',()=>{
  const transfer={id:'t1',date:'2023-07-01',sourceProductId:'p1',destinationProductId:'p3',sourceAmount:100,destinationAmount:100,sourceCurrency:'EUR',destinationCurrency:'EUR',sourceOwnerId:A,destinationOwnerId:B};
  const base=calculate(input()),withTransfer=calculate(input({transfers:[transfer]}));
  close(base.annualizedReturn,withTransfer.annualizedReturn);
  const holderA=calculate(input({scope:'holder',ownerId:A,transfers:[transfer]}));
  const holderB=calculate(input({scope:'holder',ownerId:B,transfers:[transfer]}));
  assert.equal(holderA.ok,true);assert.equal(holderB.ok,true);
  assert.ok(holderA.flows.some(f=>f.date===transfer.date&&f.amount===100));
  assert.ok(holderB.flows.some(f=>f.date===transfer.date&&f.amount===-100));
});

test('traspàs entre productes del mateix titular no crea flux agregat',()=>{
  const transfer={id:'t2',date:'2023-07-01',sourceProductId:'p1',destinationProductId:'p2',sourceAmount:80,destinationAmount:80,sourceCurrency:'EUR',destinationCurrency:'EUR',sourceOwnerId:A,destinationOwnerId:A};
  const one=calculate(input({scope:'holder',ownerId:A})),two=calculate(input({scope:'holder',ownerId:A,transfers:[transfer]}));
  close(one.annualizedReturn,two.annualizedReturn);assert.equal(two.flows.some(f=>f.date===transfer.date),false);
});

test('les valoracions intermèdies i el vincle sourceMovementId no dupliquen fluxos',()=>{
  const movement={id:'m1',productId:'p1',ownerId:A,date:'2023-06-01',type:'contribution',flowNature:'external',amount:100,currency:'EUR'};
  const valuations=vals.map(v=>({...v}));
  valuations.push({id:'mid',productId:'p1',date:'2023-08-01',value:9999,currency:'EUR',valuationType:'snapshot',ownerId:A,sourceMovementId:'m1'});
  const result=calculate(input({movements:[movement],valuations}));assert.equal(result.ok,true);
  assert.deepEqual(result.flows.map(f=>f.amount),[-1900,-100,2200]);
});

test('monedes diferents es converteixen amb el tipus EUR per unitat de la data exacta',()=>{
  const p={id:'usd',name:'Producte USD',ownerId:A,currency:'USD',startDate:'2023-01-01'};
  const valuations=[{id:'u0',productId:'usd',date:'2023-01-01',value:100,valuationType:'opening',currency:'USD',ownerId:A},{id:'u1',productId:'usd',date:'2024-01-01',value:110,valuationType:'snapshot',currency:'USD',ownerId:A}];
  const rates=[{id:'r0',currency:'USD',date:'2023-01-01',eurPerUnit:1.1},{id:'r1',currency:'USD',date:'2024-01-01',eurPerUnit:1.2}];
  const result=calculate(input({products:[p],valuations,exchangeRates:rates}));assert.equal(result.ok,true);close(result.finalValue,132);close(result.annualizedReturn,132/110-1);
  const missing=calculate(input({products:[p],valuations,exchangeRates:[rates[0]]}));assert.equal(missing.ok,false);assert.match(missing.message,/USD → EUR · 2024-01-01/);
});

test('valoracions de més de 30 dies es mostren com a advertiment de fiabilitat',()=>{
  const result=calculate(input({endDate:'2024-03-01'}));assert.equal(result.ok,true);assert.ok(result.warnings.some(w=>w.includes('no és plenament fiable')));assert.ok(result.valuations.filter(v=>v.point==='final').every(v=>v.ageDays>30));
});

test('moviments sense classificar i snapshots de titular absents bloquegen només la rendibilitat que no és verificable',()=>{
  const pending={id:'m2',productId:'p1',date:'2023-05-01',type:'contribution',amount:50,flowNature:'unclassified',currency:'EUR',ownerId:A};
  assert.match(calculate(input({movements:[pending]})).message,/pendent de classificar/);
  const legacy=vals.map(v=>({...v}));delete legacy[0].ownerId;
  const result=calculate(input({scope:'holder',ownerId:A,valuations:legacy}));assert.equal(result.ok,false);assert.match(result.message,/atribuir amb seguretat/);
});

test('migració v3 a v4 és additiva i preserva els magatzems anteriors',()=>{
  assert.equal(VERSION,4);
  const stores=new Map();
  const names={contains:n=>stores.has(n)};
  const makeStore=()=>{const s={indexes:new Set(),createIndex(n){this.indexes.add(n)}};s.indexNames={contains:n=>s.indexes.has(n)};return s};
  const db={objectStoreNames:names,createObjectStore(n){const s=makeStore();s.indexNames.parent=s;stores.set(n,s);return s}};
  for(const n of ['owners','institutions','products','valuations','movements','transfers'])stores.set(n,makeStore());
  stores.get('movements').indexes.add('flowNature');
  const preserved=stores.get('products'),sentinel={id:'realistic-existing-record'};preserved.sentinel=sentinel;
  upgradeSchema(db,{objectStore:n=>stores.get(n)});
  assert.equal(stores.get('products'),preserved);assert.equal(stores.get('products').sentinel,sentinel);assert.ok(stores.has('exchangeRates'));
  assert.ok(stores.get('exchangeRates').indexes.has('currencyDate'));assert.equal(stores.size,7);
});

test('còpies JSON v1-v3 es normalitzen sense perdre col·leccions i v4 fa roundtrip',()=>{
  const base={format:'patrimoni-backup',owners:[{id:'o'}],institutions:[],products:[],valuations:[]};
  for(const version of [1,2,3]){const old={...base,version,...(version>=2?{movements:[]} : {}),...(version>=3?{transfers:[]} : {})};const normalized=Backup.validateAndNormalize(JSON.parse(JSON.stringify(old)));assert.deepEqual(normalized.exchangeRates,[]);assert.deepEqual(normalized.owners,base.owners)}
  const v4=Backup.create({owners:base.owners,institutions:[],products:[],valuations:[],movements:[],transfers:[],exchangeRates:[{id:'fx',currency:'USD',date:'2024-01-01',eurPerUnit:0.9}]},'test');
  const decoded=JSON.parse(JSON.stringify(v4));assert.equal(decoded.version,4);assert.deepEqual(Backup.validateAndNormalize(decoded).exchangeRates,v4.exchangeRates);
});

test('diagnòstic identifica fluxos responsables dels canvis de signe sense eliminar-los',()=>{
  const p={id:'multi',name:'Producte amb fluxos mixtos',ownerId:A,currency:'EUR',startDate:'2024-01-01'};
  const result=calculate({scope:'holder',ownerId:A,products:[p],valuations:[
    {id:'o',productId:p.id,date:'2024-01-01',value:100,currency:'EUR',valuationType:'opening',ownerId:A},
    {id:'f',productId:p.id,date:'2024-04-01',value:100,currency:'EUR',valuationType:'snapshot',ownerId:A}
  ],movements:[
    {id:'w',productId:p.id,ownerId:A,date:'2024-02-01',type:'withdrawal',flowNature:'external',amount:150,currency:'EUR'},
    {id:'c',productId:p.id,ownerId:A,date:'2024-03-01',type:'contribution',flowNature:'external',amount:50,currency:'EUR'}
  ],transfers:[],exchangeRates:[],startDate:'2024-01-01',endDate:'2024-04-01'});
  assert.equal(result.ok,false);assert.match(result.message,/canvien de signe més d’una vegada/);
  assert.deepEqual(result.diagnostics.rawFlows.map(f=>[f.date,f.amount,f.productName,f.concept]),[
    ['2024-01-01',-100,'Producte amb fluxos mixtos','Valoració de cartera a l’inici del període'],
    ['2024-02-01',150,'Producte amb fluxos mixtos','Retirada externa'],
    ['2024-03-01',-50,'Producte amb fluxos mixtos','Aportació externa'],
    ['2024-04-01',100,'Producte amb fluxos mixtos','Valoració final (última dada 2024-04-01)']
  ]);
  assert.equal(result.diagnostics.signChanges.length,3);
  assert.deepEqual(result.diagnostics.signChanges.map(c=>[c.toDate,c.components[0].concept]),[
    ['2024-02-01','Retirada externa'],['2024-03-01','Aportació externa'],['2024-04-01','Valoració final (última dada 2024-04-01)']
  ]);
  const html=DiagnosticsUI.render(result.diagnostics,{money:n=>`${n} EUR`,dateFormat:s=>s,esc:s=>String(s)});
  assert.match(html,/Traça de diagnòstic/);assert.match(html,/Producte amb fluxos mixtos/);assert.match(html,/Retirada externa/);assert.match(html,/Canvis de signe detectats/);
});

test('P3: capital inicial i quatre aportacions externes produeixen sis fluxos i un canvi de signe',()=>{
  const owner='p3-owner',product={id:'p3',name:'P3',ownerId:owner,currency:'EUR',startDate:'2000-11-14'};
  const valuations=[
    {id:'p3-opening',productId:'p3',date:'2000-11-14',value:1000,currency:'EUR',valuationType:'opening',ownerId:owner},
    {id:'p3-final',productId:'p3',date:'2026-11-14',value:6000,currency:'EUR',valuationType:'snapshot',ownerId:owner}
  ];
  const movements=[
    ['m1','2000-11-30',1000],['m2','2005-04-18',500],['m3','2013-08-09',200],['m4','2021-02-22',500]
  ].map(([id,date,amount])=>({id,productId:'p3',ownerId:owner,date,type:'contribution',flowNature:'external',amount,currency:'EUR'}));
  const result=calculate({scope:'global',products:[product],valuations,movements,transfers:[],exchangeRates:[],startDate:'2000-11-14',endDate:'2026-11-14'});
  assert.equal(result.ok,true,result.message);
  assert.equal(result.diagnostics.rawFlows.length,6);
  assert.deepEqual(result.diagnostics.rawFlows.map(f=>Math.sign(f.amount)),[-1,-1,-1,-1,-1,1]);
  assert.equal(result.diagnostics.signChanges.length,1);
  assert.equal(result.diagnostics.signChanges[0].toDate,'2026-11-14');
  assert.equal(result.finalValue,6000);
});

test('traça separa el patrimoni final de 8.800 EUR del flux XIRR net de 8.760 EUR',()=>{
  const owner='owner-p',startDate='2020-01-01',endDate='2026-11-14';
  const products=[{id:'p1',name:'P1',ownerId:owner,currency:'EUR',startDate},{id:'p2',name:'P2',ownerId:owner,currency:'EUR',startDate},{id:'p3',name:'P3',ownerId:owner,currency:'EUR',startDate}];
  const valuations=[['p1',100,300],['p2',500,2500],['p3',1000,6000]].flatMap(([productId,opening,final])=>[
    {id:`${productId}-opening`,productId,date:startDate,value:opening,currency:'EUR',valuationType:'opening',ownerId:owner},
    {id:`${productId}-final`,productId,date:endDate,value:final,currency:'EUR',valuationType:'snapshot',ownerId:owner}
  ]);
  const movements=[{id:'p1-contribution-final-date',productId:'p1',ownerId:owner,date:endDate,type:'contribution',flowNature:'external',amount:40,currency:'EUR'}];
  const result=calculate({scope:'global',products,valuations,movements,transfers:[],exchangeRates:[],startDate,endDate});
  assert.equal(result.ok,true,result.message);assert.equal(result.finalValue,8800);
  const terminal=result.diagnostics.dailyFlows.find(flow=>flow.date===endDate);assert.equal(terminal.amount,8760);
  assert.equal(terminal.components.filter(flow=>flow.kind==='contribution').length,1);
  assert.deepEqual(terminal.components.map(flow=>flow.amount).sort((a,b)=>a-b),[-40,300,2500,6000]);
  const expected=referenceXirr([{date:startDate,amount:-1600},{date:endDate,amount:8760}]);close(result.annualizedReturn,expected);
  const html=DiagnosticsUI.render(result.diagnostics,{money:value=>`€${Number(value).toFixed(2)}`,dateFormat:value=>value,esc:value=>String(value)});
  assert.match(html,/Valor final del patrimoni/);assert.match(html,/Flux net utilitzat per a la XIRR/);assert.match(html,/€8800\.00/);assert.match(html,/€8760\.00/);assert.match(html,/P1 · Aportació externa/);
});
