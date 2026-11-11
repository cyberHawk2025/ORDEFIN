# ORDEFIN — versão 2.1.0

Controle financeiro pessoal para Windows, baseado na V94, com React, TypeScript, Vite, Electron e SQLite. Mantém Dashboard, lançamentos, contas, cartões, carteira e Criptomoedas. As melhorias são incrementais em Meus investimentos.

## Requisitos e execução no Windows

Windows 10/11 x64; Node.js 22.12 ou mais recente (o npm vem incluído); pnpm; internet para baixar dependências e obter cotações.

### Baixar e executar pelo PowerShell (sem instalador)

1. Instale o [Node.js LTS](https://nodejs.org/) se ainda não estiver instalado.
2. Se o pnpm ainda não estiver instalado, instale-o uma vez pelo PowerShell:

```powershell
npm.cmd install --global pnpm@10
```

3. Baixe o ZIP da branch `main` do GitHub e extraia-o em `Downloads`:

```powershell
$download = Join-Path $HOME "Downloads"
$zip = Join-Path $download "ORDEFIN-main.zip"
Invoke-WebRequest -Uri "https://github.com/cyberHawk2025/ORDEFIN/archive/refs/heads/main.zip" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $download
Set-Location (Join-Path $download "ORDEFIN-main")
```

Se a pasta `ORDEFIN-main` já existir, extraia o ZIP em outro local para evitar conflito. Na pasta extraída, execute:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd run check:types
pnpm.cmd test
pnpm.cmd run check:electron
pnpm.cmd run build
pnpm.cmd run desktop:start
```

O `desktop:start` compila a interface e abre o ORDEFIN diretamente; não cria instalador. Para desenvolvimento com atualização automática, use `pnpm.cmd run desktop:dev`. No PowerShell, use os comandos `.cmd`; não é necessário alterar a política de execução.

O desenvolvimento usa `ORDEFIN-development`, separado do perfil instalado. Para testes, é possível definir `$env:ORDEFIN_DATA_DIR` com caminho absoluto para um diretório exclusivo. Não aponte testes ao diretório de dados real.

## Estrutura

- `src/App.tsx`: aplicação principal preservada.
- `src/Investments.tsx`, `InvestmentCharts.tsx`, `investments.css`: carteira, formulários e gráficos.
- `shared/investments.mjs`: motor decimal, validação e séries de aportes.
- `services/financial.mjs`: Binance, brapi e Banco Central.
- `services/official.mjs`: arquivos oficiais Tesouro e CVM.
- `electron/database.cjs`: schema, migração e snapshot.
- `electron/investment-store.mjs`: persistência e movimentos bancários atômicos.
- `electron/main.cjs`, `preload.cjs`: processo principal e ponte isolada.
- `tests/`, `scripts/`: testes, compilação e verificação de fontes.
- `build/`: ícones do aplicativo e do instalador.

## Investimentos e cálculos

Compras são eventos imutáveis, com data, quantidade, valor bruto e custos separados. Vendas usam **custo médio ponderado móvel**, na ordem de data e inserção para o mesmo dia. Custos de compra entram na base; custos de venda reduzem o recebido. Venda acima da quantidade disponível na data é rejeitada. Encerramento e recompra mantêm o histórico.

`decimal.js` usa 40 dígitos significativos e arredondamento HALF_UP. Quantidades são armazenadas como texto decimal; somente apresentação monetária arredonda para centavos. Aportes sem quantidade podem ser registrados, mas ficam sem avaliação e precisam ser completados antes da venda. Quantidade inferida por preço de referência é estimada.

CDB/CDI/prefixados: cada aplicação identifica um contrato separado. Quantidade representa reais de principal; resgate parcial informa principal resgatado, valor bruto e custos. CDI aplica os fatores diários publicados multiplicados pelo percentual contratado. Prefixados usam base 252 e dias com Selic publicada. A convenção do período considera dias publicados posteriores à aplicação, até a avaliação/vencimento. São estimativas brutas: contrato, liquidez e extrato prevalecem. IPCA+ contratual exige avaliação manual enquanto não houver regras suficientes de defasagem e proporcionalidade. Tesouro usa PU de compra como referência de aquisição e PU de venda para avaliação por tipo/vencimento.

Não são calculados impostos, cupons, dividendos, amortizações, desdobramentos ou grupamentos automaticamente. Esses eventos podem tornar uma posição cadastrada desatualizada; reconciliação específica permanece pendente.

## Fontes e limites

- [Binance Spot](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md): par BRL validado; histórico de fechamento diário UTC. Sem par BRL, cadastro manual. Não trata USDT como reais.
- [brapi](https://brapi.dev/docs/acoes): ações, ETFs e FIIs conforme cobertura. Histórico exige preço original `rawClose`, sem substituir por ajustado. PETR4 respondeu sem token no teste real; outros ativos/dados dependem do plano. Configure `$env:BRAPI_TOKEN="seu-token"` **antes** de abrir o aplicativo. O token fica no processo principal, não no bundle da interface.
- Banco Central SGS: séries 12 (CDI diário), 11 (Selic diária) e 433 (IPCA mensal). Consultas em períodos limitados; IPCA mensal não é usado como taxa diária.
- [Tesouro Nacional](https://www.tesourotransparente.gov.br/ckan/dataset/taxas-dos-titulos-ofertados-pelo-tesouro-direto): CSV de PU e taxas, identificado por título e vencimento.
- [CVM](https://dados.cvm.gov.br/dataset/fi-doc-inf_diario): cotas por CNPJ/classe/subclasse nos arquivos mensais. Não confundir fundo tradicional com FII. Arquivos antigos anteriores a 2021 ainda exigem adaptação.
- [B3](https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/mercado-a-vista/series-historicas/): série pública pesquisada; importação direta COTAHIST pendente. Cobertura automatizada B3 usa brapi.

Datas efetivas e fontes são apresentadas. Quando a data solicitada não tem negociação, o preço anterior disponível é identificado; nenhuma consulta usa o preço atual como histórico. Cache de mercado de 5 minutos; arquivos oficiais de até 6 horas; atualização ao abrir, por botão e periodicamente com a guia visível. Falhas preservam a última referência válida com aviso. Limites 429 geram espera. Consulta real reproduzível: `pnpm.cmd run test:live`.

## Gráficos

Aportes usam datas efetivas, sem curvas artificiais. Distribuição usa custo das posições abertas. Avaliações de carteira começam nas observações completas registradas pelo aplicativo; não há reconstrução retroativa completa nem interpolação de períodos sem dados. Uma carteira parcialmente avaliada não é gravada como patrimônio completo.

## Dados, migrações e backup

SQLite permanece em `finora.sqlite` no `userData` do Electron. `appId` e nome de produção da V94 são mantidos. Migrações criam snapshot consistente antes de alteração de schema e executam em transação. Banco de versão futura é recusado, sem rebaixamento. Instalação nova não recebe dados financeiros de teste.

Ao abrir Meus investimentos pela primeira vez, registros v2 são importados uma única vez e o conteúdo bruto v1/v2 é arquivado no SQLite. As chaves originais não são apagadas. v1 é preservado, mas seu formato ainda exige revisão para importação. Uma carteira v2 ilegível bloqueia a importação, sem substituí-la por dados vazios.

Use Configurações para salvar/restaurar backup SQLite. **Abra Meus investimentos antes de fazer o primeiro backup da atualização**, para incluir os registros antigos importados. Carteira nova, operações, cotações e vínculos bancários entram no backup SQLite. Preferências e dados próprios da guia Criptomoedas ainda utilizam localStorage e não estão no backup SQLite; preserve também o perfil completo do aplicativo ao migrar de computador. Restauração substitui o banco após confirmação e cópia de segurança. Desinstalação não remove os dados automaticamente.

Movimentos de investimento são vinculados por ID único e gravados junto à operação. Compra debita bruto+custos; venda credita bruto−custos. Não geram despesas de consumo. Se o saldo já refletir a operação, selecione a opção correspondente e informe referência. Lançamentos antigos classificados como despesa não são reclassificados automaticamente.

## Aparência e valores

Claro, escuro e automático já existiam na V94 e foram preservados e testados. Máscara monetária de centavos nos lançamentos, investimentos e campos de conta: `150000` → `1.500,00`. Quantidades, preços unitários e percentuais aceitam entrada decimal própria, preferencialmente com vírgula, sem máscara de centavos.

## Ícones

`build/instalador.ico`: instalador/desinstalador. `build/programa.ico`: executável e atalhos. Os dois desenhos foram localizados na pasta local ORDEFIN-V98-Icones-Instalador-e-Atalho: quadrado no instalador, circular no programa. PNGs originais preservados, sem redesenho. Os ICOs contêm múltiplas resoluções, incluindo 256 px.

## Testes e diagnóstico

```powershell
pnpm.cmd test
pnpm.cmd run check:types
pnpm.cmd run check:electron
pnpm.cmd run check:release
pnpm.cmd run test:electron
pnpm.cmd run test:live
```

O teste Electron usa Playwright e cria um perfil temporário; cobre compra/venda via interface, saldos, máscara, temas e reabertura. Instale as dependências de desenvolvimento. `ORDEFIN_EXE` permite apontar o teste ao executável empacotado. Não configura nem usa perfil financeiro real.

Se `node` ou `npm` não for encontrado, instale o Node.js e abra outro PowerShell. Se `pnpm.cmd` não for encontrado, instale o pnpm 10 com `npm.cmd install --global pnpm@10`. Se Electron não tiver binário, reinstale as dependências. Falhas de API não devem ser corrigidas alterando saldos ou inventando cotações.

## Pendências

importação automática v1; reconstrução histórica completa e desempenho por lote após vendas; eventos corporativos/proventos; cálculo contratual IPCA+ e impostos; suporte CVM anterior a 2021; importação direta B3. Apenas os ícones da pasta local V98 foram incorporados; código experimental V95–V98 não foi integrado.
