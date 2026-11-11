const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { openDatabase } = require('../electron/database.cjs')

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordefin-stage15-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return path.join(dir, 'finance.sqlite')
}
function legacy(file, amount = 120.45) {
  const db = new DatabaseSync(file)
  db.exec(`CREATE TABLE accounts(id INTEGER PRIMARY KEY,name TEXT,opening_balance REAL,created_at TEXT);
    CREATE TABLE transactions(id INTEGER PRIMARY KEY,description TEXT,category TEXT,type TEXT,amount REAL,date TEXT,kind TEXT,account_id INTEGER);
    INSERT INTO accounts VALUES(1,'Conta antiga',500.25,'2025-01-01');`)
  db.prepare("INSERT INTO transactions VALUES(7,'Compra','Mercado','Variavel',?,'2025-02-01','despesa',1)").run(amount)
  db.close()
}
function backups(file) { return fs.readdirSync(path.dirname(file)).filter(x => x.startsWith(path.basename(file)+'.before-v3-')) }

test('stage15: backup is readable and retains original legacy schema and rows', t => {
  const file = sandbox(t); legacy(file)
  const db = openDatabase(file)
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3)
  assert.equal(db.prepare('SELECT amount_cents FROM transactions WHERE id=7').get().amount_cents,12045)
  assert.equal(db.prepare('SELECT opening_balance_cents FROM accounts WHERE id=1').get().opening_balance_cents,50025)
  db.close()
  assert.equal(backups(file).length,1)
  const copy = new DatabaseSync(path.join(path.dirname(file),backups(file)[0]))
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
  assert.equal(copy.prepare('SELECT amount FROM transactions WHERE id=7').get().amount,120.45)
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('transactions') WHERE name='amount_cents'").get().n,0)
  copy.close()
})

test('stage15: invalid legacy money fails migration without modifying source and backup remains recoverable',t => {
  const file=sandbox(t); legacy(file, 12.345)
  assert.throws(()=>openDatabase(file),/MIGRACAO_VALOR_INVALIDO/)
  const source=new DatabaseSync(file)
  assert.equal(source.prepare('SELECT amount FROM transactions WHERE id=7').get().amount,12.345)
  assert.equal(source.prepare('PRAGMA user_version').get().user_version,0)
  assert.equal(source.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('transactions') WHERE name='amount_cents'").get().n,0)
  source.close()
  assert.equal(backups(file).length,1)
  const copy=new DatabaseSync(path.join(path.dirname(file),backups(file)[0]))
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
  copy.close()
})

test('stage15: migration rerun does not create another backup or change money',t => {
  const file=sandbox(t); legacy(file)
  let db=openDatabase(file); db.close()
  const before=backups(file)
  db=openDatabase(file)
  assert.equal(db.prepare('SELECT amount_cents FROM transactions WHERE id=7').get().amount_cents,12045)
  db.close()
  assert.deepEqual(backups(file),before)
})
