Busca Vendas - Confweb
=======================

Ambiente oficial:

- VPS Hostinger com Ubuntu e Docker
- Dominio: https://buscavendas.confweb.com.br
- App: Node.js + React
- Banco: SQLite em WAL, persistido fora do container
- Busca: Scrape.do com cache interno compartilhado
- Pagamentos: Asaas com webhook criado automaticamente

Publicacao:

1. Acesse /opt/busca-vendas-confweb.
2. Atualize o repositorio com git pull --ff-only origin main.
3. Execute busca-vendas-deploy.
4. Verifique https://buscavendas.confweb.com.br/api/health.

Configuracoes obrigatorias ficam em:

deploy/hostinger/.env.production

Os segredos nunca devem ser enviados ao Git. Use chaves diferentes para
SESSION_SECRET e SETTINGS_ENCRYPTION_KEY.

Para mudar o Asaas de Sandbox para Producao:

1. Entre no Painel admin > Configuracoes.
2. Cole a API Key oficial da conta Asaas.
3. Clique em Salvar e preparar Asaas.

O Busca Vendas detecta o ambiente pela chave, valida a conta e cria ou
atualiza o webhook HTTPS automaticamente. A conta Asaas de producao precisa
estar ativa e aprovada para receber cobrancas reais.

Rotinas:

- Backup diario: deploy/hostinger/backup.sh
- Monitor de saude: deploy/hostinger/healthcheck.sh
- Os backups SQLite sao validados antes de serem compactados.
