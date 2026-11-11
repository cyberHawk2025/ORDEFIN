# ORDEFIN

**Aplicativo desktop de controle financeiro pessoal para Windows.**

## Tecnologias

- Electron — aplicativo desktop Windows.
- React e TypeScript — tecnologias usadas na interface original, aqui disponibilizada apenas como arquivos compilados.
- Vite — ferramenta utilizada na compilação original da interface.
- SQLite — armazenamento local de dados financeiros.
- JavaScript (CommonJS e módulos ES) — processo principal e serviços.

## Funcionalidades

- Visão geral de saldos e movimentações.
- Lançamentos de receitas, despesas e pagamentos.
- Cadastro manual de contas e cartões de débito/crédito.
- Consulta de carteira e histórico de movimentações locais.
- Registro e acompanhamento de investimentos.
- Consulta de informações de criptomoedas, sujeita à disponibilidade de fontes externas.
- Temas de aparência e backup/restauração.

## Pré-requisitos

- Windows 10/11 (64 bits).
- Node.js LTS instalado (o npm é incluído).
- Conexão à internet para instalar as dependências e consultar serviços externos quando necessário.

## Baixar e executar pelo PowerShell (sem instalador)

1. Instale o [Node.js LTS](https://nodejs.org/) se ainda não estiver instalado.
2. Abra o PowerShell e execute os comandos abaixo para baixar e extrair o pacote:

```powershell
$download = Join-Path $HOME "Downloads"
$zip = Join-Path $download "ORDEFIN-main.zip"
Invoke-WebRequest -Uri "https://github.com/cyberHawk2025/ORDEFIN/archive/refs/heads/main.zip" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $download
Set-Location (Join-Path $download "ORDEFIN-main")
```

3. Na mesma janela do PowerShell, instale as dependências e inicie o aplicativo:

```powershell
node -v
npm.cmd -v
npm.cmd ci
npm.cmd run check:electron
npm.cmd run desktop:start
```

`npm.cmd ci` baixa e instala as dependências do projeto na pasta extraída. `desktop:start` abre o ORDEFIN; para fechar, encerre a janela do aplicativo. Esse processo executa o programa diretamente e **não cria nem instala um arquivo `.exe` de instalação**.

**Não execute `npm.cmd run build` nesta distribuição:** o script exige os arquivos-fonte da interface, que não acompanham este pacote. A interface compilada necessária para o Electron já está incluída em `dist/`.

## Estrutura do repositório

```text
ORDEFIN/
├── build/             # Ícones do aplicativo e do instalador
├── dist/              # Interface já compilada (necessária nesta edição)
├── electron/          # Processo principal, preload e banco de dados
├── services/          # Serviços do aplicativo
├── shared/            # Código compartilhado
├── package.json       # Scripts e configuração do instalador
├── package-lock.json  # Versões travadas das dependências
├── .gitignore         # Arquivos excluídos do Git
└── README.md          # Documentação
```

## Segurança e privacidade

Os registros financeiros são armazenados localmente. **Não envie para o GitHub bancos de dados reais, backups, extratos, credenciais ou arquivos `.env`.** O `.gitignore` contém regras para evitar a inclusão desses arquivos, mas revise o resultado de `git status` antes de cada commit.

Este repositório não realiza sincronização bancária automática. A consulta de cotações pode depender de serviços externos.

## Publicar no GitHub

1. Instale o Git e configure nome e e-mail (consulte `GUIA-GITHUB-VSCODE.md`).
2. Abra esta pasta no VS Code.
3. Crie no GitHub um repositório **vazio**, sem README, licença ou `.gitignore` adicionais.
4. Execute os comandos do guia para iniciar o Git e enviar os arquivos.
5. Confirme no GitHub que `README.md`, `dist/`, `electron/` e os demais arquivos aparecem corretamente.

## Observações

- Os arquivos de `dist/` são mantidos no Git **intencionalmente** porque o código-fonte da interface não foi fornecido.
- O nome e a versão do aplicativo permanecem conforme o pacote original.
- Nenhuma licença de redistribuição foi presumida ou adicionada. Antes de tornar o repositório público, revise os direitos sobre o código e os recursos utilizados.
