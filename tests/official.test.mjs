import { test } from "node:test"
import assert from "node:assert/strict"
import { parseTreasury, parseFund } from "../services/official.mjs"
test("Tesouro matches exact maturity and separates purchase from redemption", () => {
  const csv =
    "Tipo Titulo;Data Vencimento;Data Base;PU Compra Manha;PU Venda Manha\nTesouro Selic;01/03/2027;15/10/2026;100,50;99,50\nTesouro Selic;01/03/2029;15/10/2026;200;199"
  const a = { symbol: "Tesouro Selic", maturity: "2027-03-01" }
  assert.equal(parseTreasury(csv, a, "2026-10-17", true).price, "100.50")
  assert.equal(parseTreasury(csv, a, "2026-10-17", false).price, "99.50")
  assert.throws(() =>
    parseTreasury(csv, { ...a, maturity: "2030-01-01" }, "2026-10-17", true),
  )
})
test("CVM matches CNPJ, keeps quota date, refuses ambiguous subclasses", () => {
  const csv =
    "CNPJ_FUNDO_CLASSE;ID_SUBCLASSE;DT_COMPTC;VL_QUOTA\n00.017.024/0001-53;;2026-09-25;44.9"
  assert.equal(
    parseFund(csv, { symbol: "00017024000153" }, "2026-09-26").date,
    "2026-09-25",
  )
  assert.throws(() =>
    parseFund(csv, { symbol: "11111111111111" }, "2026-09-26"),
  )
  assert.throws(
    () =>
      parseFund(
        csv + "\n00.017.024/0001-53;A;2026-09-25;45",
        { symbol: "00017024000153" },
        "2026-09-26",
      ),
    /subclasse/,
  )
})
