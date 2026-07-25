# Deploy Na Hostinger VPS

Arquitetura:

- `app`: Node.js 22 servindo API e frontend.
- `caddy`: proxy reverso com HTTPS automatico.
- `data/`: banco persistente, fora da imagem Docker.
- `backups/`: copias diarias locais do banco.

## 1. Preparar O VPS

Use Ubuntu 24.04 com Docker ou o template Docker da Hostinger. Libere no firewall:

- TCP `22` para SSH, de preferencia apenas para o IP da administracao.
- TCP `80` para HTTP.
- TCP e UDP `443` para HTTPS.

Conecte:

```bash
ssh root@IP_DO_VPS
```

Confirme:

```bash
docker --version
docker compose version
```

## 2. Obter O Projeto

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/alissonconfweb-rgb/busca-vendas-confweb.git
cd busca-vendas-confweb/deploy/hostinger
```

## 3. Configurar

```bash
cp .env.production.example .env.production
nano .env.production
chmod 600 .env.production
```

Gere o segredo de sessao:

```bash
openssl rand -hex 48
```

Cole o resultado em `SESSION_SECRET`.

## 4. Migrar O Banco Atual

Solicite no cPanel o arquivo definido por `DB_PATH`:

```text
/home/confwe06/data/busca-vendas-confweb/busca-vendas.sqlite
```

Envie para o VPS e mantenha o nome:

```bash
scp busca-vendas.sqlite root@IP_DO_VPS:/opt/busca-vendas-confweb/deploy/hostinger/data/
```

Proteja a pasta:

```bash
cd /opt/busca-vendas-confweb/deploy/hostinger
chown -R 1000:1000 data
chmod 700 data
chmod 600 data/busca-vendas.sqlite
```

Esse arquivo leva usuários, pesquisas, configurações, tokens de integração, contatos, planos, tickets e financeiro.

## 5. Publicar Sem Trocar O DNS

```bash
chmod +x deploy.sh backup.sh
./deploy.sh
docker compose ps
docker compose logs --tail=100 app
```

Teste a API diretamente no VPS:

```bash
docker compose exec -T app node -e \
  "fetch('http://127.0.0.1:3001/api/health').then(r=>r.text()).then(console.log)"
```

## 6. Trocar O DNS

Antes do corte definitivo, reduza o TTL do registro atual para `300` e aguarde o TTL anterior expirar.

No momento do corte:

1. Pare a aplicação Node antiga no cPanel para congelar novos cadastros e pesquisas.
2. Copie novamente o banco do cPanel para o VPS, substituindo o arquivo de teste.
3. Rode `./deploy.sh` e valide a saúde do contêiner.
4. Altere o DNS.

Na zona DNS que atualmente controla `confweb.com.br`, altere somente:

```text
Tipo: A
Nome: buscavendas
Valor: IP_DO_VPS_HOSTINGER
TTL: 300 durante a migracao
```

Não altere `@`, `www`, MX ou outros registros da Confweb.

Mantenha o ambiente antigo intacto, mas sem aceitar novas gravações, até concluir a validação. Isso evita que usuários e pesquisas fiquem divididos entre dois bancos durante a propagação.

Depois da propagação:

```bash
curl https://buscavendas.confweb.com.br/api/health
```

O resultado esperado é:

```json
{"ok":true}
```

Atualize no Asaas o webhook para:

```text
https://buscavendas.confweb.com.br/api/asaas/webhook
```

## 7. Backup Diario

Abra o cron:

```bash
crontab -e
```

Adicione:

```cron
20 3 * * * /opt/busca-vendas-confweb/deploy/hostinger/backup.sh >> /var/log/busca-vendas-backup.log 2>&1
```

Também mantenha os backups automáticos ou snapshots do VPS habilitados no hPanel.

## 8. Atualizacoes Futuras

```bash
cd /opt/busca-vendas-confweb
git pull origin main
cd deploy/hostinger
./deploy.sh
```

Antes de mudanças maiores:

```bash
./backup.sh
```

## Reversao Rapida

Enquanto o cPanel antigo continuar intacto, basta devolver o registro A de `buscavendas` ao IP anterior. Não apague o ambiente antigo até validar login, busca, histórico, painel admin e pagamento no VPS.
