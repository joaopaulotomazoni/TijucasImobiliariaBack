-- =====================================================================
-- MIGRATION 004 — MÓDULO FINANCEIRO (COBRANÇA, SPLIT E REPASSE)
-- =====================================================================
-- Prepara o banco para o ciclo completo de cobrança via gateway:
--
--   parcela (já existe)
--     ├── parcela_lancamentos (já existe) + beneficiario  → deriva o split
--     ├── gateway_cobrancas   (nova, 1:1) → espelho da cobrança no gateway
--     ├── splits              (nova, 1:N) → regra de rateio da parcela
--     ├── pagamentos (já existe)          → alimentado pelo webhook
--     └── repasses            (nova)      → saída do dinheiro ao proprietário
--
--   usuarios
--     ├── gateway_customers (nova) → o inquilino como "customer" no gateway
--     └── contas_gateway    (nova) → a subconta BaaS do proprietário
--
--   webhook_events           (nova) → idempotência e trilha dos webhooks
--   movimentacoes_financeiras(nova) → livro-razão para conciliação
--
-- Referências:
--   docs/plano-financeiro-adaptado.md   §2 (aditivos) e §3 (tabelas novas)
--   asaas-split-subcontas.md            detalhamento da integração Asaas
--
-- DESENHO EM DUAS FASES: na Fase 1 o sistema opera SEM split (recebimento na
-- conta principal, repasse manual/Pix registrado em `repasses`). As tabelas
-- `contas_gateway` e `splits` só passam a ser preenchidas na Fase 2, quando a
-- operação sair do período de avaliação regulatória do Banco Central
-- (Resolução Conjunta nº 16/17: teto de 10 subcontas e R$ 2.000 emitidos por
-- subconta). O schema já contempla as duas fases para não precisar de uma
-- segunda migration.
--
-- SEGURO: `parcelas`, `parcela_lancamentos`, `pagamentos` e `boletos` estavam
-- VAZIAS quando esta migration foi escrita, portanto a troca dos CHECKs de
-- status abaixo não invalida dados existentes.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. `usuarios` — dados exigidos pelo gateway na criação da subconta
-- ---------------------------------------------------------------------
-- O POST /v3/accounts da Asaas exige `incomeValue` (renda/faturamento mensal)
-- e, para PJ, `companyType` — nenhum dos dois existia aqui. O gateway também
-- separa telefone fixo (`phone`) de celular (`mobilePhone`), enquanto este
-- schema tinha uma coluna só (e com UNIQUE, o que impede reaproveitar).
-- São NULL: só viram obrigatórios no momento de abrir a subconta do
-- proprietário, validados no service, não no banco.

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS renda_mensal  numeric(12,2) NULL,
  ADD COLUMN IF NOT EXISTS tipo_empresa  text NULL,
  ADD COLUMN IF NOT EXISTS telefone_fixo text NULL;

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_tipo_empresa_chk CHECK (
    tipo_empresa IS NULL
    OR tipo_empresa IN ('MEI','LIMITED','INDIVIDUAL','ASSOCIATION')
  ),
  ADD CONSTRAINT usuarios_renda_chk CHECK (renda_mensal IS NULL OR renda_mensal >= 0);

-- ---------------------------------------------------------------------
-- 2. `contratos` — parâmetros de cobrança e comissão
-- ---------------------------------------------------------------------

ALTER TABLE public.contratos
  ADD COLUMN IF NOT EXISTS forma_pagamento_padrao text NOT NULL DEFAULT 'INDEFINIDO',
  -- Dias de antecedência com que o cron gera a parcela antes do vencimento.
  ADD COLUMN IF NOT EXISTS dia_geracao_antecipada int  NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS comissao_tipo          text NOT NULL DEFAULT 'PERCENTUAL',
  ADD COLUMN IF NOT EXISTS comissao_valor_fixo    numeric(12,2) NULL;

-- `taxa_administracao_percentual` já existia e é o valor quando
-- comissao_tipo = 'PERCENTUAL'. Ela incide sobre o ALUGUEL, não sobre o total
-- da parcela: um contrato com condomínio embutido não pode ter a comissão
-- calculada sobre a soma. Essa regra vive no domínio, não no banco.
ALTER TABLE public.contratos
  ADD CONSTRAINT contratos_forma_pgto_chk CHECK (
    forma_pagamento_padrao IN ('BOLETO','PIX','CARTAO','INDEFINIDO')
  ),
  ADD CONSTRAINT contratos_comissao_tipo_chk CHECK (comissao_tipo IN ('PERCENTUAL','FIXO')),
  -- Comissão FIXA sem valor definido deixaria o repasse indeterminado.
  ADD CONSTRAINT contratos_comissao_valor_chk CHECK (
    comissao_tipo <> 'FIXO' OR comissao_valor_fixo IS NOT NULL
  ),
  ADD CONSTRAINT contratos_geracao_chk CHECK (dia_geracao_antecipada BETWEEN 0 AND 28);

-- Novos estados do contrato:
--   RASCUNHO → contrato montado, ainda não gera cobrança
--   SUSPENSO → cobrança temporariamente interrompida (acordo, disputa)
-- O DEFAULT continua 'ATIVO'. Trocar para 'RASCUNHO' (fluxo "só ativa depois
-- da subconta aprovada") é decisão de negócio ainda em aberto — quando for
-- tomada, é um ALTER COLUMN SET DEFAULT numa migration própria.
ALTER TABLE public.contratos DROP CONSTRAINT IF EXISTS contratos_status_chk;
ALTER TABLE public.contratos
  ADD CONSTRAINT contratos_status_chk CHECK (
    status IN ('RASCUNHO','ATIVO','SUSPENSO','ENCERRADO','RESCINDIDO','INADIMPLENTE')
  );

-- ---------------------------------------------------------------------
-- 3. `parcelas` — ciclo de vida completo da cobrança
-- ---------------------------------------------------------------------

ALTER TABLE public.parcelas
  ADD COLUMN IF NOT EXISTS forma_pagamento    text NULL,
  ADD COLUMN IF NOT EXISTS external_reference text NULL,
  -- Incrementa a cada reemissão (reajuste aplicado após a emissão, correção
  -- de valor). Nunca deve haver duas cobranças ativas para a mesma parcela.
  ADD COLUMN IF NOT EXISTS tentativa          int  NOT NULL DEFAULT 1;

ALTER TABLE public.parcelas
  ADD CONSTRAINT parcelas_forma_pgto_chk CHECK (
    forma_pagamento IS NULL OR forma_pagamento IN ('BOLETO','PIX','CARTAO')
  ),
  ADD CONSTRAINT parcelas_tentativa_chk CHECK (tentativa >= 1);

-- A idempotência da GERAÇÃO já vem de UNIQUE (contrato_id, competencia).
-- Este índice protege a CONCILIAÇÃO: o external_reference é a chave que o
-- gateway devolve nos webhooks, e dois registros com a mesma chave tornariam
-- o pagamento impossível de atribuir.
CREATE UNIQUE INDEX IF NOT EXISTS uq_parcela_external_reference
  ON public.parcelas (external_reference) WHERE external_reference IS NOT NULL;

-- Estados novos:
--   PENDENTE   → cobrança emitida no gateway, aguardando pagamento
--   CONFIRMADA → pagamento reconhecido, saldo AINDA NÃO liquidado
--   RECEBIDA   → saldo disponível — único estado a partir do qual se repassa
--   REPASSADA  → repasse ao proprietário concluído
--   ESTORNADA  → estorno/chargeback
-- 'PAGA' é MANTIDA (o plano original a removia) porque
-- PaymentsRepository.registerPayment ainda a grava no registro manual de
-- pagamento; removê-la quebraria o fluxo atual. 'VENCIDA' também permanece,
-- ainda que hoje seja derivada na leitura em vez de persistida.
ALTER TABLE public.parcelas DROP CONSTRAINT IF EXISTS parcelas_status_chk;
ALTER TABLE public.parcelas
  ADD CONSTRAINT parcelas_status_chk CHECK (
    status IN ('ABERTA','PENDENTE','CONFIRMADA','RECEBIDA','PAGA','PARCIAL',
               'VENCIDA','REPASSADA','CANCELADA','ESTORNADA')
  );

-- ---------------------------------------------------------------------
-- 4. `parcela_lancamentos` — de quem é cada item da parcela
-- ---------------------------------------------------------------------
-- Esta é a coluna da qual o SPLIT é derivado. O valor que vai para o
-- proprietário é a soma dos lançamentos com beneficiario='PROPRIETARIO';
-- o resto fica com a imobiliária. Sem ela, só sobraria ratear por percentual
-- sobre o total, o que erra sempre que a parcela tiver condomínio, IPTU ou
-- desconto (a composição muda a cada mês).
--
-- A comissão entra como tipo='TAXA', beneficiario='IMOBILIARIA', valor
-- negativo: é desconto do proprietário, não cobrança do inquilino.

ALTER TABLE public.parcela_lancamentos
  ADD COLUMN IF NOT EXISTS beneficiario text NOT NULL DEFAULT 'PROPRIETARIO';

ALTER TABLE public.parcela_lancamentos
  ADD CONSTRAINT lancamento_beneficiario_chk CHECK (
    beneficiario IN ('PROPRIETARIO','IMOBILIARIA')
  );

-- ---------------------------------------------------------------------
-- 5. `contas_bancarias` — destino do repasse
-- ---------------------------------------------------------------------
-- O CPF/CNPJ do titular TEM que bater com o titular da subconta, senão o saque
-- é recusado pelo gateway. Guardar aqui permite validar no cadastro, e não
-- na hora do saque (quando o dinheiro já está preso).

ALTER TABLE public.contas_bancarias
  ADD COLUMN IF NOT EXISTS cpf_cnpj_titular text NULL,
  ADD COLUMN IF NOT EXISTS pix_key_type     text NULL,
  ADD COLUMN IF NOT EXISTS digito           text NULL;

ALTER TABLE public.contas_bancarias
  ADD CONSTRAINT conta_pix_type_chk CHECK (
    pix_key_type IS NULL
    OR pix_key_type IN ('CPF','CNPJ','EMAIL','TELEFONE','ALEATORIA')
  ),
  ADD CONSTRAINT conta_cpf_titular_chk CHECK (
    cpf_cnpj_titular IS NULL
    OR (cpf_cnpj_titular ~ '^[0-9]+$' AND length(cpf_cnpj_titular) IN (11,14))
  ),
  -- Chave Pix sem tipo é ambígua para o gateway (CPF/CNPJ/EMAIL/... não dá
  -- pra inferir do valor sozinho).
  ADD CONSTRAINT conta_pix_par_chk CHECK (
    chave_pix IS NULL OR pix_key_type IS NOT NULL
  );

-- ---------------------------------------------------------------------
-- 6. `pagamentos` — amarração com o webhook que originou o registro
-- ---------------------------------------------------------------------

ALTER TABLE public.pagamentos
  ADD COLUMN IF NOT EXISTS gateway_event_id text NULL;

-- ---------------------------------------------------------------------
-- 7. `boletos` — passa a ser histórico, não fonte da verdade
-- ---------------------------------------------------------------------
-- A partir daqui, `gateway_cobrancas` (§9) é a fonte da verdade da cobrança
-- ativa: é ela que guarda linha digitável, URL do boleto e Pix vindos do
-- gateway, e é dela que a 2ª via reexibe os dados. `boletos` fica apenas como
-- histórico de vias emitidas.
--
-- NÃO é dropada aqui de propósito: a decisão de descartar o histórico de
-- reemissões é de negócio, e a tabela está vazia — não custa nada mantê-la.
-- Se ficar decidido que não há uso, um DROP TABLE numa migration posterior
-- resolve. O que NÃO pode acontecer é as duas serem escritas em paralelo.

COMMENT ON TABLE public.boletos IS
  'Histórico de vias emitidas. A cobrança ativa vive em gateway_cobrancas.';

-- ---------------------------------------------------------------------
-- 8. `gateway_customers` — o inquilino como "customer" no gateway
-- ---------------------------------------------------------------------

CREATE TABLE public.gateway_customers (
  id                   bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  usuario_id           bigint NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  gateway              text   NOT NULL DEFAULT 'ASAAS',
  external_customer_id text   NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gateway_customer UNIQUE (usuario_id, gateway)
);

CREATE INDEX idx_gateway_customer_external
  ON public.gateway_customers (gateway, external_customer_id);

-- ---------------------------------------------------------------------
-- 9. `contas_gateway` — a subconta BaaS do proprietário (Fase 2)
-- ---------------------------------------------------------------------
-- Fluxo obrigatório de criação, nesta ordem:
--   1. INSERT aqui com status='PENDENTE' e external_reference próprio
--   2. POST /v3/accounts no gateway, enviando esse mesmo externalReference
--   3. UPDATE com external_account_id, wallet_id e api_key_encrypted
--
-- A ordem importa porque a apiKey da subconta é retornada UMA ÚNICA VEZ e não
-- tem endpoint de recuperação: se o passo 2 der certo e o 3 falhar, a subconta
-- fica órfã e inutilizável. Com o external_reference gravado antes, dá para
-- consultar o gateway e reconciliar em vez de criar outra.

CREATE TABLE public.contas_gateway (
  id                  bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  usuario_id          bigint NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  gateway             text   NOT NULL DEFAULT 'ASAAS',
  -- Nossa chave, gravada ANTES da chamada ao gateway (ver acima).
  external_reference  text   NOT NULL,
  -- Preenchidos só depois que o gateway responde.
  external_account_id text   NULL,
  wallet_id           text   NULL,
  -- NUNCA em texto puro, nunca em log, nunca em resposta de API ao frontend.
  api_key_encrypted   text   NULL,
  status              text   NOT NULL DEFAULT 'PENDENTE',
  onboarding_status   text   NULL,
  onboarding_url      text   NULL,   -- link de envio de documentos (reenviável)
  aprovada_em         timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_conta_gateway     UNIQUE (usuario_id, gateway),
  CONSTRAINT uq_conta_gateway_ref UNIQUE (gateway, external_reference),
  CONSTRAINT conta_gateway_status_chk CHECK (
    status IN ('PENDENTE','APROVADA','BLOQUEADA','RECUSADA')
  ),
  -- Só uma subconta APROVADA pode receber split, e para isso precisa da
  -- wallet e da chave. Impede que um UPDATE parcial deixe o registro num
  -- estado que o código a jusante trataria como pronto.
  CONSTRAINT conta_gateway_aprovada_chk CHECK (
    status <> 'APROVADA'
    OR (external_account_id IS NOT NULL
        AND wallet_id IS NOT NULL
        AND api_key_encrypted IS NOT NULL)
  )
);

CREATE TRIGGER trg_contas_gateway_updated BEFORE UPDATE ON public.contas_gateway
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 10. `gateway_cobrancas` — espelho da parcela no gateway
-- ---------------------------------------------------------------------

CREATE TABLE public.gateway_cobrancas (
  id                  bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  parcela_id          bigint NOT NULL REFERENCES public.parcelas(id) ON DELETE CASCADE,
  gateway             text   NOT NULL DEFAULT 'ASAAS',
  external_payment_id text   NOT NULL,
  linha_digitavel     text   NULL,
  codigo_barras       text   NULL,
  url_boleto          text   NULL,
  url_fatura          text   NULL,
  qr_code_pix         text   NULL,
  copia_cola_pix      text   NULL,
  valor               numeric(12,2) NOT NULL,
  data_vencimento     date   NOT NULL,
  status_gateway      text   NULL,   -- vocabulário do gateway, sem tradução
  raw_json            jsonb  NULL,   -- resposta crua, para auditoria
  ativa               boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gateway_cobranca_valor_chk CHECK (valor >= 0)
);

-- Uma parcela pode acumular várias cobranças ao longo do tempo (reemissão por
-- reajuste), mas só UMA pode estar ativa — duas cobranças vivas para a mesma
-- parcela significa cobrar o inquilino em dobro.
CREATE UNIQUE INDEX uq_gateway_cobranca_ativa
  ON public.gateway_cobrancas (parcela_id, gateway) WHERE ativa;

CREATE UNIQUE INDEX uq_gateway_cobranca_external
  ON public.gateway_cobrancas (gateway, external_payment_id);

CREATE INDEX idx_gateway_cobranca_parcela ON public.gateway_cobrancas (parcela_id);

CREATE TRIGGER trg_gateway_cobrancas_updated BEFORE UPDATE ON public.gateway_cobrancas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 11. `splits` — regra de rateio da parcela (Fase 2)
-- ---------------------------------------------------------------------
-- `tipo` aceita PERCENTUAL, mas a recomendação é sempre FIXO, com o valor
-- derivado dos parcela_lancamentos do proprietário. Percentual erra quando a
-- parcela tem condomínio/IPTU/desconto, e no Asaas ele incide sobre o valor
-- LÍQUIDO — o que faz o proprietário ratear a tarifa do gateway.
--
-- `status` usa vocabulário interno; o mapper do adapter traduz de/para o
-- gateway (PENDING, AWAITING_CREDIT, DONE, CANCELLED, REFUSED, REFUNDED).

CREATE TABLE public.splits (
  id                bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  parcela_id        bigint NOT NULL REFERENCES public.parcelas(id) ON DELETE CASCADE,
  conta_gateway_id  bigint NOT NULL REFERENCES public.contas_gateway(id) ON DELETE RESTRICT,
  tipo              text   NOT NULL DEFAULT 'FIXO',
  valor             numeric(12,2) NOT NULL,
  external_split_id text   NULL,
  status            text   NOT NULL DEFAULT 'PENDENTE',
  motivo_recusa     text   NULL,   -- refusalReason do gateway
  creditado_em      timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT split_tipo_chk   CHECK (tipo IN ('FIXO','PERCENTUAL')),
  CONSTRAINT split_valor_chk  CHECK (valor >= 0),
  CONSTRAINT split_status_chk CHECK (
    status IN ('PENDENTE','AGUARDANDO_CREDITO','CONCLUIDO','CANCELADO','RECUSADO','ESTORNADO')
  ),
  CONSTRAINT split_recusa_chk CHECK (status <> 'RECUSADO' OR motivo_recusa IS NOT NULL)
);

CREATE INDEX idx_splits_parcela ON public.splits (parcela_id);
CREATE INDEX idx_splits_conta   ON public.splits (conta_gateway_id);

CREATE TRIGGER trg_splits_updated BEFORE UPDATE ON public.splits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 12. `repasses` — saída do dinheiro para o banco do proprietário
-- ---------------------------------------------------------------------
-- Serve às duas fases:
--   Fase 1 → transferência da conta principal (conta_gateway_id NULL)
--   Fase 2 → transferência da subconta do proprietário
--
-- Regra crítica: só disparar a partir de parcela em RECEBIDA (saldo
-- liquidado), nunca de CONFIRMADA. Na Fase 2, o gatilho é o split em
-- CONCLUIDO — no evento de pagamento recebido o split ainda pode estar em
-- AGUARDANDO_CREDITO e a transferência é recusada por saldo insuficiente.

CREATE TABLE public.repasses (
  id                   bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  parcela_id           bigint NOT NULL REFERENCES public.parcelas(id) ON DELETE RESTRICT,
  -- NULL na Fase 1: o dinheiro sai da conta principal, não de uma subconta.
  conta_gateway_id     bigint NULL REFERENCES public.contas_gateway(id) ON DELETE RESTRICT,
  conta_bancaria_id    bigint NULL REFERENCES public.contas_bancarias(id) ON DELETE SET NULL,
  valor                numeric(12,2) NOT NULL,
  metodo               text   NOT NULL DEFAULT 'PIX',
  status               text   NOT NULL DEFAULT 'PROCESSANDO',
  external_transfer_id text   NULL,
  motivo_falha         text   NULL,
  comprovante_key      text   NULL,   -- objeto no S3 privado (padrão das garantias)
  tentativa            int    NOT NULL DEFAULT 1,
  solicitado_em        timestamptz NOT NULL DEFAULT now(),
  efetivado_em         timestamptz NULL,
  CONSTRAINT repasse_status_chk    CHECK (status IN ('PROCESSANDO','CONCLUIDO','FALHOU')),
  CONSTRAINT repasse_metodo_chk    CHECK (metodo IN ('PIX','TED','MANUAL')),
  CONSTRAINT repasse_valor_chk     CHECK (valor > 0),
  CONSTRAINT repasse_falha_chk     CHECK (status <> 'FALHOU' OR motivo_falha IS NOT NULL),
  CONSTRAINT repasse_efetivado_chk CHECK (status <> 'CONCLUIDO' OR efetivado_em IS NOT NULL)
);

-- Transferência duplicada é dinheiro que sai duas vezes e não volta sozinho.
-- O UNIQUE em webhook_events já barra o reprocessamento do mesmo evento; este
-- índice barra o caso mais amplo (dois eventos distintos, retry manual,
-- conciliação disparando em cima do webhook) permitindo apenas uma tentativa
-- viva por parcela — uma que FALHOU pode ser refeita.
CREATE UNIQUE INDEX uq_repasse_ativo_por_parcela
  ON public.repasses (parcela_id) WHERE status <> 'FALHOU';

CREATE INDEX idx_repasses_conta_gateway ON public.repasses (conta_gateway_id);
CREATE INDEX idx_repasses_status        ON public.repasses (status);

-- ---------------------------------------------------------------------
-- 13. `webhook_events` — idempotência e trilha
-- ---------------------------------------------------------------------
-- O endpoint de webhook é PÚBLICO (não passa pelo authMiddleware) e o gateway
-- reenvia eventos. O UNIQUE abaixo é o que impede que o mesmo pagamento seja
-- registrado duas vezes ou que um repasse seja disparado em duplicidade.

CREATE TABLE public.webhook_events (
  id                bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  gateway           text   NOT NULL DEFAULT 'ASAAS',
  external_event_id text   NOT NULL,
  event_type        text   NOT NULL,
  -- NULL para eventos da conta principal; preenchido para os de subconta,
  -- que chegam por rota própria (/webhooks/asaas/sub/:contaGatewayId).
  conta_gateway_id  bigint NULL REFERENCES public.contas_gateway(id) ON DELETE SET NULL,
  payload_json      jsonb  NOT NULL,
  status            text   NOT NULL DEFAULT 'RECEBIDO',
  erro_mensagem     text   NULL,
  recebido_em       timestamptz NOT NULL DEFAULT now(),
  processado_em     timestamptz NULL,
  CONSTRAINT uq_webhook_event UNIQUE (gateway, external_event_id),
  CONSTRAINT webhook_status_chk CHECK (
    status IN ('RECEBIDO','PROCESSADO','ERRO','IGNORADO')
  )
);

-- Para o job que reprocessa o que ficou em RECEBIDO/ERRO.
CREATE INDEX idx_webhook_pendentes
  ON public.webhook_events (recebido_em) WHERE status IN ('RECEBIDO','ERRO');

-- ---------------------------------------------------------------------
-- 14. `movimentacoes_financeiras` — livro-razão
-- ---------------------------------------------------------------------
-- Trilha append-only para conciliação: cada evento de dinheiro vira uma linha,
-- e o estorno entra como lançamento reverso em vez de UPDATE.

CREATE TABLE public.movimentacoes_financeiras (
  id                 bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  parcela_id         bigint NULL REFERENCES public.parcelas(id) ON DELETE SET NULL,
  tipo               text   NOT NULL,
  valor              numeric(12,2) NOT NULL,   -- sinal indica entrada/saída
  origem             text   NULL,
  destino            text   NULL,
  referencia_externa text   NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mov_tipo_chk CHECK (
    tipo IN ('COBRANCA','PAGAMENTO','SPLIT','REPASSE','ESTORNO','TARIFA','COMISSAO')
  )
);

CREATE INDEX idx_mov_parcela ON public.movimentacoes_financeiras (parcela_id);
CREATE INDEX idx_mov_tipo    ON public.movimentacoes_financeiras (tipo, created_at);

COMMIT;
