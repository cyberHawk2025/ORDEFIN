/** Abreviação exclusivamente visual; os cálculos continuam usando Decimal. */
export const compactBRL = (input: string | number | null): string => {
  if (input === null) return "Indisponível"
  const n = Number(input)
  if (!Number.isFinite(n)) return "Indisponível"
  const absolute = Math.abs(n)
  const tiers: Array<[number, string]> = [[1e18,"Qi"],[1e15,"Q"],[1e12,"T"],[1e9,"B"],[1e6,"M"]]
  for (const [scale, suffix] of tiers) {
    if (absolute >= scale) {
      const rounded = Math.round(absolute / scale * 10) / 10
      // Se o arredondamento ultrapassar 999,9, usar a unidade superior.
      if (rounded >= 1000 && scale < 1e18) continue
      return `${n < 0 ? "−" : ""}R$ ${rounded.toLocaleString("pt-BR", {maximumFractionDigits:1})}${suffix}`
    }
  }
  return n.toLocaleString("pt-BR", {style:"currency",currency:"BRL"})
}
