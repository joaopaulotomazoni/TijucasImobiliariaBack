-- =====================================================================
-- MIGRATION 003 — COMPROVANTE DE DEPÓSITO DA CAUÇÃO
-- =====================================================================
-- Adiciona o comprovante do depósito em dinheiro na caderneta de poupança
-- (art. 38, §2º da Lei 8.245/91), no mesmo padrão de chave de objeto S3
-- privado já usado em garantia_fiadores.comprovante_renda_key e
-- garantia_seguro_fianca.apolice_key.
-- =====================================================================

BEGIN;

ALTER TABLE public.garantia_caucao
  ADD COLUMN comprovante_deposito_key text NULL;

COMMIT;
