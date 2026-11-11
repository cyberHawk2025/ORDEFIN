import Decimal from "decimal.js"

export const D = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
})

export const CATEGORIES = [
  "Criptomoeda",
  "Ação",
  "ETF",
  "FII",
  "Fundo",
  "CDB",
  "CDI",
  "Prefixado",
  "IPCA",
  "Tesouro Selic",
  "Tesouro Prefixado",
  "Tesouro IPCA+",
  "Outro",
]

export const decimal = (v) => new D(v)

export function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value
  )
}

export function localDate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function amount(value, zero = false) {
  let x
  try {
    x = new D(value)
  } catch {
    throw Error("Valor numérico inválido")
  }
  if (!x.isFinite() || (zero ? x.lt(0) : x.lte(0)) || x.gt("1e24"))
    throw Error("Valor fora dos limites")
  return x
}

export function assetKey(a) {
  return [
    a.category,
    a.symbol.trim().toUpperCase(),
    a.maturity || "",
    a.institution || "",
    a.rateType || "",
    a.rate || "",
    a.contract || "",
  ].join("|")
}

export function validateOperation(op) {
  if (
    !op ||
    !op.id ||
    !["buy", "sell"].includes(op.type) ||
    !CATEGORIES.includes(op.asset?.category) ||
    !op.asset.symbol?.trim()
  )
    throw Error("Operação inválida")

  if (!validDate(op.date) || op.date > localDate())
    throw Error("Data inválida ou futura")

  if (
    op.asset.maturity &&
    (!validDate(op.asset.maturity) ||
      (op.type === "buy" && op.asset.maturity < op.date))
  )
    throw Error("Vencimento inválido")

  amount(op.amount)
  amount(op.fees ?? "0", true)

  if (
    decimal(op.amount).decimalPlaces() > 2 ||
    decimal(op.fees ?? 0).decimalPlaces() > 2
  )
    throw Error("Valores monetários devem ter até duas casas decimais")

  if (op.type === "sell" && op.quantity == null)
    throw Error("Informe a quantidade vendida")

  if (op.quantity != null) amount(op.quantity)

  if (op.type === "sell" && decimal(op.fees || 0).gt(op.amount))
    throw Error("Custos maiores que o valor recebido")

  if (op.asset.rateType && op.asset.rateType !== "unknown")
    amount(op.asset.rate, true)

  if (
    op.accountId != null &&
    (!Number.isSafeInteger(op.accountId) || op.accountId <= 0)
  )
    throw Error("Conta inválida")

  return op
}

export function portfolio(operations, quotes = {}) {
  const positions = new Map()
  const ids = new Set()

  const sorted = operations
    .map((op, index) => ({ op, index }))
    .sort((a, b) => a.op.date.localeCompare(b.op.date) || a.index - b.index)

  for (const { op } of sorted) {
    validateOperation(op)
    if (ids.has(op.id)) throw Error("Operação duplicada")
    ids.add(op.id)

    const key = assetKey(op.asset)
    let p = positions.get(key)

    if (!p) {
      p = {
        key,
        asset: op.asset,
        quantity: decimal(0),
        cost: decimal(0),
        realized: decimal(0),
        contributions: decimal(0),
        unknown: false,
        estimated: false,
        operations: [],
      }
      positions.set(key, p)
    }

    const gross = amount(op.amount),
      fees = amount(op.fees || 0, true)
    p.operations.push(op)
    p.estimated ||= !!op.estimated

    if (op.type === "buy") {
      p.cost = p.cost.plus(gross).plus(fees)
      p.contributions = p.contributions.plus(gross).plus(fees)
      if (op.quantity == null) p.unknown = true
      else p.quantity = p.quantity.plus(op.quantity)
    } else {
      if (p.unknown)
        throw Error("Complete a quantidade dos aportes antes de vender")
      const q = amount(op.quantity)
      if (q.gt(p.quantity))
        throw Error("Venda maior que a quantidade disponível na data")
      const allocated = q.eq(p.quantity)
        ? p.cost
        : p.cost.mul(q).div(p.quantity)
      p.realized = p.realized.plus(gross).minus(fees).minus(allocated)
      p.cost = p.cost.minus(allocated)
      p.quantity = p.quantity.minus(q)
    }
  }

  return [...positions.values()].map((p) => {
    const quote = quotes[p.key]
    const price = quote?.price != null ? amount(quote.price) : null
    const value = p.unknown || !price ? null : p.quantity.mul(price)
    const result = value == null ? null : value.minus(p.cost)
    return {
      ...p,
      quantity: p.unknown ? null : p.quantity.toString(),
      cost: p.cost.toString(),
      realized: p.realized.toString(),
      contributions: p.contributions.toString(),
      average:
        p.unknown || p.quantity.isZero()
          ? null
          : p.cost.div(p.quantity).toString(),
      value: value?.toString() ?? null,
      result: result?.toString() ?? null,
      percent:
        result == null || p.cost.isZero()
          ? null
          : result.div(p.cost).mul(100).toString(),
      closed: !p.unknown && p.quantity.isZero(),
      quote,
    }
  })
}

// Accrual is an estimate, never a market price. Daily factors use actual published daily rates.

export function fixedAccrual(principal, rateType, rate, series, businessDays) {
  const p = amount(principal)
  if (rateType === "unknown" || rate == null) return null

  const r = amount(rate, true).div(100)

  if (rateType === "fixed") {
    if (!Number.isInteger(businessDays) || businessDays < 0)
      throw Error("Dias úteis necessários")
    return p
      .mul(decimal(1).plus(r).pow(decimal(businessDays).div(252)))
      .toString()
  }

  if (!Array.isArray(series) || !series.length) return null

  let total = p
  for (const point of series) {
    if (!validDate(point.date) || !Number.isFinite(Number(point.value)))
      throw Error("Série inválida")
    const daily = decimal(point.value).div(100)
    if (rateType === "cdi") total = total.mul(decimal(1).plus(daily.mul(r)))
    else if (rateType === "ipca") total = total.mul(decimal(1).plus(daily))
    else throw Error("Indexador inválido")
  }

  if (rateType === "ipca") {
    if (!Number.isInteger(businessDays) || businessDays < 0) return null
    total = total.mul(decimal(1).plus(r).pow(decimal(businessDays).div(252)))
  }

  return total.toString()
}

export function cashTimeline(operations) {
  let invested = decimal(0),
    withdrawn = decimal(0)
  const points = []
  for (const op of [...operations].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    if (op.type === "buy")
      invested = invested.plus(op.amount).plus(op.fees || 0)
    else withdrawn = withdrawn.plus(op.amount).minus(op.fees || 0)
    const point = {
      date: op.date,
      contributions: invested.toString(),
      withdrawals: withdrawn.toString(),
    }
    if (points.at(-1)?.date === op.date) points[points.length - 1] = point
    else points.push(point)
  }
  return points
}

export function currencyInput(text) {
  const digits = text.replace(/\D/g, "").slice(0, 16)
  return decimal(digits || 0)
    .div(100)
    .toFixed(2)
    .replace(".", ",")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

export function parseBrazilian(text) {
  const s = String(text)
    .trim()
    .replace(/R\$|\s/g, "")
  if (!/^\d+(?:\.\d{3})*(?:,\d+)?$/.test(s) && !/^\d+(?:\.\d+)?$/.test(s))
    throw Error("Número inválido")
  return decimal(
    s.includes(",") ? s.replaceAll(".", "").replace(",", ".") : s,
  ).toString()
}
