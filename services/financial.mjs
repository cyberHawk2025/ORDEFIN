import {
  assetKey,
  validDate,
  localDate,
  amount,
  fixedAccrual,
} from "../shared/investments.mjs"

const BINANCE = "https://data-api.binance.vision/api/v3"

export function createFinancialService({
  fetcher = fetch,
  now = Date.now,
  token = process.env.BRAPI_TOKEN || "",
} = {}) {
  const cache = new Map(),
    pending = new Map()

  async function request(url, options = {}) {
    let r
    try {
      r = await fetcher(url, { ...options, signal: AbortSignal.timeout(20000) })
    } catch {
      throw Error("Sem conexão ou serviço indisponível")
    }
    if (r.status === 429) {
      throw Error("Limite de consultas atingido (429)")
    }
    if (!r.ok)
      throw Error(
        `Fonte indisponível (HTTP ${r.status}); verifique cobertura e token`,
      )
    try {
      return await r.json()
    } catch {
      throw Error("Resposta inválida da fonte")
    }
  }

  function quote(price, date, source, kind = "market", extra = {}) {
    amount(price)
    if (!validDate(date)) throw Error("Data inválida na cotação")
    return {
      price: String(price),
      date,
      source,
      kind,
      fetchedAt: now(),
      stale: false,
      ...extra,
    }
  }

  // Consulta pública não oficial: sem token. Não garante disponibilidade nem tempo real.
  async function yahooChart(asset, fromDate = null) {
    const symbol = String(asset.symbol || "").trim().toUpperCase()
    if (!/^[A-Z0-9]{4,12}$/.test(symbol)) throw Error("Ticker B3 inválido")
    const period1 = fromDate ? Math.floor(Date.parse(fromDate + "T00:00:00Z") / 1000) - 8 * 86400 : Math.floor(now() / 1000) - 8 * 86400
    const period2 = Math.floor(now() / 1000) + 86400
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SA?period1=${period1}&period2=${period2}&interval=1d`
    const j = await request(url)
    const r = j.chart?.result?.[0]
    if (!r || r.meta?.currency !== "BRL" || r.meta?.symbol?.toUpperCase() !== symbol + ".SA")
      throw Error("Ticker B3 não encontrado na fonte gratuita")
    const prices = r.indicators?.quote?.[0]?.close || []
    const points = (r.timestamp || []).map((timestamp, i) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      price: prices[i],
    })).filter(x => Number.isFinite(x.price) && x.price > 0 && validDate(x.date))
    if (!points.length) throw Error("Fechamentos B3 indisponíveis na fonte gratuita")
    return points.map(x => ({ date: x.date, price: String(x.price) }))
  }

  // CoinGecko Demo API pública: somente ativos com IDs inequívocos.
  // Não usar conversão USD/USDT como BRL. Não exige token do usuário.
  const geckoIds = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", LTC: "litecoin", DOT: "polkadot", LINK: "chainlink", BCH: "bitcoin-cash", XLM: "stellar", AVAX: "avalanche-2", TRX: "tron", UNI: "uniswap", SHIB: "shiba-inu", USDC: "usd-coin", USDT: "tether" }
  async function geckoCurrent(symbol) {
    const id = geckoIds[symbol]
    if (!id) throw Error(`CoinGecko: símbolo ${symbol} sem ID validado`)
    const data = await request(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=brl&include_last_updated_at=true`)
    const entry = data?.[id]
    if (!entry || !Number.isFinite(Number(entry.brl)) || Number(entry.brl) <= 0)
      throw Error("CoinGecko: preço BRL inválido")
    const updated = Number(entry.last_updated_at) * 1000
    if (!Number.isFinite(updated) || updated <= 0 || updated > now() + 60000 || now() - updated > 300000)
      throw Error("CoinGecko: cotação desatualizada")
    return quote(entry.brl, localDate(), "CoinGecko · BRL · contingência", "market", { marketTime: updated })
  }

  // Fallback público CoinPaprika. IDs são validados pelo catálogo oficial,
  // evitando atribuir cotações de outra moeda com o mesmo símbolo.
  const paprikaIds = { BTC: "btc-bitcoin", ETH: "eth-ethereum", XRP: "xrp-xrp", SOL: "sol-solana", ADA: "ada-cardano", DOGE: "doge-dogecoin", LTC: "ltc-litecoin", DOT: "dot-polkadot", LINK: "link-chainlink", BCH: "bch-bitcoin-cash", XLM: "xlm-stellar", AVAX: "avax-avalanche", TRX: "trx-tron", UNI: "uni-uniswap", SHIB: "shib-shiba-inu", USDC: "usdc-usd-coin", USDT: "usdt-tether" }
  async function paprikaId(symbol) {
    const id = paprikaIds[symbol]
    if (!id) throw Error(`CoinPaprika: símbolo ${symbol} sem identificação verificada; cotação manual necessária`)
    return id
  }
  async function paprikaCurrent(symbol) {
    const id = await paprikaId(symbol)
    const data = await request(`https://api.coinpaprika.com/v1/tickers/${id}?quotes=BRL`)
    if (data.id !== id || data.symbol?.toUpperCase() !== symbol) throw Error("CoinPaprika retornou outro ativo")
    const price = data.quotes?.BRL?.price
    amount(price)
    return quote(price, localDate(), "CoinPaprika · cotação BRL · fonte alternativa", "market", { marketTime: Date.parse(data.last_updated) || now() })
  }
  async function paprikaHistory(symbol, fromDate) {
    const id = await paprikaId(symbol)
    // O endpoint gratuito de histórico tem janela limitada, conforme a política da fonte.
    const url = `https://api.coinpaprika.com/v1/tickers/${id}/historical?start=${fromDate}&end=${localDate()}&interval=24h&quote=brl`
    const rows = await request(url)
    if (!Array.isArray(rows)) throw Error("CoinPaprika: resposta histórica inválida")
    const points = rows.map(row => ({date: String(row.timestamp || "").slice(0,10), price: String(row.price)}))
      .filter(p => validDate(p.date) && p.date >= fromDate && p.date <= localDate() && Number.isFinite(Number(p.price)) && Number(p.price) > 0)
    if (!points.length) throw Error("CoinPaprika: histórico gratuito indisponível no período")
    return {source: "CoinPaprika · histórico diário BRL · fonte alternativa", points: [...new Map(points.map(p => [p.date,p])).values()].sort((a,b) => a.date.localeCompare(b.date))}
  }

  // Daily historical closes are retrieved in batches, never fabricated.
  async function history(asset, fromDate) {
    if (["Ação", "ETF", "FII"].includes(asset.category)) {
      if (!validDate(fromDate) || fromDate > localDate()) throw Error("Data inicial inválida")
      const points = (await yahooChart(asset, fromDate)).filter(x => x.date >= fromDate && x.date <= localDate())
      if (!points.length) throw Error("Histórico B3 indisponível no período")
      return { source: "Yahoo Finance · fechamento diário · fonte não oficial", points }
    }
    if (asset.category !== "Criptomoeda")
      throw Error("Histórico automático ainda não disponível para esta categoria; nenhuma cotação será inventada")
    const symbol = asset.symbol.trim().toUpperCase()
    if (!/^[A-Z0-9]{2,20}$/.test(symbol) || !validDate(fromDate) || fromDate > localDate())
      throw Error("Ativo ou data inicial inválidos")
    try {
      const pair = symbol + "BRL"
      const info = await request(`${BINANCE}/exchangeInfo?symbol=${pair}`)
      if (!info.symbols?.some(s => s.symbol === pair && s.quoteAsset === "BRL"))
        throw Error("Par BRL indisponível na Binance")
      const end = now()
      let cursor = Date.parse(fromDate + "T00:00:00Z")
      const points = []
      // Hard limit avoids unbounded requests; older histories require a dedicated provider.
      if (end - cursor > 5 * 366 * 86400000)
        throw Error("Histórico superior a cinco anos: fonte específica necessária")
      while (cursor < end) {
        const rows = await request(`${BINANCE}/klines?symbol=${pair}&interval=1d&startTime=${cursor}&limit=1000`)
        if (!Array.isArray(rows) || !rows.length) break
        for (const row of rows) {
          const t = Number(row[0]), close = Number(row[6])
          if (!Number.isFinite(t) || t >= end || !Number.isFinite(close)) continue
          // Only finalized candles: today's value is supplied separately by live quotes.
          if (close >= end) continue
          amount(row[4])
          points.push({ date: new Date(t).toISOString().slice(0,10), price: String(row[4]) })
        }
        const next = Number(rows.at(-1)[0]) + 86400000
        if (next <= cursor) break
        cursor = next
        if (rows.length < 1000) break
      }
      // A compra feita hoje ainda não possui candle diário fechado.
      // Incluímos apenas uma cotação spot REAL, identificada como intradiária.
      // Não criamos pontos artificiais para simular uma evolução.
      try {
        const live = await request(`${BINANCE}/ticker/price?symbol=${pair}`)
        if (live.symbol === pair) {
          amount(live.price)
          const today = localDate()
          if (today >= fromDate && !points.some(p => p.date === today))
            points.push({ date: today, price: String(live.price) })
        }
      } catch { /* O histórico fechado continua válido sem a cotação intradiária. */ }
      if (!points.length) throw Error("Sem fechamentos ou cotação spot disponíveis para o ativo")
      return { source: "Binance · fechamento diário UTC + spot intradiário quando disponível", points }
    } catch (binanceError) {
      try {
        const result = await paprikaHistory(symbol, fromDate)
        // Complementar o último dia somente com uma cotação REAL da fonte alternativa.
        if (!result.points.some(p => p.date === localDate())) {
          try {
            const live = await paprikaCurrent(symbol)
            result.points.push({ date: localDate(), price: live.price })
            result.points.sort((a,b) => a.date.localeCompare(b.date))
            result.source += " + cotação atual"
          } catch { /* Histórico existente continua válido. */ }
        }
        return result
      }
      catch (paprikaError) { throw Error(`Histórico indisponível. Binance: ${binanceError.message}; CoinPaprika: ${paprikaError.message}`) }
    }
  }

  async function raw(asset, date) {
    const symbol = asset.symbol.trim().toUpperCase()
    if (date && (!validDate(date) || date > localDate()))
      throw Error("Data inválida")

    if (asset.category === "Criptomoeda") {
      if (!/^[A-Z0-9]{2,20}$/.test(symbol)) throw Error("Símbolo inválido")
      try {
        const pair = symbol + "BRL"
  
        const info = await request(`${BINANCE}/exchangeInfo?symbol=${pair}`)
        if (
          !info.symbols?.some((s) => s.symbol === pair && s.quoteAsset === "BRL")
        )
          throw Error(
            "Par direto BRL indisponível; informe preço manual. Não usamos USDT como BRL.",
          )
  
        if (date) {
          const start = Date.parse(date + "T00:00:00Z")
          if (start + 86400000 > now()) {
            // The UTC day is still open: use the current spot price, explicitly
            // marked as intraday rather than pretending it is a daily close.
            const live = await request(`${BINANCE}/ticker/price?symbol=${pair}`)
            if (live.symbol !== pair) throw Error("Ativo retornado não corresponde ao solicitado")
            return quote(live.price, date, "Binance Spot · cotação intradiária BRL (dia ainda aberto)", "intraday", { provisional: true })
          }
          const rows = await request(
            `${BINANCE}/klines?symbol=${pair}&interval=1d&startTime=${start}&endTime=${start + 86399999}&limit=1`,
          )
          if (
            !Array.isArray(rows) ||
            !rows[0] ||
            Number(rows[0][0]) !== start ||
            Number(rows[0][6]) >= now()
          )
            throw Error("Preço histórico indisponível na data")
          return quote(
            rows[0][4],
            date,
            "Binance · fechamento diário UTC",
            "close",
          )
        }
  
        const r = await request(`${BINANCE}/ticker/price?symbol=${pair}`)
        if (r.symbol !== pair)
          throw Error("Ativo retornado não corresponde ao solicitado")
        return quote(r.price, localDate(), "Binance Spot · par BRL")
      } catch (binanceError) {
        try {
          if (date) {
            const result = await paprikaHistory(symbol, date)
            const point = result.points.filter(p => p.date <= date).at(-1)
            if (!point) throw Error("Cotação histórica indisponível para a data")
            return quote(point.price, point.date, result.source, "close", { requestedDate: date })
          }
          try { return await geckoCurrent(symbol) }
          catch (geckoError) {
            try { return await paprikaCurrent(symbol) }
            catch (paprikaError) {
              throw Error(`Cotação indisponível. Binance: ${binanceError.message}; CoinGecko: ${geckoError.message}; CoinPaprika: ${paprikaError.message}`)
            }
          }
        } catch (paprikaError) {
          throw paprikaError
        }
      }
    }

    if (["Ação", "ETF", "FII"].includes(asset.category)) {
      if (!/^[A-Z0-9]{4,12}$/.test(symbol)) throw Error("Ticker inválido")

      try {
      const start = date
        ? new Date(Date.parse(date + "T12:00:00Z") - 7 * 86400000)
            .toISOString()
            .slice(0, 10)
        : ""

      const query = date
        ? `?startDate=${start}&endDate=${date}&interval=1d&includeRaw=true`
        : ""

      const j = await request(
        `https://brapi.dev/api/quote/${symbol}${query}`,
        token ? { headers: { Authorization: `Bearer ${token}` } } : {},
      )
      const r = j.results?.find((r) => r.symbol === symbol)
      if (!r || r.currency !== "BRL") throw Error("Ativo BRL não encontrado")

      if (date) {
        const rows = (r.historicalDataPrice || [])
          .map((x) => ({
            ...x,
            day: new Date(x.date * 1000).toISOString().slice(0, 10),
          }))
          .filter((x) => x.day <= date && x.day >= start)
          .sort((a, b) => b.day.localeCompare(a.day))
        const row = rows[0]
        if (!row?.rawClose)
          throw Error(
            "Fechamento original indisponível. Histórico sem ajuste requer cobertura/plano brapi; informe o preço do comprovante.",
          )
        return quote(
          row.rawClose,
          row.day,
          "brapi · fechamento original (sem ajuste)",
          "close",
          { requestedDate: date },
        )
      }

      const timestamp = Date.parse(r.regularMarketTime)
      if (!Number.isFinite(timestamp)) throw Error("Horário da cotação ausente")
      return quote(
        r.regularMarketPrice,
        new Date(timestamp).toISOString().slice(0, 10),
        "brapi · B3",
        "market",
        { marketTime: timestamp, stale: now() - timestamp > 86400000 },
      )
      } catch (brapiError) {
        // A brapi sem token tem cobertura limitada. Usar uma segunda fonte gratuita.
        try {
          const points = await yahooChart(asset, date || null)
          const available = points.filter(x => !date || x.date <= date).sort((a,b) => b.date.localeCompare(a.date))
          const row = available[0]
          if (!row) throw Error("Cotação histórica não publicada para a data")
          return quote(row.price, row.date, "Yahoo Finance · B3 · fonte gratuita não oficial", date ? "close" : "market", date ? { requestedDate: date } : { stale: row.date !== localDate() })
        } catch (fallbackError) {
          throw Error(`Cotação B3 indisponível: ${String(fallbackError.message || fallbackError)}; brapi: ${String(brapiError.message || brapiError)}`)
        }
      }
    }

    if (["CDB", "CDI", "Prefixado", "IPCA"].includes(asset.category)) {
      if (asset.rateType === "unknown" || !asset.rateType)
        throw Error("Taxa contratada não informada; avaliação indisponível")

      if (asset.rateType === "ipca")
        throw Error(
          "IPCA+: a defasagem, aniversário e proporcionalidade dependem do contrato. Informe avaliação do extrato; não aplicamos inflação mensal como taxa diária.",
        )

      if (!validDate(asset.purchaseDate))
        throw Error("Data inicial do contrato ausente")

      const end = [
        date || localDate(),
        asset.maturity || "9999-12-31",
      ].sort()[0]
      const start = asset.purchaseDate

      if (end < start) throw Error("Avaliação anterior à aplicação")

      if (end === start)
        return quote("1", end, "Principal na data de aplicação", "estimate")

      if (Date.parse(end) - Date.parse(start) > 3660 * 86400000)
        throw Error(
          "Contrato superior a dez anos: informe avaliação do extrato",
        )

      let cursor = start,
        points = []

      while (cursor <= end) {
        const stop = new Date(
          Math.min(Date.parse(end), Date.parse(cursor) + 365 * 86400000),
        )
          .toISOString()
          .slice(0, 10)
        points.push(
          ...(await series(asset.rateType === "cdi" ? 12 : 11, cursor, stop)),
        )
        cursor = new Date(Date.parse(stop) + 86400000)
          .toISOString()
          .slice(0, 10)
      }

      points = points.filter((p) => p.date > start && p.date <= end)
      if (!points.length)
        throw Error("Sem dias úteis publicados para o período")

      const value = fixedAccrual(
        "1",
        asset.rateType,
        asset.rate,
        points,
        points.length,
      )
      if (value === null) throw Error("Dados insuficientes")

      return quote(
        value,
        points.at(-1).date,
        asset.rateType === "cdi"
          ? "BCB SGS 12 · acumulação diária × percentual CDI · estimativa bruta"
          : "Taxa prefixada contratada · base 252 · dias com Selic publicada (BCB 11) · estimativa bruta",
        "estimate",
        {
          stale:
            Date.parse(end) - Date.parse(points.at(-1).date) > 4 * 86400000,
        },
      )
    }

    throw Error(
      "Consulta automática não disponível para esta categoria; informe avaliação manual com data e fonte.",
    )
  }

  async function getQuote(asset, date) {
    const key = assetKey(asset) + "|" + (date || "current")
    const old = cache.get(key)
    const ttl = date ? 86400000 : 300000
    if (old && now() - old.fetchedAt < ttl) return old
    if (pending.has(key)) return pending.get(key)
    const task = raw(asset, date)
      .then((q) => {
        cache.set(key, q)
        return q
      })
      .catch((e) => {
        if (old && !date) return { ...old, stale: true, error: e.message }
        throw e
      })
      .finally(() => pending.delete(key))
    pending.set(key, task)
    return task
  }

  async function series(code, start, end) {
    if (
      ![12, 11, 433].includes(code) ||
      !validDate(start) ||
      !validDate(end) ||
      end < start
    )
      throw Error("Série ou período inválido")
    if (Date.parse(end) - Date.parse(start) > 366 * 86400000)
      throw Error("Consulte séries em períodos de até um ano")
    const br = (d) => d.split("-").reverse().join("/")
    const j = await request(
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?formato=json&dataInicial=${br(start)}&dataFinal=${br(end)}`,
    )
    if (!Array.isArray(j) || !j.length) throw Error("Série BCB indisponível")
    return j.map((x) => {
      const date = x.data?.split("/").reverse().join("-")
      if (
        !validDate(date) ||
        date < start ||
        date > end ||
        !Number.isFinite(Number(x.valor))
      )
        throw Error("Série BCB inválida")
      return {
        date,
        value: String(x.valor),
        source: `Banco Central SGS ${code}`,
      }
    })
  }

  return { getQuote, series, history }
}
