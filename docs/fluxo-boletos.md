# Fluxo de boletos

## Comportamento

1. A criação de um contrato ativo grava um handoff durável e tenta emitir até
   12 competências, a partir do mês atual ou do início futuro da vigência.
2. A referência `contrato-{id}-{competencia}` torna a emissão retomável. Se o
   processo cair, a reconciliação do startup/cron reusa o customer e a cobrança
   externa em vez de duplicá-los.
3. O inquilino vinculado consulta `GET /payments/my`; o próximo boleto aberto a
   vencer vem primeiro. `GET /payments/:parcelaId/boleto` devolve somente uma
   cobrança pertencente ao usuário autenticado.
4. O cliente paga por URL, linha digitável ou Pix. Somente o webhook autenticado
   confirma o pagamento; não existe baixa autodeclarada pelo cliente.
   Após confirmação/recebimento, a cobrança deixa de ser pagável, mas a última
   via continua disponível ao inquilino como histórico.
5. O endpoint confirma ao Asaas somente depois de persistir `payload.id` na
   inbox `webhook_events`. O processamento financeiro roda em segundo plano,
   com locks `SKIP LOCKED`, retry com backoff e `DESCARTADO` após o limite.
   Eventos desconhecidos ficam como `IGNORADO`, preservando a auditoria.

## Endpoints

- `POST /contracts/register` — cria contrato e dispara o lote inicial.
- `POST /contracts/:contratoId/charges/batch` — retomada manual idempotente.
- `GET /payments/my` — parcelas e cobrança segura do inquilino.
- `GET /payments/:parcelaId/boleto` — segunda via do próprio inquilino.
- `POST /webhooks/asaas` — confirmação/estorno, protegido por
  `asaas-access-token`; exige o `id` externo do evento no payload e responde
  depois da persistência, sem aguardar a conciliação financeira.

## Implantação

1. Garantir que `004_financeiro.sql` já foi aplicada e executar
   `pnpm migrate:billing` para aplicar `005_fluxo_boletos_lote.sql`.
2. Rodar `pnpm test` e `pnpm test:integration`.
3. Antes do primeiro startup após a migration, homologar e configurar
   `PAYMENT_GATEWAY_PROVIDER=ASAAS`, URL e chave do Sandbox; do contrário, o
   reconciliador de desenvolvimento emitirá cobranças `FAKE`. O factory bloqueia
   `FAKE` quando `NODE_ENV=production`.
4. O Asaas não documenta idempotência nativa no `POST /payments`;
   `externalReference` é somente um campo de busca. Manter
   `ASAAS_ALLOW_BEST_EFFORT_CHARGE_CREATION=false` e só habilitar depois de
   homologar no Sandbox cenários de timeout/retry e aceitar formalmente o risco
   residual de cobrança duplicada.
5. Cadastrar no Asaas o webhook e o mesmo `ASAAS_WEBHOOK_TOKEN` usado no
   backend. Só trocar a URL/chave para produção depois da homologação.
6. Ajustar `WEBHOOK_CRON_SCHEDULE`, `WEBHOOK_MAX_ATTEMPTS` e
   `WEBHOOK_BACKOFF_BASE_SECONDS` conforme a operação. Monitorar eventos em
   `ERRO` e `DESCARTADO`; estes últimos exigem análise/reconciliação manual.
7. No frontend, abrir `cobranca.urlBoleto` ou exibir
   `cobranca.linhaDigitavel`/`cobranca.copiaColaPix`; não chamar o antigo
   `POST /payments/:id/pagar`.
8. Monitorar eventos `IGNORADO` com motivo
   `estorno_parcial_requer_conciliacao_de_valores` ou
   `registro_bancario_cancelado_requer_analise_operacional`. O primeiro exige
   conciliar o valor efetivamente estornado; o segundo pode exigir restaurar
   ou reemitir o boleto no Asaas. Nenhum deles é convertido automaticamente em
   baixa/cancelamento integral da parcela.
