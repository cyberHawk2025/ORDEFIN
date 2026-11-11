import { unzip } from "fflate"
import { amount, validDate, localDate } from "../shared/investments.mjs"
const TREASURY =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv"
const iso = (s) => s?.split("/").reverse().join("-")
export function parseTreasury(text, asset, date, historical) {
  if (!asset.maturity || !validDate(asset.maturity))
    throw Error("Informe o vencimento exato do título")
  const rows = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
  const headers = rows.shift().split(";")
  const at = (name) => {
    const i = headers.indexOf(name)
    if (i < 0) throw Error("Formato Tesouro não reconhecido")
    return i
  }
  const type = at("Tipo Titulo"),
    maturity = at("Data Vencimento"),
    day = at("Data Base"),
    price = at(historical ? "PU Compra Manha" : "PU Venda Manha")
  const found = rows
    .map((r) => r.split(";"))
    .filter(
      (r) =>
        r[type] === asset.symbol &&
        iso(r[maturity]) === asset.maturity &&
        iso(r[day]) <= date,
    )
    .sort((a, b) => iso(b[day]).localeCompare(iso(a[day])))[0]
  if (!found) throw Error("Título/vencimento sem preço disponível até a data")
  const actual = iso(found[day])
  if (Date.parse(date) - Date.parse(actual) > 7 * 86400000)
    throw Error("Preço Tesouro muito antigo para a data solicitada")
  const value = found[price].replace(",", ".")
  amount(value)
  return {
    price: value,
    date: actual,
    source:
      "Tesouro Nacional · " +
      (historical ? "PU compra manhã" : "PU venda manhã"),
    kind: historical ? "reference" : "market",
    requestedDate: date,
  }
}
export function parseFund(text, asset, date) {
  const cnpj = asset.symbol.replace(/\D/g, "")
  if (cnpj.length !== 14) throw Error("Informe CNPJ com 14 dígitos")
  const rows = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
  const h = rows.shift().split(";")
  const ci =
    h.indexOf("CNPJ_FUNDO_CLASSE") >= 0
      ? h.indexOf("CNPJ_FUNDO_CLASSE")
      : h.indexOf("CNPJ_FUNDO")
  const di = h.indexOf("DT_COMPTC"),
    pi = h.indexOf("VL_QUOTA"),
    si = h.indexOf("ID_SUBCLASSE")
  if (ci < 0 || di < 0 || pi < 0) throw Error("Formato CVM não reconhecido")
  const found = rows
    .map((r) => r.split(";"))
    .filter((r) => r[ci]?.replace(/\D/g, "") === cnpj && r[di] <= date)
    .sort((a, b) => b[di].localeCompare(a[di]))
  if (!found.length) throw Error("Cota CVM indisponível no período")
  const day = found[0][di]
  const candidates = found.filter(
    (r) =>
      r[di] === day && (si < 0 || !asset.contract || r[si] === asset.contract),
  )
  if (candidates.length !== 1)
    throw Error("CNPJ possui subclasses: informe o identificador da subclasse")
  amount(candidates[0][pi])
  return {
    price: candidates[0][pi],
    date: day,
    source: "CVM · informe diário · cota publicada",
    kind: "quota",
    requestedDate: date,
  }
}
export function createOfficialService({
  fetcher = fetch,
  now = Date.now,
} = {}) {
  const files = new Map()
  async function file(url, zipped = false) {
    const cached = files.get(url)
    if (cached && now() - cached.time < 6 * 3600000) return cached.promise
    const promise = (async () => {
      let response
      try {
        response = await fetcher(url, { signal: AbortSignal.timeout(45000) })
      } catch {
        throw Error("Fonte oficial indisponível ou sem conexão")
      }
      if (!response.ok)
        throw Error("Arquivo oficial indisponível: HTTP " + response.status)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length > 60000000)
        throw Error("Arquivo excede o limite de segurança")
      let decoded = bytes
      if (zipped) {
        const files = await new Promise((resolve, reject) =>
          unzip(
            bytes,
            {
              filter: (f) =>
                f.name.endsWith(".csv") && f.originalSize < 250000000,
            },
            (e, r) => (e ? reject(e) : resolve(r)),
          ),
        )
        decoded = Object.values(files)[0]
        if (!decoded) throw Error("CSV ausente no arquivo CVM")
      }
      return new TextDecoder().decode(decoded)
    })()
    files.set(url, { time: now(), promise })
    if (files.size > 3) files.delete(files.keys().next().value)
    try {
      return await promise
    } catch (e) {
      files.delete(url)
      throw e
    }
  }
  async function getQuote(asset, requested) {
    const date = requested || localDate()
    let q
    if (asset.category.startsWith("Tesouro"))
      q = parseTreasury(await file(TREASURY), asset, date, !!requested)
    else if (asset.category === "Fundo") {
      let error
      for (let i = 0; i < 2; i++) {
        const d = new Date(date + "T12:00:00Z")
        d.setUTCDate(1)
        d.setUTCMonth(d.getUTCMonth() - i)
        const ym = d.toISOString().slice(0, 7).replace("-", "")
        try {
          q = parseFund(
            await file(
              `https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_${ym}.zip`,
              true,
            ),
            asset,
            date,
          )
          break
        } catch (e) {
          error = e
        }
      }
      if (!q) throw error
    } else throw Error("Categoria oficial não suportada")
    return {
      ...q,
      fetchedAt: now(),
      stale: Date.parse(date) - Date.parse(q.date) > 4 * 86400000,
    }
  }
  return { getQuote }
}
