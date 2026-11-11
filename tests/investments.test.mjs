import { test } from "node:test"
import assert from "node:assert/strict"
import {
  portfolio,
  fixedAccrual,
  currencyInput,
  cashTimeline,
} from "../shared/investments.mjs"
const asset = { category: "Criptomoeda", symbol: "BTC" }
const buy = (id, amount = "100", quantity = "2", date = "2025-01-01") => ({
  id,
  type: "buy",
  asset,
  amount,
  quantity,
  date,
  fees: "0",
})
const sell = (id, quantity, amount, date = "2025-01-02") => ({
  ...buy(id, amount, quantity, date),
  type: "sell",
})
test("weighted cost, partial sale, realized/unrealized, fees", () => {
  const ops = [
    buy("1"),
    buy("2", "200", "2"),
    { ...sell("3", "1", "100"), fees: "2" },
  ]
  const p = portfolio(ops, { "Criptomoeda|BTC|||||": { price: "90" } })[0]
  assert.equal(p.quantity, "3")
  assert.equal(p.cost, "225")
  assert.equal(p.average, "75")
  assert.equal(p.realized, "23")
  assert.equal(p.result, "45")
  assert.equal(p.percent, "20")
})
test("total sale, closure and repurchase preserve realized history", () => {
  let ops = [buy("1"), sell("2", "2", "120")]
  assert.equal(portfolio(ops)[0].closed, true)
  ops.push(buy("3", "150", "1", "2025-01-03"))
  const p = portfolio(ops)[0]
  assert.equal(p.realized, "20")
  assert.equal(p.cost, "150")
  assert.equal(p.operations.length, 3)
})
test("overselling and backdated overselling fail", () => {
  assert.throws(() => portfolio([buy("1"), sell("2", "3", "100")]), /maior/)
  assert.throws(
    () => portfolio([buy("1"), sell("2", "1", "100", "2024-01-01")]),
    /maior/,
  )
})
test("same day preserves insertion order; duplicate rejected", () => {
  assert.equal(
    portfolio([buy("1"), sell("2", "2", "100", "2025-01-01")])[0].closed,
    true,
  )
  assert.throws(() => portfolio([buy("1"), buy("1")]), /duplicada/)
})
test("tiny crypto and large amounts keep decimal precision", () => {
  const p = portfolio([
    buy("1", "1000000000000", "0.000000000000000003"),
    sell("2", "0.000000000000000001", "500000000000"),
  ])[0]
  assert.equal(p.quantity, "2e-18")
  assert.ok(p.realized.startsWith("166666666666.666666"))
})
test("unknown quantity and missing quotes never create returns", () => {
  assert.equal(portfolio([buy("1")])[0].value, null)
  const p = portfolio([buy("1", "100", null)])[0]
  assert.equal(p.quantity, null)
  assert.equal(p.value, null)
  assert.throws(
    () => portfolio([buy("1", "100", null), sell("2", "1", "50")]),
    /Complete/,
  )
})
test("known and unknown fixed rates; CDI uses daily rates", () => {
  assert.equal(fixedAccrual("1000", "fixed", "12", [], 252), "1120")
  assert.equal(fixedAccrual("1000", "unknown", null, [], 252), null)
  assert.equal(
    fixedAccrual(
      "1000",
      "cdi",
      "110",
      [{ date: "2025-01-02", value: "0.05" }],
      1,
    ),
    "1000.55",
  )
  assert.equal(fixedAccrual("1000", "cdi", "100", [], 1), null)
})
test("Brazilian cents input, deletion, contribution dates", () => {
  for (const [s, r] of [
    ["1", "0,01"],
    ["15", "0,15"],
    ["150", "1,50"],
    ["1500", "15,00"],
    ["150000", "1.500,00"],
    ["", "0,00"],
  ])
    assert.equal(currencyInput(s), r)
  assert.deepEqual(
    cashTimeline([buy("1"), buy("2", "50", "1", "2025-02-01")]),
    [
      { date: "2025-01-01", contributions: "100", withdrawals: "0" },
      { date: "2025-02-01", contributions: "150", withdrawals: "0" },
    ],
  )
})
test("invalid dates, zero quantities and nonfinite numbers fail", () => {
  for (const op of [
    buy("1", "NaN"),
    buy("1", "10", "0"),
    buy("1", "10", "1", "2025-02-30"),
  ])
    assert.throws(() => portfolio([op]))
})
