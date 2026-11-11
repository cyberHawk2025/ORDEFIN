import { createFinancialService } from "../services/financial.mjs"
import { createOfficialService } from "../services/official.mjs"
const market = createFinancialService(),
  official = createOfficialService()
const cases = [
  [
    "Binance atual",
    () => market.getQuote({ category: "Criptomoeda", symbol: "BTC" }),
  ],
  [
    "Binance histórico",
    () =>
      market.getQuote({ category: "Criptomoeda", symbol: "BTC" }, "2025-03-10"),
  ],
  ["brapi atual", () => market.getQuote({ category: "Ação", symbol: "PETR4" })],
  [
    "brapi histórico sem token",
    () => market.getQuote({ category: "Ação", symbol: "PETR4" }, "2025-03-10"),
  ],
  ["BCB CDI", () => market.series(12, "2026-10-01", "2026-10-15")],
  [
    "Tesouro",
    () =>
      official.getQuote({
        category: "Tesouro Selic",
        symbol: "Tesouro Selic",
        maturity: "2027-03-01",
      }),
  ],
  [
    "CVM",
    () =>
      official.getQuote(
        { category: "Fundo", symbol: "00.017.024/0001-53" },
        "2026-09-25",
      ),
  ],
]
for (const [name, run] of cases) {
  try {
    const result = await run()
    console.log(
      JSON.stringify({
        name,
        ok: true,
        result: Array.isArray(result)
          ? { count: result.length, first: result[0] }
          : result,
      }),
    )
  } catch (e) {
    console.log(JSON.stringify({ name, ok: false, error: e.message }))
  }
}
