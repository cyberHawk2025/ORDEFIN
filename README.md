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
- Node.js e npm instalados.
- Conexão à internet para instalar as dependências e consultar serviços externos quando necessário.

## Executar pelo VS Code / PowerShell

Abra **a pasta deste repositório** no VS Code e use **Terminal > Novo Terminal**:

```powershell
node -v
npm.cmd -v
npm.cmd ci
npm.cmd run check:electron
npm.cmd run desktop:start
```

`desktop:start` inicia a aplicação Electron usando a interface existente em `dist/`. Para fechar, encerre a janela do aplicativo.

## Criar o instalador para Windows

No terminal do VS Code, dentro da pasta do projeto:

```powershell
npm.cmd ci
npm.cmd run encapsular
```

Se a compilação do instalador terminar sem erros, procure o arquivo `.exe` na pasta `release/`. Essa pasta é ignorada pelo Git.

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
