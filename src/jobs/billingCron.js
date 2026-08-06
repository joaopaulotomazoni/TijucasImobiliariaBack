import cron from 'node-cron';
import BillingService from '../services/billing.service.js';
import { dataAtualIso } from '../utils/businessDays.js';

// node-cron dentro do próprio processo Express — funciona, mas some se o
// processo cair e não escala horizontalmente (mais de uma instância rodando
// = geração duplicada tentada em paralelo, ainda que a UNIQUE de
// parcelas_unica_por_competencia proteja o dado final). Ok para começar;
// migrar para pg_cron quando isso importar. Ver docs/plano-financeiro-adaptado.md §5.
const HORARIO = process.env.BILLING_CRON_SCHEDULE || '0 6 * * *'; // 06:00 todo dia
const TIMEZONE = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

export function iniciarBillingCron() {
  cron.schedule(HORARIO, executarReconciliacaoCobrancas, {
    timezone: TIMEZONE,
  });

  console.log(`[billingCron] agendado (${HORARIO}, ${TIMEZONE}).`);
}

export async function executarReconciliacaoCobrancas() {
  const hoje = dataAtualIso();

  try {
    const resultado = await BillingService.reconciliarHorizonteCobrancas(hoje);

    console.log(
      `[billingCron] ${hoje}: ${resultado.geradas} cobrança(s) gerada(s), ${resultado.falhas.length} falha(s).`
    );

    for (const falha of resultado.falhas) {
      console.error(
        `[billingCron] contrato ${falha.contratoId}${falha.competencia ? ` (${falha.competencia})` : ''}: ${falha.motivo}`
      );
    }
  } catch (error) {
    console.error('[billingCron] erro inesperado na geração diária:', error);
  }
}
