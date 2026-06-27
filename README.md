# Busca Vendas - Confweb

Aplicacao web para validar demanda de produtos em marketplaces antes de comprar estoque. O usuario pesquisa uma palavra-chave, cria conta quando tenta consultar, recebe 1 pesquisa gratis e depois e direcionado para os planos.

## O Que Tem No Projeto

- Frontend responsivo em React + Vite.
- Backend Node.js nativo com API HTTP.
- Banco SQLite local em `data/busca-vendas.sqlite`.
- Login/cadastro real, sessoes persistentes e painel admin.
- Controle de plano, limite de pesquisas, historico, suporte, dicas e contatos comerciais.
- Integracao opcional com Oxylabs para buscar dados em paginas publicas do Mercado Livre.
- Integracao opcional com OAuth/API Mercado Livre, caso o app seja liberado pelo Mercado Livre.

## Requisitos

- Node.js `22.5` ou superior.
- npm.
- Acesso a shell/terminal para instalar dependencias e rodar build.
- Em producao, use HTTPS para dominio proprio.

> Importante: o projeto usa `node:sqlite`, disponivel nas versoes modernas do Node. Hospedagens com Node antigo nao vao rodar sem adaptar o banco.

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
- `OXYLABS_USERNAME` e `OXYLABS_PASSWORD`: credenciais da Oxylabs, se usar Web Unblocker.
- `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET` e `MELI_REDIRECT_URI`: credenciais Mercado Livre, se usar OAuth.

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
