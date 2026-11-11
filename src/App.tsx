import { currencyInput } from "../shared/investments.mjs";
import Investments from "./Investments";
import Wallet from "./Wallet";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";

type TransactionType = "Cartão" | "Empréstimo" | "Conta fixa";
type Transaction = {
  id: number;
  description: string;
  category: string;
  type: TransactionType;
  amount: number;
  date: string;
  kind?: "receita" | "despesa";
  account_id?: number | null;
  card_id?: number | null;
  debit_card_id?: number | null;
  paid?: number;
};

type BtcSnapshot = { price: number; time: number };

type Signal = {trend:string; action:string; reason:string; rsi:number; macd:number; sma20:number; sma50:number; updated:number};
function calculateSignal(candles: number[][]): Signal | null {
  if (candles.length < 60) return null;
  const close=candles.map(c=>Number(c[4]));
  if(close.some(x=>!Number.isFinite(x)||x<=0))return null;
  const avg=(n:number)=>close.slice(-n).reduce((a,b)=>a+b,0)/n;
  const ema=(n:number)=>{const k=2/(n+1);let value=close[0];return close.map(x=>(value=x*k+value*(1-k)));};
  const fast=ema(12),slow=ema(26), macdLine=fast.map((v,i)=>v-slow[i]);
  let signalLine=macdLine[0]; for(const v of macdLine)signalLine=v*(2/10)+signalLine*(8/10);
  const macd=macdLine[macdLine.length-1]-signalLine;
  let gains=0,losses=0;for(let i=close.length-14;i<close.length;i++){const d=close[i]-close[i-1];gains+=Math.max(d,0);losses+=Math.max(-d,0);}
  const rsi=losses===0?100:100-100/(1+gains/losses);
  const sma20=avg(20),sma50=avg(50),last=close[close.length-1];
  const trend=last>sma20&&sma20>sma50?'Alta':last<sma20&&sma20<sma50?'Baixa':'Lateral / indefinida';
  let action='AGUARDAR',reason='Os indicadores ainda não mostram confirmação suficiente.';
  if(rsi<35&&macd>0){action='AVALIAR COMPRA';reason='Preço pressionado para baixo e sinais iniciais de recuperação. Ainda pode cair.';}
  else if(trend==='Alta'&&macd>0&&rsi>=35&&rsi<68){action='AVALIAR COMPRA';reason='Tendência de alta confirmada por médias e impulso positivo; não significa preço barato.';}
  else if(rsi>70&&macd<0){action='AVALIAR VENDA';reason='Preço esticado e impulso perdendo força; uma correção é possível.';}
  else if(trend==='Baixa'&&macd<0){action='AVALIAR VENDA';reason='Tendência de baixa e impulso negativo. Se não possui a moeda, evite interpretar como ordem de venda.';}
  else if(rsi<35){reason='Preço em possível sobrevenda, mas ainda sem confirmação de recuperação.';}
  else if(rsi>70){reason='Preço em possível sobrecompra, mas a alta pode continuar.';}
  return {trend,action,reason,rsi,macd,sma20,sma50,updated:Date.now()};
}

const categoryColors: Record<string, string> = {
  Moradia: "#6c5ce7",
  Alimentação: "#f59e0b",
  Transporte: "#20b486",
  Saúde: "#ef6a77",
  Outros: "#94a3b8",
};

const typeColors: Record<TransactionType, string> = {
  Cartão: "#6c5ce7",
  Empréstimo: "#f59e0b",
  "Conta fixa": "#20b486",
};

const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const monthNamesLong = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const formatMoney = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

// Valores brasileiros: 1.500 = mil e quinhentos; 1.500,50 = mil e quinhentos e cinquenta.
// Também aceita 1500, 1500.50 e 1,500.50 (formato internacional).
function parseBRL(value: FormDataEntryValue | null): number {
  const raw = String(value ?? '').trim().replace(/\s|R\$/gi, '');
  if (!raw || !/^[+-]?[\d.,]+$/.test(raw)) return NaN;
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  let normalized: string;
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if (comma >= 0) {
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (dot >= 0) {
    const parts = raw.split('.');
    normalized = parts.length > 2 || (parts.length === 2 && parts[1].length === 3)
      ? raw.replace(/\./g, '') : raw;
  } else normalized = raw;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : NaN;
}

const formatBtc = (value: number) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 8, maximumFractionDigits: 8 }).format(value);

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18" /></>,
    bitcoin: <><circle cx="12" cy="12" r="9" /><path d="M9 7h4.2a2.3 2.3 0 0 1 0 4.6H9m0 0h4.8a2.4 2.4 0 0 1 0 4.8H9m2-11v13m3-13v2m0 9v2" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrowUp: <path d="m6 15 6-6 6 6" />,
    arrowDown: <path d="m6 9 6 6 6-6" />,
    wallet: <><path d="M4 6.5h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2h12" /><path d="M15 11h5v4h-5a2 2 0 0 1 0-4Z" /></>,
    chart: <><path d="M4 19V9m6 10V5m6 14v-7m4 7H2" /></>,
    refresh: <><path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9m16 6-2 2.5A7 7 0 0 1 5.5 15" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></>,
    spark: <path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2Zm7 13 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" />,
  };

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function MiniChart({ values, positive = true }: { values: number[]; positive?: boolean }) {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) return <div role="status" style={{padding: 16, color: "#84908b", fontSize: 13}}>Histórico insuficiente: aguardando novas cotações reais.</div>;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${32 - ((value - min) / (max - min || 1)) * 25}`).join(" ");
  return (
    <svg className={`mini-chart ${positive ? "positive" : "negative"}`} viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

function CryptoHistoryChart({ values, positive, currency, mode }: { values: number[]; positive: boolean; currency: 'BRL' | 'USD'; mode: 'line' | 'area' }) {
  if (values.length < 2 || values.some(v => !Number.isFinite(v))) return <div role="status" className="crypto-chart-message">Histórico insuficiente: aguardando novas cotações reais.</div>;
  const low = Math.min(...values), high = Math.max(...values);
  const range = high - low || Math.abs(high) * .01 || 1;
  const bottom = low - range * .08, top = high + range * .08;
  const x0 = 82, x1 = 982, y0 = 18, y1 = 246;
  const coords = values.map((v,i) => [x0 + i/(values.length-1)*(x1-x0), y1 - (v-bottom)/(top-bottom)*(y1-y0)]);
  const line = coords.map(([x,y],i) => `${i===0?'M':'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${x1},${y1} L${x0},${y1} Z`;
  const ticks = Array.from({length:5},(_,i)=>top-(top-bottom)*i/4);
  const format = (v:number) => new Intl.NumberFormat('pt-BR',{maximumFractionDigits:currency==='USD'?2:0}).format(v);
  const stroke = '#ff596b'; // Identidade visual vermelha do histórico; dados reais preservados.
  return <svg className="crypto-history-svg" viewBox="0 0 1000 275" preserveAspectRatio="none" role="img" aria-label={`Gráfico de cotação ${currency}, ${positive?'em alta':'em queda'}`}>
    <defs><linearGradient id="crypto-area-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={stroke} stopOpacity={mode==='area'?.32:0}/><stop offset="100%" stopColor={stroke} stopOpacity="0"/></linearGradient></defs>
    {ticks.map((v,i)=><g key={i}><line x1={x0} x2={x1} y1={y0+i*(y1-y0)/4} y2={y0+i*(y1-y0)/4} stroke="currentColor" opacity=".12"/><text x={x0-12} y={y0+i*(y1-y0)/4+4} textAnchor="end" fill="currentColor" opacity=".65" fontSize="13">{format(v)}</text></g>)}
    {Array.from({length:7},(_,i)=><line key={i} x1={x0+i*(x1-x0)/6} x2={x0+i*(x1-x0)/6} y1={y0} y2={y1} stroke="currentColor" opacity=".07"/>)}
    <path d={area} fill="url(#crypto-area-fill)"/><path d={line} fill="none" stroke={stroke} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
    <circle cx={coords[coords.length-1][0]} cy={coords[coords.length-1][1]} r="4.5" fill={stroke}/>
    {Array.from({length:5},(_,i)=><text key={i} x={x0+i*(x1-x0)/4} y="269" textAnchor={i===0?'start':i===4?'end':'middle'} fill="currentColor" opacity=".6" fontSize="12">{i===0?'Início':i===4?'Agora':`${Math.round(i*25)}%`}</text>)}
  </svg>;
}

function DonutChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let progress = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 42 42" className="donut" aria-label="Distribuição de despesas">
        <circle cx="21" cy="21" r="15.9" className="donut-base" />
        {data.map((item) => {
          const portion = total ? (item.value / total) * 100 : 0;
          const dashOffset = 25 - progress;
          progress += portion;
          return <circle key={item.label} cx="21" cy="21" r="15.9" stroke={item.color} strokeDasharray={`${portion} ${100 - portion}`} strokeDashoffset={dashOffset} className="donut-segment" />;
        })}
      </svg>
      <div className="donut-center"><strong>{data.length}</strong><span>categorias</span></div>
    </div>
  );
}

function AnnualBarChart({ transactions }: { transactions: Transaction[] }) {
  const months = monthNames.map((label, month) => {
    const entries = transactions.filter((item) => item.kind !== "receita" && new Date(`${item.date}T12:00:00`).getMonth() === month);
    const byType = (["Cartão", "Empréstimo", "Conta fixa"] as TransactionType[]).map((type) => ({
      type,
      value: entries.filter((item) => item.type === type).reduce((sum, item) => sum + item.amount, 0),
    }));
    return { label, total: byType.reduce((sum, item) => sum + item.value, 0), byType };
  });
  const max = Math.max(...months.map((month) => month.total), 1);
  return (
    <div className="annual-chart" aria-label="Despesas mensais por tipo">
      {months.map((month) => (
        <div className="month-column" key={month.label}>
          <span className="bar-value">{month.total ? formatMoney(month.total).replace("R$", "").trim() : "—"}</span>
          <div className="bar-track">
            {month.byType.map((item) => (
              <i key={item.type} style={{ height: `${(item.value / max) * 100}%`, background: typeColors[item.type] }} title={`${item.type}: ${formatMoney(item.value)}`} />
            ))}
          </div>
          <span>{month.label}</span>
        </div>
      ))}
    </div>
  );
}

function localDateForInput(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const incomeOrigins = ["Salário", "Trabalho extra", "Rendimento de investimento", "Venda", "Presente / Doação", "Reembolso", "Outras receitas"];

function Modal({ onClose, onSave, onManageCards, accounts, cards, editing, categories }: { accounts: FinoraAccount[]; cards: OrdefinCard[]; categories: string[]; editing?: Transaction | null; onClose: () => void; onManageCards: () => void; onSave: (transaction: Omit<Transaction, "id">) => void }) {
  const today = localDateForInput();
  // Controlled fields keep user input stable while the modal is open.
  const [descriptionValue, setDescriptionValue] = useState(editing?.description ?? "");
  const [kindValue, setKindValue] = useState<"receita" | "despesa">(editing?.kind ?? "despesa");
  const [categoryValue, setCategoryValue] = useState(editing?.category ?? "");
  const [amountValue, setAmountValue] = useState(editing ? editing.amount.toLocaleString("pt-BR", {minimumFractionDigits: 2, maximumFractionDigits: 2}) : "");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      description: String(form.get("description")),
      category: String(form.get("category")),
      type: form.get("type") as TransactionType,
      amount: parseBRL(form.get("amount")),
      date: String(form.get("date")),
      kind: form.get("kind") === "receita" ? "receita" : "despesa",
      account_id: form.get('payment_card')&&String(form.get('payment_card')).startsWith('d')?cards.find(c=>c.id===Number(String(form.get('payment_card')).slice(1)))?.account_id??null:(form.get('payment_card')?null:(form.get('account_id')?Number(form.get('account_id')):null)),
      card_id:form.get('kind')==='despesa'&&String(form.get('payment_card')||'').startsWith('c')?Number(String(form.get('payment_card')).slice(1)):null,
      debit_card_id:form.get('kind')==='despesa'&&String(form.get('payment_card')||'').startsWith('d')?Number(String(form.get('payment_card')).slice(1)):null,
    });
  };
  return (
    <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><span className="eyebrow">{editing ? "Corrigir registro" : "Novo registro"}</span><h2 id="modal-title">{editing ? "Editar lançamento" : "Adicionar lançamento"}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button>
        </div>
        <form className="launch-form" onSubmit={submit}><div className="modal-scroll"><label>Pagamento com cartão<select name="payment_card" defaultValue={editing?.debit_card_id?`d${editing.debit_card_id}`:editing?.card_id?`c${editing.card_id}`:''}><option value="">Sem cartão</option>{cards.flatMap(c=>[...(c.card_mode!=='debito'?[<option key={'c'+c.id} value={'c'+c.id}>{c.name} — Crédito ({formatMoney(c.available)})</option>]:[]),...(c.card_mode!=='credito'?[<option key={'d'+c.id} value={'d'+c.id}>{c.name} — Débito (conta vinculada)</option>]:[])])}</select></label>{cards.length === 0 && <div className="launch-card-empty" role="status"><span>Nenhum cartão cadastrado. Para pagar com cartão, cadastre um na tela Contas. Para movimentar uma conta bancária sem cartão, use o campo Conta vinculada abaixo.</span><button type="button" className="button secondary" onClick={onManageCards}>Cadastrar cartão</button></div>}<p style={{fontSize:12,opacity:.8}}>Débito desconta o saldo da conta vinculada; crédito reduz o limite. Para cartões múltiplos, escolha a função na compra.</p><label>Conta vinculada <select name="account_id" defaultValue={editing?.account_id ?? ""}><option value="">Sem conta (não altera saldo)</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>Descrição<input name="description" type="text" value={descriptionValue} onChange={event => setDescriptionValue(event.target.value)} placeholder="Ex.: Conta de água" autoComplete="off" required /></label>
          <label>Movimentação<select name="kind" value={kindValue} onChange={event => { const next = event.target.value as "receita" | "despesa"; setKindValue(next); setCategoryValue(current => (next === "receita" && !current ? "Salário" : current)); }}><option value="despesa">Despesa</option><option value="receita">Receita</option></select></label>
          <div className="field-row">
            <label>Valor<input name="amount" value={amountValue} onChange={event => setAmountValue(currencyInput(event.target.value))} type="text" inputMode="decimal" autoComplete="off" placeholder="0,00" required /></label>
            <label>Data<input name="date" type="date" defaultValue={editing?.date ?? today} required /></label>
          </div>
          <div className="field-row">
            <label>{kindValue === "receita" ? "Origem da receita" : "Categoria"}<input name="category" type="text" list={kindValue === "receita" ? "ordefin-income-origins" : "ordefin-category-suggestions"} value={categoryValue} onChange={event => setCategoryValue(event.target.value)} placeholder={kindValue === "receita" ? "Ex.: Salário, trabalho extra..." : "Digite a categoria (ex.: Água)"} maxLength={45} autoComplete="off" required /><datalist id="ordefin-income-origins">{incomeOrigins.map(origin => <option key={origin} value={origin} />)}</datalist><datalist id="ordefin-category-suggestions">{Array.from(new Set([...categories, ...(editing?.category ? [editing.category] : [])])).map(category => <option key={category} value={category} />)}</datalist></label>
            <label>Tipo<select name="type" defaultValue={editing?.type ?? "Cartão"}><option>Cartão</option><option>Empréstimo</option><option>Conta fixa</option></select></label>
          </div>
          </div><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" type="submit"><Icon name="check" size={18} /> {editing ? "Salvar alterações" : "Salvar lançamento"}</button></div>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [appearance, setAppearance] = useState<"system" | "light" | "dark">(() => {
    const saved = localStorage.getItem("ordefin-appearance");
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    localStorage.setItem("ordefin-appearance", appearance);
    document.documentElement.dataset.theme = appearance === "system" ? (systemDark ? "dark" : "light") : appearance;
  }, [appearance, systemDark]);
  const [activeTab, setActiveTab] = useState<"dashboard" | "transactions" | "bitcoin" | "accounts" | "investments" | "wallet" | "settings">("dashboard");
  const [categories,setCategories] = useState<string[]>(()=>{try {const v=JSON.parse(localStorage.getItem('ordefin-categories')||'null');return Array.isArray(v)&&v.every(x=>typeof x==='string')?v:['Moradia','Alimentação','Transporte','Saúde','Salário','Outros'];}catch{return ['Moradia','Alimentação','Transporte','Saúde','Salário','Outros'];}});
  const [newCategory,setNewCategory] = useState('');
  const [settingsMessage,setSettingsMessage] = useState('');
  useEffect(()=>{localStorage.setItem('ordefin-categories',JSON.stringify(categories));},[categories]);
  const [period, setPeriod] = useState("Ano inteiro");
  // Ano financeiro é apenas um filtro de visualização: não altera saldos nem registros.
  const [financialYear, setFinancialYear] = useState<number>(() => new Date().getFullYear());
  // Anos adicionados manualmente são preferências de navegação, nunca registros financeiros.
  const [extraFinancialYears, setExtraFinancialYears] = useState<number[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("ordefin-extra-financial-years") || "[]");
      return Array.isArray(saved) ? saved.filter((year): year is number => typeof year === "number" && Number.isInteger(year) && year >= 1900 && year <= 2200) : [];
    } catch { return []; }
  });
  useEffect(() => { localStorage.setItem("ordefin-extra-financial-years", JSON.stringify(extraFinancialYears)); }, [extraFinancialYears]);
  const addFinancialYear = () => {
    // O Electron pode bloquear diálogos nativos como window.prompt().
    // Acrescenta diretamente o próximo ano futuro disponível.
    const current = new Date().getFullYear();
    const lastYear = Math.max(current + 5, ...extraFinancialYears);
    if (lastYear >= 2200) return;
    const nextYear = lastYear + 1;
    setExtraFinancialYears((previous) => previous.includes(nextYear) ? previous : [...previous, nextYear]);
    setFinancialYear(nextYear);
  };
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem("finora-transactions");
    return saved ? JSON.parse(saved) : [];
  });
  const [accounts, setAccounts] = useState<FinoraAccount[]>([]);
  const [cards, setCards] = useState<OrdefinCard[]>([]);
  const [cardMessage, setCardMessage] = useState("");
  const [transfers, setTransfers] = useState<FinoraTransfer[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [btc, setBtc] = useState<{ price: number; change: number; updated: Date } | null>(null);
  const [btcHistory, setBtcHistory] = useState<BtcSnapshot[]>(() => {
    const saved = localStorage.getItem("finora-btc-history");
    return saved ? JSON.parse(saved) : [];
  });
  const [btcError, setBtcError] = useState(false);
  const [btcLastChecked, setBtcLastChecked] = useState<Date | null>(null);
  const [btcLoading, setBtcLoading] = useState(false);
  const [btcSource, setBtcSource] = useState<"Binance" | null>(null);
  const [btcLive, setBtcLive] = useState(false);
  const [btcClock, setBtcClock] = useState(Date.now());
  const btcSocketPrice = useRef<{price: number; time: number} | null>(null);
  const btcSocketConnected = useRef(false);
  const btcLastMessageAt = useRef(0);
  const btcLatest = useRef<{price: number; change: number; updated: Date} | null>(null);
  const btcLastSaved = useRef(0);
  const btcChange = useRef<number | null>(null);
  const [marketPairs, setMarketPairs] = useState<{symbol:string;baseAsset:string;quoteAsset:string}[]>([]);
  const [marketQuotes, setMarketQuotes] = useState<Record<string,{price:number;change:number;updated:number}>>({});
  const [marketSearch, setMarketSearch] = useState("");
  const [marketQuoteFilter, setMarketQuoteFilter] = useState("BRL");
  const [marketSelected, setMarketSelected] = useState("BTCBRL");
  const [marketFavorites, setMarketFavorites] = useState<string[]>(() => {
    try { const data = JSON.parse(localStorage.getItem("ordefin-market-favorites") || "[]"); return Array.isArray(data) ? data : []; } catch { return []; }
  });
  const [marketOnlyFavorites, setMarketOnlyFavorites] = useState(false);
  const [marketStatus, setMarketStatus] = useState("Carregando mercado...");
  const [marketClock, setMarketClock] = useState(Date.now());
  useEffect(() => { localStorage.setItem("ordefin-market-favorites", JSON.stringify(marketFavorites)); }, [marketFavorites]);
  useEffect(() => {
    let alive = true;
    let ws: WebSocket | null = null;
    let reconnect: number | undefined;
    let retry = 2000;
    let lastEvent = 0;
    let initialLoaded = false;
    const pending: Record<string,{price:number;change:number;updated:number}> = {};
    const endpoint = "https://data-api.binance.vision/api/v3";
    const load = async () => {
      try {
        const [infoResponse, tickerResponse] = await Promise.all([
          fetch(endpoint + "/exchangeInfo", {cache:"no-store"}),
          fetch(endpoint + "/ticker/24hr?type=FULL", {cache:"no-store"})
        ]);
        if (!infoResponse.ok || !tickerResponse.ok) throw new Error("Falha na consulta inicial");
        const info = await infoResponse.json();
        const tickers = await tickerResponse.json();
        if (!alive) return;
        const pairs = (info.symbols || []).filter((x: any) => x.status === "TRADING" && x.isSpotTradingAllowed !== false && (x.permissionSets?.some((set: string[]) => set.includes("SPOT")) || x.permissions?.includes("SPOT")))
          .map((x: any) => ({symbol:String(x.symbol),baseAsset:String(x.baseAsset),quoteAsset:String(x.quoteAsset)}));
        setMarketPairs(pairs);
        const allowed = new Set(pairs.map((x:{symbol:string})=>x.symbol));
        const initial: Record<string,{price:number;change:number;updated:number}> = {};
        for (const t of tickers) {
          const price = Number(t.lastPrice), change = Number(t.priceChangePercent);
          if (allowed.has(t.symbol) && price > 0 && Number.isFinite(change)) initial[t.symbol] = {price,change,updated:Number(t.closeTime)||Date.now()};
        }
        setMarketQuotes(initial);
        initialLoaded = true;
      } catch { if (alive) setMarketStatus("Falha na consulta inicial · tentando reconectar"); }
    };
    const connect = () => {
      if (!alive) return;
      try {
        ws = new WebSocket("wss://data-stream.binance.vision:443/ws/!ticker@arr");
        ws.onopen = () => {retry=2000;setMarketStatus("Binance conectada · aguardando atualizações");};
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (!Array.isArray(payload)) return;
            const now = Date.now();
            for (const t of payload) {
              const price = Number(t.c), change = Number(t.P);
              if (t.s && price > 0 && Number.isFinite(change)) pending[t.s] = {price,change,updated:Number(t.E)||now};
            }
            lastEvent = now;
          } catch { /* mensagem inválida */ }
        };
        ws.onclose = () => {
          if (!alive) return;
          setMarketStatus("Desconectado · reconectando...");
          reconnect = window.setTimeout(connect,retry);
          retry=Math.min(retry*2,30000);
        };
        ws.onerror = () => ws?.close();
      } catch {reconnect=window.setTimeout(connect,retry);retry=Math.min(retry*2,30000);}
    };
    void load(); connect();
    const timer = window.setInterval(() => {
      const changes = Object.entries(pending);
      if (changes.length) {
        for (const key of Object.keys(pending)) delete pending[key];
        setMarketQuotes(old => ({...old,...Object.fromEntries(changes)}));
      }
      const now=Date.now();setMarketClock(now);
      if (ws?.readyState === WebSocket.OPEN) setMarketStatus(lastEvent && now-lastEvent<20000 ? "Binance · atualizando ao vivo" : "Binance conectada · aguardando negociações");
    },1000);
    const refresh = window.setInterval(() => {if (!initialLoaded || ws?.readyState !== WebSocket.OPEN) void load();},120000);
    return () => {alive=false;ws?.close();window.clearTimeout(reconnect);window.clearInterval(timer);window.clearInterval(refresh);};
  }, []);
  const marketFiltered = useMemo(() => marketPairs.filter(pair =>
    (marketQuoteFilter === "TODAS" || pair.quoteAsset === marketQuoteFilter) &&
    (!marketOnlyFavorites || marketFavorites.includes(pair.symbol)) &&
    (`${pair.symbol} ${pair.baseAsset} ${pair.quoteAsset}`.toLowerCase().includes(marketSearch.trim().toLowerCase()))
  ).sort((a,b) => Number(marketFavorites.includes(b.symbol))-Number(marketFavorites.includes(a.symbol)) || a.symbol.localeCompare(b.symbol)), [marketPairs,marketQuoteFilter,marketOnlyFavorites,marketFavorites,marketSearch]);
  const marketCurrentPair = marketPairs.find(p => p.symbol === marketSelected);
  const marketCurrentPrice = marketQuotes[marketSelected];
  const quickCryptoCoins = [
    {symbol:'BTC',name:'Bitcoin',color:'#f7931a',dark:'#493015'},
    {symbol:'ETH',name:'Ethereum',color:'#627eea',dark:'#25335e'},
    {symbol:'SOL',name:'Solana',color:'#14f195',dark:'#123e37'},
    {symbol:'BNB',name:'BNB',color:'#f3ba2f',dark:'#493c19'},
    {symbol:'XRP',name:'XRP',color:'#c7d0db',dark:'#2a3643'},
    {symbol:'ADA',name:'Cardano',color:'#3468d1',dark:'#20385e'},
    {symbol:'DOGE',name:'Dogecoin',color:'#c2a633',dark:'#48401c'},
    {symbol:'TRX',name:'TRON',color:'#eb0029',dark:'#4e2029'},
    {symbol:'AVAX',name:'Avalanche',color:'#e84142',dark:'#51272b'},
    {symbol:'DOT',name:'Polkadot',color:'#e6007a',dark:'#51213d'},
    {symbol:'LTC',name:'Litecoin',color:'#345d9d',dark:'#233953'},
    {symbol:'LINK',name:'Chainlink',color:'#2a5ada',dark:'#22375f'},
  ];
  const selectedCoinSymbol = marketCurrentPair?.baseAsset || (marketSelected.endsWith('BRL') ? marketSelected.slice(0,-3) : 'BTC');
  const selectedCoinTheme = quickCryptoCoins.find(c=>c.symbol===selectedCoinSymbol) || {symbol:selectedCoinSymbol,name:selectedCoinSymbol,color:'#6f92b6',dark:'#223548'};
  const quickCoinPrice = marketCurrentPrice?.price || (marketSelected==='BTCBRL' ? btc?.price : undefined);
  const quickCoinChange = marketCurrentPrice?.change ?? (marketSelected==='BTCBRL' ? btc?.change : undefined);
  const quickCoinUpdated = marketCurrentPrice?.updated || (marketSelected==='BTCBRL' ? btc?.updated.getTime() : undefined);

  const marketFormat = (price:number,quote:string) => quote === "BRL" ? new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:price<1?8:2}).format(price) : new Intl.NumberFormat("pt-BR",{maximumFractionDigits:price<1?10:6}).format(price)+" "+quote;
  const [analysisPeriod,setAnalysisPeriod] = useState('4h');
  const [analysis,setAnalysis] = useState<Signal|null>(null);
  const [analysisError,setAnalysisError] = useState('');
  const [analysisLoading,setAnalysisLoading] = useState(false);
  // Compra registrada em reais: o preço histórico nunca é substituído pela cotação atual.
  type CryptoPurchase = { investedBRL:number; buyPrice:number; buyCurrency:'BRL'|'USD'; buyFxBRL:number; quantity:number; date:string; savedAt:number };
  const [cryptoPurchases,setCryptoPurchases] = useState<Record<string,CryptoPurchase>>(()=>{
    try {const raw=JSON.parse(localStorage.getItem('ordefin-crypto-purchases-v22')||'{}');return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};}catch{return {};}
  });
  useEffect(()=>{localStorage.setItem('ordefin-crypto-purchases-v22',JSON.stringify(cryptoPurchases));},[cryptoPurchases]);
  const [purchaseCurrency,setPurchaseCurrency] = useState<'BRL'|'USD'>('BRL');
  useEffect(()=>{setPurchaseCurrency(cryptoPurchases[marketSelected]?.buyCurrency||'BRL');},[marketSelected]);
  const [purchaseError,setPurchaseError] = useState('');
  const currentPurchase=cryptoPurchases[marketSelected];
  // Prefere o preço BRL direto da mesma moeda. Caso contrário, converte pela cotação
  // negociada da moeda de referência, sem equiparar USDT/USDC ao dólar.
  const brlDirect = marketCurrentPair ? marketQuotes[marketCurrentPair.baseAsset+'BRL'] : undefined;
  const quoteBRL = marketCurrentPair?.quoteAsset==='BRL' ? undefined : marketQuotes[(marketCurrentPair?.quoteAsset||'')+'BRL'];
  const marketBRLPrice = marketCurrentPair && (brlDirect || marketCurrentPrice) &&
    (marketCurrentPair.quoteAsset==='BRL'||brlDirect||quoteBRL) ?
    (marketCurrentPair.quoteAsset==='BRL'?marketCurrentPrice.price:brlDirect?.price??(quoteBRL?marketCurrentPrice.price*quoteBRL.price:null)) : null;
  const brlSource = marketCurrentPair?.quoteAsset==='BRL' ? marketSelected : brlDirect ? marketCurrentPair?.baseAsset+'BRL' : quoteBRL ? marketSelected+' × '+marketCurrentPair?.quoteAsset+'BRL' : '';
  const brlUpdated = marketCurrentPair?.quoteAsset==='BRL'?marketCurrentPrice?.updated:brlDirect?.updated??Math.min(marketCurrentPrice?.updated??0,quoteBRL?.updated??0);
  const marketBRLFresh = marketBRLPrice!==null && Number.isFinite(marketBRLPrice) && marketBRLPrice>0 && !!brlUpdated && marketClock-brlUpdated<120000;
  const currentInvestmentValue = currentPurchase && marketBRLFresh && marketBRLPrice!==null ? currentPurchase.quantity*marketBRLPrice : null;
  const currentInvestmentResult = currentInvestmentValue===null||!currentPurchase?null:currentInvestmentValue-currentPurchase.investedBRL;
  useEffect(()=>{
    let alive=true;const controller=new AbortController();
    const load=async()=>{setAnalysis(null);setAnalysisError('');setAnalysisLoading(true);
      try{const response=await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(marketSelected)}&interval=${analysisPeriod}&limit=150`,{signal:controller.signal,cache:'no-store'});
        if(!response.ok)throw new Error('Histórico indisponível para este par');
        const data=await response.json();const result=calculateSignal(data.slice(0,-1));
        if(!result)throw new Error('Dados insuficientes para analisar');
        if(alive)setAnalysis(result);
      }catch(e){if(alive)setAnalysisError(e instanceof Error?e.message:'Não foi possível consultar o histórico');}
      finally{if(alive)setAnalysisLoading(false);}
    };
    void load();const timer=window.setInterval(load,60000);
    return()=>{alive=false;controller.abort();window.clearInterval(timer);};
  },[marketSelected,analysisPeriod]);
  const [displayCurrency,setDisplayCurrency] = useState<'BRL'|'USD'>('BRL');
  const [usdBrl,setUsdBrl] = useState<{rate:number;updated:number}|null>(null);
  useEffect(()=>{
    let alive=true;
    const load=async()=>{
      try {const r=await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL',{cache:'no-store'});
        if(!r.ok)throw new Error('Câmbio indisponível');const d=await r.json();const rate=Number(d.rates?.BRL);
        if(!Number.isFinite(rate)||rate<=0)throw new Error('Câmbio inválido');
        if(alive)setUsdBrl({rate,updated:Date.now()});
      }catch{if(alive)setUsdBrl(null);}
    };void load();const t=window.setInterval(load,300000);return()=>{alive=false;window.clearInterval(t)};
  },[]);
  const [chartPeriod,setChartPeriod]=useState<'24h'|'7d'|'30d'>('24h');
  const [cryptoChartMode, setCryptoChartMode] = useState<'line' | 'area'>('area');
  const [coinChart,setCoinChart]=useState<number[]>([]);
  const [coinChartError,setCoinChartError]=useState('');
  const [coinChartLoading,setCoinChartLoading]=useState(false);
  useEffect(()=>{
    let alive=true;const controller=new AbortController();
    const load=async()=>{
      setCoinChartLoading(true);
      try{
        const interval=chartPeriod==='24h'?'15m':chartPeriod==='7d'?'2h':'8h';
        const limit=chartPeriod==='24h'?96:chartPeriod==='7d'?84:90;
        const url=`https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(marketSelected)}&interval=${interval}&limit=${limit}`;
        const r=await fetch(url,{cache:'no-store',signal:controller.signal});if(!r.ok)throw new Error('Histórico indisponível');
        const data=await r.json();const values=data.map((k:any)=>Number(k[4])).filter((v:number)=>Number.isFinite(v)&&v>0);
        if(values.length<2)throw new Error('Sem dados suficientes');
        if(alive){setCoinChart(values);setCoinChartError('');}
      }catch(e){if(alive){setCoinChart([]);setCoinChartError('Histórico indisponível para este par.');}}
      finally{if(alive)setCoinChartLoading(false);}
    };setCoinChart([]);void load();const timer=window.setInterval(load,60000);
    return()=>{alive=false;controller.abort();window.clearInterval(timer)};
  },[marketSelected,chartPeriod]);
  const [converterMode,setConverterMode]=useState<'crypto'|'fiat'>('crypto');
  const [fiatDirection,setFiatDirection]=useState<'BRL_TO_USD'|'USD_TO_BRL'>('BRL_TO_USD');
  const [brlAmount, setBrlAmount] = useState('1.000,00');
  const [converterCoin, setConverterCoin] = useState('BTC');
  const [converterDirection, setConverterDirection] = useState<'BRL_TO_COIN'|'COIN_TO_BRL'>('BRL_TO_COIN');
  const [converterQuote, setConverterQuote] = useState<{price:number;updated:number}|null>(null);
  const [converterError, setConverterError] = useState('');
  useEffect(()=>{
    let alive=true;
    const symbol=`${converterCoin}BRL`;
    const cached=marketQuotes[symbol];
    if(cached?.price>0) setConverterQuote({price:cached.price,updated:cached.updated});
    else setConverterQuote(null);
    setConverterError('');
    const load=async()=>{
      try{
        const response=await fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,{cache:'no-store'});
        if(!response.ok) throw new Error('Cotação indisponível');
        const data=await response.json();
        const price=Number(data.price);
        if(!Number.isFinite(price)||price<=0)throw new Error('Cotação inválida');
        if(alive){setConverterQuote({price,updated:Date.now()});setConverterError('');}
      }catch{if(alive)setConverterError('Não foi possível atualizar a cotação.');}
    };
    void load();
    const timer=window.setInterval(load,60000);
    return()=>{alive=false;window.clearInterval(timer)};
  },[converterCoin]);
  // Formatação pt-BR sem perder a precisão do valor utilizado nos cálculos.
  const converterInput=Number(brlAmount.replace(/\./g,'').replace(',','.'));
  const converterIsCryptoQuantity=converterMode==='crypto'&&converterDirection==='COIN_TO_BRL';
  const converterMaxDecimals=converterIsCryptoQuantity?8:2;
  const handleConverterAmountChange=(raw:string)=>{
    const cleaned=raw.replace(/[^\d,.]/g,'');
    const separator=cleaned.lastIndexOf(',')>=0?',':(cleaned.includes('.')&&!/^\d{1,3}(?:\.\d{3})+$/.test(cleaned)?'.':'');
    const decimalIndex=separator?cleaned.lastIndexOf(separator):-1;
    const integerPart=(decimalIndex>=0?cleaned.slice(0,decimalIndex):cleaned).replace(/\D/g,'');
    const decimals=decimalIndex>=0?cleaned.slice(decimalIndex+1).replace(/\D/g,'').slice(0,converterMaxDecimals):'';
    const grouped=(integerPart.replace(/^0+(?=\d)/,'')||'0').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
    setBrlAmount(grouped+(decimalIndex>=0?','+decimals:''));
  };
  const converterResult=converterQuote&&Number.isFinite(converterInput)&&converterInput>=0
    ? (converterDirection==='BRL_TO_COIN'?converterInput/converterQuote.price:converterInput*converterQuote.price):null;
  const fiatResult=usdBrl&&Number.isFinite(converterInput)&&converterInput>=0?(fiatDirection==='BRL_TO_USD'?converterInput/usdBrl.rate:converterInput*usdBrl.rate):null;
  const btcRecent = Boolean(btc && btcClock - btc.updated.getTime() < 15000);
  const btcStreamActive = btcLive && btcClock - btcLastMessageAt.current < 15000;
  const btcStatus = btcStreamActive && btcRecent ? "Binance · ao vivo" : btcLive ? "Binance · aguardando negociações" : btc ? "Binance · sem conexão ao vivo" : "Conectando à Binance";

  useEffect(() => {
    if (!window.finora) return;
    let alive = true;
    (async () => {
      try {
        const api = window.finora!;
        const existing = await api.listTransactions();
        const legacyRaw = localStorage.getItem('finora-transactions');
        let loaded = existing;
        if (legacyRaw && !localStorage.getItem('finora-migrated')) {
          const parsed = JSON.parse(legacyRaw);
          if (Array.isArray(parsed)) loaded = await api.importLegacy(parsed);
          localStorage.setItem('finora-migrated', '1');
        }
        if (alive) setTransactions(loaded as Transaction[]);
        if (alive) { setAccounts(await api.listAccounts()); setTransfers(await api.listTransfers()); setCards(await api.listCards()); setCardPayments(await api.listCardPayments()); }
        const history = await api.listBtc();
        if (alive) setBtcHistory(history);
      } catch (error) { console.error('Falha ao carregar banco SQLite', error); }
    })();
    return () => { alive = false; };
  }, []);

  // A cotação principal e a variação de 24h são exclusivamente da Binance.
  const fetchBtc = async () => {
    setBtcLoading(true);
    try {
      const response = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCBRL", { cache: "no-store" });
      if (!response.ok) throw new Error("Binance indisponível");
      const data = await response.json();
      const price = Number(data.lastPrice);
      const change = Number(data.priceChangePercent);
      const time = Number(data.closeTime);
      if (!(price > 0) || !Number.isFinite(price) || !Number.isFinite(change) || !(time > 0)) throw new Error("Resposta inválida da Binance");
      btcChange.current = change;
      setBtcLastChecked(new Date());
      if (!btcSocketConnected.current) {
        const next = { price, change, updated: new Date(time) };
        btcLatest.current = next;
        setBtc(next);
        setBtcSource("Binance");
      } else {
        setBtc(current => current ? { ...current, change } : current);
      }
      setBtcError(false);
    } catch {
      setBtcError(!btcSocketConnected.current);
    } finally {
      setBtcLoading(false);
    }
  };

  useEffect(() => {
    fetchBtc();
    // Fluxo de negociações BTC/BRL. A interface consolida as mensagens em 1 atualização/segundo.
    // Não se inventam preços entre negociações; se não houver novo trade, o preço permanece.
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let closed = false;
    let retryMs = 2000;
    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket("wss://stream.binance.com:9443/ws/btcbrl@trade");
        socket.onopen = () => { btcSocketConnected.current = true; setBtcLive(true); setBtcError(false); setBtcSource("Binance"); retryMs = 2000; };
        socket.onmessage = (event) => {
          try {
            const trade = JSON.parse(event.data);
            const price = Number(trade.p);
            const time = Number(trade.T);
            if (Number.isFinite(price) && price > 0 && Number.isFinite(time) && time > 0) {
              btcSocketPrice.current = {price, time};
              btcLastMessageAt.current = Date.now();
            }
          } catch { /* ignora mensagem inválida */ }
        };
        socket.onclose = () => {
          btcSocketConnected.current = false; setBtcLive(false);
          btcSocketPrice.current = null;
          if (!closed) { reconnectTimer = window.setTimeout(connect, retryMs); retryMs = Math.min(retryMs * 2, 30000); }
        };
        socket.onerror = () => socket?.close();
      } catch { reconnectTimer = window.setTimeout(connect, retryMs); }
    };
    connect();
    const ticker = window.setInterval(() => {
      setBtcClock(Date.now());
      if (!btcSocketConnected.current || !btcSocketPrice.current) return;
      const {price, time} = btcSocketPrice.current;
      const prior = btcLatest.current;
      if (prior && prior.price === price && prior.updated.getTime() === time) return;
      const next = {price, change: btcChange.current ?? prior?.change ?? 0, updated: new Date(time)};
      btcLatest.current = next;
      setBtc(next);
      setBtcSource("Binance");
      setBtcError(false);
      if (time - btcLastSaved.current >= 1000) {
        btcLastSaved.current = time;
        setBtcHistory(current => {
          if (current.some(item => item.time === time)) return current;
          const updated = [...current, {price, time}].slice(-168);
          if (window.finora) void window.finora.addBtc({price, time}).catch(console.error);
          else localStorage.setItem("finora-btc-history", JSON.stringify(updated));
          return updated;
        });
      }
    }, 1000);
    const fallback = window.setInterval(() => { void fetchBtc(); }, 60000);
    return () => {
      closed = true;
      btcSocketConnected.current = false;
      btcSocketPrice.current = null;
      socket?.close();
      window.clearTimeout(reconnectTimer);
      window.clearInterval(ticker);
      window.clearInterval(fallback);
    };
  }, []);

  useEffect(() => {
    if (!window.finora) localStorage.setItem("finora-transactions", JSON.stringify(transactions));
  }, [transactions]);

  const periodTransactions = useMemo(() => {
    return transactions.filter((transaction) => {
      const date = new Date(`${transaction.date}T12:00:00`);
      return !Number.isNaN(date.getTime()) && date.getFullYear() === financialYear && (period === "Ano inteiro" || monthNamesLong[date.getMonth()] === period);
    });
  }, [period, financialYear, transactions]);

  const expenses = periodTransactions.filter(t => t.kind !== "receita");
  const totalExpenses = expenses.reduce((sum, t) => sum + t.amount, 0);
  const totalIncome = periodTransactions.filter(t => t.kind === "receita").reduce((sum,t) => sum + t.amount, 0);
  const netResult = totalIncome - totalExpenses;
  // Projeção usa apenas lançamentos marcados como pendentes; pagamentos já efetuados
  // estão refletidos nos saldos atuais e não podem ser debitados novamente.
  const [launchFilter, setLaunchFilter] = useState<"todos" | "pago" | "pendente" | "entrada">("todos");
  // A situação vem do SQLite: o status não é mais uma etiqueta apenas visual.
  const statusOf = (t: Transaction) => t.kind === "receita" ? "entrada" : (t.paid === 1 ? "pago" : "pendente");
  const pendingTotalCents = periodTransactions.filter(t => statusOf(t) === "pendente" && t.card_id == null).reduce((sum,t) => sum + Math.round(t.amount * 100), 0);
  const bankBalanceCents = accounts.reduce((sum,a) => sum + Math.round(a.balance * 100), 0);
  const forecastCents = bankBalanceCents - pendingTotalCents;
  const visibleLaunches = periodTransactions.filter(t => launchFilter === "todos" || statusOf(t) === launchFilter);
  const setLaunchStatus = async (t: Transaction, value: "pago" | "pendente") => {
    if (!window.finora) return;
    try {
      let accountId = t.account_id ?? null;
      if (value === "pago" && t.card_id == null && accountId == null) {
        if (accounts.length === 0) { alert("Cadastre primeiro uma conta em Contas e transferências."); return; }
        const choices = accounts.map((a,i) => `${i+1} - ${a.name}`).join("\n");
        const choice = window.prompt(`Qual conta pagou ${t.description}?\n${choices}\n\nDigite o número da conta:`);
        if (choice == null) return;
        const selected = Number(choice.trim());
        if (!Number.isInteger(selected) || selected < 1 || selected > accounts.length) { alert("Selecione um número válido da lista."); return; }
        accountId = accounts[selected-1].id;
      }
      await window.finora.setTransactionPaid({id:t.id,paid:value==="pago",account_id:accountId});
      setTransactions(await window.finora.listTransactions());
      await refreshAccounts();
      await refreshActivity();
    } catch(error) { alert("Não foi possível atualizar o pagamento: " + String(error)); }
  };

  const typeData = useMemo(() => {
    const grouped = expenses.reduce<Partial<Record<TransactionType, number>>>((result, transaction) => {
      result[transaction.type] = (result[transaction.type] || 0) + transaction.amount;
      return result;
    }, {});
    return (["Cartão", "Empréstimo", "Conta fixa"] as TransactionType[]).map((label) => ({ label, value: grouped[label] || 0, color: typeColors[label] })).sort((a, b) => b.value - a.value);
  }, [periodTransactions]);
  const cardsTotalLimit=cards.reduce((sum,c)=>sum+c.credit_limit,0);
  const cardsTotalUsed=cards.reduce((sum,c)=>sum+c.used,0);
  const cardsTotalAvailable=cards.reduce((sum,c)=>sum+c.available,0);
  // Avisos baseados apenas em dados existentes: nenhum vencimento ou alerta de preço inventado.
  const [notificationsOpen,setNotificationsOpen] = useState(false);
  const notificationButtonRef=useRef<HTMLButtonElement>(null);
  const [notificationPosition,setNotificationPosition]=useState({top:80,right:16});
  const toggleNotifications=()=>{
    if(!notificationsOpen && notificationButtonRef.current){
      const r=notificationButtonRef.current.getBoundingClientRect();
      setNotificationPosition({top:Math.min(r.bottom+10,window.innerHeight-60),right:Math.max(12,window.innerWidth-r.right)});
    }
    setNotificationsOpen(v=>!v);
  };
  useEffect(()=>{
    if(!notificationsOpen)return;
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setNotificationsOpen(false);};
    const onResize=()=>setNotificationsOpen(false);
    document.addEventListener('keydown',onKey);
    window.addEventListener('resize',onResize);
    return ()=>{document.removeEventListener('keydown',onKey);window.removeEventListener('resize',onResize);};
  },[notificationsOpen]);
  const [activity,setActivity] = useState<{id:number;action:string;message:string;created_at:string}[]>([]);
  const refreshActivity=async()=>{if(window.finora)setActivity(await window.finora.listActivity());};
  useEffect(()=>{void refreshActivity();},[]);
  const [readNotificationIds,setReadNotificationIds] = useState<string[]>(()=>{
    try { const stored=JSON.parse(localStorage.getItem('ordefin-notifications-read-v25')||'[]');return Array.isArray(stored)?stored.filter((x):x is string=>typeof x==='string'):[]; } catch{return [];}
  });
  useEffect(()=>{localStorage.setItem('ordefin-notifications-read-v25',JSON.stringify(readNotificationIds.slice(-300)));},[readNotificationIds]);
  const notifications = useMemo(()=>{
    const items:{id:string;title:string;message:string;tab:'accounts'|'bitcoin'|'transactions'}[]=[];
    for(const a of activity)items.push({id:`activity-${a.id}`,title:`Lançamento ${a.action}`,message:`${a.message} • ${a.created_at}`,tab:'transactions'});
    for(const c of cards){
      if(c.credit_limit>0 && c.available/c.credit_limit<=0.2){
        const ratio=Math.round(c.available/c.credit_limit*100);
        items.push({id:`card-${c.id}-${Math.round(c.available*100)}`,title:`Limite baixo: ${c.name}`,message:`Restam ${formatMoney(c.available)} (${ratio}% do limite) no cartão ${c.name}.`,tab:'accounts'});
      }
    }
    if(marketStatus.includes('Desconectado')||marketStatus.includes('Falha')){
      items.push({id:'binance-connection',title:'Verificar conexão com a Binance',message:'As cotações podem estar desatualizadas. Confira o status na área Criptomoedas.',tab:'bitcoin'});
    }
    return items;
  },[cards,marketStatus,activity]);
  const unreadNotifications=notifications.filter(n=>!readNotificationIds.includes(n.id)).length;
  const markAllNotificationsRead=()=>setReadNotificationIds(old=>Array.from(new Set([...old,...notifications.map(n=>n.id)])));
  const annualTransactions = useMemo(() => transactions.filter((transaction) => new Date(`${transaction.date}T12:00:00`).getFullYear() === financialYear), [transactions, financialYear]);


  // Recarrega os cartões ao abrir o lançamento, inclusive após cadastros feitos em Contas.
  useEffect(() => {
    if (!showModal || !window.finora) return;
    let active = true;
    void window.finora.listCards().then(list => {
      if (active) setCards(list);
    }).catch(error => console.error('Falha ao atualizar cartões no lançamento', error));
    return () => { active = false; };
  }, [showModal]);

  const saveTransaction = async (transaction: Omit<Transaction, "id">) => {
    try {
      const saved = window.finora ? await window.finora.addTransaction(transaction) : { ...transaction, id: Date.now() };
      setTransactions((current) => [saved, ...current]);
      await refreshAccounts();
      if (window.finora) setCards(await window.finora.listCards());
      setShowModal(false); await refreshActivity();
    } catch (error) { alert('Não foi possível salvar o lançamento: ' + String(error)); }
  };

  const updateTransaction = async (transaction: Omit<Transaction,"id">) => {
    if (!editingTransaction) return;
    try {
      if (window.finora) {
        await window.finora.updateTransaction({ ...transaction, id: editingTransaction.id });
        setTransactions(await window.finora.listTransactions());
        setCards(await window.finora.listCards());
      } else setTransactions(old=>old.map(t=>t.id===editingTransaction.id?{...transaction,id:t.id}:t));
      await refreshAccounts();
      setShowModal(false);setEditingTransaction(null);await refreshActivity();
    } catch(error){alert('Não foi possível editar o lançamento: '+String(error));}
  };
  const deleteTransaction = async (transaction: Transaction) => {
    try {
      const preview=window.finora?await window.finora.previewTransactionDeletion(transaction.id):null;
      let refund=false;
      if(preview?.hasPayments){
        refund=window.confirm(`O cartão desta compra possui pagamentos registrados.\n\nDeseja excluir "${transaction.description}" (${formatMoney(transaction.amount)}) e estornar até ${formatMoney(preview.refund)} dos pagamentos mais recentes?\n\nATENÇÃO: pagamentos não estão vinculados a compras individuais. O estorno poderá afetar pagamentos de outras compras deste cartão.\n\nOK = excluir e estornar. Cancelar = escolher outra opção.`);
        if(!refund){
          if(preview.overpayment>0){alert(`Não é possível excluir mantendo todos os pagamentos: sobrariam ${formatMoney(preview.overpayment)} pagos a mais que as compras existentes. Operação cancelada.`);return;}
          if(!window.confirm('Excluir somente a compra, mantendo os pagamentos e o saldo bancário?'))return;
        }
      }else if(!window.confirm(`Excluir definitivamente o lançamento "${transaction.description}" de ${formatMoney(transaction.amount)}?`))return;
      if(window.finora){await window.finora.deleteTransaction(transaction.id,refund);setTransactions(await window.finora.listTransactions());setCards(await window.finora.listCards());}
      else setTransactions(old=>old.filter(t=>t.id!==transaction.id));
      await refreshAccounts();await refreshActivity();
    }catch(error){alert('Não foi possível excluir o lançamento: '+String(error));}
  };
  const refreshAccounts = async () => { if (window.finora) {setAccounts(await window.finora.listAccounts());setTransfers(await window.finora.listTransfers());} };
  useEffect(()=>{const update=()=>{void refreshAccounts();};window.addEventListener('ordefin-investments-changed',update);return()=>window.removeEventListener('ordefin-investments-changed',update);},[]);
  const [accountMessage, setAccountMessage] = useState("");
  const [editingAccount, setEditingAccount] = useState<number | null>(null);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountEditMode, setAccountEditMode] = useState<"current" | "opening">("current");
  const [cardPayments, setCardPayments] = useState<{id:number;card_id:number;account_id:number|null;amount:number;date:string;card_name:string;account_name:string|null}[]>([]);
  const financialYears = useMemo(() => {
    const current = new Date().getFullYear();
    const years = new Set<number>([financialYear, ...extraFinancialYears]);
    // Exibe sempre o ano atual e os cinco anos seguintes, mesmo sem lançamentos.
    for (let year = current; year <= Math.min(current + 5, 2200); year++) years.add(year);
    for (const transaction of transactions) {
      const year = Number(transaction.date.slice(0, 4));
      if (Number.isInteger(year) && year >= 1900 && year <= 2200) years.add(year);
    }
    for (const payment of cardPayments) {
      const year = Number(payment.date.slice(0, 4));
      if (Number.isInteger(year) && year >= 1900 && year <= 2200) years.add(year);
    }
    return [...years].sort((a, b) => b - a);
  }, [transactions, cardPayments, financialYear, extraFinancialYears]);
  const refreshCardPayments = async () => { if(window.finora) setCardPayments(await window.finora.listCardPayments()); };
  useEffect(() => { if(activeTab === 'accounts' || activeTab === 'transactions') void refreshCardPayments(); }, [activeTab]);
  const saveAccountEdit = async (event:FormEvent<HTMLFormElement>, id:number) => {
    event.preventDefault();
    if(accountSaving || !window.finora)return;
    const f=new FormData(event.currentTarget);
    const name=String(f.get('name')||'').trim();
    const balance=parseBRL(f.get('account_amount'));
    if(!name || !Number.isFinite(balance) || balance<0 || Math.abs(balance*100-Math.round(balance*100))>0.000001){setAccountMessage('Informe nome e saldo válido com até duas casas decimais.');return;}
    setAccountSaving(true);
    try {
      await window.finora.setCurrentAccountBalance({id,name,balance});
      await refreshAccounts();await refreshActivity();
      setEditingAccount(null);
      setAccountMessage(`Conta "${name}" salva. Saldo disponível: ${formatMoney(balance)}.`);
    } catch(e){setAccountMessage(`Não foi possível salvar: ${String(e)}`);}
    finally{setAccountSaving(false);}
  };
  const removeAccount = async (a:FinoraAccount) => {
    if(!window.finora || !window.confirm(`Excluir a conta "${a.name}"? Só é possível excluir contas sem movimentações. Esta operação não estorna pagamentos.`))return;
    try {await window.finora.deleteAccount(a.id);await refreshAccounts();await refreshActivity();setAccountMessage('Conta excluída.');}
    catch(e){setAccountMessage(String(e).includes('CONTA_COM_MOVIMENTACOES')?'Esta conta possui lançamentos, transferências ou pagamentos. Corrija ou estorne essas movimentações antes de excluir a conta.':'Não foi possível excluir a conta.');}
  };
  const changePayment = async (id:number, amount:number) => {
    if(!window.finora)return;
    const input=window.prompt('Novo valor do pagamento (R$):',amount.toFixed(2).replace('.',','));
    if(input===null)return;
    const value=parseBRL(input);
    if(!Number.isFinite(value)||value<=0){setAccountMessage('Informe um valor maior que zero.');return;}
    if(!window.confirm(`Confirmar alteração do pagamento para ${formatMoney(value)}? O saldo bancário e o limite do cartão serão recalculados.`))return;
    try {await window.finora.updateCardPayment({id,amount:value});await refreshAccounts();setCards(await window.finora.listCards());await refreshCardPayments();await refreshActivity();setAccountMessage('Pagamento corrigido e saldos atualizados.');}
    catch(e){setAccountMessage('Não foi possível editar o pagamento: '+String(e));}
  };
  const removePayment = async (id:number,amount:number) => {
    if(!window.finora||!window.confirm(`Estornar o pagamento de ${formatMoney(amount)}? O valor voltará à conta bancária vinculada e a dívida do cartão aumentará.`))return;
    try {await window.finora.deleteCardPayment(id);await refreshAccounts();setCards(await window.finora.listCards());await refreshCardPayments();await refreshActivity();setAccountMessage('Pagamento estornado e saldos atualizados.');}
    catch(e){setAccountMessage('Não foi possível estornar o pagamento: '+String(e));}
  };
  const [transferMessage, setTransferMessage] = useState("");
  const [accountCreating, setAccountCreating] = useState(false);
  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget; // Capturar antes de qualquer await (currentTarget pode ser limpo).
    if (!window.finora) { setAccountMessage('Aplicativo desktop indisponível. Abra pelo ORDEFIN no Electron.'); return; }
    const fields = new FormData(form);
    const name = String(fields.get('name') || '').trim();
    const opening_balance = parseBRL(fields.get('opening_balance'));
    if (!name || name.length > 100) { setAccountMessage('Informe um nome de conta válido.'); return; }
    if (!Number.isFinite(opening_balance) || opening_balance < 0 || Math.abs(opening_balance * 100 - Math.round(opening_balance * 100)) > 1e-7) {
      setAccountMessage('Informe um saldo válido com até dois centavos. Ex.: 1.500,75.'); return;
    }
    if (accounts.some(a => a.name.trim().toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
      setAccountMessage('Já existe uma conta com esse nome. Escolha outro nome ou edite a conta cadastrada.'); return;
    }
    setAccountCreating(true);
    setAccountMessage('Cadastrando conta...');
    try {
      await window.finora.addAccount({ name, opening_balance: Math.round(opening_balance * 100) / 100 });
      form.reset();
      await refreshAccounts();
      setAccountMessage(`Conta "${name}" criada com sucesso. Saldo inicial: ${formatMoney(opening_balance)}.`);
    } catch (err) {
      const msg = String(err);
      setAccountMessage(msg.includes('CONTA_DUPLICADA') || msg.includes('UNIQUE constraint')
        ? 'Já existe uma conta com esse nome. Escolha outro nome.'
        : `Não foi possível criar a conta: ${msg}`);
    } finally { setAccountCreating(false); }
  };
  const [editingCard, setEditingCard] = useState<number | null>(null);
  const updateCardLimit = async (event: FormEvent<HTMLFormElement>, cardId: number) => {
    event.preventDefault(); if (!window.finora) return;
    const limit = parseBRL(new FormData(event.currentTarget).get('limit'));
    if (!Number.isFinite(limit) || limit < 0) {setCardMessage('Informe um limite válido. Ex.: 1.500,00.'); return;}
    try {await window.finora.updateCardLimit({id:cardId,credit_limit:limit}); setCards(await window.finora.listCards()); setEditingCard(null); setCardMessage('Limite atualizado com sucesso.');}
    catch(e) {setCardMessage(String(e).includes('LIMITE_INFERIOR')?'O limite não pode ser menor que o valor já utilizado.':'Não foi possível atualizar o limite.');}
  };
  const [editingCardIdentity, setEditingCardIdentity] = useState<number | null>(null);
  const saveCardIdentity = async (event: FormEvent<HTMLFormElement>, id:number) => {
    event.preventDefault();
    if(!window.finora) return;
    const fields=new FormData(event.currentTarget);
    try {
      await window.finora.updateCardIdentity({id,name:String(fields.get('name')||''),issuer:String(fields.get('issuer')||''),brand:String(fields.get('brand')||'')});
      setCards(await window.finora.listCards());
      setEditingCardIdentity(null);
      setCardMessage('Banco emissor e bandeira atualizados. O limite e as movimentações foram preservados.');
    } catch(e) {setCardMessage('Não foi possível salvar os dados do cartão. Confira o nome e tente novamente.');}
  };
  const [editingCardNumber, setEditingCardNumber] = useState<number|null>(null);
  const [replacementNumber, setReplacementNumber] = useState('');
  const deleteSavedCard = async (id:number, name:string) => {
    if (!window.finora || !window.confirm(`Excluir o cartão "${name}"? Esta ação não pode ser desfeita. Cartões com compras ou pagamentos vinculados não podem ser excluídos.`)) return;
    try {
      await window.finora.deleteCard(id);
      setCards(await window.finora.listCards());
      setCardMessage('Cartão excluído com sucesso.');
      await refreshActivity();
    } catch(e) {
      setCardMessage(String(e).includes('CARTAO_COM_MOVIMENTACOES')?'Este cartão tem compras ou pagamentos vinculados e não pode ser excluído. Os registros financeiros foram preservados.':'Não foi possível excluir o cartão.');
    }
  };
  const saveCardNumber = async (event:FormEvent<HTMLFormElement>, card:OrdefinCard) => {
    event.preventDefault();
    const digits=replacementNumber.replace(/\D/g,'');
    if (digits.length<12 || digits.length>19) {setCardMessage('Digite um número válido de 12 a 19 dígitos.');return;}
    try {
      const result=await window.finora?.identifyCard(digits.slice(0,8));
      await window.finora?.updateCardNumber({id:card.id,last_four:digits.slice(-4),issuer:result?.issuer||card.issuer||'',brand:result?.brand||detectBrand(digits)||card.brand||''});
      setCards(await window.finora!.listCards());
      setEditingCardNumber(null);setReplacementNumber('');
      setCardMessage(result?.issuer?'Número atualizado e emissor sugerido pela base pública.':'Número atualizado. O banco não foi identificado; use Editar banco e bandeira para informar manualmente.');
    } catch(e) {setCardMessage('Não foi possível atualizar o número do cartão.');}
  };
  const [newCardMode,setNewCardMode]=useState<'debito'|'credito'|'ambos'>('ambos');
  const [newCardAccount,setNewCardAccount]=useState('');
  const [editingCardMode,setEditingCardMode]=useState<number|null>(null);
  const [cardViewMode,setCardViewMode]=useState<Record<number,'debito'|'credito'>>({});
  const [cardNumber, setCardNumber] = useState('');
  const [cardIssuer, setCardIssuer] = useState('');
  const [cardBrand, setCardBrand] = useState('');
  const [cardNickname, setCardNickname] = useState('');
  const cardManualIssuer = useRef(false);
  const cardManualBrand = useRef(false);
  const [cardLookup, setCardLookup] = useState('Digite o número para identificar.');
  const detectBrand = (digits:string) => {
    if (/^(34|37)/.test(digits)) return 'American Express';
    if (/^4/.test(digits)) return 'Visa';
    if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return 'Mastercard';
    if (/^(6011|65|64[4-9]|622(12[6-9]|1[3-9]\d|[2-8]\d{2}|9[01]\d|92[0-5]))/.test(digits)) return 'Discover';
    if (/^35(2[89]|[3-8]\d)/.test(digits)) return 'JCB';
    if (/^(30[0-5]|36|3[89])/.test(digits)) return 'Diners Club';
    // Elo, Hipercard e Aura usam intervalos diversos: preferir confirmação por BIN.
    return '';
  };
  const normalizeBrand = (raw:string) => {
    const key=raw.toLowerCase().replace(/[^a-z]/g,'');
    const known:Record<string,string>={visa:'Visa',mastercard:'Mastercard',master:'Mastercard',amex:'American Express',americanexpress:'American Express',elo:'Elo',hipercard:'Hipercard',diners:'Diners Club',dinersclub:'Diners Club',discover:'Discover',jcb:'JCB',aura:'Aura',enroute:'EnRoute',voyager:'Voyager'};
    return known[key] || '';
  };
  const handleCardNumberChange = (raw:string) => {
    const digits=raw.replace(/\D/g,'').slice(0,19);
    // Só reinicia a identificação se o BIN mudar; editar os últimos dígitos
    // não pode apagar um banco ou bandeira informados manualmente.
    const binChanged = digits.slice(0, 8) !== cardNumber.slice(0, 8);
    if (binChanged) {
      cardManualIssuer.current = false;
      cardManualBrand.current = false;
      setCardIssuer('');
      setCardBrand(detectBrand(digits));
      setCardLookup(digits.length < 8
        ? 'Aguardando 8 dígitos para consultar o banco.'
        : 'Consultando os primeiros 8 dígitos...');
    } else if (!cardManualBrand.current) {
      setCardBrand(current => current || detectBrand(digits));
    }
    setCardNumber(digits);
  };
  const cardBin = cardNumber.slice(0, 8);
  useEffect(() => {
    const prefix=cardBin;
    if(prefix.length!==8) return;
    let active=true;
    const timer=setTimeout(async()=>{
      try {
        const result=await window.finora?.identifyCard(prefix);
        if(!active)return;
        const issuer=String(result?.issuer||'').trim();
        const brand=normalizeBrand(String(result?.brand||''));
        if(issuer && !cardManualIssuer.current)setCardIssuer(issuer);
        if(brand && !cardManualBrand.current)setCardBrand(brand);
        setCardLookup(issuer?'Banco sugerido pelo BIN. Confirme os dados.':'Banco não identificado. Digite o emissor manualmente.');
      }catch {
        if(active)setCardLookup('Consulta indisponível. Informe o banco manualmente.');
      }
    },650);
    return ()=>{active=false;clearTimeout(timer)};
  },[cardBin]);
  const createCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!window.finora) return;
    const form = event.currentTarget; const f=new FormData(form);
    const limit = newCardMode==='debito'?0:parseBRL(f.get('limit')); if (!Number.isFinite(limit) || limit < 0) {setCardMessage('Informe um limite válido. Ex.: 1.500,00.'); return;}
    const digits=cardNumber.replace(/\D/g,'');
    if(digits.length<12 || digits.length>19) {setCardMessage('Informe um número de cartão com 12 a 19 dígitos.');return;}
    const issuer=String(f.get('issuer')||'').trim();
    const brand=String(f.get('brand')||'').trim();
    const label=cardNickname.trim() || `${issuer||'Cartão'} ${brand} •••• ${digits.slice(-4)}`;
    if(newCardMode!=='credito'&&!newCardAccount){setCardMessage('Selecione a conta bancária do débito.');return;}
    try { await window.finora.addCard({name:label,credit_limit:limit,issuer,brand,last_four:digits.slice(-4),card_mode:newCardMode,account_id:newCardMode==='credito'?null:Number(newCardAccount)}); setCards(await window.finora.listCards()); form.reset(); setCardNumber('');setCardIssuer('');setCardBrand('');setCardNickname('');cardManualIssuer.current=false;cardManualBrand.current=false;setNewCardMode('ambos');setNewCardAccount(''); setCardMessage('Cartão cadastrado com sucesso. O número completo não foi armazenado.'); }
    catch(e) {setCardMessage(String(e).includes('DUPLICADO')?'Já existe um cartão com esse nome.':'Não foi possível cadastrar o cartão.');}
  };
  const updateCardMode = async(event:FormEvent<HTMLFormElement>,id:number)=>{
    event.preventDefault();const f=new FormData(event.currentTarget);
    const mode=String(f.get('mode')) as 'debito'|'credito'|'ambos';const account=f.get('account_id')?Number(f.get('account_id')):null;
    try{await window.finora?.updateCardMode({id,card_mode:mode,account_id:account});setCards(await window.finora!.listCards());setEditingCardMode(null);setCardMessage('Funções do cartão atualizadas.');}
    catch(e){setCardMessage(String(e).includes('CARTAO_COM_MOVIMENTACOES')?'Não é possível desativar uma função que já possui movimentações.':String(e).includes('CONTA_COM_MOVIMENTACOES')?'Não é possível trocar a conta de um cartão com compras no débito.':'Confira a função e a conta vinculada.');}
  };
  const payCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!window.finora) return;
    const form=event.currentTarget; const f=new FormData(form);
    const amount = parseBRL(f.get('amount'));
    const card = cards.find(c => c.id === Number(f.get('card_id')));
    if (!Number.isFinite(amount) || amount <= 0 || !card || amount > card.used + 0.000001) { setCardMessage('Informe um pagamento maior que zero e não superior ao valor utilizado no cartão.'); return; }
    try { await window.finora.payCard({card_id:Number(f.get('card_id')),account_id:f.get('account_id')?Number(f.get('account_id')):null,amount,date:String(f.get('date'))}); setCards(await window.finora.listCards()); await refreshAccounts(); await refreshCardPayments(); form.reset(); setCardMessage('Pagamento registrado. Limite disponível atualizado.'); }
    catch(e) {setCardMessage(String(e).includes('EXCEDE_DIVIDA')?'O pagamento não pode superar o valor utilizado.':String(e).includes('SALDO_INSUFICIENTE')?'Saldo insuficiente na conta selecionada.':'Não foi possível registrar o pagamento.');}
  };
  const createTransfer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!window.finora) return;
    const form=event.currentTarget;
    const f = new FormData(form);
    const source=Number(f.get('source')), destination=Number(f.get('destination'));
    const amount=parseBRL(f.get('amount'));
    if(source===destination){setTransferMessage('Selecione duas contas diferentes.');return;}
    if(!Number.isFinite(amount)||amount<=0||Math.abs(amount*100-Math.round(amount*100))>0.000001){setTransferMessage('Informe um valor válido com até duas casas decimais.');return;}
    try {
      await window.finora.addTransfer({source_account_id:source,destination_account_id:destination,amount,date:String(f.get('date')),note:String(f.get('note')||'')});
    }catch(err){setTransferMessage(String(err).includes('SALDO_INSUFICIENTE')?'Saldo insuficiente na conta de origem.':`Falha na transferência: ${String(err)}`);return;}
    form.reset();setTransferMessage('Transferência registrada com sucesso.');
    try {await refreshAccounts();}catch(e){setTransferMessage('Transferência registrada, mas não foi possível atualizar a tela. Reabra Minhas contas.');}
  };
  const [excelPreview, setExcelPreview] = useState<Omit<Transaction,"id">[]>([]);
  const [excelInfo, setExcelInfo] = useState("");
  const [excelBusy, setExcelBusy] = useState(false);
  const readExcel = async (file: File) => {
    setExcelPreview([]);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const accepted: Omit<Transaction,"id">[] = [];
      const rejected: string[] = [];
      for (const sheetName of wb.SheetNames) {
        if (!monthNamesLong.includes(sheetName)) continue;
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '' });
        for (const [index, row] of rows.entries()) {
          const normalized = Object.fromEntries(Object.entries(row).map(([key,value])=>[key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(),value]));
          const description = String(normalized['descricao'] || normalized['historico'] || '').trim();
          const category = String(normalized['categoria'] || 'Outros').trim();
          const rawAmount = normalized['valor'];
          const amount = typeof rawAmount === 'number' ? rawAmount : Number(String(rawAmount).replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.'));
          const rawDate = normalized['data'];
          let date = '';
          if (rawDate instanceof Date && !isNaN(rawDate.getTime())) date = `${rawDate.getFullYear()}-${String(rawDate.getMonth()+1).padStart(2,'0')}-${String(rawDate.getDate()).padStart(2,'0')}`;
          else if (typeof rawDate === 'number') { const d = XLSX.SSF.parse_date_code(rawDate); if(d) date = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`; }
          else { const m = String(rawDate).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if(m) date = `${m[3]}-${m[2]}-${m[1]}`; else if(/^\d{4}-\d{2}-\d{2}$/.test(String(rawDate))) date=String(rawDate); }
          if (!description || !Number.isFinite(amount) || amount === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { rejected.push(`${sheetName}: linha ${index+2}`); continue; }
          const kindText = String(normalized['tipo de movimento'] || normalized['natureza'] || normalized['entrada/saida'] || '').toLowerCase();
          const kind = kindText.includes('receita') || kindText.includes('entrada') || amount < 0 && kindText.includes('credito') ? 'receita' : 'despesa';
          accepted.push({description,category,type:'Conta fixa',amount:Math.abs(amount),date,kind});
        }
      }
      setExcelPreview(accepted);
      setExcelInfo(`${accepted.length} lançamentos reconhecidos. ${rejected.length} linhas ignoradas. Importação sem conta bancária vinculada. Confira a classificação receita/despesa antes de confirmar. Nenhum dado foi gravado ainda.`);
    } catch(e) {setExcelInfo('Falha ao ler o Excel: '+String(e));}
  };
  const confirmExcel = async () => {
    if(!window.finora || !excelPreview.length || !window.confirm(`Importar ${excelPreview.length} lançamentos? Esta operação acrescenta registros e não elimina duplicatas.`)) return;
    setExcelBusy(true);
    try {await window.finora.importExcel(excelPreview);setTransactions(await window.finora.listTransactions());setExcelPreview([]);setExcelInfo('Importação concluída. Faça um backup SQLite.');}
    catch(e){setExcelInfo('Erro na importação: '+String(e));}
    finally {setExcelBusy(false);}
  };
  const btcValues = btcHistory.slice(-18).map((item) => item.price);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="chart" size={23} /></span><span>ORDEFIN</span></div>
        <nav aria-label="Navegação principal">
          <button className={activeTab === "dashboard" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("dashboard")}><Icon name="grid" /><span>Visão geral</span></button>
          <button className={activeTab === "transactions" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("transactions")}><Icon name="card" /><span>Lançamentos</span></button>
          <button className={activeTab === "wallet" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("wallet")}><Icon name="wallet" /><span>Minha carteira</span></button>
          <button className={activeTab === "accounts" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("accounts")}><Icon name="wallet" /><span>Contas</span></button>
          <button className={activeTab === "investments" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("investments")}><Icon name="chart" /><span>Meus investimentos</span></button>
          <button className={activeTab === "bitcoin" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("bitcoin")}><Icon name="bitcoin" /><span>Criptomoedas</span><span className="live-dot" /></button>
        </nav>

        <div className="sidebar-footer"><button className={activeTab==='settings'?'nav-item active':'nav-item'} onClick={()=>setActiveTab('settings')}><Icon name="settings"/><span>Configurações</span></button><small>Seus dados ficam neste computador</small></div>
      </aside>

      <main className={`ordefin-workspace workspace-${activeTab}`}>
        <header className="topbar">
          <div><p className="today">{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</p><h1>{activeTab === "bitcoin" ? "Mercado de criptomoedas" : activeTab === "transactions" ? "Lançamentos" : activeTab === "wallet" ? "Minha carteira" : activeTab === "accounts" ? "Contas e transferências" : activeTab === "investments" ? "Meus investimentos" : activeTab === "settings" ? "Configurações" : "Visão geral"}</h1></div>
          <div className="header-actions">
            <div className="notification-anchor">
              <button type="button" ref={notificationButtonRef} className="icon-button notification" aria-label={`Notificações${unreadNotifications?` (${unreadNotifications} não lidas)`:''}`} aria-expanded={notificationsOpen} aria-controls="ordefin-notification-panel" onClick={toggleNotifications}><Icon name="bell" />{unreadNotifications>0&&<i aria-hidden="true" />}</button>
              {notificationsOpen&&createPortal(<div className="ordefin-notification-layer" onMouseDown={()=>setNotificationsOpen(false)}>
                <div id="ordefin-notification-panel" className="ordefin-notification-panel" role="region" aria-label="Central de notificações" style={{top:notificationPosition.top,right:notificationPosition.right}} onMouseDown={e=>e.stopPropagation()}>
                <div className="ordefin-notification-head"><strong>Notificações {unreadNotifications>0?`(${unreadNotifications} novas)`:''}</strong><button type="button" className="ordefin-notification-close" onClick={()=>setNotificationsOpen(false)} aria-label="Fechar notificações"><Icon name="close" size={17}/></button></div>
                {notifications.length===0?<p className="ordefin-notification-empty">Nenhum aviso no momento. Os alertas aparecem aqui quando houver algo que precise da sua atenção.</p>:<>
                  <div className="ordefin-notification-list">{notifications.map(n=><button type="button" key={n.id} className={`ordefin-notification-item ${readNotificationIds.includes(n.id)?'read':'unread'}`} onClick={()=>{setReadNotificationIds(old=>old.includes(n.id)?old:[...old,n.id]);setActiveTab(n.tab);setNotificationsOpen(false);}}><strong>{n.title}</strong><span>{n.message}</span></button>)}</div>
                  {unreadNotifications>0&&<button type="button" className="ordefin-notification-readall" onClick={markAllNotificationsRead}>Marcar todas como lidas</button>}
                </>}
                <p className="ordefin-notification-foot">Avisos locais. Não são enviados ao celular ou por e-mail.</p>
              </div></div>,document.body)}
            </div>
            {(activeTab === "dashboard" || activeTab === "transactions") && <div className="financial-year-controls"><select className="period-select" aria-label="Ano financeiro" value={financialYear} onChange={(event) => setFinancialYear(Number(event.target.value))}>{financialYears.map(year => <option key={year} value={year}>{year}</option>)}</select><button type="button" className="financial-year-add" onClick={addFinancialYear} title="Adicionar próximo ano financeiro" aria-label="Adicionar próximo ano financeiro"><Icon name="plus" size={17} /></button></div>}
            <select className="period-select" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Período"><option>Ano inteiro</option>{monthNamesLong.map((month) => <option key={month}>{month}</option>)}</select>
            <button className="button primary" onClick={() => {setEditingTransaction(null);setShowModal(true);}}><Icon name="plus" size={18} /> Novo lançamento</button>
          </div>
        </header>

        {activeTab === "settings" && <div className="settings-page">
          <section className="panel settings-panel"><h2>Aparência</h2><p>Escolha o estilo do ORDEFIN. Sua preferência fica salva neste dispositivo.</p><div className="settings-theme-options">{([['system','Automático'],['light','Claro'],['dark','Escuro']] as const).map(([value,label])=><button key={value} type="button" className={appearance===value?'selected':''} onClick={()=>setAppearance(value)} aria-pressed={appearance===value}><span className={`appearance-preview ${value}`} aria-hidden="true"><i/><i/><i/></span>{label}</button>)}</div></section>
          <section className="panel settings-panel"><h2>Backup e restauração</h2><p>Faça uma cópia dos seus registros antes de atualizar o aplicativo. Restaurar substitui os dados atuais e reinicia o ORDEFIN.</p><div className="settings-actions"><button type="button" className="button primary" onClick={async()=>{try{const ok=await window.finora?.saveBackup();setSettingsMessage(ok?'Backup salvo com sucesso.':'Backup cancelado.');}catch(e){setSettingsMessage('Falha ao salvar backup: '+String(e));}}}>Salvar backup</button><button type="button" className="button" onClick={async()=>{if(!window.confirm('A restauração substituirá todos os dados financeiros atuais. Faça um backup antes de continuar. Deseja escolher um arquivo?'))return;try{const ok=await window.finora?.restoreBackup();if(!ok)setSettingsMessage('Restauração cancelada.');}catch(e){setSettingsMessage('Não foi possível restaurar: '+String(e));}}}>Restaurar backup</button></div></section>
          <section className="panel settings-panel"><h2>Categorias de lançamentos</h2><p>Organize as categorias disponíveis ao registrar receitas e despesas. As categorias já usadas em lançamentos são preservadas.</p><div className="settings-categories">{categories.map(cat=><div key={cat}><span>{cat}</span><button type="button" aria-label={`Remover ${cat}`} onClick={()=>{if(transactions.some(t=>t.category===cat)){setSettingsMessage('Esta categoria já possui lançamentos. Ela foi preservada.');return;}setCategories(old=>old.filter(c=>c!==cat));}}>Remover</button></div>)}</div><form className="settings-add-category" onSubmit={e=>{e.preventDefault();const name=newCategory.trim();if(!name||name.length>45||categories.some(c=>c.toLowerCase()===name.toLowerCase())){setSettingsMessage('Informe um nome único de até 45 caracteres.');return;}setCategories(old=>[...old,name]);setNewCategory('');setSettingsMessage('Categoria adicionada.');}}><input value={newCategory} onChange={e=>setNewCategory(e.target.value)} placeholder="Nova categoria" maxLength={45} aria-label="Nova categoria"/><button className="button primary" type="submit">Adicionar</button></form></section>
          {settingsMessage&&<p role="status" className="settings-message">{settingsMessage}</p>}
        </div>}
        {activeTab === "wallet" && <div className="premium-wallet"><Wallet accounts={accounts} cards={cards} transactions={transactions} transfers={transfers} payments={cardPayments} onAccounts={()=>setActiveTab("accounts")} onTransactions={()=>setActiveTab("transactions")} onDeleteCard={(id,name)=>void deleteSavedCard(id,name)} onEditCard={()=>setActiveTab("accounts")} cardMessage={cardMessage} /></div>}
        {activeTab === "dashboard" && (
          <div className="content dashboard-redesign">
            <section className="summary-grid" aria-label="Resumo financeiro">
              <article className="metric-card featured"><div className="metric-head"><span className="metric-icon"><Icon name="wallet" /></span></div><span className="metric-label">Saldo das contas</span><strong>{formatMoney(accounts.reduce((sum,a)=>sum+a.balance,0))}</strong><span className="metric-note">Saldos reais cadastrados; lançamentos sem conta não alteram este total</span></article>
              <article className="metric-card"><div className="metric-head"><span className="metric-icon violet"><Icon name="arrowUp" /></span></div><span className="metric-label">Receitas</span><strong>{formatMoney(totalIncome)}</strong><span className="metric-note">Entradas cadastradas no período</span></article>
              <article className="metric-card"><div className="metric-head"><span className="metric-icon coral"><Icon name="arrowDown" /></span></div><span className="metric-label">Despesas</span><strong>{formatMoney(totalExpenses)}</strong><span className="metric-note">{expenses.length} despesas</span></article>
              <article className="metric-card metric-net"><div className="metric-head"><span className="metric-icon"><Icon name="chart" /></span></div><span className="metric-label">Resultado do período</span><strong>{formatMoney(totalIncome-totalExpenses)}</strong><span className="metric-note">Receitas menos despesas · não inclui limites de crédito</span></article>
            </section>

            <div className="wallet-shortcut"><span>🏦 Consulte cada conta, cartão e movimentação no extrato unificado.</span><button className="button" onClick={()=>setActiveTab("wallet")}>Abrir Minha carteira →</button></div>
            <section className="panel ordefin-cards-panel" aria-label="Cartões de crédito detalhados">
              <div className="panel-head"><div><span className="eyebrow">Crédito separado do saldo bancário</span><h2>Meus cartões — débito e crédito</h2></div><button className="text-button" onClick={()=>setActiveTab('accounts')}>Gerenciar cartões →</button></div>
              <div className="ordefin-card-totals"><div><small>Limite total</small><strong>{formatMoney(cardsTotalLimit)}</strong></div><div><small>Total utilizado</small><strong>{formatMoney(cardsTotalUsed)}</strong></div><div><small>Crédito disponível</small><strong>{formatMoney(cardsTotalAvailable)}</strong></div></div>
              {cardMessage&&<p role="status" aria-live="polite">{cardMessage}</p>}<div className="ordefin-card-grid">{cards.map(c=><article key={c.id} className="ordefin-card-item"><h3>💳 {c.name}</h3><p>{c.issuer || "Emissor não identificado"} · {c.brand || "Bandeira não identificada"}{c.last_four ? ` · •••• ${c.last_four}` : ""}</p><p>Limite: <strong>{formatMoney(c.credit_limit)}</strong></p><p>Gasto acumulado: <strong>{formatMoney(c.used)}</strong></p><p>Disponível: <strong>{formatMoney(c.available)}</strong></p><progress max={Math.max(c.credit_limit,1)} value={Math.min(c.used,c.credit_limit)} /><div className="ordefin-card-actions" style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}><button className="button secondary" type="button" onClick={()=>setActiveTab("accounts")}>Editar cartão</button><button className="button secondary" type="button" style={{borderColor:"#c65361",color:"#ff929d"}} onClick={()=>void deleteSavedCard(c.id,c.name)}>Excluir cartão</button></div><details><summary>Ver compras deste cartão</summary>{transactions.filter(t=>t.card_id===c.id&&t.kind!=='receita').length===0?<p>Sem compras registradas.</p>:transactions.filter(t=>t.card_id===c.id&&t.kind!=='receita').map(t=><p key={t.id}>{new Date(t.date+'T12:00:00').toLocaleDateString('pt-BR')} · {t.description} · {formatMoney(t.amount)}</p>)}</details></article>)}</div>
              {cards.length===0&&<p>Cadastre seu primeiro cartão em Contas e transferências para acompanhar limites e compras aqui.</p>}
              <p className="market-note">Compras lançadas em cada cartão atualizam seu limite automaticamente. Limite de crédito não é saldo disponível em banco.</p>
            </section>
            <section className="panel annual-panel">
              <div className="panel-head">
                <div><span className="eyebrow">Resumo anual · {financialYear}</span><h2>Receitas e despesas ao longo do ano</h2></div>
                <div className="chart-legend">{(["Cartão", "Empréstimo", "Conta fixa"] as TransactionType[]).map((type) => <span key={type}><i style={{ background: typeColors[type] }} />{type}</span>)}</div>
              </div>
              <AnnualBarChart transactions={annualTransactions} />
            </section>

            <section className="dashboard-grid">
              <article className="panel distribution-panel">
                <div className="panel-head"><div><span className="eyebrow">Onde está indo seu dinheiro</span><h2>Despesas por tipo</h2></div><button className="text-button" onClick={() => setActiveTab("transactions")}>Ver detalhes <Icon name="chevron" size={15} /></button></div>
                <div className="distribution-content"><DonutChart data={typeData} /><div className="legend">{typeData.map((item) => <div className="legend-row" key={item.label}><span className="legend-color" style={{ background: item.color }} /><span>{item.label}</span><strong>{formatMoney(item.value)}</strong><small>{totalExpenses ? Math.round((item.value / totalExpenses) * 100) : 0}%</small></div>)}</div></div>
              </article>

              <article className="panel btc-preview">
                <div className="panel-head"><div><span className="eyebrow">Mercado em tempo real</span><h2>Bitcoin</h2></div><span className={btcError ? "connection offline" : "connection"}><i /> {btcError ? "Binance indisponível" : btcStatus}</span></div>
                <div className="btc-price"><span>BTC / BRL</span><strong>{btc ? formatMoney(btc.price) : btcError ? "Indisponível" : "Carregando..."}</strong>{btc && <span className={btc.change >= 0 ? "trend up" : "trend down"}>{btc.change >= 0 ? "+" : ""}{btc.change.toFixed(2)}% em 24h</span>}</div>
                <MiniChart values={btcValues} positive={!btc || btc.change >= 0} />
                <div className="btc-footer"><span>Cotação {btcSource ?? "Binance (aguardando)"}: {btc ? btc.updated.toLocaleString("pt-BR") : "--"}{!btcRecent ? " · Cotação pode estar desatualizada" : ""}{btcError ? " · Não foi possível atualizar" : ""}</span><button onClick={() => setActiveTab("bitcoin")}>Abrir cotação <Icon name="chevron" size={15} /></button></div>
              </article>
            </section>

            <section className="panel recent-panel">
              <div className="panel-head"><div><span className="eyebrow">Movimentação</span><h2>Últimos lançamentos</h2></div><button className="text-button" onClick={() => setActiveTab("transactions")}>Ver todos <Icon name="chevron" size={15} /></button></div>
              <TransactionList transactions={periodTransactions.slice(0, 5)} />
            </section>
          </div>
        )}

        {activeTab === "accounts" && (
          <div className="content accounts-redesign" style={{display:'grid',gap:14}}>
            <section className="panel" style={{padding:24}}>
              <h2>Minhas contas</h2>
              <p>Organize o dinheiro que você tem no banco ou em espécie. <strong>Opcional:</strong> você pode continuar registrando receitas e despesas sem cadastrar nenhuma conta.</p>
              <p>Saldo total das contas: <strong>{formatMoney(accounts.reduce((s,a)=>s+a.balance,0))}</strong></p>
              {accounts.length === 0 ? <p>Nenhuma conta cadastrada. Adicione uma conta para acompanhar seu saldo por banco ou carteira.</p> :
                <div className="ordefin-account-list">{accounts.map(a=><div key={a.id} className="ordefin-account-item account-summary-card"><div className="account-summary-top"><strong>{a.name}</strong><strong>{formatMoney(a.balance)}</strong></div><div className="account-summary-actions"><button className="button" type="button" onClick={()=>{setEditingAccount(a.id);setAccountMessage('');}}>Editar</button><button className="button" type="button" onClick={()=>void removeAccount(a)}>Excluir</button></div></div>)}</div>}
              {editingAccount!==null&&(()=>{const a=accounts.find(item=>item.id===editingAccount);return a?<div className="account-edit-overlay" role="presentation" onClick={()=>!accountSaving&&setEditingAccount(null)}><div className="account-edit-dialog" role="dialog" aria-modal="true" aria-label={`Editar conta ${a.name}`} onClick={e=>e.stopPropagation()}><h3>Editar conta</h3><p>Altere o nome ou informe o saldo que aparece no seu banco.</p><form key={a.id} onSubmit={e=>void saveAccountEdit(e,a.id)}><label>Nome da conta<input name="name" defaultValue={a.name} required maxLength={100}/></label><label>Saldo disponível (R$)<input name="account_amount" onChange={e=>{e.currentTarget.value=currencyInput(e.currentTarget.value);}} type="text" inputMode="numeric" defaultValue={a.balance.toFixed(2).replace('.',',')} required/></label><p className="account-edit-note">A correção ajusta o saldo sem apagar transferências, pagamentos ou compras.</p><div className="account-edit-actions"><button type="button" className="button" disabled={accountSaving} onClick={()=>setEditingAccount(null)}>Cancelar</button><button type="submit" className="button primary" disabled={accountSaving}>{accountSaving?'Salvando...':'Salvar alterações'}</button></div></form></div></div>:null;})()}

              <div className="v55-account-table-wrap"><div className="v55-section-heading"><h3>Visão detalhada das contas</h3><span>{accounts.length} {accounts.length===1?'conta cadastrada':'contas cadastradas'}</span></div><div className="v55-table-scroll"><table className="v55-table"><thead><tr><th>Nome</th><th>Instituição</th><th>Tipo</th><th>Saldo</th><th>Ações</th></tr></thead><tbody>{accounts.map(a=><tr key={a.id}><td><strong>{a.name}</strong></td><td>{a.name}</td><td>Conta bancária</td><td><strong>{formatMoney(a.balance)}</strong></td><td><button type="button" onClick={()=>{setEditingAccount(a.id);setAccountMessage('');}}>Editar</button><button type="button" className="v55-danger" onClick={()=>void removeAccount(a)}>Excluir</button></td></tr>)}{accounts.length===0&&<tr><td colSpan={5}>Nenhuma conta cadastrada.</td></tr>}</tbody></table></div></div>
              <details className="ordefin-account-action"><summary>+ Nova conta</summary>
              <p>Informe o nome e o saldo inicial da conta.</p>
              <form className="ordefin-new-account-form" onSubmit={createAccount}><label className="ordefin-new-account-field"><span>Nome da conta</span><input name="name" required maxLength={100} placeholder="Ex.: Nubank"/></label><label className="ordefin-new-account-field"><span>Saldo inicial (R$)</span><input name="opening_balance" onChange={e=>{e.currentTarget.value=currencyInput(e.currentTarget.value);}} type="text" inputMode="numeric" required defaultValue="0"/></label><button className="button primary ordefin-new-account-submit" type="submit" disabled={accountCreating}>{accountCreating ? "Adicionando..." : "Adicionar conta"}</button></form>
              {accountMessage && <p role="status" aria-live="polite">{accountMessage}</p>}
              </details>
              <details className="ordefin-account-action"><summary>Pagamentos de cartões {cardPayments.length>0 ? `(${cardPayments.length})` : ""}</summary><p>Edite ou estorne pagamentos registrados.</p>{cardPayments.length===0?<p>Nenhum pagamento de cartão registrado.</p>:cardPayments.map(payment=><div key={payment.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',padding:'12px 0',borderBottom:'1px solid rgba(150,160,170,.2)'}}><div><strong>{payment.card_name} — {formatMoney(payment.amount)}</strong><div style={{fontSize:12,opacity:.8}}>{payment.date.split('-').reverse().join('/')} • Conta: {payment.account_name||'Sem conta vinculada'}</div></div><div style={{display:'flex',gap:8}}><button className="button" onClick={()=>void changePayment(payment.id,payment.amount)}>Editar pagamento</button><button className="button" onClick={()=>void removePayment(payment.id,payment.amount)}>Estornar</button></div></div>)}</details>
            </section>
            <details className="panel transfer-collapsible" style={{padding:24}}><summary>Transferir entre contas</summary>

              <p>Use quando mover dinheiro de uma conta para outra, como do Nubank para a Caixa. Isso <strong>não é receita nem despesa</strong> e não altera o saldo total.</p>
              {accounts.length < 2 ? <p>Cadastre pelo menos duas contas para habilitar transferências.</p> :
                <form onSubmit={createTransfer} style={{display:'flex',gap:10,flexWrap:'wrap'}}><label>De<select name="source" required>{accounts.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></label><label>Para<select name="destination" required defaultValue={accounts[1]?.id}>{accounts.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></label><label>Valor (R$)<input name="amount" type="text" inputMode="decimal" placeholder="0,00" required/></label><label>Data<input name="date" type="date" required defaultValue={localDateForInput()}/></label><label>Observação (opcional)<input name="note" placeholder="Ex.: transferência PIX"/></label><button className="button primary" type="submit">Transferir</button></form>}
              {transferMessage && <p role="status" aria-live="polite">{transferMessage}</p>}
              <h3>Histórico de transferências</h3>
              {transfers.length === 0 ? <p>Nenhuma transferência registrada.</p> : transfers.map(t=><p key={t.id}>{new Date(`${t.date}T12:00:00`).toLocaleDateString('pt-BR')}: {accounts.find(a=>a.id===t.source_account_id)?.name ?? 'Conta'} → {accounts.find(a=>a.id===t.destination_account_id)?.name ?? 'Conta'} — <strong>{formatMoney(t.amount)}</strong>{t.note ? ` — ${t.note}` : ''}</p>)}
            </details>
          </div>
        )}
        {activeTab === "accounts" && (
          <section className="panel" style={{padding:24,marginTop:20}}>
            <h2>Meus cartões — débito e crédito</h2>
            <p>Cadastre cartões de débito, crédito ou múltiplos. O débito movimenta a conta; o crédito utiliza o limite.</p>
            {cards.length===0?<p>Nenhum cartão cadastrado.</p>:<div className="ordefin-manage-card-grid">{cards.map(c=><div key={c.id} className="ordefin-manage-card"><strong>{c.name}</strong>
              <div className="ordefin-card-identity"><span>Função: <strong>{c.card_mode==='ambos'?'Débito e crédito':c.card_mode==='debito'?'Somente débito':'Somente crédito'}</strong></span><span>Banco: <strong>{c.issuer || 'Não identificado'}</strong></span><span>Bandeira: <strong>{c.brand || 'Não identificada'}</strong></span>{c.last_four && <span>Final: •••• {c.last_four}</span>}</div>
              <button className="button secondary" type="button" onClick={()=>setEditingCardMode(editingCardMode===c.id?null:c.id)}>Alterar função</button>
              {editingCardMode===c.id&&<form onSubmit={e=>void updateCardMode(e,c.id)} style={{display:'grid',gap:8,marginTop:10}}><label>Função<select name="mode" defaultValue={c.card_mode}><option value="debito">Somente débito</option><option value="credito">Somente crédito</option><option value="ambos">Débito e crédito</option></select></label><label>Conta vinculada ao débito<select name="account_id" defaultValue={c.account_id||''}><option value="">Nenhuma</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><button className="button primary" type="submit">Salvar função</button></form>}
              <button className="button secondary" type="button" onClick={()=>setEditingCardIdentity(editingCardIdentity===c.id?null:c.id)}>{editingCardIdentity===c.id?'Cancelar':'Editar banco e bandeira'}</button>
              {editingCardIdentity===c.id && <form className="ordefin-card-identity-form" onSubmit={e=>void saveCardIdentity(e,c.id)}>
                <label>Nome do cartão<input name="name" defaultValue={c.name} required maxLength={100}/></label>
                <label>Banco emissor<input name="issuer" defaultValue={c.issuer||''} placeholder="Ex.: Inter" maxLength={100}/></label>
                <label>Bandeira<input name="brand" defaultValue={c.brand||''} placeholder="Ex.: Mastercard" maxLength={40}/></label>
                <button className="button primary" type="submit">Salvar identificação</button>
              </form>}
              <div className="ordefin-card-actions" style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10,marginBottom:10}}>
                <button className="button secondary" type="button" onClick={()=>{setEditingCardNumber(editingCardNumber===c.id?null:c.id);setReplacementNumber('');}}>{editingCardNumber===c.id?'Cancelar':'Alterar número'}</button>
                <button className="button secondary" type="button" style={{borderColor:'#c65361',color:'#ff929d'}} onClick={()=>void deleteSavedCard(c.id,c.name)}>Excluir cartão</button>
              </div>
              {editingCardNumber===c.id&&<form onSubmit={e=>void saveCardNumber(e,c)} style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'end',marginBottom:12}}>
                <label>Novo número do cartão<input type="text" inputMode="numeric" autoComplete="off" placeholder="0000 0000 0000 0000" value={replacementNumber.replace(/(\d{4})(?=\d)/g,'$1 ')} onChange={e=>setReplacementNumber(e.target.value.replace(/\D/g,'').slice(0,19))} required/></label>
                <button className="button primary" type="submit">Salvar número</button>
                <small>O número completo não será salvo. O banco poderá ser corrigido manualmente.</small>
              </form>}
              {c.card_mode!=='debito'&&<div>Limite total: {formatMoney(c.credit_limit)}</div>}{c.card_mode!=='debito'&&<><div>Utilizado: {formatMoney(c.used)}</div><div><strong>Disponível: {formatMoney(c.available)}</strong></div></>}<button className="button secondary" type="button" disabled={c.card_mode==='debito'} onClick={()=>setEditingCard(editingCard===c.id?null:c.id)}>{editingCard===c.id?'Cancelar edição':'Editar limite'}</button>{editingCard===c.id&&c.card_mode!=='debito'&&<form onSubmit={e=>void updateCardLimit(e,c.id)} style={{display:'flex',gap:8,marginTop:8}}><label>Novo limite (R$)<input name="limit" type="text" inputMode="decimal" defaultValue={c.credit_limit.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} required /></label><button className="button primary" type="submit">Salvar limite</button></form>}{c.card_mode!=='debito'&&<progress max={Math.max(c.credit_limit,1)} value={Math.min(c.used,c.credit_limit)} style={{width:'100%'}} />}
              {c.used > 0.009 && <details style={{marginTop:12}}>
                <summary style={{cursor:'pointer',fontWeight:600}}>Registrar pagamento e liberar limite</summary>
                <p style={{fontSize:13,opacity:.85}}>Informe quanto você já pagou deste cartão. O crédito disponível será recomposto, sem criar uma nova despesa.</p>
                <form onSubmit={e=>void payCard(e)} style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'end'}}>
                  <input type="hidden" name="card_id" value={c.id}/>
                  <label>Valor pago (R$)<input name="amount" type="text" inputMode="decimal" placeholder="Ex.: 200,00" required/></label>
                  <label>Data do pagamento<input name="date" type="date" required defaultValue={localDateForInput()}/></label>
                  <label>Pago com qual conta?<select name="account_id" defaultValue=""><option value="">Sem vincular conta</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name} — saldo: {formatMoney(a.balance)}</option>)}</select></label>
                  <button className="button primary" type="submit">Confirmar pagamento</button>
                </form>
                <p style={{fontSize:12,opacity:.75}}>Máximo a registrar: {formatMoney(c.used)}. Se escolher uma conta, o pagamento reduzirá o saldo dela.</p>
              </details>}</div>)}</div>}
            <div className="card-register-heading"><div><span className="eyebrow">Novo cartão</span><h3>Adicionar cartão</h3><p>Preencha os dados e escolha como ele será usado.</p></div></div>
            <form onSubmit={createCard} className="ordefin-card-register card-register-clean">
              <div className="card-register-section">
                <h4><span>1</span> Identificação</h4>
                <div className="card-register-fields">
                  <label className="card-register-number">Número do cartão<input name="card_number" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="0000 0000 0000 0000" value={cardNumber.replace(/(\d{4})(?=\d)/g,'$1 ')} onChange={e=>handleCardNumberChange(e.target.value)} required /></label>
                  <label>Banco emissor<input name="issuer" value={cardIssuer} onChange={e=>{cardManualIssuer.current=true;setCardIssuer(e.target.value)}} placeholder="Digite o banco, se necessário" /></label>
                  <label>Bandeira<select name="brand" value={cardBrand} onChange={e=>{cardManualBrand.current=true;setCardBrand(e.target.value)}}><option value="">Selecione a bandeira</option>{['Visa','Mastercard','Elo','American Express','Hipercard','Diners Club','Discover','JCB','Aura','EnRoute','Voyager','Outra'].map(b=><option key={b} value={b}>{b}</option>)}</select></label>
                  <label>Apelido (opcional)<input name="name" value={cardNickname} onChange={e=>setCardNickname(e.target.value)} placeholder="Ex.: Cartão principal" maxLength={100}/></label>
                </div>
                <p className="card-register-hint" role="status">{cardLookup || 'A bandeira pode ser sugerida automaticamente.'} Apenas os 8 primeiros dígitos são consultados. O número completo não é armazenado.</p>
              </div>
              <div className="card-register-section">
                <h4><span>2</span> Como você usa este cartão?</h4>
                <div className="card-mode-options" role="radiogroup" aria-label="Função do cartão">
                  {(['debito','credito','ambos'] as const).map(mode=><label key={mode} className={`card-mode-option ${newCardMode===mode?'is-selected':''}`}><input type="radio" name="card_mode" checked={newCardMode===mode} onChange={()=>setNewCardMode(mode)}/><span><strong>{mode==='debito'?'Débito':mode==='credito'?'Crédito':'Débito e crédito'}</strong><small>{mode==='debito'?'Usa o saldo da conta':mode==='credito'?'Usa um limite separado':'Duas funções no mesmo cartão'}</small></span></label>)}
                </div>
                <div className="card-register-fields card-register-finance">
                  {newCardMode!=='credito'&&<label>Conta vinculada ao débito<select value={newCardAccount} onChange={e=>setNewCardAccount(e.target.value)} required><option value="">Selecione uma conta</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name} — {formatMoney(a.balance)}</option>)}</select></label>}
                  {newCardMode!=='debito'&&<label>Limite de crédito (R$)<input name="limit" type="text" inputMode="decimal" placeholder="Ex.: 1.500,00" required /></label>}
                </div>
                <p className="card-register-hint">{newCardMode==='debito'?'No débito, o valor disponível é o saldo da conta vinculada.':newCardMode==='credito'?'No crédito, as compras reduzem o limite, não o saldo bancário.':'No débito, usa o saldo da conta. No crédito, usa o limite informado. Os valores ficam separados.'}</p>
              </div>
              <div className="card-register-footer"><span>Você poderá editar o cartão depois do cadastro.</span><button className="button primary" type="submit">Cadastrar cartão</button></div>
            </form>
            {cardMessage&&<p role="status">{cardMessage}</p>}
          </section>
        )}
        {activeTab === "transactions" && (
          <div className="content transactions-redesign">
            <section className="page-intro"><div><span className="eyebrow">Histórico dinâmico</span><h2>Todos os lançamentos</h2><p>Edite ou exclua registros; saldos e cartões serão recalculados.</p></div></section>
            <section className="ordefin-forecast-metrics" aria-label="Resumo e previsão"><div><span>Saldo atual em contas</span><strong>{formatMoney(bankBalanceCents/100)}</strong></div><div><span>Entradas no período</span><strong className="positive">{formatMoney(totalIncome)}</strong></div><div><span>Despesas registradas</span><strong className="negative">{formatMoney(totalExpenses)}</strong></div><div><span>Ainda a pagar (previsto)</span><strong>{formatMoney(pendingTotalCents/100)}</strong></div><div className={forecastCents<0?'forecast-negative':'forecast-positive'}><span>Saldo após pendências</span><strong>{formatMoney(forecastCents/100)}</strong></div></section>
            <section className={`ordefin-forecast-notice ${forecastCents<0?'is-negative':'is-positive'}`} role="status"><strong>{forecastCents<0?'Atenção: saldo previsto negativo':'Previsão de saldo'}</strong><p>{forecastCents<0?`Se pagar todas as pendências marcadas, faltarão ${formatMoney(Math.abs(forecastCents)/100)}.`:`Após pagar as pendências marcadas, a previsão é sobrar ${formatMoney(forecastCents/100)}.`}</p><small>Simulação baseada no saldo atual e nos lançamentos pendentes. Marcar uma despesa como paga debita a conta vinculada; compras no crédito só debitam a conta no pagamento da fatura.</small></section>
            <section className="panel ordefin-launch-panel"><div className="v54-filter-tabs" aria-label="Filtrar lançamentos">{([{id:"todos",label:"Todos"},{id:"entrada",label:"Receitas"},{id:"pago",label:"Pagos"},{id:"pendente",label:"Pendentes"}] as const).map(f=><button key={f.id} type="button" className={launchFilter===f.id?"active":""} onClick={()=>setLaunchFilter(f.id)}>{f.label}</button>)}</div><div className="ordefin-launch-toolbar"><div><span className="eyebrow">Controle doméstico</span><h2>Minhas contas e lançamentos</h2></div><label>Mostrar <select value={launchFilter} onChange={e=>setLaunchFilter(e.target.value as typeof launchFilter)}><option value="todos">Todos</option><option value="pago">Pagos</option><option value="pendente">A pagar</option><option value="entrada">Entradas</option></select></label></div><div className="ordefin-launch-scroll"><table className="ordefin-launch-table"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Tipo / Status</th><th>Valor</th><th>Ações</th></tr></thead><tbody>{visibleLaunches.map(t=><tr key={t.id}><td>{t.date.split('-').reverse().join('/')}</td><td><strong>{t.description}</strong></td><td>{t.category}</td><td>{accounts.find(a=>a.id===t.account_id)?.name ?? (t.card_id ? cards.find(c=>c.id===t.card_id)?.name : null) ?? "—"}</td><td>{t.kind==='receita'?<span className="launch-status income">ENTRADA</span>:<select className={`launch-status-select ${statusOf(t)==='pago'?'paid':'pending'}`} value={statusOf(t)} aria-label={`Situação de ${t.description}`} onChange={e=>void setLaunchStatus(t,e.target.value as 'pago'|'pendente')}><option value="pago">PAGA</option><option value="pendente">NÃO PAGO</option></select>}<small>{t.type}</small></td><td className={t.kind==='receita'?'positive':'negative'}>{t.kind==='receita'?'+ ':'− '}{formatMoney(t.amount)}</td><td><button type="button" onClick={()=>{setEditingTransaction(t);setShowModal(true)}}>Editar</button><button type="button" onClick={()=>void deleteTransaction(t)}>Excluir</button></td></tr>)}{visibleLaunches.length===0&&<tr><td colSpan={7} className="launch-empty">Nenhum lançamento encontrado. Use “Novo lançamento” para começar.</td></tr>}</tbody></table></div><p className="launch-footnote">Ao marcar PAGA, o pagamento é registrado na conta escolhida. Uma compra no crédito só reduz o saldo bancário ao pagar a fatura.</p></section>
            <section className="panel" style={{marginTop:20,padding:22}} aria-label="Histórico de pagamentos de cartões">
              <div className="panel-head"><div><span className="eyebrow">Pagamentos confirmados</span><h2>Histórico de faturas pagas</h2></div></div>
              <p style={{opacity:.8,marginBottom:18}}>Os pagamentos de faturas aparecem aqui mesmo quando não existem lançamentos no período. Eles reduzem o saldo bancário, mas não são somados novamente às despesas.</p>
              {(() => {
                const visiblePayments = cardPayments.filter(payment => {const date=new Date(`${payment.date}T12:00:00`);return date.getFullYear()===financialYear && (period==='Ano inteiro'||monthNamesLong[date.getMonth()]===period);});
                return visiblePayments.length===0?<p>Nenhum pagamento de cartão registrado neste período.</p>:<div style={{display:'grid',gap:12}}>{visiblePayments.map(payment=><div key={payment.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12,padding:'14px',border:'1px solid rgba(150,160,170,.25)',borderRadius:12}}><div><strong>✓ Pago · {payment.card_name}</strong><div style={{fontSize:13,opacity:.85,marginTop:5}}>{payment.date.split('-').reverse().join('/')} · Conta: {payment.account_name||'Sem conta bancária vinculada'}</div><strong style={{display:'block',marginTop:6}}>{formatMoney(payment.amount)}</strong></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="button" onClick={()=>void changePayment(payment.id,payment.amount)}>Editar pagamento</button><button className="button" onClick={()=>void removePayment(payment.id,payment.amount)}>Estornar</button></div></div>)}</div>;
              })()}
              {accountMessage&&<p role="status" style={{marginTop:12}}>{accountMessage}</p>}
            </section>
          </div>
        )}

        {activeTab === "investments" && <div className="investment-workspace"><Investments quotes={marketQuotes} clock={marketClock} /></div>}

        {activeTab === "bitcoin" && (
          <div className="content crypto-screen-compact crypto-screen-v52 crypto-screen-v54">
            <div className="crypto-top-row">
            <div className="crypto-overview">
            <section className={`bitcoin-hero bitcoin-compact-card crypto-color-card ${selectedCoinSymbol === "BTC" ? "crypto-btc-bronze" : ""}`} style={{'--coin-accent':selectedCoinTheme.color,'--coin-bg':selectedCoinTheme.dark} as React.CSSProperties}>
              <div className="crypto-currency-toggle" aria-label="Moeda de exibição"><button type="button" className={displayCurrency==='BRL'?'active':''} onClick={()=>setDisplayCurrency('BRL')}>BRL</button><button type="button" className={displayCurrency==='USD'?'active':''} onClick={()=>setDisplayCurrency('USD')}>USD</button></div>
              <div className="bitcoin-symbol crypto-coin-symbol" aria-hidden="true">{selectedCoinSymbol==='BTC' ? <Icon name="bitcoin" size={23} /> : selectedCoinSymbol.slice(0,3)}</div>
              <div className="bitcoin-title">
                <label className="crypto-coin-picker-label" htmlFor="crypto-coin-picker">Criptomoeda</label>
                <select id="crypto-coin-picker" className="crypto-coin-picker" value={marketSelected} onChange={e=>{setMarketSelected(e.target.value);setMarketQuoteFilter('BRL');}} aria-label="Escolher criptomoeda para cotação">
                  {quickCryptoCoins.map(c=><option key={c.symbol} value={`${c.symbol}BRL`}>{c.name} · {c.symbol}/BRL</option>)}
                  {!quickCryptoCoins.some(c=>`${c.symbol}BRL`===marketSelected)&&<option value={marketSelected}>{marketCurrentPair?`${marketCurrentPair.baseAsset}/${marketCurrentPair.quoteAsset}`:marketSelected}</option>}
                </select>
                <strong>{quickCoinPrice && marketSelected.endsWith('BRL') ? (displayCurrency==='BRL'?marketFormat(quickCoinPrice,'BRL'):(usdBrl?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'USD',maximumFractionDigits:quickCoinPrice/usdBrl.rate<1?8:2}).format(quickCoinPrice/usdBrl.rate):'US$ —')) : '—'}</strong>
                <span className={quickCoinChange!=null && quickCoinChange<0?'trend down':'trend up'}>{quickCoinChange!=null?`${quickCoinChange>=0?'+':''}${quickCoinChange.toFixed(2)}%`:'—'} <small>nas últimas 24h</small></span>
              </div>
              {displayCurrency==='USD'&&<small className="crypto-fx-note">USD convertido pela taxa de referência USD/BRL · atualização diária</small>}
              <div className="crypto-overview-meta"><span className={quickCoinUpdated && marketClock-quickCoinUpdated<120000 ? "crypto-live" : "crypto-stale"}>{quickCoinUpdated && marketClock-quickCoinUpdated<120000 ? "● Cotação recente" : "● Aguardando cotação"}</span><span>Fonte: Binance{quickCoinUpdated ? ` · ${new Date(quickCoinUpdated).toLocaleTimeString("pt-BR")}` : ""}</span></div>
            </section>
            </div>
              <article className="panel converter crypto-converter-compact" aria-label="Conversor rápido de criptomoedas">
                <div className="crypto-converter-head"><h2>Conversor rápido</h2></div>
                <div className="crypto-converter-modes"><button type="button" className={converterMode==='crypto'?'active':''} onClick={()=>setConverterMode('crypto')}>Cripto</button><button type="button" className={converterMode==='fiat'?'active':''} onClick={()=>setConverterMode('fiat')}>BRL / USD</button></div>
                {converterMode==='crypto'?<>
                  <label htmlFor="converter-coin">Criptomoeda</label>
                  <select id="converter-coin" value={converterCoin} onChange={e=>setConverterCoin(e.target.value)}>{quickCryptoCoins.map(c=><option key={c.symbol} value={c.symbol}>{c.name} ({c.symbol})</option>)}</select>
                </>:<><label htmlFor="fiat-direction">Direção</label><select id="fiat-direction" value={fiatDirection} onChange={e => { const direction = e.currentTarget.value; if (direction === "BRL_TO_USD" || direction === "USD_TO_BRL") setFiatDirection(direction) }}><option value="BRL_TO_USD">BRL → USD</option><option value="USD_TO_BRL">USD → BRL</option></select></>}
                <label htmlFor="converter-amount">{converterMode==='fiat'?(fiatDirection==='BRL_TO_USD'?'Valor em reais (BRL)':'Valor em dólares (USD)'):(converterDirection==='BRL_TO_COIN'?'Valor em reais (BRL)':`Quantidade em ${converterCoin}`)}</label>
                <input id="converter-amount" type="text" inputMode="decimal" value={brlAmount} onChange={e=>handleConverterAmountChange(e.target.value)} onBlur={()=>{if(!converterIsCryptoQuantity){setBrlAmount(v=>{const n=Number(v.replace(/\./g,'').replace(',','.'));return Number.isFinite(n)?new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n):'0,00'})}}} placeholder="0,00" />
                <button type="button" className="crypto-converter-swap" onClick={()=>{if(converterMode==='fiat')setFiatDirection(v=>v==='BRL_TO_USD'?'USD_TO_BRL':'BRL_TO_USD');else setConverterDirection(v=>v==='BRL_TO_COIN'?'COIN_TO_BRL':'BRL_TO_COIN');setBrlAmount('')}} aria-label="Inverter conversão"><Icon name="arrowDown" size={14}/> Inverter</button>
                <span className="crypto-converter-result-label">{converterMode==='fiat'?(fiatDirection==='BRL_TO_USD'?'Equivalente em USD':'Equivalente em BRL'):(converterDirection==='BRL_TO_COIN'?`Equivalente em ${converterCoin}`:'Equivalente em reais')}</span>
                <strong className="crypto-converter-result">{converterMode==='fiat'?(fiatResult===null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:fiatDirection==='BRL_TO_USD'?'USD':'BRL'}).format(fiatResult)):(converterResult===null?'—':converterDirection==='BRL_TO_COIN'?`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:8}).format(converterResult)} ${converterCoin}`:formatMoney(converterResult))}</strong>
                <p className="crypto-converter-note">{converterMode==='fiat'?(usdBrl?'Câmbio de referência · atualização diária · sem taxas':'Câmbio indisponível'):(converterError|| (converterQuote?`Binance · ${new Date(converterQuote.updated).toLocaleTimeString('pt-BR')} · sem taxas`:'Consultando cotação...'))}</p>
              </article>
            </div>
            <section className="bitcoin-grid">
              <article className="panel chart-panel crypto-dynamic-chart"><div className="panel-head"><div><span className="eyebrow">Histórico · Binance</span><h2>{selectedCoinSymbol}/{displayCurrency} · {chartPeriod}</h2></div><div className="crypto-chart-actions"><div className="crypto-periods">{(['24h','7d','30d'] as const).map(p=><button key={p} type="button" className={chartPeriod===p?'active':''} onClick={()=>setChartPeriod(p)}>{p}</button>)}</div><div className="crypto-periods crypto-chart-style"><button type="button" className={cryptoChartMode==='line'?'active':''} onClick={()=>setCryptoChartMode('line')}>Linha</button><button type="button" className={cryptoChartMode==='area'?'active':''} onClick={()=>setCryptoChartMode('area')}>Área</button></div></div></div>
                <div className="large-chart">{coinChartLoading&&coinChart.length===0?<p className="crypto-chart-message">Carregando histórico...</p>:coinChartError?<p className="crypto-chart-message">{coinChartError}</p>:displayCurrency==='USD'&&!usdBrl?<p className="crypto-chart-message">Aguardando taxa USD/BRL...</p>:<CryptoHistoryChart values={displayCurrency==='USD'&&usdBrl?coinChart.map(v=>v/usdBrl.rate):coinChart} currency={displayCurrency} mode={cryptoChartMode} positive={coinChart.length>1?coinChart[coinChart.length-1]>=coinChart[0]:true}/>}</div>
                <div className="chart-axis"><span>Mais antigo</span><span>Agora</span></div>{displayCurrency==='USD'&&<p className="crypto-fx-note">Histórico convertido para USD pela taxa de referência atual (não é série cambial histórica).</p>}
              </article>

            </section>
            {btcError && <div className="offline-banner"><Icon name="refresh" /><div><strong>Sem conexão com a cotação</strong><span>Exibindo o último valor salvo. Verifique sua internet e tente novamente.</span></div><button onClick={fetchBtc}>Tentar novamente</button></div>}
            <details className="crypto-expandable"><summary><span><strong>Explorar mercado</strong><small>Buscar moedas, pares e favoritos</small></span><Icon name="chevron" size={17}/></summary>
            <section className="panel market-panel" aria-label="Mercado Binance Spot">
              <div className="panel-head"><div><span className="eyebrow">Binance Spot · pares negociáveis</span><h2>Mercado de criptomoedas</h2></div><span className="market-status">{marketStatus}</span></div>
              <p className="market-note">Cotações públicas da Binance. Os pares e preços disponíveis são carregados automaticamente; os preços mudam quando a Binance publica novas negociações. Nenhuma ordem de compra ou venda é realizada.</p>
              <div className="market-controls">
                <input type="search" placeholder="Buscar moeda ou par (ex.: ETH, SOL, BTCBRL)" aria-label="Buscar criptomoeda" value={marketSearch} onChange={e=>setMarketSearch(e.target.value)}/>
                <select aria-label="Moeda de cotação" value={marketQuoteFilter} onChange={e=>setMarketQuoteFilter(e.target.value)}><option value="BRL">Em reais (BRL)</option><option value="USDT">Em USDT</option><option value="USDC">Em USDC</option><option value="BTC">Em BTC</option><option value="TODAS">Todos os pares</option></select>
                <label className="market-favorite-filter"><input type="checkbox" checked={marketOnlyFavorites} onChange={e=>setMarketOnlyFavorites(e.target.checked)}/> Só favoritos</label>
              </div>
              <div className="market-layout">
                <div className="market-list" role="list" aria-label="Pares da Binance">
                  <div className="market-list-caption">{marketFiltered.length} pares encontrados · exibindo até 100 por vez</div>
                  {marketFiltered.slice(0,100).map(pair => {
                    const quote=marketQuotes[pair.symbol];
                    return <div className={`market-item ${marketSelected===pair.symbol?"selected":""}`} key={pair.symbol} role="listitem">
                      <button className="market-star" aria-label={`${marketFavorites.includes(pair.symbol)?"Remover":"Adicionar"} ${pair.symbol} ${marketFavorites.includes(pair.symbol)?"dos":"aos"} favoritos`} onClick={()=>setMarketFavorites(old=>old.includes(pair.symbol)?old.filter(x=>x!==pair.symbol):[...old,pair.symbol])}>{marketFavorites.includes(pair.symbol)?"★":"☆"}</button>
                      <button className="market-pair" onClick={()=>setMarketSelected(pair.symbol)}><strong>{pair.baseAsset}<small>/{pair.quoteAsset}</small></strong><span>{quote?marketFormat(quote.price,pair.quoteAsset):"Aguardando..."}</span><em className={quote?.change && quote.change<0?"negative":"positive"}>{quote?`${quote.change>=0?"+":""}${quote.change.toFixed(2)}%`:"—"}</em></button>
                    </div>;
                  })}
                  {!marketFiltered.length && <p className="market-note">Nenhum par encontrado com estes filtros.</p>}
                </div>
                <div className="market-detail"><span className="eyebrow">Par selecionado</span><h3>{marketCurrentPair?`${marketCurrentPair.baseAsset}/${marketCurrentPair.quoteAsset}`:marketSelected}</h3><strong className="market-big-price">{marketCurrentPrice&&marketCurrentPair?marketFormat(marketCurrentPrice.price,marketCurrentPair.quoteAsset):"Aguardando cotação"}</strong><p className={marketCurrentPrice?.change && marketCurrentPrice.change<0?"negative":"positive"}>{marketCurrentPrice?`${marketCurrentPrice.change>=0?"+":""}${marketCurrentPrice.change.toFixed(2)}% nas últimas 24h`:"Sem variação disponível"}</p><p className="market-note">{marketCurrentPrice?`Última atualização do preço: ${new Date(marketCurrentPrice.updated).toLocaleString("pt-BR")}. ${marketClock-marketCurrentPrice.updated>30000?"Preço pode estar desatualizado ou sem negociações recentes.":""}`:"Aguardando dados da Binance."}</p><p className="market-note">A moeda após a barra é a unidade do preço. USDT e USDC não são reais.</p></div>
              </div>
            </section>
            </details>
            <details className="crypto-expandable"><summary><span><strong>Análise e investimentos em cripto</strong><small>Indicadores, histórico de compra e resultado estimado</small></span><Icon name="chevron" size={17}/></summary>
            <section className="panel ordefin-analysis" aria-label="Análise técnica da criptomoeda selecionada">
              <div className="panel-head"><div><span className="eyebrow">Análise técnica • Binance Spot</span><h2>Comprar, vender ou aguardar?</h2></div><label>Período <select value={analysisPeriod} onChange={e=>setAnalysisPeriod(e.target.value)}><option value="15m">15 minutos</option><option value="1h">1 hora</option><option value="4h">4 horas</option><option value="1d">1 dia</option></select></label></div>
              <p><strong>Moeda analisada:</strong> {marketCurrentPair?`${marketCurrentPair.baseAsset}/${marketCurrentPair.quoteAsset}`:marketSelected} · <strong>Variação 24h:</strong> {marketCurrentPrice?`${marketCurrentPrice.change>=0?'+':''}${marketCurrentPrice.change.toFixed(2)}%`:'Aguardando cotação'} · <strong>Preço:</strong> {marketCurrentPrice&&marketCurrentPair?marketFormat(marketCurrentPrice.price,marketCurrentPair.quoteAsset):'Indisponível'}</p>
              {analysisLoading&&<p>Consultando histórico e calculando indicadores...</p>}
              {analysisError&&<p role="alert">Análise indisponível: {analysisError}. Nenhum sinal será mostrado sem dados suficientes.</p>}
              {analysis&&!analysisLoading&&<><div className="ordefin-signal"><span>Tendência: <strong>{analysis.trend}</strong></span><strong className={analysis.action==='AVALIAR COMPRA'?'positive':analysis.action==='AVALIAR VENDA'?'negative':''}>{analysis.action}</strong><p>{analysis.reason}</p></div><p>RSI: <strong>{analysis.rsi.toFixed(1)}</strong> · MACD: <strong>{analysis.macd>0?'Positivo':'Negativo'}</strong> · Média 20: <strong>{analysis.sma20.toFixed(4)}</strong> · Média 50: <strong>{analysis.sma50.toFixed(4)}</strong></p><small>Análise calculada em {new Date(analysis.updated).toLocaleString('pt-BR')}. Atualização aproximada a cada 60 segundos; candles fechados. A variação de 24h não é, por si só, um sinal de negociação.</small></>}
              <div className="ordefin-holding" key={marketSelected}>
                <h3>Meu investimento — quanto ganho ou perco se vender agora?</h3>
                <p>Registre sua compra uma única vez. O preço e o valor investido ficam <strong>fixos</strong>; somente a cotação atual e a estimativa de venda são atualizadas pela Binance.</p>
                <div className="ordefin-purchase-price">
                  <div><span>Preço atual de 1 {marketCurrentPair?.baseAsset||'moeda'} em reais</span><strong>{marketBRLFresh&&marketBRLPrice!==null?formatMoney(marketBRLPrice):'Cotação em BRL indisponível'}</strong><small>{marketBRLFresh?`Fonte: Binance Spot (${brlSource}) · ${new Date(brlUpdated!).toLocaleString('pt-BR')}`:'Sem preço recente para converter este par com segurança.'}</small></div>
                  {currentPurchase&&<div><span>Preço de 1 {marketCurrentPair?.baseAsset||'moeda'} na sua compra</span><strong>{formatMoney(currentPurchase.buyPrice*(currentPurchase.buyCurrency==='USD'?currentPurchase.buyFxBRL:1))}</strong><small>{currentPurchase.buyCurrency==='USD'?`${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'USD'}).format(currentPurchase.buyPrice)} × câmbio histórico R$ ${currentPurchase.buyFxBRL.toLocaleString('pt-BR',{maximumFractionDigits:6})}`:'Cotação histórica em BRL informada por você'} · {currentPurchase.date}</small></div>}
                </div>
                <form onSubmit={e=>{
                  e.preventDefault();setPurchaseError('');
                  const f=new FormData(e.currentTarget);
                  const investedBRL=parseBRL(f.get('investedBRL'));
                  const buyPrice=parseBRL(f.get('buyPrice'));
                  const buyFxBRL=purchaseCurrency==='USD'?parseBRL(f.get('buyFxBRL')):1;
                  const date=String(f.get('buyDate')||'');
                  const historicalBRL=buyPrice*buyFxBRL;
                  if(![investedBRL,buyPrice,buyFxBRL,historicalBRL].every(n=>Number.isFinite(n)&&n>0)||!/^\d{4}-\d{2}-\d{2}$/.test(date)){
                    setPurchaseError('Preencha a data e valores positivos válidos. Exemplo brasileiro: 18.000,00.');return;
                  }
                  if(historicalBRL<0.00000001){setPurchaseError('Preço de compra muito pequeno. Confira o valor digitado.');return;}
                  const quantity=investedBRL/historicalBRL;
                  if(!Number.isFinite(quantity)||quantity<=0){setPurchaseError('Não foi possível calcular a quantidade. Confira os valores.');return;}
                  setCryptoPurchases(old=>({...old,[marketSelected]:{investedBRL,buyPrice,buyCurrency:purchaseCurrency,buyFxBRL,quantity,date,savedAt:Date.now()}}));
                }}>
                  <label>Quanto você investiu (R$)<input name="investedBRL" type="text" inputMode="decimal" defaultValue={currentPurchase?currentPurchase.investedBRL.toLocaleString('pt-BR',{minimumFractionDigits:2}):''} placeholder="Ex.: 100,00" required/></label>
                  <label>Preço de 1 {marketCurrentPair?.baseAsset||'moeda'} quando comprou
                    <input name="buyPrice" type="text" inputMode="decimal" defaultValue={currentPurchase?currentPurchase.buyPrice.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:8}):''} placeholder="Ex.: 18.000,00" required/>
                  </label>
                  <label>Moeda do preço na compra
                    <select value={purchaseCurrency} onChange={e=>setPurchaseCurrency(e.target.value as 'BRL'|'USD')}><option value="BRL">Real (BRL)</option><option value="USD">Dólar (USD)</option></select>
                  </label>
                  {purchaseCurrency==='USD'&&<label>Dólar em reais no dia da compra (USD/BRL)<input name="buyFxBRL" type="text" inputMode="decimal" defaultValue={currentPurchase?.buyCurrency==='USD'?currentPurchase.buyFxBRL.toLocaleString('pt-BR',{maximumFractionDigits:6}):''} placeholder="Ex.: 5,00" required/><small>Informe o câmbio histórico real da compra. Não usamos o dólar de hoje para calcular uma compra antiga.</small></label>}
                  <label>Data da compra<input name="buyDate" type="date" defaultValue={currentPurchase?.date||localDateForInput()} required/></label>
                  <button className="button primary" type="submit">{currentPurchase?'Atualizar dados da compra':'Salvar minha compra'}</button>
                </form>
                {purchaseError&&<p role="alert" className="negative">{purchaseError}</p>}
                {currentPurchase&&<div className="ordefin-profit-summary" aria-live="polite">
                  <div><span>Valor investido (fixo)</span><strong>{formatMoney(currentPurchase.investedBRL)}</strong></div>
                  <div><span>Quantidade comprada (fixa)</span><strong>{new Intl.NumberFormat('pt-BR',{maximumFractionDigits:10}).format(currentPurchase.quantity)} {marketCurrentPair?.baseAsset||''}</strong></div>
                  <div><span>Se vender tudo agora (estimativa)</span><strong>{currentInvestmentValue!==null?formatMoney(currentInvestmentValue):'Aguardando cotação BRL'}</strong></div>
                  <div className="ordefin-profit-result"><span>Lucro ou prejuízo bruto estimado</span><strong className={currentInvestmentResult===null?'':currentInvestmentResult>=0?'positive':'negative'}>{currentInvestmentResult!==null?`${currentInvestmentResult>=0?'+':'−'} ${formatMoney(Math.abs(currentInvestmentResult))}`:'Indisponível sem cotação recente'}</strong><small>{currentInvestmentResult!==null?`${(currentInvestmentResult/currentPurchase.investedBRL*100).toLocaleString('pt-BR',{maximumFractionDigits:2})}% sobre o investimento`:''}</small></div>
                </div>}
                <p className="market-note">Preço histórico e valor da compra são salvos localmente e não mudam com o mercado. Para compras em dólar, registre também o câmbio histórico. A conversão atual utiliza pares Spot da Binance em BRL quando disponíveis; não confunde USDT/USDC com USD. Estimativa antes de taxas, spread e impostos. Não registra uma venda real.</p>
              </div>
              <p className="market-note">Os sinais são estimativas de análise técnica, não ordens nem garantias de lucro. Queda não significa compra segura; alta não significa venda obrigatória. Confirme os riscos antes de negociar.</p>
            </section>
            </details>

          </div>
        )}
      </main>
      <nav className="mobile-nav" aria-label="Navegação móvel">
        <button className={activeTab === "dashboard" ? "active" : ""} onClick={() => setActiveTab("dashboard")}><Icon name="grid" /><span>Início</span></button>
        <button className={activeTab === "wallet" ? "active" : ""} onClick={() => setActiveTab("wallet")}><Icon name="wallet" /><span>Carteira</span></button>
        <button className={activeTab === "transactions" ? "active" : ""} onClick={() => setActiveTab("transactions")}><Icon name="card" /><span>Lançamentos</span></button>
        <button className={activeTab === "investments" ? "active" : ""} onClick={() => setActiveTab("investments")}><Icon name="chart" /><span>Investimentos</span></button>
        <button className={activeTab === "bitcoin" ? "active" : ""} onClick={() => setActiveTab("bitcoin")}><Icon name="bitcoin" /><span>Criptos</span></button>
      </nav>
      {showModal && <Modal key={editingTransaction?.id ?? "new"} editing={editingTransaction} accounts={accounts} cards={cards} categories={categories} onClose={() => {setShowModal(false);setEditingTransaction(null);}} onManageCards={() => {setShowModal(false);setEditingTransaction(null);setActiveTab("accounts");}} onSave={(transaction) => { const category = transaction.category.trim(); if (category && !categories.some(existing => existing.toLocaleLowerCase("pt-BR") === category.toLocaleLowerCase("pt-BR"))) setCategories(previous => [...previous, category]); void (editingTransaction ? updateTransaction : saveTransaction)({ ...transaction, category }); }} />}
    </div>
  );
}

function TransactionList({ transactions, onEdit, onDelete }: { transactions: Transaction[]; onEdit?: (t:Transaction)=>void; onDelete?: (t:Transaction)=>void }) {
  return (
    <div className="transaction-list">
      {transactions.length === 0 && <div className="transactions-empty"><strong>Nenhum lançamento neste período</strong><p>Use “Novo lançamento” para registrar receitas, despesas e compras no cartão. Os registros aparecerão aqui automaticamente.</p></div>}
      {transactions.map((transaction) => (
        <div className="transaction" key={transaction.id}>
          <span className="transaction-icon" style={{ color: categoryColors[transaction.category] || categoryColors.Outros, background: `${categoryColors[transaction.category] || categoryColors.Outros}16` }}><Icon name={transaction.type === "Cartão" ? "card" : transaction.type === "Empréstimo" ? "wallet" : "calendar"} /></span>
          <div className="transaction-main"><strong>{transaction.description}</strong><span>{transaction.category} · {transaction.type}</span></div>
          <span className="transaction-date">{new Date(`${transaction.date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</span>
          <strong className="transaction-value">{transaction.kind === "receita" ? "+ " : "− "}{formatMoney(transaction.amount)}</strong>
          {onEdit && onDelete && <div className="ordefin-transaction-actions"><button type="button" onClick={()=>onEdit(transaction)} aria-label={`Editar ${transaction.description}`}>Editar</button><button type="button" onClick={()=>onDelete(transaction)} aria-label={`Excluir ${transaction.description}`}>Excluir</button></div>}
        </div>
      ))}
    </div>
  );
}
