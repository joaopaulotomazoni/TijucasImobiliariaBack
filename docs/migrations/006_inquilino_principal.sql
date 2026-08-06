-- =====================================================================
-- MIGRATION 006 — EXATAMENTE UM INQUILINO PRINCIPAL POR CONTRATO
-- =====================================================================

BEGIN;

-- A regra de "no máximo um" já é garantida pelo índice parcial. Antes de
-- instalar a validação de "pelo menos um", interrompe a migration se houver
-- dado legado inválido para que nada seja corrigido silenciosamente.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.contratos c
    WHERE (
      SELECT count(*)
      FROM public.contrato_inquilinos ci
      WHERE ci.contrato_id = c.id AND ci.principal
    ) <> 1
  ) THEN
    RAISE EXCEPTION
      'Existem contratos sem exatamente um inquilino principal.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_contrato_tem_um_principal(
  p_contrato_id bigint
)
RETURNS void AS $$
BEGIN
  -- O contrato pode ter sido removido na mesma transação (ON DELETE CASCADE).
  IF EXISTS (SELECT 1 FROM public.contratos WHERE id = p_contrato_id)
     AND (
       SELECT count(*)
       FROM public.contrato_inquilinos
       WHERE contrato_id = p_contrato_id AND principal
     ) <> 1 THEN
    RAISE EXCEPTION
      'O contrato % deve possuir exatamente um inquilino principal.',
      p_contrato_id
      USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.valida_principal_apos_contrato()
RETURNS trigger AS $$
BEGIN
  PERFORM public.assert_contrato_tem_um_principal(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.valida_principal_apos_vinculo()
RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.assert_contrato_tem_um_principal(NEW.contrato_id);
  END IF;

  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND OLD.contrato_id <> NEW.contrato_id) THEN
    PERFORM public.assert_contrato_tem_um_principal(OLD.contrato_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contratos_exigem_inquilino_principal
  ON public.contratos;
CREATE CONSTRAINT TRIGGER contratos_exigem_inquilino_principal
AFTER INSERT OR UPDATE ON public.contratos
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.valida_principal_apos_contrato();

DROP TRIGGER IF EXISTS contrato_inquilinos_exatamente_um_principal
  ON public.contrato_inquilinos;
CREATE CONSTRAINT TRIGGER contrato_inquilinos_exatamente_um_principal
AFTER INSERT OR UPDATE OR DELETE ON public.contrato_inquilinos
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.valida_principal_apos_vinculo();

COMMIT;
