-- =====================================================================
-- MIGRATION 005 — APOIO À LISTAGEM E GERAÇÃO EM LOTE DE BOLETOS
-- =====================================================================

BEGIN;

-- Handoff durável contrato -> lote. Se o processo cair depois do COMMIT do
-- contrato, o reconciliador retoma a mesma janela no startup/cron. A data-base
-- não avança com o calendário enquanto o primeiro lote estiver incompleto.
ALTER TABLE public.contratos
  ADD COLUMN IF NOT EXISTS cobrancas_iniciais_iniciadas_em timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS cobrancas_iniciais_a_partir_de date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS cobrancas_iniciais_concluidas_em timestamptz NULL;

ALTER TABLE public.contratos DROP CONSTRAINT IF EXISTS contratos_valor_chk;
ALTER TABLE public.contratos
  ADD CONSTRAINT contratos_valor_chk CHECK (valor_aluguel > 0);

-- Verificação de e-mail e redefinição de senha não devem sobrescrever o
-- código uma da outra. Ambos continuam de uso único via usado_em.
ALTER TABLE public.codigo_verificacao
  DROP CONSTRAINT IF EXISTS codigo_verificacao_usuario_id_key;
ALTER TABLE public.codigo_verificacao
  ADD COLUMN IF NOT EXISTS tentativas_falhas int NOT NULL DEFAULT 0;
ALTER TABLE public.codigo_verificacao
  DROP CONSTRAINT IF EXISTS codigo_tentativas_chk;
ALTER TABLE public.codigo_verificacao
  ADD CONSTRAINT codigo_tentativas_chk CHECK (tentativas_falhas >= 0);
DROP INDEX IF EXISTS public.idx_codigo_usuario;
CREATE UNIQUE INDEX IF NOT EXISTS uq_codigo_usuario_tipo
  ON public.codigo_verificacao (usuario_id, tipo);

-- Contrato financeiro é encerrado/cancelado, não apagado em cascata. RESTRICT
-- evita que uma corrida de exclusão remova parcelas enquanto o gateway ainda
-- possui boletos ativos.
ALTER TABLE public.parcelas
  DROP CONSTRAINT IF EXISTS parcelas_contrato_id_fkey;
ALTER TABLE public.parcelas
  ADD CONSTRAINT parcelas_contrato_id_fkey
  FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE RESTRICT;

-- Independentemente do provider, uma parcela só pode ter uma cobrança ativa.
-- A versão anterior incluía `gateway` na chave e permitia dois boletos vivos
-- durante uma troca de provider.
DROP INDEX IF EXISTS public.uq_gateway_cobranca_ativa;
CREATE UNIQUE INDEX uq_gateway_cobranca_ativa
  ON public.gateway_cobrancas (parcela_id) WHERE ativa;

-- Linhas antigas recebidas/encerradas continuam como histórico, não como uma
-- cobrança ainda pagável. Isso também evita bloquear o fim do contrato.
UPDATE public.gateway_cobrancas gc
SET ativa = false
FROM public.parcelas p
WHERE p.id = gc.parcela_id
  AND gc.ativa
  AND p.status IN (
    'CONFIRMADA','RECEBIDA','PAGA','REPASSADA','CANCELADA','ESTORNADA'
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_pagamento_gateway_event
  ON public.pagamentos (gateway_event_id)
  WHERE gateway_event_id IS NOT NULL;

ALTER TABLE public.pagamentos
  ADD COLUMN IF NOT EXISTS estornado_em timestamptz NULL;

-- Inbox durável do gateway. A migration 004 cria a tabela; estes campos
-- separam a confirmação HTTP do processamento financeiro e permitem retry
-- com backoff, concorrência segura e dead-letter auditável.
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS tentativas int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proxima_tentativa_em timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS descartado_em timestamptz NULL;

ALTER TABLE public.webhook_events
  DROP CONSTRAINT IF EXISTS webhook_tentativas_chk;
ALTER TABLE public.webhook_events
  ADD CONSTRAINT webhook_tentativas_chk CHECK (tentativas >= 0);

ALTER TABLE public.webhook_events
  DROP CONSTRAINT IF EXISTS webhook_status_chk;
ALTER TABLE public.webhook_events
  ADD CONSTRAINT webhook_status_chk CHECK (
    status IN ('RECEBIDO','PROCESSADO','ERRO','IGNORADO','DESCARTADO')
  );

DROP INDEX IF EXISTS public.idx_webhook_pendentes;
CREATE INDEX idx_webhook_pendentes
  ON public.webhook_events (proxima_tentativa_em, recebido_em, id)
  WHERE status IN ('RECEBIDO','ERRO');

DROP INDEX IF EXISTS public.idx_gateway_customer_external;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gateway_customer_external
  ON public.gateway_customers (gateway, external_customer_id);

-- A listagem do inquilino parte dos contratos vinculados e percorre suas
-- parcelas por vencimento. O índice composto evita leituras e ordenações
-- desnecessárias conforme o histórico financeiro cresce.
CREATE INDEX IF NOT EXISTS idx_parcelas_contrato_vencimento
  ON public.parcelas (contrato_id, data_vencimento, id);

COMMIT;
