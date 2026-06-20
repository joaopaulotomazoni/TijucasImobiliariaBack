-- =====================================================================
-- MIGRATION 002 — OBSERVAÇÕES EM IMÓVEIS
-- =====================================================================
-- Adiciona um campo de texto livre em `imoveis`, análogo ao já existente
-- em `contratos`, para anotações internas do corretor sobre o imóvel
-- (estado de conservação, combinados com o proprietário, etc.).
-- =====================================================================

BEGIN;

ALTER TABLE public.imoveis
  ADD COLUMN observacoes text NULL;

COMMIT;
