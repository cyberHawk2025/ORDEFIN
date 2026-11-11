import { test } from "node:test"
import assert from "node:assert/strict"
import { createFinancialService } from "../services/financial.mjs"
const asset = { category: "Criptomoeda", symbol: "BTC" }
let now = Date.parse("2026-10-17T12:00:00Z")
const response = (j) => ({ ok: true, json: async () => j })
test("historical uses exact requested candle; no current fallback", async () => {
  const start = Date.parse("2025-01-01T00:00:00Z")
  const svc = createFinancialService({
    now: () => now,
    fetcher: async (u) =>
      response(
        u.includes("exchangeInfo")
          ? { symbols: [{ symbol: "BTCBRL", quoteAsset: "BRL" }] }
          : [[start, 0, 0, 0, "500000", 0, start + 86399999]],
      ),
  })
  const q = await svc.getQuote(asset, "2025-01-01")
  assert.equal(q.price, "500000")
  assert.equal(q.date, "2025-01-01")
})
test("cache deduplicates, expired quote is retained as stale after failure", async () => {
  let n = 0,
    fail = false
  const svc = createFinancialService({
    now: () => now,
    fetcher: async (u) => {
      n++
      if (fail) throw Error()
      return response(
        u.includes("exchangeInfo")
          ? { symbols: [{ symbol: "BTCBRL", quoteAsset: "BRL" }] }
          : { symbol: "BTCBRL", price: "100" },
      )
    },
  })
  await Promise.all([svc.getQuote(asset), svc.getQuote(asset)])
  assert.equal(n, 2)
  fail = true
  now += 300001
  const q = await svc.getQuote(asset)
  assert.equal(q.price, "100")
  assert.equal(q.stale, true)
})
test("connection, invalid data and rate limit fail explicitly", async () => {
  for (const fetcher of [
    async () => {
      throw Error()
    },
    async () => response({}),
    async () => ({ ok: false, status: 429 }),
  ]) {
    const svc = createFinancialService({ fetcher })
    await assert.rejects(svc.getQuote(asset))
  }
})
test("B3 previous session is explicit and adjusted closes are refused", async () => {
  const row = { date: Date.parse("2025-01-03") / 1000, rawClose: 30 }
  const svc = createFinancialService({
    fetcher: async () =>
      response({
        results: [
          { symbol: "PETR4", currency: "BRL", historicalDataPrice: [row] },
        ],
      }),
  })
  const q = await svc.getQuote(
    { category: "Ação", symbol: "PETR4" },
    "2025-01-05",
  )
  assert.equal(q.date, "2025-01-03")
  assert.equal(q.requestedDate, "2025-01-05")
  delete row.rawClose
  row.close = 30
  await assert.rejects(
    svc.getQuote({ category: "Ação", symbol: "PETR4" }, "2025-01-06"),
    /original indisponível/,
  )
})

test("fixed contract uses published business days and keeps unknown/IPCA unavailable", async () => {
  const svc = createFinancialService({
    fetcher: async () =>
      response([
        { data: "02/01/2025", valor: "0.05" },
        { data: "03/01/2025", valor: "0.05" },
      ]),
  })
  const q = await svc.getQuote(
    {
      category: "CDB",
      symbol: "CDB Teste",
      purchaseDate: "2025-01-01",
      rateType: "cdi",
      rate: "110",
    },
    "2025-01-03",
  )
  assert.equal(q.price, "1.0011003025")
  assert.equal(q.kind, "estimate")
  await assert.rejects(
    svc.getQuote({ category: "CDB", symbol: "X", rateType: "unknown" }),
    /informada/,
  )
  await assert.rejects(
    svc.getQuote({ category: "IPCA", symbol: "X", rateType: "ipca" }),
    /contrato/,
  )
})

test("today's BTC historical lookup uses clearly labelled intraday spot price", async () => {
  const clock = Date.parse("2026-10-18T03:00:00Z")
  const svc = createFinancialService({
    now: () => clock,
    fetcher: async (url) => response(url.includes("exchangeInfo")
      ? { symbols: [{ symbol: "BTCBRL", quoteAsset: "BRL" }] }
      : { symbol: "BTCBRL", price: "410000" }),
  })
  const q = await svc.getQuote(asset, "2026-10-18")
  assert.equal(q.price, "410000")
  assert.equal(q.kind, "intraday")
  assert.equal(q.provisional, true)
})
