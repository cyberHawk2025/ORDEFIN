import {portfolio} from "../shared/investments.mjs";
import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { createInvestmentStore } from "../electron/investment-store.mjs"
const require = createRequire(import.meta.url)
const { openDatabase } = require("../electron/database.cjs")
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ordefin-store-"))
  const db = openDatabase(path.join(dir, "test.sqlite"))
  t.after(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { db, store: createInvestmentStore(db) }
}
const op = {
  id: "1",
  type: "buy",
  asset: { category: "Ação", symbol: "PETR4" },
  date: "2025-01-01",
  amount: "100",
  fees: "1",
  quantity: "2",
}
test("legacy is archived, imports once, survives backup and reload", (t) => {
  const { db, store } = fixture(t)
  const raw = JSON.stringify([
    {
      id: "old",
      category: "Criptomoeda",
      symbol: "BTC",
      date: "2025-01-01",
      invested: 100,
      quantity: 0.001,
    },
  ])
  assert.equal(
    store.initialize({ "ordefin-investments-v2": raw }).operations.length,
    1,
  )
  assert.equal(store.initialize({}).operations.length, 1)
  assert.equal(
    db.prepare("SELECT payload FROM investment_legacy").get().payload,
    raw,
  )
  assert.equal(createInvestmentStore(db).read().operations[0].amount, "100")
})
test("corrupted legacy does not create empty portfolio", (t) => {
  const { store } = fixture(t)
  assert.throws(() => store.initialize({ "ordefin-investments-v2": "broken" }))
  assert.equal(store.read(), null)
})
test("operation persistence is idempotent, errors rollback and quotes do not mutate purchase", (t) => {
  const { store } = fixture(t)
  store.initialize()
  store.add(op)
  store.add(op)
  assert.equal(store.read().operations.length, 1)
  assert.throws(() =>
    store.add({ ...op, id: "2", type: "sell", quantity: "3" }),
  )
  assert.equal(store.read().operations.length, 1)
  store.saveQuote(op.asset, {
    price: "70",
    date: "2025-01-02",
    source: "test",
    fetchedAt: Date.now(),
  })
  assert.equal(store.read().operations[0].amount, "100")
})

test("bank movement commits exactly once, sale credits net, already recorded does not move", (t) => {
  const { db, store } = fixture(t)
  db.exec(
    "INSERT INTO accounts(id,name,opening_balance) VALUES(1,'Teste',1000)",
  )
  store.initialize()
  const linked = { ...op, accountId: 1, bankMode: "move" }
  store.add(linked)
  store.add(linked)
  assert.equal(
    db.prepare("SELECT SUM(amount) n FROM account_adjustments").get().n,
    -101,
  )
  assert.equal(
    db.prepare("SELECT count(*) n FROM investment_movements").get().n,
    1,
  )
  store.add({
    ...op,
    id: "2",
    type: "sell",
    quantity: "1",
    amount: "60",
    fees: "2",
    accountId: 1,
    bankMode: "move",
  })
  assert.equal(
    db.prepare("SELECT SUM(amount) n FROM account_adjustments").get().n,
    -43,
  )
  store.add({ ...op, id: "3", accountId: 1, bankMode: "recorded" })
  assert.equal(
    db.prepare("SELECT SUM(amount) n FROM account_adjustments").get().n,
    -43,
  )
  assert.equal(db.prepare("SELECT count(*) n FROM transactions").get().n, 0)
})
test("bank errors rollback both ledger and portfolio", (t) => {
  const { db, store } = fixture(t)
  store.initialize()
  assert.throws(() => store.add({ ...op, accountId: 999, bankMode: "move" }))
  assert.equal(store.read().operations.length, 0)
  assert.equal(
    db.prepare("SELECT count(*) n FROM account_adjustments").get().n,
    0,
  )
})

test("imported crypto consolidates with new purchases of the same asset", (t) => {
  const { store } = fixture(t)
  store.initialize({
    "ordefin-investments-v2": JSON.stringify([
      {
        id: "old",
        category: "Criptomoeda",
        symbol: "BTC",
        date: "2025-01-01",
        invested: 100,
        quantity: 1,
      },
    ]),
  })
  const state = store.add({
    ...op,
    id: "new",
    asset: { category: "Criptomoeda", symbol: "BTC" },
  })
  const positions=portfolio(state.operations);
  assert.equal(positions.length,1);
  assert.equal(positions[0].quantity,"3");
  assert.equal(positions[0].cost,"201");
})


test("investment purchase refuses insufficient funds and rolls back atomically", (t) => {
  const { db, store } = fixture(t)
  db.exec("INSERT INTO accounts(id,name,opening_balance) VALUES(1,'Teste',100)")
  store.initialize()
  assert.throws(() => store.add({ ...op, accountId: 1, bankMode: "move" }), /SALDO_INSUFICIENTE/)
  assert.equal(store.read().operations.length, 0)
  assert.equal(db.prepare("SELECT count(*) n FROM account_adjustments").get().n, 0)
  assert.equal(db.prepare("SELECT count(*) n FROM investment_movements").get().n, 0)
  db.exec("UPDATE accounts SET opening_balance=101 WHERE id=1")
  store.add({ ...op, accountId: 1, bankMode: "move" })
  assert.equal(db.prepare("SELECT SUM(amount) n FROM account_adjustments").get().n, -101)
  assert.throws(() => store.add({ ...op, id: "next", accountId: 1, bankMode: "move" }), /SALDO_INSUFICIENTE/)
  assert.equal(store.read().operations.length, 1)
})

test("bank balance includes transfers, paid expenses, card payments and adjustments", (t) => {
  const { db, store } = fixture(t)
  db.exec(`INSERT INTO accounts(id,name,opening_balance) VALUES(1,'Origem',200),(2,'Destino',0);
    INSERT INTO credit_cards(id,name,credit_limit) VALUES(1,'Cartao',1000);
    INSERT INTO transfers(source_account_id,destination_account_id,amount,date) VALUES(1,2,30,'2025-01-01');
    INSERT INTO card_payments(card_id,account_id,amount,date) VALUES(1,1,20,'2025-01-01');
    INSERT INTO account_adjustments(account_id,amount) VALUES(1,-10);
    INSERT INTO transactions(description,category,type,amount,date,kind,account_id,paid)
      VALUES('Despesa','Outros','saida',40,'2025-01-01','despesa',1,1);`)
  store.initialize()
  // 200 - 30 - 20 - 10 - 40 = 100, mas o aporte custa 101.
  assert.throws(() => store.add({ ...op, accountId: 1, bankMode: "move" }), /SALDO_INSUFICIENTE/)
  assert.equal(store.read().operations.length, 0)
  // Operação já registrada não debita novamente a conta.
  store.add({ ...op, accountId: 1, bankMode: "recorded" })
  assert.equal(db.prepare("SELECT count(*) n FROM account_adjustments").get().n, 1)
})
