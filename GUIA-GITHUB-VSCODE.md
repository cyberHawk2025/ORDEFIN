# Publicar o ORDEFIN no GitHub pelo VS Code

## 1. Preparação

Instale o [Git para Windows](https://git-scm.com/downloads/win) e o [Node.js LTS](https://nodejs.org/) (22.12 ou mais recente), se necessário. Extraia o ZIP do projeto em uma pasta no computador e abra essa pasta no VS Code usando **Arquivo > Abrir Pasta**.

No VS Code, abra **Terminal > Novo Terminal** e confira as ferramentas:

```powershell
git --version
node -v
npm.cmd -v
pnpm.cmd -v
```

Se o pnpm ainda não estiver instalado, execute `npm.cmd install --global pnpm@10` e abra um novo terminal.

Se for a primeira vez usando o Git nesse computador, configure a identidade do commit usando **seus próprios dados**:

```powershell
git config --global user.name "SEU NOME"
git config --global user.email "SEU_EMAIL_DO_GITHUB"
```

## 2. Crie um repositório no GitHub

Acesse https://github.com/new, escolha um nome (por exemplo, `ORDEFIN`) e a visibilidade desejada. **Não marque** as opções de criar README, `.gitignore` ou licença, pois esses arquivos já estão no pacote.

Copie a URL HTTPS do novo repositório, no formato:

`https://github.com/SEU_USUARIO/ORDEFIN.git`

## 3. Inicie o Git e envie o projeto

No terminal do VS Code, dentro da pasta extraída, execute os comandos **um por vez**:

```powershell
git init
git branch -M main
git add .
git status
git commit -m "Publica edicao ORDEFIN sem conexao bancaria"
git remote add origin https://github.com/SEU_USUARIO/ORDEFIN.git
git push -u origin main
```

**Troque `SEU_USUARIO` pelo seu usuário do GitHub.** O comando `git status` permite revisar os arquivos antes do commit. O GitHub pode pedir autenticação no navegador; use o método de login indicado pelo Git Credential Manager. **Não cole senhas ou tokens dentro dos arquivos do projeto.**

Se `git remote add origin` informar que `origin` já existe, confira `git remote -v` e, se necessário, use:

```powershell
git remote set-url origin https://github.com/SEU_USUARIO/ORDEFIN.git
```

Se o repositório remoto não estiver vazio, não force o envio sem antes conferir o histórico; crie um repositório vazio ou integre as alterações com cuidado.

## 4. Próximas atualizações

Depois de alterar arquivos:

```powershell
git status
git add .
git commit -m "Atualiza projeto ORDEFIN"
git push
```

No VS Code, também é possível usar o painel **Controle de Código-Fonte** para revisar alterações, criar commits e sincronizar.

## 5. Instalar dependências, testar e executar

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd run check:types
pnpm.cmd test
pnpm.cmd run check:electron
pnpm.cmd run build
pnpm.cmd run desktop:start
```

`desktop:start` abre o aplicativo sem criar um instalador. Não envie `release/`, `node_modules/`, bancos de dados ou backups ao GitHub.

## 6. Dados e privacidade

O código-fonte, os testes e as configurações de compilação estão incluídos no repositório. Verifique cuidadosamente que nenhum dado financeiro pessoal, arquivo `.db`, backup, credencial ou arquivo `.env` seja incluído nos commits.
