const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('edição de investimentos ligada da interface ao armazenamento',()=>{
 const main=read('electron/main.cjs'), preload=read('electron/preload.cjs'), store=read('electron/investment-store.mjs');
 assert.match(main,/investments:editDetails/);
 assert.match(preload,/investments:editDetails/);
 assert.match(store,/function editDetails\(id, patch\)/);
});
test('edição valida carteira e usa transação com rollback',()=>{
 const s=read('electron/investment-store.mjs');
 const edit=s.slice(s.indexOf('function editDetails('),s.indexOf('function editAmount('));
 for(const token of ['BEGIN IMMEDIATE','portfolio(state.operations.map','ROLLBACK','COMMIT','SALDO_INSUFICIENTE','investment_movements','account_adjustments']) assert.ok(edit.includes(token),token);
});
test('edição restringe campos e exige centavos exatos',()=>{
 const s=read('electron/investment-store.mjs');
 const edit=s.slice(s.indexOf('function editDetails('),s.indexOf('function editAmount('));
 assert.match(edit,/const allowed = \["amount", "fees", "quantity", "date"\]/);
 assert.match(edit,/mul\(100\)\.isInteger\(\)/);
});
