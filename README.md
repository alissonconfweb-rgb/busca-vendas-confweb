# Busca Vendas - Confweb

Aplicacao web para mostrar o potencial de vendas de um produto, quanto os anuncios campeoes ja venderam e se existe espaco para entrar nesse mercado. A Scrape.do coleta as evidencias publicas dos anuncios do Mercado Livre e a base interna reaproveita somente resultados ainda validos.

## O Que Tem No Projeto

- Frontend responsivo em React + Vite.
- Backend Node.js nativo com API HTTP.
- Banco SQLite local em `data/busca-vendas.sqlite`.
- Login/cadastro real, sessoes persistentes e painel admin.
- Controle de plano, limite de pesquisas, historico, suporte, dicas e contatos comerciais.
- Coleta via Scrape.do com validacao de preco e vendas na pagina de cada anuncio.
- Cache versionado que descarta metricas antigas ou sem origem comprovada.

## Requisitos

- Node.js `20.20` ou superior.
- npm.
- Acesso a shell/terminal para instalar dependencias e rodar build.
- Em producao, use HTTPS para dominio proprio.

> Importante: o projeto usa SQLite por meio de `better-sqlite3`, sem depender do modulo experimental `node:sqlite`.

## Rodar Localmente

```bash
git clone https://github.com/alissonconfweb-rgb/busca-vendas-confweb.git
cd busca-vendas-confweb
cp .env.example .env
npm install
npm run build
npm start
```

Acesse:

```text
http://127.0.0.1:3001
```

Para desenvolvimento com frontend e backend separados:

```bash
npm run dev
```

## Configurar Admin

No arquivo `.env`, preencha:

```env
CREATOR_EMAIL=seu-email@dominio.com
ADMIN_EMAIL=admin@dominio.com
ADMIN_PASSWORD=sua-senha-forte
SESSION_SECRET=uma-chave-longa-e-unica
```

Ao iniciar o servidor, o admin e criado/atualizado automaticamente. Tambem e possivel rodar:

```bash
npm run admin:create
```

## Variaveis De Ambiente

Use `.env.example` como base. As principais sao:

- `CREATOR_EMAIL`: e-mail que sempre tera permissao de criador/admin. Se ficar vazio, usa `ADMIN_EMAIL`.
- `ADMIN_EMAIL` e `ADMIN_PASSWORD`: admin inicial.
- `SESSION_SECRET`: chave obrigatoria para sessoes seguras.
- `PUBLIC_URL`: URL final da aplicacao em producao.
- `SCRAPEDO_API_TOKEN`: credencial obrigatoria da fonte principal de novas pesquisas.
- `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET` e `MELI_REDIRECT_URI`: opcionais e usados apenas no diagnostico administrativo da conta Mercado Livre.

## Ordem Das Fontes

1. Base interna compartilhada, somente se o resultado usar os parsers atuais e ainda estiver dentro do prazo configurado.
2. Scrape.do para consultar a listagem e validar preco e vendas na pagina de cada anuncio.

Mercado Livre Search oficial, Zyte, Oxylabs, navegador local e proxy proprio nao participam do fluxo de pesquisa.

Nunca commite `.env`, banco SQLite real, arquivos de build ou credenciais.

## Deploy

Consulte o guia completo em [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
Para o servidor/cPanel da Confweb, use tambem [docs/CPANEL_CONFWEB.md](docs/CPANEL_CONFWEB.md).

Resumo do processo:

```bash
npm install --include=dev
npm run build
npm start
```

O servidor serve a pasta `dist` e a API no mesmo dominio.

## Dados E Backups

O banco fica em:

```text
data/busca-vendas.sqlite
```

Em producao, faca backup da pasta `data`. Em plataformas com disco efemero, configure volume persistente ou migre para um banco externo antes de vender em escala. Tambem e possivel definir `DB_PATH=/var/data/busca-vendas.sqlite` para apontar o SQLite para um disco persistente.

## Contribuicao

Leia [CONTRIBUTING.md](CONTRIBUTING.md) para padrao de branches, commits e revisao.

## Licenca

MIT. Veja [LICENSE](LICENSE).
