# Busca Vendas - Confweb

Aplicacao web para mostrar o potencial de vendas de um produto na internet, quanto os anuncios campeoes ja venderam e se existe espaco para entrar nesse mercado. O Mercado Livre e a primeira fonte de evidencias, e nao o unico canal de venda analisado pelo posicionamento do produto.

## O Que Tem No Projeto

- Frontend responsivo em React + Vite.
- Backend Node.js nativo com API HTTP.
- Banco SQLite local em `data/busca-vendas.sqlite`.
- Login/cadastro real, sessoes persistentes e painel admin.
- Controle de plano, limite de pesquisas, historico, suporte, dicas e contatos comerciais.
- Integracao oficial com o catalogo, detalhes de produtos e ranking de mais vendidos do Mercado Livre.
- Fontes externas opcionais para completar categorias que nao exponham tres produtos com vendas pela API oficial.

## Requisitos

- Node.js `20.20` ou superior.
- npm.
- Acesso a shell/terminal para instalar dependencias e rodar build.
- Em producao, use HTTPS para dominio proprio.

> Importante: o projeto usa SQLite por meio de `sql.js`, sem depender do modulo experimental `node:sqlite`.

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
- `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET` e `MELI_REDIRECT_URI`: credenciais da fonte oficial do Mercado Livre.
- `SCRAPEDO_API_TOKEN`: fallback residencial economico usado somente quando a fonte oficial nao completar o Top 3.

## Ordem Das Fontes

1. Base interna compartilhada, se a pesquisa ainda estiver dentro do prazo configurado.
2. Catalogo, detalhes de produtos e ranking oficial de mais vendidos do Mercado Livre.
3. Scrape.do com rede residencial brasileira, somente para completar resultados sem dados oficiais suficientes.

Zyte, Oxylabs, navegador local e proxy proprio ficam desativados por padrao.

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
