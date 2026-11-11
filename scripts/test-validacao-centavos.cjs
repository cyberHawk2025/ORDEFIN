const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../electron/database.cjs');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
test('bloqueia fração de centavo sem modificar o banco', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordefin-money-')); const db=openDatabase(path.join(dir,'test.sqlite'));
 try {
  db.prepare('INSERT INTO accounts(name,opening_balance) VALUES (?,?)').run('Teste',12.34);
  assert.equal(db.prepare('SELECT opening_balance_cents AS n FROM accounts').get().n,1234);
  assert.throws(()=>db.prepare('UPDATE accounts SET opening_balance=?').run(12.345),/VALOR_MONETARIO_INVALIDO/);
  assert.equal(db.prepare('SELECT opening_balance_cents AS n FROM accounts').get().n,1234);
  assert.throws(()=>db.prepare('INSERT INTO accounts(name,opening_balance) VALUES (?,?)').run('Inválida',0.001),/VALOR_MONETARIO_INVALIDO/);
 } finally {db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
