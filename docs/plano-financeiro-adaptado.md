# Módulo Financeiro — Plano adaptado ao TijucasImobiliariaBack

> Versão do [arquitetura-modulo-financeiro-alugueis.md](../arquitetura-modulo-financeiro-alugueis.md)
> **traduzida para a realidade deste projeto**: nomes de tabela reais, stack
> Node/Express + Supabase (sem TypeScript, sem DI, sem fila), e separando o que
> é **aditivo** (colunas em tabelas que já existem) do que é **tabela nova**.
>
> Fonte da verdade do schema: [database_schema.sql](./database_schema.sql).
> Convenções: [ai_patterns.md](./ai_patterns.md).
> O módulo de **garantias** (caução/fiador/seguro) é ortogonal a este plano —
> os dois convivem sem conflito.

---

## 0. Mapa de nomes (plano genérico → seu sistema)

Seguir o plano original ao pé da letra **criaria tabelas duplicadas**. Traduza sempre:

| Plano genérico | Neste projeto | Situação |
|---|---|---|
| `clientes` | **`usuarios`** (tabela única: cadastro + auth) | já existe |
| `cobrancas` | **`parcelas`** | já existe (precisa de colunas) |
| `cobranca_lancamentos` | **`parcela_lancamentos`** | já existe (falta `beneficiario`) |
| `dados_bancarios` | **`contas_bancarias`** | já existe (precisa de colunas) |
| `pagamentos` | **`pagamentos`** | já existe |
| boleto / 2ª via | **`boletos`** | já existe |
| `gateway_customers`, `contas_gateway`, `gateway_cobrancas`, `splits`, `repasses`, `webhook_events`, `movimentacoes_financeiras` | — | **não existem (tabelas novas)** |

Papel `LOCATARIO`/`PROPRIETARIO`: você **já** modela como relacionamento
(`contrato_inquilinos`, `imoveis.proprietario_id`) — que é a abordagem que o
próprio plano recomenda. Não crie coluna de papel.

---

## 1. O que você JÁ tem (não refazer)

- `numeric(12,2)` em todo dinheiro (o plano exige "nunca float"). ✅
- Idempotência da geração: `parcelas` tem `UNIQUE (contrato_id, competencia)` — é a
  chave `external_reference = contrato|competencia` que o plano pede. ✅
- Parâmetros financeiros no `contratos`: `valor_aluguel`, `dia_vencimento` (1–28),
  `percentual_multa_atraso`, `percentual_juros_mora_mensal`, `dias_tolerancia`,
  `taxa_administracao_percentual` (**= a comissão**), `indice_reajuste`. ✅
- `tipo_pessoa` (coluna gerada do `documento`), `documento` só dígitos. ✅
- Transação reutilizável: [withTransaction](../src/utils/withTransaction.js).
- Erros de negócio: [AppError](../src/errors/AppError.js) + handler central.
- Storage S3 (presigned) já pronto: [storage.service.js](../src/services/storage.service.js)
  serve para comprovantes de pagamento/repasse.

---

## 2. Mudanças ADITIVAS (colunas em tabelas existentes)

Estas alteram tabelas que já existem — todas vazias hoje (`parcelas`,
`parcela_lancamentos`, `pagamentos`, `boletos` = 0 linhas), então são seguras.

### 2.1 `contratos`
```sql
ALTER TABLE public.contratos
  ADD COLUMN forma_pagamento_padrao text NOT NULL DEFAULT 'INDEFINIDO',
  ADD COLUMN dia_geracao_antecipada int  NOT NULL DEFAULT 5,
  ADD COLUMN comissao_tipo          text NOT NULL DEFAULT 'PERCENTUAL';
  -- `taxa_administracao_percentual` já existe e vira o valor quando comissao_tipo='PERCENTUAL'.
  -- Se quiser comissão FIXA, use uma coluna de valor (abaixo) OU reaproveite via lançamento.
ALTER TABLE public.contratos
  ADD COLUMN comissao_valor_fixo numeric(12,2) NULL;

ALTER TABLE public.contratos
  ADD CONSTRAINT contratos_forma_pgto_chk
    CHECK (forma_pagamento_padrao IN ('BOLETO','PIX','CARTAO','INDEFINIDO')),
  ADD CONSTRAINT contratos_comissao_tipo_chk
    CHECK (comissao_tipo IN ('PERCENTUAL','FIXO'));
```

Máquina de estados: o fluxo do plano precisa de `RASCUNHO` (criar antes da
subconta) e `SUSPENSO`. Estenda o CHECK atual:
```sql
ALTER TABLE public.contratos DROP CONSTRAINT contratos_status_chk;
ALTER TABLE public.contratos
  ADD CONSTRAINT contratos_status_chk
    CHECK (status IN ('RASCUNHO','ATIVO','SUSPENSO','ENCERRADO','RESCINDIDO','INADIMPLENTE'));
-- Obs.: mude o DEFAULT para 'RASCUNHO' se adotar o fluxo "ativa só após subconta aprovada".
```

### 2.2 `parcelas` (= cobranças)
```sql
ALTER TABLE public.parcelas
  ADD COLUMN forma_pagamento    text NULL,
  ADD COLUMN external_reference text NULL,
  ADD COLUMN tentativa          int  NOT NULL DEFAULT 1;

-- Reforça a idempotência do lado do gateway/conciliação:
CREATE UNIQUE INDEX uq_parcela_external_reference
  ON public.parcelas (external_reference) WHERE external_reference IS NOT NULL;
```
Status: hoje é `ABERTA/PAGA/PARCIAL/VENCIDA/CANCELADA`. Para cobrir o ciclo com
repasse, adicione os estados do plano:
```sql
ALTER TABLE public.parcelas DROP CONSTRAINT parcelas_status_chk;
ALTER TABLE public.parcelas
  ADD CONSTRAINT parcelas_status_chk
    CHECK (status IN ('ABERTA','PENDENTE','CONFIRMADA','RECEBIDA','PARCIAL','VENCIDA','REPASSADA','CANCELADA','ESTORNADA'));
```
> Regra crítica do plano: só dispare repasse a partir de `RECEBIDA` (saldo
> liquidado), nunca de `CONFIRMADA`.

### 2.3 `parcela_lancamentos` (= lançamentos)
Falta a coluna que diz **quem recebe** cada item — é dela que o split é derivado:
```sql
ALTER TABLE public.parcela_lancamentos
  ADD COLUMN beneficiario text NOT NULL DEFAULT 'PROPRIETARIO';
ALTER TABLE public.parcela_lancamentos
  ADD CONSTRAINT lancamento_beneficiario_chk
    CHECK (beneficiario IN ('PROPRIETARIO','IMOBILIARIA'));
-- O enum `tipo` já cobre ALUGUEL/CONDOMINIO/IPTU/MULTA/JUROS/DESCONTO/TAXA/OUTRO.
-- Use TAXA para a comissão da imobiliária (beneficiario='IMOBILIARIA', valor negativo).
```

### 2.4 `contas_bancarias` (= dados bancários do repasse)
O plano exige o CPF/CNPJ do titular (tem que bater com o dono da subconta, senão
o saque é recusado) e o tipo da chave Pix:
```sql
ALTER TABLE public.contas_bancarias
  ADD COLUMN cpf_cnpj_titular text NULL,
  ADD COLUMN pix_key_type     text NULL,   -- CPF|CNPJ|EMAIL|TELEFONE|ALEATORIA
  ADD COLUMN digito           text NULL;
ALTER TABLE public.contas_bancarias
  ADD CONSTRAINT conta_pix_type_chk
    CHECK (pix_key_type IS NULL OR pix_key_type IN ('CPF','CNPJ','EMAIL','TELEFONE','ALEATORIA'));
```

---

## 3. Tabelas NOVAS (não existem hoje)

DDL no estilo do seu schema (bigint identity, `numeric(12,2)`, `text`+CHECK,
trigger `set_updated_at`, FK para `usuarios`/`parcelas`).

### 3.1 Integração com o gateway
```sql
-- Locatário como "customer" em cada gateway
CREATE TABLE public.gateway_customers (
  id                   bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  usuario_id           bigint NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  gateway              text   NOT NULL DEFAULT 'ASAAS',
  external_customer_id text   NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gateway_customer UNIQUE (usuario_id, gateway)
);

-- Subconta (BaaS) do proprietário — destino do split
CREATE TABLE public.contas_gateway (
  id                  bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  usuario_id          bigint NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  gateway             text   NOT NULL DEFAULT 'ASAAS',
  external_account_id text   NOT NULL,
  wallet_id           text   NOT NULL,
  api_key_encrypted   text   NOT NULL,   -- NUNCA em texto puro (ver §5)
  status              text   NOT NULL DEFAULT 'PENDENTE',   -- PENDENTE|APROVADA|BLOQUEADA
  onboarding_status   text   NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_conta_gateway UNIQUE (usuario_id, gateway),
  CONSTRAINT conta_gateway_status_chk CHECK (status IN ('PENDENTE','APROVADA','BLOQUEADA'))
);
CREATE TRIGGER trg_contas_gateway_updated BEFORE UPDATE ON public.contas_gateway
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Espelho da parcela (cobrança interna) no gateway
CREATE TABLE public.gateway_cobrancas (
  id                 bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  parcela_id         bigint NOT NULL REFERENCES public.parcelas(id) ON DELETE CASCADE,
  gateway            text   NOT NULL DEFAULT 'ASAAS',
  external_payment_id text  NOT NULL,
  linha_digitavel    text   NULL,
  url_boleto         text   NULL,
  url_fatura         text   NULL,
  qr_code_pix        text   NULL,
  copia_cola_pix     text   NULL,
  status_gateway     text   NULL,
  raw_json           jsonb  NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gateway_cobranca UNIQUE (parcela_id, gateway)
);

-- Regras de split de cada parcela
CREATE TABLE public.splits (
  id               bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  parcela_id       bigint NOT NULL REFERENCES public.parcelas(id) ON DELETE CASCADE,
  conta_gateway_id bigint NOT NULL REFERENCES public.contas_gateway(id) ON DELETE RESTRICT,
  tipo             text   NOT NULL,   -- FIXO|PERCENTUAL
  valor            numeric(12,2) NOT NULL,
  external_split_id text  NULL,
  status           text   NOT NULL DEFAULT 'PENDENTE',
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT split_tipo_chk CHECK (tipo IN ('FIXO','PERCENTUAL'))
);

-- Repasse (subconta do proprietário → banco dele)
CREATE TABLE public.repasses (
  id                  bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  parcela_id          bigint NOT NULL REFERENCES public.parcelas(id) ON DELETE RESTRICT,
  conta_gateway_id    bigint NOT NULL REFERENCES public.contas_gateway(id) ON DELETE RESTRICT,
  valor               numeric(12,2) NOT NULL,
  metodo              text   NOT NULL DEFAULT 'PIX',   -- PIX|TED
  status              text   NOT NULL DEFAULT 'PROCESSANDO', -- PROCESSANDO|CONCLUIDO|FALHOU
  external_transfer_id text  NULL,
  tentativa           int    NOT NULL DEFAULT 1,
  solicitado_em       timestamptz NOT NULL DEFAULT now(),
  efetivado_em        timestamptz NULL,
  CONSTRAINT repasse_status_chk CHECK (status IN ('PROCESSANDO','CONCLUIDO','FALHOU')),
  CONSTRAINT repasse_metodo_chk CHECK (metodo IN ('PIX','TED'))
);
```

### 3.2 Auditoria / idempotência
```sql
-- Idempotência e trilha dos webhooks
CREATE TABLE public.webhook_events (
  id                bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  gateway           text   NOT NULL DEFAULT 'ASAAS',
  external_event_id text   NOT NULL,
  event_type        text   NOT NULL,
  payload_json      jsonb  NOT NULL,
  status            text   NOT NULL DEFAULT 'RECEBIDO', -- RECEBIDO|PROCESSADO|ERRO|IGNORADO
  recebido_em       timestamptz NOT NULL DEFAULT now(),
  processado_em     timestamptz NULL,
  CONSTRAINT uq_webhook_event UNIQUE (gateway, external_event_id),
  CONSTRAINT webhook_status_chk CHECK (status IN ('RECEBIDO','PROCESSADO','ERRO','IGNORADO'))
);

-- Livro-razão (ledger) — recomendado para conciliação
CREATE TABLE public.movimentacoes_financeiras (
  id                 bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  parcela_id         bigint NULL REFERENCES public.parcelas(id) ON DELETE SET NULL,
  tipo               text   NOT NULL,   -- COBRANCA|PAGAMENTO|SPLIT|REPASSE|ESTORNO|TARIFA
  valor              numeric(12,2) NOT NULL,
  origem             text   NULL,
  destino            text   NULL,
  referencia_externa text   NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_mov_parcela ON public.movimentacoes_financeiras (parcela_id);
```

> `pagamentos` já existe e serve ao plano (1:N com `parcelas`, suporta parcial).
> Talvez adicionar `gateway_event_id` para amarrar ao webhook que o originou:
> `ALTER TABLE public.pagamentos ADD COLUMN gateway_event_id text NULL;`

Empacote tudo isso como `docs/migrations/002_financeiro.sql` (mesmo padrão do
`001_garantias.sql`) quando for aplicar.

---

## 4. A camada gateway-agnóstica NO SEU STACK

O plano usa hexagonal + DI + TypeScript. Sem TS e sem container de DI, o
equivalente idiomático aqui é **um módulo de interface + um factory**, mantendo
suas camadas controller→service→repository.

Estrutura sugerida sob `src/`:
```
src/
  gateways/
    paymentGateway.js        # a "interface" (JSDoc) + contrato dos métodos
    fakeGateway.js           # implementação em memória (boleto pago, transfer ok)
    asaas/
      asaasGateway.js        # o adapter real (só ele conhece a Asaas)
      asaasMapper.js         # ACL: traduz vocabulário interno <-> Asaas
    gatewayFactory.js        # resolve qual gateway usar (env/config)
  services/
    billing.service.js       # GerarCobrancasDoMes, montar lançamentos/split
    payments.service.js      # processar pagamento (a partir do webhook)
    payouts.service.js       # repasse ao proprietário
  controllers/
    billing.controller.js
    webhooks.controller.js
  repositories/
    billing.repository.js    # parcelas, parcela_lancamentos, gateway_cobrancas, splits
    payouts.repository.js     # repasses
    webhooks.repository.js    # webhook_events (idempotência)
```

Sem injeção de dependência formal: os services pegam o gateway via
`gatewayFactory.resolve()` em vez de importar a Asaas direto. Trocar de gateway =
escrever um adapter novo + apontar o factory. **O domínio nunca importa a SDK da Asaas.**

O `fakeGateway` é o que te deixa construir e testar **tudo** antes de ter a Asaas
aprovada — é a peça central do roteiro (§7).

---

## 5. Infra assíncrona — decisões que faltam no seu stack

O plano assume fila + workers + scheduler. Hoje você **não tem** nada disso
(Express + Supabase, processamento inline). Opções realistas, do mais simples ao
mais robusto:

**Geração diária de cobranças (o job do §7 do plano):**
- **`pg_cron` no Supabase** (extensão nativa) chamando uma função SQL/Edge Function
  que dispara seu endpoint interno de geração. Mais simples de operar.
- **`node-cron` dentro do próprio processo Express** — funciona, mas some se o
  processo cair e não escala horizontalmente. Ok para começar.
- Trava por competência (lock) pra não duplicar sob concorrência — sua
  `UNIQUE (contrato_id, competencia)` já protege contra duplicata mesmo sem lock.

**Webhooks:**
- MVP aceitável: **processar inline** no endpoint, protegido por
  `webhook_events.external_event_id UNIQUE` (idempotência) — responda 200 rápido e
  faça o mínimo. Seu handler de erro já existe.
- Evolução: enfileirar (Supabase Queues / pgmq, ou um Redis + worker) e processar
  assíncrono, como o plano recomenda.

**Conciliação (job noturno):** cruzar `parcelas` × `pagamentos` × `repasses` pra
pegar o que o webhook perdeu. Mesmo mecanismo de cron.

> Recomendação pragmática pro MVP: `pg_cron` para geração/conciliação + webhook
> inline idempotente. Migre para fila quando o volume justificar.

---

## 6. Segurança (pontos que o seu projeto ainda não resolve)

- **`api_key_encrypted` das subcontas**: o plano exige cofre (KMS/Vault), nunca
  texto puro. Hoje você guarda segredos no `.env`. Para as chaves **por subconta**
  (uma por proprietário, geradas em runtime) você precisa de criptografia em
  repouso — ex.: coluna criptografada com uma master key no ambiente, ou AWS KMS
  (você já usa AWS pro S3). **Decisão pendente.**
- **Validação de origem do webhook**: token no header + whitelist de IP da Asaas.
  O endpoint de webhook é público (não passa pelo seu `authMiddleware`).
- **Recalcular no backend**: nunca confiar em valor vindo do front (você já segue
  isso nas validações Zod atuais).

---

## 7. O que você precisa fazer A MAIS para começar

### Pré-requisitos (fora do código)
1. **Conta Asaas Sandbox** + API key raiz (base `https://api-sandbox.asaas.com/v3`).
2. **Decidir o cofre** das `api_key` de subconta (KMS vs coluna criptografada).
3. **Decidir o cron**: `pg_cron` (recomendado) ou `node-cron`.
4. **URL pública de webhook** (em produção) + token de validação.
5. **Modelo de comissão**: confirmar se é só percentual (você já tem) ou também fixo.
6. **Adotar `RASCUNHO`/`SUSPENSO`** no contrato? (afeta o fluxo de ativação).

### Roteiro de implementação (ordem sugerida, no seu stack)
1. **Migração `002_financeiro.sql`** — aditivos (§2) + tabelas novas (§3). Atualizar
   `database_schema.sql`. (Espelha §18.1 do plano.)
2. **Domínio puro** — funções de cálculo (lançamentos, comissão, multa/juros,
   derivar split dos lançamentos com `beneficiario`). 100% testável sem gateway,
   como o resto dos seus services.
3. **`paymentGateway.js` (interface) + `fakeGateway.js`** — simula cobrança criada,
   webhook de pago, transferência ok.
4. **`billing.service` + `billing.repository`** rodando contra o `fakeGateway`,
   dentro de `withTransaction` (parcela + lançamentos + gateway_cobranca + splits
   numa transação só).
5. **Geração automática** — endpoint + cron, com a idempotência da
   `UNIQUE(contrato_id, competencia)`.
6. **Endpoints** (§16 do plano, adaptados) + **receptor de webhook** com
   `webhook_events` idempotente, ainda alimentado pelo `fakeGateway`.
7. **Repasse** (`payouts.service`) a partir de `RECEBIDA` → `REPASSADA`.
8. **Conciliação + segurança do webhook + cofre da api_key**.
9. **Só então** escrever `asaasGateway.js` (o adapter) e homologar no Sandbox.
   Como tudo já roda contra a interface, essa etapa vira "preencher o adapter".

### Endpoints (nomes reais, seguindo seu padrão de rotas)
```
POST   /contracts/:id/charges          gera cobrança manual (além do cron)
GET    /charges?contractId=&status=    lista/filtra parcelas
GET    /charges/:id                     detalhe + lançamentos + pagamentos
GET    /charges/:id/second-copy         2ª via (reexibe boleto/pix; NÃO cria nova)
POST   /charges/:id/cancel
POST   /owners/:id/subaccount           onboarding da subconta
GET    /owners/:id/payouts              extrato de repasses (tela do proprietário)
POST   /charges/:id/payout              dispara repasse manual (fallback)
POST   /webhooks/:gateway               receptor público (validado por token)
```

---

## 8. Resumo do esforço

| Bloco | Tipo | Peso |
|---|---|---|
| Aditivos em `contratos`/`parcelas`/`parcela_lancamentos`/`contas_bancarias` | migração | baixo |
| 7 tabelas novas (gateway/split/repasse/webhook/ledger) | migração | médio |
| Domínio de cálculo (lançamentos/comissão/split) | código puro | médio |
| Interface + FakeGateway | código | baixo |
| Services/controllers/repos de cobrança e repasse | código | alto |
| Cron (pg_cron) + webhook idempotente | infra | médio |
| Cofre das api_keys de subconta | infra/segurança | médio |
| Adapter Asaas + homologação Sandbox | integração | médio |

O grosso do modelo de dados **já existe** — o trabalho real está na camada de
integração (gateway/split/repasse/webhook), no domínio de cálculo e na infra
assíncrona, não em refazer cadastro/cobrança do zero.
