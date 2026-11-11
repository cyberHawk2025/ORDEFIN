const { test } = require("node:test")

const assert = require("node:assert/strict")

const fs = require("node:fs")

const os = require("node:os")

const path = require("node:path")

const { DatabaseSync } = require("node:sqlite")

const { openDatabase } = require("../electron/database.cjs")

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ordefin-test-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return path.join(dir, "test.sqlite")
}

test("fresh installation has empty finance tables and current schema", (t) => {
  const db = openDatabase(fixture(t))
  try {
    for (const table of [
      "transactions",
      "accounts",
      "credit_cards",
      "investment_state",
    ])
      assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0)
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 3)
  } finally {
    db.close()
  }
})

test("migration preserves real rows, paid status, balances and snapshot; rerun is idempotent", (t) => {
  const file = fixture(t)
  let db = new DatabaseSync(file)
  db.exec(
    `CREATE TABLE transactions(id INTEGER PRIMARY KEY,description TEXT,category TEXT,type TEXT,amount REAL,date TEXT,kind TEXT,account_id INTEGER); CREATE TABLE accounts(id INTEGER PRIMARY KEY,name TEXT,opening_balance REAL,created_at TEXT); INSERT INTO accounts VALUES(1,'Conta real',321.12,'2025-01-01');INSERT INTO transactions VALUES(42,'Aluguel','Moradia','Conta fixa',120,'2025-01-02','despesa',1);`,
  )
  db.close()
  db = openDatabase(file)
  const rows = db.prepare("SELECT * FROM transactions").all()
  assert.equal(rows[0].paid, 1)
  assert.equal(rows[0].amount, 120)
  assert.equal(
    db.prepare("SELECT opening_balance FROM accounts").get().opening_balance,
    321.12,
  )
  db.close()
  const backups = fs
    .readdirSync(path.dirname(file))
    .filter((x) => x.includes("before-v3"))
  assert.equal(backups.length, 1)
  const backup = new DatabaseSync(path.join(path.dirname(file), backups[0]))
  assert.equal(
    backup.prepare("SELECT amount FROM transactions").get().amount,
    120,
  )
  backup.close()
  db = openDatabase(file)
  assert.deepEqual(db.prepare("SELECT * FROM transactions").all(), rows)
  db.close()
  assert.equal(
    fs.readdirSync(path.dirname(file)).filter((x) => x.includes("before-v3"))
      .length,
    1,
  )
})

test("newer schema is refused without rewriting data", (t) => {
  const file = fixture(t)
  const db = new DatabaseSync(file)
  db.exec("PRAGMA user_version=99")
  db.close()
  assert.throws(() => openDatabase(file), /mais recente/)
  const check = new DatabaseSync(file)
  assert.equal(check.prepare("PRAGMA user_version").get().user_version, 99)
  check.close()
})
