const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../electron/database.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordefin-migration-'));
try {
 const file=path.join(dir,'finance.sqlite');
 let db=openDatabase(file);
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,3);
 db.prepare('INSERT INTO accounts(name,opening_balance) VALUES(?,?)').run('Teste',12.34);
 assert.equal(db.prepare('SELECT opening_balance_cents FROM accounts').get().opening_balance_cents,1234);
 db.prepare('UPDATE accounts SET opening_balance=? WHERE name=?').run(9.87,'Teste');
 assert.equal(db.prepare('SELECT opening_balance_cents FROM accounts').get().opening_balance_cents,987);
 db.close();
 db=openDatabase(file);
 assert.equal(db.prepare('SELECT opening_balance_cents FROM accounts').get().opening_balance_cents,987);
 db.close();
 console.log('OK: migração, escrita, atualização e reabertura');
} finally {fs.rmSync(dir,{recursive:true,force:true})}
