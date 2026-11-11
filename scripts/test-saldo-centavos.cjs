const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { openDatabase } = require('../electron/database.cjs')
const { balanceCents, centsToReais } = require('../electron/money-balance.cjs')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordefin-cents-'))
try {
  const db = openDatabase(path.join(dir,'test.sqlite'))
  db.prepare('INSERT INTO accounts(name,opening_balance) VALUES (?,?)').run('Teste', 0.30)
  const id = db.prepare('SELECT id FROM accounts').get().id
  db.prepare("INSERT INTO transactions(description,category,type,amount,date,kind,account_id,paid) VALUES ('Teste','Outros','Variavel',0.10,'2026-10-17','despesa',?,1)").run(id)
  db.prepare("INSERT INTO transactions(description,category,type,amount,date,kind,account_id,paid) VALUES ('Teste','Outros','Variavel',0.20,'2026-10-17','despesa',?,1)").run(id)
  assert.equal(balanceCents(db,id),0)
  assert.equal(centsToReais(balanceCents(db,id)),0)
  db.close()
  console.log('PASS: saldo em centavos sem erro de ponto flutuante')
} finally { fs.rmSync(dir,{recursive:true,force:true}) }
