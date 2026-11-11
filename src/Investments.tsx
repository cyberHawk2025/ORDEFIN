import Decimal from "decimal.js"
import { compactBRL } from "./investmentDisplay"
import InvestmentCharts from "./InvestmentCharts"

import { memo, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"

import {
  CATEGORIES,
  assetKey,
  decimal,
  localDate,
  parseBrazilian,
  portfolio,
  type Asset,
  type Operation,
  type Quote,
  type State,
} from "../shared/investments.mjs"

import "./investments.css"

const money = (v: string | number | null) =>
  v === null
    ? "Indisponível"
    : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

const num = (v: string | null) => {
  if(v===null)return "Não informada";
  const [whole,fraction]=decimal(v).toDecimalPlaces(8).toFixed().split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(fraction?','+fraction:'');
}

const empty: State = {
  version: 1,
  operations: [],
  quotes: {},
  observations: [],
  warnings: [],
}

const fixedCategories = ["CDB", "CDI", "Prefixado", "IPCA"]

/** Entrada monetária por centavos: 1 -> 0,01; 100 -> 1,00; 10000 -> 100,00.
 * Apenas o texto do campo muda; cálculos continuam usando parseBrazilian/decimal.js.
 */
export function formatInvestmentMoneyInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "")
  if (!digits) return "0,00"
  const cents = digits.padStart(3, "0")
  const integer = cents.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return `${integer},${cents.slice(-2)}`
}


/** Intercepta edição por centavos sem reprocessar o texto formatado.
 * Backspace em "0,00" deve funcionar, em vez de parecer um campo travado.
 */
function handleMoneyKey(event: KeyboardEvent<HTMLInputElement>, current: string, update: (next: string) => void) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return
  const key = event.key
  if (!/^\d$/.test(key) && key !== "Backspace" && key !== "Delete") return
  event.preventDefault()
  const input = event.currentTarget
  const selected = input.selectionStart !== input.selectionEnd
  const digits = current.replace(/\D/g, "")
  const nextDigits = /^\d$/.test(key)
    ? (selected ? key : digits + key)
    : (selected ? "" : digits.slice(0, -1))
  update(formatInvestmentMoneyInput(nextDigits))
  requestAnimationFrame(() => {
    if (document.activeElement === input) input.setSelectionRange(input.value.length, input.value.length)
  })
}



/** Ícones vetoriais locais: nenhuma dependência de rede ou chave de API. */
function InvestmentBadge({ kind, symbol }: { kind: "wallet" | "market" | "result" | "asset"; symbol?: string }) {
  const coin = symbol?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") ?? ""
  if (kind === "asset") {
    if (coin === "BTC" || coin === "XBT") return <span className="investment-coin-mark investment-coin-btc" aria-label="Bitcoin">₿</span>
    if (coin === "ETH") return <span className="investment-coin-mark investment-coin-eth" aria-label="Ethereum"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 7 17l9-4 9 4L16 2Zm-9 18 9 10 9-10-9 5-9-5Z" fill="currentColor" /></svg></span>
    if (coin === "SOL") return <span className="investment-coin-mark investment-coin-sol" aria-label="Solana"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 6h21l-5 5H3l5-5Zm-5 9h21l5 5H8l-5-5Zm5 9h21l-5 5H3l5-5Z" fill="currentColor" /></svg></span>
    if (coin === "XRP") return <span className="investment-coin-mark investment-coin-xrp" aria-label="XRP"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 7c4 0 5 8 12 8s8-8 12-8M4 25c4 0 5-8 12-8s8 8 12 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></span>
    return <span className="investment-coin-mark investment-coin-generic" aria-label={coin || "Ativo"}>{coin ? coin.slice(0, 3) : "◇"}</span>
  }
  if (kind === "wallet") return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="9" width="24" height="18" rx="5"/><path d="M6 9V7a3 3 0 0 1 3-3h15M21 17h7v6h-7a3 3 0 0 1 0-6Z"/><circle cx="22" cy="20" r=".8" fill="currentColor" stroke="none"/></svg>
  if (kind === "market") return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 24 8-8 6 5L28 8"/><path d="M20 8h8v8"/><path d="M4 28h24"/></svg>
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 27h22"/><rect x="7" y="17" width="4" height="8" rx="1"/><rect x="14" y="12" width="4" height="13" rx="1"/><rect x="21" y="7" width="4" height="18" rx="1"/><path d="m5 12 8-7 5 4 9-6"/></svg>
}

function Investments(_props: {
  quotes: Record<string, { price: number; updated: number }>
  clock: number
}) {
  const api = window.ordefinInvestments

  const [state, setState] = useState<State>(empty),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("")

  const [category, setCategory] = useState("Criptomoeda"),
    [symbol, setSymbol] = useState("BTC"),
    [date, setDate] = useState(localDate()),
    [cash, setCash] = useState("0,00"),
    [fees, setFees] = useState("0,00"),
    [quantity, setQuantity] = useState("")

  const [institution, setInstitution] = useState(""),
    [maturity, setMaturity] = useState(""),
    [rateType, setRateType] = useState("unknown"),
    [rate, setRate] = useState(""),
    [contract, setContract] = useState("")

  const [historical, setHistorical] = useState<Quote | null>(null),
    [historicalKey, setHistoricalKey] = useState(""),
    [saleKey, setSaleKey] = useState("")

  const [confirmClear, setConfirmClear] = useState(false)
  const [simCategory, setSimCategory] = useState("Criptomoeda")
  const [simSymbol, setSimSymbol] = useState("BTC")
  const [simDate, setSimDate] = useState(localDate())
  const [simAmount, setSimAmount] = useState("100,00")
  const [simUnits, setSimUnits] = useState("1")
  const [simMode, setSimMode] = useState<"quantity" | "amount">("quantity")
  const [simHistorical, setSimHistorical] = useState<Quote | null>(null)
  const [simError, setSimError] = useState("")
  const [simLoading, setSimLoading] = useState(false)
  const simRequest = useRef(0)

  const [manualKey, setManualKey] = useState(""),
    [manualPrice, setManualPrice] = useState(""),
    [manualDate, setManualDate] = useState(localDate()),
    [manualSource, setManualSource] = useState("")

  const [accounts, setAccounts] = useState<{ id: number; name: string }[]>([]),
    [accountId, setAccountId] = useState(""),
    [bankMode, setBankMode] = useState<"move" | "recorded">("recorded"),
    [bankReference, setBankReference] = useState("")

  useEffect(() => {
    window.finora
      ?.listAccounts()
      .then(setAccounts)
      .catch((e) => setMessage(String(e)))
  }, [])

  const refreshing = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state

  const fixed = fixedCategories.includes(category),
    treasury = category.startsWith("Tesouro")

  const asset: Asset = {
    category,
    symbol: treasury ? category : symbol.trim().toUpperCase(),
    ...(maturity ? { maturity } : {}),
    ...(institution ? { institution } : {}),
    ...(fixed ? { rateType, rate: rate ? parseSafe(rate) : undefined } : {}),
    ...(contract ? { contract } : {}),
  }

  const requestKey = JSON.stringify(asset) + "|" + date

  const [selectedAssetKey, setSelectedAssetKey] = useState("ALL")
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [assetHistories, setAssetHistories] = useState<Record<string, {date:string;cost:string;value:string}[]>>({})
  const [marketHistory, setMarketHistory] = useState<{date:string; cost:string; value:string}[]>([])
  const [historyStatus, setHistoryStatus] = useState("")
  const historyVersion = useRef(0)
  const operationsKey = useMemo(() => JSON.stringify(state.operations.map(o => [o.id,o.date,o.amount,o.quantity,o.type,o.asset])), [state.operations])
  useEffect(() => {
    if (!loaded || !api) return
    const version = ++historyVersion.current
    const operations = state.operations
    const open = portfolio(operations).filter(p => !p.closed)
    if (!open.length) { setMarketHistory([]); setAssetHistories({}); setHistoryStatus(""); return }
    const from = [...operations].sort((a,b) => a.date.localeCompare(b.date))[0]?.date as string
    setHistoryStatus("Consultando histórico de mercado…")
    Promise.all(open.map(async p => {
      try { return {key:p.key, data:await api.history(p.asset, from), error:""} }
      catch (error) { return {key:p.key, data:{points: [] as {date:string;price:string}[]}, error:`${p.asset.symbol}: ${String(error)}`} }
    }))
      .then(all => {
        if (historyVersion.current !== version) return
        const byAsset = new Map(all.map(item => [item.key, new Map(item.data.points.map(q => [q.date,q.price]))]))
        const dates = [...new Set(all.flatMap(item => item.data.points.map(q => q.date)))].sort()
        const result: {date:string;cost:string;value:string}[] = []
        const individual: Record<string, {date:string;cost:string;value:string}[]> = Object.fromEntries(open.map(p => [p.key, []]))
        // Recalcular a carteira somente quando uma operação altera a posição.
        // Em séries diárias longas, a posição é idêntica entre duas operações.
        const operationDays = [...new Set(operations.map(op => op.date))].sort()
        let lastOperationDay = -1
        let positionsOnDay: ReturnType<typeof portfolio> = []
        for (const day of dates) {
          let changed = false
          while (lastOperationDay + 1 < operationDays.length && operationDays[lastOperationDay + 1] <= day) {
            lastOperationDay++
            changed = true
          }
          if (changed) positionsOnDay = portfolio(operations.filter(op => op.date <= day))
          if (!positionsOnDay.length) continue
          let value = decimal(0), complete = true, cost = decimal(0)
          for (const pos of positionsOnDay.filter(p => !p.closed)) {
            const price = byAsset.get(pos.key)?.get(day)
            if (!price || pos.quantity === null) { complete = false; break }
            value = value.plus(decimal(pos.quantity).mul(price))
            cost = cost.plus(pos.cost)
            individual[pos.key]?.push({date:day,cost:String(pos.cost),value:decimal(pos.quantity).mul(price).toString()})
          }
          if (complete) result.push({date:day,cost:cost.toString(),value:value.toString()})
        }
        setMarketHistory(result)
        setAssetHistories(individual)
        const errors = all.map(item => item.error).filter(Boolean)
        setHistoryStatus(errors.length ? errors.join(" | ") : result.length ? "Histórico das fontes de mercado disponíveis" : "Sem avaliações históricas completas")
      })
      .catch(e => {
        if (historyVersion.current !== version) return
        setMarketHistory([])
        setAssetHistories({})
        setHistoryStatus(String(e))
      })
    return () => { historyVersion.current++ }
  }, [loaded, operationsKey])

  const positions = useMemo(
    () => portfolio(state.operations, state.quotes),
    [state.operations, state.quotes],
  )
  const active = useMemo(() => positions.filter((p) => !p.closed), [positions]),
    closed = useMemo(() => positions.filter((p) => p.closed), [positions])

  const selectedActive = selectedAssetKey === "ALL" ? active : active.filter(p => p.key === selectedAssetKey)
  const selectedPositions = selectedAssetKey === "ALL" ? positions : positions.filter(p => p.key === selectedAssetKey)
  const selectedHistory = selectedAssetKey === "ALL" ? marketHistory : assetHistories[selectedAssetKey] ?? []
  const total = (
    key: "cost" | "realized" | "value" | "result",
    rows = positions,
  ) => rows.reduce((s, p) => s.plus(p[key] ?? 0), decimal(0)).toString()
  const priced = selectedActive.filter((p) => p.value !== null)
  const pricedCost = decimal(total("cost", priced))

  useEffect(() => {
    if (!api) {
      setMessage(
        "Abra o aplicativo desktop para usar a carteira com backup SQLite.",
      )
      return
    }
    let alive = true
    const legacy: Record<string, string> = {}
    for (const key of ["ordefin-investments-v1", "ordefin-investments-v2"]) {
      const raw = localStorage.getItem(key)
      if (raw !== null) legacy[key] = raw
    }
    api
      .load(legacy)
      .then((s) => {
        if (alive) {
          setState(s)
          setLoaded(true)
        }
      })
      .catch((e) => setMessage(String(e)))
    return () => {
      alive = false
    }
  }, [])

  async function refresh(operationsOverride?: Operation[]) {
    if (!api || refreshing.current) return
    refreshing.current = true
    setBusy(true)
    const errors: string[] = []
    try {
      const ps = portfolio(operationsOverride ?? stateRef.current.operations).filter((p) => !p.closed)
      for (const p of ps) {
        try {
          await api.quote(p.asset)
          // A cotação já foi persistida pelo processo principal.
          // Não publicar estado parcial: a leitura final é a fonte da verdade.
        } catch (e) {
          errors.push(p.asset.symbol + ": " + String(e))
          // Preservar a última cotação persistida; a falha será exibida.
        }
      }
      const updated = await api.observe()
      // Nunca mesclar cotações antigas do React sobre as recém-gravadas no SQLite.
      setState(updated)
      setMessage(
        errors.length
          ? errors.join("\n")
          : "Consulta concluída. Confira a data efetiva de cada cotação.",
      )
    } finally {
      refreshing.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!loaded) return
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh()
    }, 300000)
    return () => clearInterval(timer)
  }, [loaded])

  // A cotação é consultada automaticamente; resultados atrasados nunca substituem
  // o ativo ou a data atualmente selecionados.
  const [quoteStatus, setQuoteStatus] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [quoteError, setQuoteError] = useState("")
  useEffect(() => {
    if (!loaded || !api || saleKey || fixed || !symbol.trim()) {
      setHistorical(null)
      setQuoteStatus("idle")
      return
    }
    let cancelled = false
    setHistorical(null)
    setQuoteStatus("loading")
    setQuoteError("")
    const timer = setTimeout(() => {
      void api.quote(asset, date).then((q) => {
        if (cancelled) return
        setHistorical(q)
        setHistoricalKey(requestKey)
        setQuoteStatus("ready")
      }).catch((error) => {
        if (cancelled) return
        setQuoteStatus("error")
        setQuoteError(String(error))
      })
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [loaded, requestKey, saleKey, fixed])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!api) return
    setBusy(true)
    try {
      const value = !saleKey && !fixed && quantity.trim() && historical && historicalKey === requestKey
        ? decimal(parseBrazilian(quantity)).mul(historical.price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
        : parseBrazilian(cash),
        costs = parseBrazilian(fees)
      let q = quantity ? parseBrazilian(quantity) : null
      let estimated = false
      let selected: Asset = asset
      let purchaseQuote: Quote | undefined

      if (saleKey) {
        selected = positions.find((p) => p.key === saleKey)!.asset
        if (!q) throw Error("Informe a quantidade vendida.")
      } else if (fixed) {
        selected = {
          ...asset,
          rate: rateType === "unknown" ? undefined : parseBrazilian(rate),
          contract: crypto.randomUUID(),
          purchaseDate: date,
        }
        q = value
        estimated = true
      } else {
        // Sempre obter a cotação do ativo/data no momento de salvar.
        // Não aceitar quantidade ou preço digitados para compras de mercado.
        purchaseQuote = historical && historicalKey === requestKey
          ? historical
          : await api.quote(asset, date)
        if (decimal(purchaseQuote.price).lte(0))
          throw Error("Cotação histórica inválida")
        q = quantity.trim() ? parseBrazilian(quantity) : decimal(value).div(purchaseQuote.price).toString()
        if (decimal(q).lte(0)) throw Error("Quantidade inválida")
        estimated = !quantity.trim()
      }

      const op: Operation = {
        id: crypto.randomUUID(),
        type: saleKey ? "sell" : "buy",
        asset: selected,
        date,
        amount: value,
        fees: costs,
        quantity: q,
        estimated,
        purchaseQuote,
        ...(accountId
          ? { accountId: Number(accountId), bankMode, bankReference }
          : {}),
        createdAt: Date.now(),
      }

      const result = await api.add(op)
      setState(result)
      // Após o registro, buscar imediatamente a cotação atual da nova posição.
      // Não depender do próximo ciclo de cinco minutos.
      void refresh(result.operations)
      setMessage("Operação salva no banco e incluída nos backups. Atualizando a rentabilidade…")
      setCash("0,00")
      setFees("0,00")
      setQuantity("")
      setHistorical(null)
      setSaleKey("")
      window.dispatchEvent(new Event("ordefin-investments-changed"))
    } catch (e) {
      setMessage(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function simulate(e: FormEvent) {
    e.preventDefault()
    const request = ++simRequest.current
    setSimHistorical(null)
    setSimError("")
    if (!api) { setSimError("Abra o ORDEFIN no aplicativo desktop."); return }
    if (fixedCategories.includes(simCategory)) {
      setSimError("Renda fixa exige taxa e condições contratuais; não é possível simular usando apenas cotação unitária.")
      return
    }
    setSimLoading(true)
    try {
      const amount = decimal(parseBrazilian(simAmount))
      const units = decimal(parseBrazilian(simUnits))
      if (simMode === "quantity" ? (!units.isFinite() || units.lte(0)) : (!amount.isFinite() || amount.lte(0))) throw Error("Informe uma quantidade ou valor positivo")
      const selected: Asset = { category: simCategory, symbol: simSymbol.trim().toUpperCase() }
      if (!selected.symbol) throw Error("Informe o código do ativo")
      const historical = await api.quote(selected, simDate)
      if (decimal(historical.price).lte(0)) throw Error("Cotação inválida")
      if (request === simRequest.current) setSimHistorical(historical)
    } catch (error) { if (request === simRequest.current) setSimError(String(error)) }
    finally { if (request === simRequest.current) setSimLoading(false) }
  }

  async function saveManual(e: FormEvent) {
    e.preventDefault()
    if (!api) return
    try {
      const p = positions.find((p) => p.key === manualKey)!
      setState(
        await api.manual(p.asset, {
          price: parseBrazilian(manualPrice),
          date: manualDate,
          source: manualSource,
        }),
      )
      setManualKey("")
      setMessage("Avaliação manual registrada com data e fonte.")
    } catch (e) {
      setMessage(String(e))
    }
  }

  async function deleteSingleOperation(op: Operation) {
    if (!api || busy) return
    const description = `${op.type === "buy" ? "COMPRA" : "VENDA"} de ${op.asset.symbol}\nData: ${op.date.split("-").reverse().join("/")}\nValor bruto: ${money(op.amount)}\nQuantidade: ${num(op.quantity)}`
    if (!window.confirm(`Excluir SOMENTE esta operação?\n\n${description}\n\nOutros registros serão preservados. Se houver movimentação bancária vinculada, somente o ajuste desta operação será revertido. Esta ação não pode ser desfeita.`)) return
    setBusy(true)
    try {
      const updated = await api.deleteOperation(op.id, "EXCLUIR OPERACAO")
      setState(updated)
      setMessage(`Operação de ${op.asset.symbol} excluída individualmente. Os outros lançamentos foram preservados.`)
      window.dispatchEvent(new Event("ordefin-investments-changed"))
    } catch (error) { setMessage("Não foi possível excluir a operação: " + String(error)) }
    finally { setBusy(false) }
  }

  async function clearTestPortfolio() {
    if (!api || busy) return
    if (!confirmClear) return
    const confirmation = 'ZERAR INVESTIMENTOS'
    setBusy(true)
    try {
      const cleared = await api.resetPortfolio(confirmation)
      setState(cleared)
      setMarketHistory([])
      setHistoryStatus('')
      setHistorical(null)
      setSimHistorical(null)
      setSimError('')
      setConfirmClear(false)
      setMessage('Carteira de investimentos zerada. Pronta para novos testes.')
    } catch (error) {
      setMessage('Não foi possível zerar a carteira: ' + String(error))
    } finally {
      setBusy(false)
    }
  }

  const simQuantity = simHistorical ? (simMode === "quantity" ? decimal(parseBrazilian(simUnits)) : decimal(parseBrazilian(simAmount)).div(simHistorical.price)) : null

  return (
    <div className="content investments-page investment-vnext">
      <section className="page-intro">
        <div>
          <span className="eyebrow">Patrimônio e aplicações</span>
          <h2>Meus investimentos</h2>
          <p>
            Compras, vendas e avaliações com origem e data. Os valores não
            incluem impostos estimados.
          </p>
        </div>
        <div className="investment-toolbar">
          <button
            className="button primary"
            type="button"
            disabled={!loaded || busy}
            onClick={() => void refresh()}
          >
            {busy ? "Consultando…" : "Atualizar cotações"}
          </button>
          <button
            className="button investment-delete-button"
            type="button"
            disabled={!loaded || busy}
            onClick={() => setConfirmClear(true)}
          >
            Excluir todos os investimentos de teste
          </button>
        </div>
      </section>
        {confirmClear && (
          <div role="alertdialog" aria-label="Confirmar exclusão dos investimentos" style={{ border: '1px solid #dc6c6c', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <p><strong>Excluir todos os investimentos de teste?</strong></p>
            <p>Esta ação é irreversível: apaga TODAS as operações registradas na carteira de investimentos, incluindo compras e vendas de teste, além de cotações e avaliações salvas. Ajustes bancários vinculados serão revertidos. Outras áreas do programa serão preservadas.</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className="button" type="button" disabled={busy} onClick={() => setConfirmClear(false)}>Cancelar</button>
              <button className="button" type="button" disabled={busy} onClick={() => void clearTestPortfolio()} style={{ background: '#b42332', color: '#fff' }}>Sim, excluir investimentos</button>
            </div>
          </div>
        )}
      {message && (
        <p className="investment-message" role="status">
          {message}
        </p>
      )}
      {state.warnings.map((w, i) => (
        <p key={i} className="investment-hint">
          {w}
        </p>
      ))}
      <section className="investment-asset-selector" aria-label="Selecionar investimento para visualizar">
        <button type="button" className="investment-selector-current" aria-expanded={selectorOpen} onClick={() => setSelectorOpen(v => !v)}>
          <span className="investment-selector-symbol">{selectedAssetKey === "ALL" ? <InvestmentBadge kind="wallet" /> : <InvestmentBadge kind="asset" symbol={selectedActive[0]?.asset.symbol} />}</span>
          <span className="investment-selector-label"><strong>{selectedAssetKey === "ALL" ? "Carteira completa" : `${selectedActive[0]?.asset.symbol ?? "Ativo removido"} · ${selectedActive[0]?.asset.category ?? ""}`}</strong><small>{selectedAssetKey === "ALL" ? `${active.length} ativos · ${state.operations.filter(o => o.type === "buy").length} compras` : `${selectedActive[0]?.operations.filter(o => o.type === "buy").length ?? 0} compras · ${selectedActive[0]?.asset.symbol ?? ""}`}</small></span>
          <span className="investment-selector-amount"><strong>{compactBRL(total("cost",selectedActive))}</strong><small className={decimal(total("result",selectedActive)).lt(0) ? "investment-negative" : "investment-positive"}>{selectedActive.every(p => p.value !== null) ? compactBRL(total("result",selectedActive)) : "Cotação indisponível"}</small></span>
          <span className="investment-selector-chevron">{selectorOpen ? "⌃" : "⌄"}</span>
        </button>
        {selectorOpen && <div className="investment-selector-options">
          {[{key:"ALL",symbol:"Carteira completa",category:"Todos os investimentos"},...active.map(p=>({key:p.key,symbol:p.asset.symbol,category:p.asset.category}))].map(item=><button type="button" key={item.key} className={item.key === selectedAssetKey ? "is-selected" : ""} onClick={() => {setSelectedAssetKey(item.key);setSelectorOpen(false)}}><span><strong>{item.symbol}</strong><small>{item.category}</small></span><span>{item.key === selectedAssetKey ? "✓" : "→"}</span></button>)}
        </div>}
      </section>
      <div className="investment-summary">
        <article className="panel"><span className="investment-summary-icon"><InvestmentBadge kind="wallet" /></span><span>Valor total aplicado</span><strong title={money(total("cost",selectedActive))}>{compactBRL(total("cost",selectedActive))}</strong><small>Custo das posições mantidas</small></article>
        <article className="panel"><span className="investment-summary-icon"><InvestmentBadge kind="market" /></span><span>Valor atual estimado</span><strong title={money(total("value",selectedActive))}>{selectedActive.length > 0 && priced.length === selectedActive.length ? compactBRL(total("value",selectedActive)) : "Indisponível"}</strong><small>{priced.length} de {selectedActive.length} posições avaliadas</small></article>
        <article className="panel"><span className="investment-summary-icon"><InvestmentBadge kind="result" /></span><span>Resultado dos ativos</span><strong className={selectedActive.length > 0 && priced.length === selectedActive.length ? decimal(total("result",selectedActive)).lt(0) ? "investment-negative" : "investment-positive" : ""} title={money(total("result",selectedActive))}>{selectedActive.length > 0 && priced.length === selectedActive.length ? compactBRL(total("result",selectedActive)) : "Indisponível"}</strong><small>{selectedActive.length > 0 && priced.length === selectedActive.length && pricedCost.gt(0) ? num(decimal(total("result",selectedActive)).div(pricedCost).mul(100).toFixed(2)) + "% de rentabilidade" : "Cotação válida necessária"}</small></article>
      </div>
      <InvestmentCharts key={selectedAssetKey} onDeleteOperation={deleteSingleOperation} busy={busy} state={state} positions={selectedPositions} history={selectedHistory} historyStatus={historyStatus} selectedAssetKey={selectedAssetKey} assetHistories={assetHistories} />
      <section className="panel investment-simulator">
        <h2>Simular investimento (não registra compra)</h2>
        <p>Informe quanto teria aplicado em uma data passada. O ORDEFIN consulta somente o preço histórico para calcular quantas unidades o valor hipotético compraria naquela data. Não acompanha rentabilidade nem registra operação.</p>
        <form className="investment-form" onSubmit={simulate}>
          <label>Tipo de investimento<select value={simCategory} onChange={e => { setSimCategory(e.target.value); setSimHistorical(null) }}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
          <label>{simCategory === "Fundo" ? "CNPJ do fundo / classe" : "Código do ativo"}<input value={simSymbol} onChange={e => { setSimSymbol(e.target.value); setSimHistorical(null) }} required /></label>
          <label>Data da compra simulada<input type="date" max={localDate()} value={simDate} onChange={e => { setSimDate(e.target.value); setSimHistorical(null) }} required /></label>
          <label>Calcular por<select value={simMode} onChange={e => { setSimMode(e.target.value as "quantity" | "amount"); setSimHistorical(null) }}><option value="quantity">Quantidade de unidades</option><option value="amount">Valor disponível (R$)</option></select></label>
          {simMode === "quantity" ? <label>Quantidade hipotética<input inputMode="decimal" value={simUnits} onChange={e => { setSimUnits(e.target.value); setSimHistorical(null) }} required /></label> : <label>Valor hipotético investido (R$)<input inputMode="decimal" value={simAmount} onKeyDown={e => handleMoneyKey(e, simAmount, setSimAmount)} onChange={e => { setSimAmount(formatInvestmentMoneyInput(e.target.value)); setSimHistorical(null) }} required /></label>}
          <button className="button primary" disabled={simLoading || !loaded}>{simLoading ? "Consultando…" : "Calcular simulação"}</button>
        </form>
        {simError && <p role="alert" className="investment-message">{simError}</p>}
        {simQuantity && simHistorical && <div className="investment-results-grid investment-simulation-result">
          <div><span>Quantidade hipotética</span><strong>{num(simQuantity.toString())} {simSymbol.toUpperCase()}</strong></div>
          <div><span>Preço unitário</span><strong>{money(simHistorical.price)}</strong></div>
          <div><span>Valor total hipotético</span><strong>{money(simQuantity.mul(simHistorical.price).toString())}</strong></div>
          <p>Cotação histórica utilizada: {money(simHistorical.price)} em {simHistorical.date} ({simHistorical.source}). Esta simulação não calcula lucro ou prejuízo e não salva nenhuma operação.</p>
        </div>}
      </section>
      <section className="panel">
        <h2>
          {saleKey ? "Registrar venda ou resgate" : "Registrar investimento"}
        </h2>
        <form className="investment-form" onSubmit={save}>
          <label>
            Operação
            <select
              value={saleKey}
              onChange={(e) => {
                setSaleKey(e.target.value)
                setQuantity("")
              }}
            >
              <option value="">Compra / aporte</option>
              {active.map((p) => (
                <option key={p.key} value={p.key}>
                  Vender / resgatar {p.asset.symbol} {p.asset.maturity}
                </option>
              ))}
            </select>
          </label>
          {!saleKey && (
            <>
              <label>
                Tipo
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value)
                    setHistorical(null)
                    setMaturity("")
                    setInstitution("")
                    setContract("")
                  }}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                {category === "Fundo"
                  ? "CNPJ do fundo / classe"
                  : "Nome ou código do ativo"}
                <input
                  value={treasury ? category : symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  readOnly={treasury}
                  required
                />
              </label>
              {(fixed || treasury || category === "Fundo") && (
                <>
                  <label>
                    Instituição
                    <input
                      value={institution}
                      onChange={(e) => setInstitution(e.target.value)}
                    />
                  </label>
                  <label>
                    Vencimento{treasury ? " (obrigatório)" : ""}
                    <input
                      type="date"
                      value={maturity}
                      onChange={(e) => setMaturity(e.target.value)}
                      required={treasury}
                    />
                  </label>
                </>
              )}
              {category === "Fundo" && (
                <label>
                  Subclasse, se houver
                  <input
                    value={contract}
                    onChange={(e) => setContract(e.target.value)}
                  />
                </label>
              )}
              {fixed && (
                <>
                  <label>
                    Rentabilidade
                    <select
                      value={rateType}
                      onChange={(e) => setRateType(e.target.value)}
                    >
                      <option value="unknown">Não sei informar</option>
                      <option value="cdi">Percentual do CDI</option>
                      <option value="fixed">Prefixada (% ao ano)</option>
                      <option value="ipca">IPCA + taxa anual</option>
                    </select>
                  </label>
                  {rateType !== "unknown" && (
                    <label>
                      Taxa contratada (%)
                      <input
                        value={rate}
                        onChange={(e) => setRate(e.target.value)}
                        required
                        inputMode="decimal"
                      />
                      <small>
                        Ex.: 110 para 110% do CDI ou 12 para 12% ao ano.
                      </small>
                    </label>
                  )}
                  <p className="investment-hint">
                    Cada aplicação é um contrato separado. Para resgates, a
                    quantidade representa reais de principal, sem os
                    rendimentos. A avaliação depende da taxa, do calendário e
                    das condições contratuais.
                  </p>
                </>
              )}
            </>
          )}
          <label>
            Data
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={localDate()}
              required
            />
          </label>
          <label>
            {saleKey
              ? "Valor bruto recebido (R$)"
              : "Valor investido (R$)"}
            <input
              value={cash}
              inputMode="numeric"
              onKeyDown={(e) => handleMoneyKey(e, cash, setCash)}
              onChange={(e) => setCash(formatInvestmentMoneyInput(e.target.value))}
              required={!quantity.trim() || Boolean(saleKey) || fixed}
            />
          </label>
          <label>
            Custos e taxas (R$) — opcional
            <input
              value={fees}
              inputMode="numeric"
              onKeyDown={(e) => handleMoneyKey(e, fees, setFees)}
              onChange={(e) => setFees(formatInvestmentMoneyInput(e.target.value))}
            />
          </label>
          {(saleKey || (!fixed && !saleKey)) && (
            <label>
              {saleKey ? "Quantidade vendida / principal resgatado" : "Quantidade comprada (opcional; calcula o valor pela cotação)"}
              <input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                inputMode="decimal"
                required={Boolean(saleKey)}
              />
            </label>
          )}
          {!saleKey && !fixed && (
            <div aria-live="polite" className="investment-hint">
              {quoteStatus === "loading" && <p>Consultando cotação histórica automaticamente…</p>}
              {quoteStatus === "error" && (
                <p role="alert">Cotação indisponível: {quoteError}. Não é possível registrar uma compra sem cotação válida.</p>
              )}
              {quoteStatus === "ready" && historical && historicalKey === requestKey && (
                <p>
                  Preço histórico: R$ {num(historical.price)} por unidade · {historical.date} · {historical.source}.
                  <strong> {quantity.trim() ? `Quantidade informada: ${quantity}` : `Quantidade estimada: ${decimal(parseSafe(cash) || 0).gt(0) ? num(decimal(parseSafe(cash)).div(historical.price).toString()) : "informe o valor investido"}`}.</strong>
                  {historical.date !== date && " Cotação do último pregão disponível anterior à data solicitada."}
                </p>
              )}
              <p>{quantity.trim() && historical && historicalKey === requestKey ? `Total calculado pela quantidade: ${money(decimal(parseSafe(quantity) || 0).mul(historical.price).toString())}. ` : ""}A cotação é uma referência; confira o preço real no comprovante antes de salvar.</p>
            </div>
          )}
          <label>
            Conta vinculada (opcional)
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Sem vínculo bancário</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {accountId && (
            <>
              <label>
                Movimentação no saldo
                <select
                  value={bankMode}
                  onChange={(e) =>
                    setBankMode(e.target.value as "move" | "recorded")
                  }
                >
                  <option value="recorded">
                    Saldo já reflete a operação — não movimentar
                  </option>
                  <option value="move">Movimentar o saldo ao salvar</option>
                </select>
              </label>
              <label>
                Referência / comprovante
                <input
                  value={bankReference}
                  onChange={(e) => setBankReference(e.target.value)}
                  required={bankMode === "recorded"}
                />
              </label>
              <p className="investment-hint">
                Compra debita valor aplicado + custos; venda credita valor bruto
                − custos. Movimentações novas não são despesas de consumo. Se já
                cadastrou como lançamento, revise a classificação separadamente.
              </p>
            </>
          )}
          <button
            type="submit"
            className="button primary"
            disabled={!loaded || busy}
          >
            Salvar operação
          </button>
        </form>
      </section>
      {selectedActive.length > 0 && (
        <section className="panel investment-quote-tools" aria-label="Preço médio e cotações dos investimentos">
          <div className="investment-quote-tools-header">
            <h2>Preço médio e referência de cotação</h2>
            <p>Dados complementares não exibidos nos cards de desempenho.</p>
          </div>
          <div className="investment-quote-tools-list">
            {selectedActive.map((p) => (
              <article className="investment-quote-tool-row" key={p.key}>
                <div className="investment-quote-tool-asset"><strong>{p.asset.symbol} · {p.asset.category}</strong><small>Preço médio de aquisição: <b title={p.average === null ? "Indisponível" : money(p.average)}>{p.average === null ? "Indisponível" : compactBRL(p.average)}</b> por unidade</small></div>
                <div className="investment-quote-tool-source">
                  {p.quote ? (
                    <><span title={p.quote.source}>{p.quote.source}</span><small>Referência: {p.quote.date} · consulta: {new Date(p.quote.fetchedAt).toLocaleString("pt-BR")}{p.quote.stale || Date.now() - p.quote.fetchedAt > 300000 ? " · cotação anterior/manual" : ""}</small></>
                  ) : <span>Sem cotação disponível</span>}
                </div>
                <button type="button" className="button secondary" onClick={() => setManualKey(p.key)}>Informar cotação manual</button>
              </article>
            ))}
          </div>
        </section>
      )}
      {manualKey && (
        <section className="panel">
          <h2>Avaliação manual</h2>
          <form className="investment-form" onSubmit={saveManual}>
            <label>
              Preço por unidade / fator por real de principal
              <input
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                required
                inputMode="decimal"
              />
            </label>
            <label>
              Data da avaliação
              <input
                type="date"
                value={manualDate}
                max={localDate()}
                onChange={(e) => setManualDate(e.target.value)}
                required
              />
            </label>
            <label>
              Fonte / comprovante
              <input
                value={manualSource}
                onChange={(e) => setManualSource(e.target.value)}
                required
              />
            </label>
            <button className="button primary">Salvar avaliação</button>
            <button
              type="button"
              className="button"
              onClick={() => setManualKey("")}
            >
              Cancelar
            </button>
          </form>
        </section>
      )}
      <section className="panel investment-history-section">
        <div className="investment-history-heading"><h2>Histórico de operações</h2><span className="investment-history-count">{state.operations.length} {state.operations.length === 1 ? "operação" : "operações"}</span></div>
        {state.operations.length === 0 ? <p className="investment-history-empty">Nenhuma operação registrada.</p> : (
          <div className="investment-history-grid">
            {state.operations.map((o) => (
              <article className="investment-history-card" key={o.id}>
                <div className="investment-history-card-top">
                  <div className="investment-history-identity">
                    <InvestmentBadge kind="asset" symbol={o.asset.symbol} />
                    <div className="investment-history-name"><strong>{o.asset.symbol} <span>· {o.asset.category}</span></strong><small>{o.type === "buy" ? "Compra" : "Venda"} · {o.date.split("-").reverse().join("/")}</small></div>
                  </div>
                  <div className="investment-history-total"><small>Valor bruto</small><strong title={money(o.amount)}>{compactBRL(o.amount)}</strong></div>
                </div>
                <div className="investment-history-details">
                  <div><small>Quantidade</small><strong title={o.quantity === null ? "Não informada" : num(o.quantity)}>{num(o.quantity)} {o.asset.symbol}</strong>{o.estimated && <small>Quantidade estimada</small>}</div>
                  <div><small>Taxas</small><strong title={money(o.fees)}>{compactBRL(o.fees)}</strong></div>
                  <div><small>Cotação de referência</small><strong title={o.purchaseQuote ? `${o.purchaseQuote.source} · ${o.purchaseQuote.date} · ${money(o.purchaseQuote.price)}` : "Comprovante / cadastro manual"}>{o.purchaseQuote ? compactBRL(o.purchaseQuote.price) : "Manual"}</strong><small>{o.purchaseQuote ? `${o.purchaseQuote.source} · ${o.purchaseQuote.date.split("-").reverse().join("/")}` : "Comprovante / cadastro manual"}</small></div>
                </div>
                {o.accountId && <div className="investment-history-bank">Conta: {accounts.find((a) => a.id === o.accountId)?.name || o.accountId} · {o.bankMode === "move" ? "saldo movimentado" : "já refletido no saldo"} · {o.bankReference || o.id}</div>}
                <div className="investment-history-actions">
                  {o.quantity === null && <button type="button" className="button" disabled={busy} onClick={async () => {
                          const q = window.prompt(
                            "Quantidade efetiva do comprovante:",
                          )
                          if (q && api)
                            try {
                              setState(
                                await api.complete(o.id, parseBrazilian(q)),
                              )
                            } catch (e) {
                              setMessage(String(e))
                            }
                        }}>Completar quantidade</button>}
                  <button type="button" className="investment-history-edit" disabled={busy} onClick={async () => {
                    if (!api) return
                    const raw = window.prompt("Valor bruto (R$):", Number(o.amount).toFixed(2).replace(".", ","))
                    if (raw === null) return
                    const fees = window.prompt("Taxas (R$):", Number(o.fees).toFixed(2).replace(".", ","))
                    if (fees === null) return
                    const quantity = window.prompt("Quantidade (deixe vazio se não informada):", o.quantity === null ? "" : String(o.quantity).replace(".", ","))
                    if (quantity === null) return
                    const date = window.prompt("Data (AAAA-MM-DD):", o.date)
                    if (date === null) return
                    setBusy(true)
                    try {
                      const updated = await api.editDetails(o.id, { amount: String(parseBrazilian(raw)), fees: String(parseBrazilian(fees)), quantity: quantity.trim() ? String(parseBrazilian(quantity)) : null, date: date.trim() })
                      setState(updated)
                      setMessage("Lançamento corrigido; carteira e movimentação bancária sincronizadas.")
                      window.dispatchEvent(new Event("ordefin-investments-changed"))
                    } catch (e) { setMessage("Não foi possível editar: " + String(e)) }
                    finally { setBusy(false) }
                  }}>Editar</button>
                  <button type="button" className="investment-operation-delete" disabled={busy} onClick={() => void deleteSingleOperation(o)}>Excluir</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {closed.length > 0 && <section className="panel">
        <h2>Investimentos encerrados</h2>
        {closed.map((p) => (
            <p key={p.key}>
              {p.asset.symbol} · resultado realizado {money(p.realized)} ·{" "}
              {p.operations.length} operações preservadas
            </p>
          ))}
      </section>}
    </div>
  )
}

function parseSafe(s: string) {
  try {
    return parseBrazilian(s)
  } catch {
    return "0"
  }
}

// O relógio e as cotações do painel global não são usados nesta tela.
// Evita renderizar o formulário inteiro a cada atualização do mercado.
export default memo(Investments, () => true)
