import { compactBRL } from "./investmentDisplay"
import { useState } from "react"
import { cashTimeline, decimal, assetKey, type State, type Position, type Operation } from "../shared/investments.mjs"

const money = (n: string | number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const percentText = (value: {toFixed: (places: number) => string} | null) => value === null ? "Indisponível" : `${value.toFixed(2)}%`
const quantityText = (value: {toFixed: (places: number) => string} | null) => value === null ? "Não informada" : Number(value.toFixed(8)).toLocaleString("pt-BR", {maximumFractionDigits:8})
const COLORS = ["#28a9e8", "#13a47b", "#a87ae8", "#e9b95c", "#f1767b", "#5fc5bf", "#7787e8"]

type PlotPoint = {date:string;value:number;cost:number}
function MarketEvolution({points, chartId, label}: {points:PlotPoint[];chartId:string;label:string}) {
  if (!points.length) return <div className="investment-chart-empty">Nenhuma cotação histórica disponível.</div>
  if (points.length === 1) return <div className="investment-chart-empty"><p>Uma cotação disponível em {points[0].date.split("-").reverse().join("/")}.</p><strong>{money(points[0].value)}</strong><small>É necessário obter preços de pelo menos duas datas para desenhar uma linha de evolução.</small></div>
  const max = Math.max(1,...points.flatMap(p=>[p.value,p.cost]))
  const minDate = Date.parse(points[0].date + "T00:00:00Z")
  const maxDate = Date.parse(points[points.length-1].date + "T00:00:00Z")
  const px = (p:PlotPoint,i:number) => 42 + ((Date.parse(p.date+"T00:00:00Z")-minDate)/Math.max(1,maxDate-minDate))*638
  const py = (n:number) => 185-(n/max)*153
  const trace = (key:"value"|"cost") => points.map((p,i)=>`${i ? "L":"M"}${px(p,i).toFixed(2)},${py(p[key]).toFixed(2)}`).join(" ")
  const area = `${trace("value")} L${px(points[points.length-1],points.length-1)},185 L42,185 Z`
  const gridValues = [0,.25,.5,.75,1]
  return <svg className="investment-modern-chart" viewBox="0 0 720 228" role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id={`${chartId}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00e69b" stopOpacity=".36"/><stop offset="100%" stopColor="#00e69b" stopOpacity=".015"/></linearGradient><filter id={`${chartId}-glow`} x="-15%" y="-40%" width="130%" height="180%"><feGaussianBlur stdDeviation="2"/></filter></defs>
    {gridValues.map((t,i)=><g key={i}><line x1="42" y1={py(t*max)} x2="680" y2={py(t*max)} stroke="#15526b" strokeOpacity=".7" strokeDasharray="2 3"/><text x="35" y={py(t*max)+4} fill="#b3cce0" fontSize="10" textAnchor="end">{compactBRL(t*max)}<title>{money(t*max)}</title></text></g>)}
    {[0,.25,.5,.75,1].map((t,i)=><line key={i} x1={42+t*638} y1="32" x2={42+t*638} y2="185" stroke="#16435c" strokeOpacity=".55" strokeDasharray="2 4"/>)}
    <path d={area} fill={`url(#${chartId}-fill)`}/>
    <path d={trace("cost")} fill="none" stroke="#ffca19" strokeWidth="2.1" strokeDasharray="7 5"/>
    <path d={trace("value")} fill="none" stroke="#00e8a1" strokeWidth="6" opacity=".2" filter={`url(#${chartId}-glow)`}/>
    <path d={trace("value")} fill="none" stroke="#00e8a1" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round"/>
    {[points[0],points[points.length-1]].map((p,i)=><circle key={i} cx={px(p,i)} cy={py(p.value)} r="4.5" fill="#00e8a1" stroke="#06293b" strokeWidth="2"><title>{p.date}: {money(p.value)} (aplicado: {money(p.cost)})</title></circle>)}
    <text x="42" y="213" fill="#b3cce0" fontSize="12">{points[0].date.split("-").reverse().join("/")}</text>
    <text x="680" y="213" textAnchor="end" fill="#b3cce0" fontSize="12">{points[points.length-1].date.split("-").reverse().join("/")}</text>
  </svg>
}

export default function InvestmentCharts({ state, positions, history, historyStatus, selectedAssetKey, assetHistories, onDeleteOperation, busy }: { onDeleteOperation: (op: Operation) => Promise<void>; busy: boolean; state: State; positions: Position[]; history: {date:string;cost:string;value:string}[]; historyStatus: string; selectedAssetKey: string; assetHistories: Record<string, {date:string;cost:string;value:string}[]> }) {
  const [selectedPurchase, setSelectedPurchase] = useState("")
  const timeline = cashTimeline(state.operations)
  const purchases = state.operations.filter(o => o.type === "buy" && (selectedAssetKey === "ALL" || assetKey(o.asset) === selectedAssetKey)).slice().sort((a,b) => a.date.localeCompare(b.date))
  const chosen = purchases.find(o => o.id === selectedPurchase) ?? purchases[0]
  const purchaseRows = purchases.map(op => {
    const position = positions.find(p => p.key === assetKey(op.asset))
    const cost = decimal(op.amount).plus(op.fees || 0)
    const quote = position?.quote?.price
    const qty = op.quantity == null ? null : decimal(op.quantity)
    // A sale changes lot allocation: do not claim the original quantity is still held.
    const hasSale = state.operations.some(o => o.type === "sell" && assetKey(o.asset) === assetKey(op.asset))
    const current = qty !== null && quote != null && !hasSale ? qty.mul(quote) : null
    const result = current !== null ? current.minus(cost) : null
    const percent = result !== null && cost.gt(0) ? result.div(cost).mul(100) : null
    return {op,position,cost,qty,current,result,percent,hasSale}
  })
  const selectedRow = purchaseRows.find(r => r.op.id === chosen?.id)
  const individualAssetHistory = selectedRow ? (assetHistories[assetKey(selectedRow.op.asset)] ?? []) : []
  const noSales = selectedRow ? !state.operations.some(o => o.type === "sell" && assetKey(o.asset) === assetKey(selectedRow.op.asset)) : false
  // Reconstruct daily market price from portfolio value and quantity held on that date.
  // Only valid for a single asset without sales, and only when every earlier buy has quantity.
  const selectedHistory = selectedRow && noSales && selectedRow.qty !== null
    ? individualAssetHistory.filter(h => h.date >= selectedRow.op.date).map(h => {
      const held = purchases.filter(o => assetKey(o.asset) === assetKey(selectedRow.op.asset) && o.date <= h.date).reduce((sum,o) => o.quantity == null ? sum : sum.plus(o.quantity), decimal(0))
      const complete = purchases.filter(o => assetKey(o.asset) === assetKey(selectedRow.op.asset) && o.date <= h.date).every(o => o.quantity != null)
      return complete && held.gt(0) ? {date:h.date, value:decimal(h.value).div(held).mul(selectedRow.qty!).toNumber()} : null
    }).filter((h): h is {date:string;value:number} => h !== null)
    : []
    const active = positions.filter((p) => !p.closed)
  const totalCost = active.reduce((s, p) => s.plus(p.cost), decimal(0))
  const fullyPriced = active.length > 0 && active.every((p) => p.value !== null)
  const totalValue = fullyPriced ? active.reduce((s, p) => s.plus(p.value ?? 0), decimal(0)) : null
  const result = totalValue !== null ? totalValue.minus(totalCost) : null

  const categories = [...new Set(active.map((p) => p.asset.category))]
  const slices = categories.map((category, i) => ({
    category,
    color: COLORS[i % COLORS.length],
    amount: active.filter((p) => p.asset.category === category).reduce((s, p) => s.plus(p.cost), decimal(0)),
  }))
  const observations = history.map(p => ({...p, time: Date.parse(p.date + "T00:00:00Z")}))
  const minTime = observations[0]?.time ?? 0
  const maxTime = observations.at(-1)?.time ?? minTime
  const maxVal = Math.max(1, ...observations.flatMap((p) => [Number(p.value), Number(p.cost)]))
  const x = (time: number) => 28 + ((time - minTime) / Math.max(1, maxTime - minTime)) * 652
  const y = (v: string) => 186 - Number(v) / maxVal * 155
  const pathFor = (field: "value" | "cost") => observations.map((p, i) => `${i ? "L" : "M"}${x(p.time)},${y(p[field])}`).join(" ")
  const valuePath = pathFor("value")
  const areaPath = observations.length >= 2 ? `${valuePath} L${x(maxTime)},186 L${x(minTime)},186 Z` : ""
  let offset = 0
  return (
    <>
      <section className="investment-charts investment-charts-overview">
        <article className="panel investment-visual-panel">
          <div className="investment-panel-heading"><h2>Evolução histórica do investimento</h2><small>Valor de mercado desde a primeira compra · cotações disponíveis</small></div>
          {observations.length >= 1 ? (
            <>
              <MarketEvolution points={observations.map(p=>({date:p.date,value:Number(p.value),cost:Number(p.cost)}))} chartId="portfolio-evolution" label="Evolução histórica da carteira e capital investido" />
              <p className="investment-legend"><span>● Valor avaliado</span><span>● Capital investido</span></p>
            </>
          ) : <div className="investment-chart-empty"><p>Aguardando histórico de preços desde a primeira compra.</p><small>{historyStatus || "Nenhuma cotação histórica foi encontrada."}</small></div>}
        </article>
        <article className="panel investment-visual-panel">
          <div className="investment-panel-heading"><h2>Distribuição por tipo de ativo</h2><small>Baseada no capital investido nas posições abertas</small></div>
          {totalCost.gt(0) ? (
            <div className="investment-donut-layout">
              <div className="investment-donut" role="img" aria-label={`Distribuição dos investimentos: ${slices.map(s => `${s.category} ${s.amount.div(totalCost).mul(100).toFixed(1)}%`).join(', ')}`}>
                <svg viewBox="0 0 200 200" aria-hidden="true">
                  <circle cx="100" cy="100" r="70" fill="none" stroke="#334b55" strokeWidth="32" />
                  {slices.map((s) => {
                    const percentage = s.amount.div(totalCost).mul(100).toNumber()
                    const start = offset
                    offset += percentage
                    return <circle key={s.category} cx="100" cy="100" r="70" fill="none" stroke={s.color} strokeWidth="32" strokeDasharray={`${percentage * 4.3982297} ${439.82297 - percentage * 4.3982297}`} strokeDashoffset={-start * 4.3982297} transform="rotate(-90 100 100)"><title>{s.category}: {percentage.toFixed(1)}%</title></circle>
                  })}
                  <text x="100" y="95" textAnchor="middle" fontSize="12" fill="currentColor">Total aplicado</text>
                  <text x="100" y="115" textAnchor="middle" fontSize="15" fontWeight="700" fill="currentColor">{compactBRL(totalCost.toString())}<title>{money(totalCost.toString())}</title></text>
                </svg>
              </div>
              <div className="investment-donut-legend investment-donut-legend-safe">{slices.map(s => <div key={s.category}><span className="investment-legend-dot" style={{ background: s.color }} /><span>{s.category}</span><strong title={`${s.category}: ${money(s.amount.toString())} · ${s.amount.div(totalCost).mul(100).toFixed(1)}%`}>{s.amount.div(totalCost).mul(100).toFixed(1).replace(".", ",")}%</strong></div>)}</div>
            </div>
          ) : <div className="investment-chart-empty"><p>Cadastre um investimento para visualizar a distribuição.</p></div>}
          {active.length > 0 && <details><summary>Distribuição por ativo</summary>{active.map((p) => <p className="investment-distribution-asset" key={p.key}><span>{p.asset.symbol}</span><strong title={money(p.cost)}>{compactBRL(p.cost)}</strong></p>)}</details>}
        </article>
      </section>
      <section className="panel investment-purchases" aria-label="Compras individuais">
        <div className="investment-panel-heading"><h2>Posições por ativo</h2><small>{purchases.length} compras registradas · {active.length} ativos em carteira</small></div>
        <div className="investment-asset-list">{(selectedAssetKey === "ALL" ? [] : active).map(p => <div className="investment-asset-row" key={p.key}><strong>{p.asset.symbol} · {p.asset.category}</strong><span>{p.operations.filter(o => o.type === "buy").length} compras · {quantityText(p.quantity === null ? null : decimal(p.quantity))} unidades</span><span>Aplicado: <span title={money(p.cost)}>{compactBRL(p.cost)}</span></span><span title={p.value === null ? undefined : money(p.value)}>Atual: {p.value === null ? "Indisponível" : compactBRL(p.value)}</span><strong title={p.result == null ? undefined : money(p.result)} className={p.result == null ? "" : Number(p.result) < 0 ? "investment-negative" : "investment-positive"}>{p.result == null ? "Sem avaliação" : compactBRL(p.result)}<small className="investment-asset-percent">{p.result !== null && decimal(p.cost).gt(0) ? `${decimal(p.result).div(p.cost).mul(100).toFixed(2)}%` : ""}</small></strong></div>)}</div>
        <h3 className="investment-detail-title">{selectedAssetKey === "ALL" ? "Detalhamento de todas as compras" : `Detalhamento das compras (${active[0]?.asset.symbol ?? ""})`}</h3>        <div className="investment-table investment-purchases-table"><table><thead><tr><th>#</th><th>Data da compra</th><th>Ativo</th><th>Valor aplicado</th><th>Cotação da compra</th><th>Quantidade adquirida</th><th>Valor atual estimado</th><th>Lucro / prejuízo</th><th>Rentabilidade</th><th>Ações</th></tr></thead><tbody>{purchaseRows.map((r, index) => <tr key={r.op.id} className={chosen?.id === r.op.id ? "investment-selected-row" : ""} onClick={() => setSelectedPurchase(r.op.id)}><td>{index + 1}</td><td><button className="investment-row-select" type="button" onClick={() => setSelectedPurchase(r.op.id)}>{r.op.date.split("-").reverse().join("/")}</button></td><td>{r.op.asset.symbol}</td><td><span title={money(r.cost.toString())}>{compactBRL(r.cost.toString())}</span></td><td title={r.op.purchaseQuote?.price ? money(r.op.purchaseQuote.price) : undefined}>{r.op.purchaseQuote?.price ? compactBRL(r.op.purchaseQuote.price) : "Não informada"}</td><td>{quantityText(r.qty)}</td><td title={r.current === null ? undefined : money(r.current.toString())}>{r.current === null ? "Indisponível" : compactBRL(r.current.toString())}</td><td className={r.result === null ? "" : r.result.lt(0) ? "investment-negative" : "investment-positive"} title={r.result === null ? undefined : money(r.result.toString())}>{r.result === null ? "Indisponível" : compactBRL(r.result.toString())}</td><td className={r.percent === null ? "" : r.percent.lt(0) ? "investment-negative" : "investment-positive"}>{r.percent === null ? "Indisponível" : `${r.percent.toFixed(2)}%`}</td><td><button type="button" className="investment-operation-delete" disabled={busy} onClick={e => { e.stopPropagation(); void onDeleteOperation(r.op) }}>Excluir compra</button></td></tr>)}</tbody></table></div>
        {purchaseRows.some(r => r.hasSale) && <p className="investment-hint">Há vendas registradas. A rentabilidade por compra exige alocação das quantidades vendidas; os valores individuais são ocultados para evitar resultados incorretos.</p>}
        <div className="investment-purchase-detail">
          <div className="investment-purchase-graph"><div className="investment-panel-heading"><h2>Gráfico por compra</h2><label>Selecionar compra<select value={chosen?.id ?? ""} onChange={e => setSelectedPurchase(e.target.value)}>{purchases.map((op,i) => <option key={op.id} value={op.id}>{i+1} · {op.asset.symbol} · {op.date.split("-").reverse().join("/")}</option>)}</select></label></div>
          {selectedHistory.length ? <MarketEvolution points={selectedHistory.map(p=>({date:p.date,value:p.value,cost:Number(selectedRow?.cost ?? 0)}))} chartId="purchase-evolution" label="Evolução histórica da compra selecionada e capital aplicado" /> : <div className="investment-chart-empty"><p>Histórico diário desta compra indisponível.</p><small>{historyStatus || "As fontes ainda não forneceram cotações para duas datas distintas."}</small></div>}
          <p className="investment-legend"><span>● Valor de mercado</span><span>● Capital investido</span></p></div>
          <div className="investment-purchase-metrics"><h2>Resumo da compra selecionada</h2>{selectedRow && <div className="investment-purchase-metrics-grid"><div><small>Ativo e data</small><strong>{selectedRow.op.asset.symbol} · {selectedRow.op.date.split("-").reverse().join("/")}</strong></div><div><small>Valor aplicado</small><strong><span title={money(selectedRow.cost.toString())}>{compactBRL(selectedRow.cost.toString())}</span></strong></div><div><small>Quantidade adquirida</small><strong>{quantityText(selectedRow.qty)}</strong></div><div><small>Cotação da compra</small><strong title={selectedRow.op.purchaseQuote?.price ? money(selectedRow.op.purchaseQuote.price) : undefined}>{selectedRow.op.purchaseQuote?.price ? compactBRL(selectedRow.op.purchaseQuote.price) : "Não informada"}</strong></div><div><small>Valor atual estimado</small><strong title={selectedRow.current === null ? undefined : money(selectedRow.current.toString())}>{selectedRow.current === null ? "Indisponível" : compactBRL(selectedRow.current.toString())}</strong></div><div><small>Lucro / prejuízo</small><strong className={selectedRow.result?.lt(0) ? "investment-negative" : "investment-positive"} title={selectedRow.result === null ? undefined : money(selectedRow.result.toString())}>{selectedRow.result === null ? "Indisponível" : compactBRL(selectedRow.result.toString())}</strong></div><div><small>Rentabilidade</small><strong className={selectedRow.percent?.lt(0) ? "investment-negative" : "investment-positive"}>{selectedRow.percent === null ? "Indisponível" : `${selectedRow.percent.toFixed(2)}%`}</strong></div></div>}</div>
        </div>
      </section>
      <section className="panel"><h2>Aportes acumulados</h2><p>Os aportes representam dinheiro aplicado, não lucro ou valorização.</p><details><summary>Ver aportes por data</summary>{timeline.map((p) => <p key={p.date}>{p.date} · aportes {money(p.contributions)} · vendas líquidas {money(p.withdrawals)}</p>)}</details></section>
    </>
  )
}
