import cron from 'node-cron';
import WebhooksService from '../services/webhooks.service.js';

const HORARIO = process.env.WEBHOOK_CRON_SCHEDULE || '*/30 * * * * *';

let emExecucao = false;

function batchSize() {
  const parsed = Number.parseInt(process.env.WEBHOOK_BATCH_SIZE, 10);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, 500)
    : 50;
}

export function iniciarWebhookCron() {
  cron.schedule(HORARIO, executarProcessamentoWebhooks);
  console.log(`[webhookCron] agendado (${HORARIO}).`);
}

export async function executarProcessamentoWebhooks() {
  if (emExecucao) {
    return { ignorado: true, motivo: 'worker_local_em_execucao' };
  }

  emExecucao = true;

  try {
    const resultado = await WebhooksService.processarPendentes({
      limite: batchSize(),
    });

    if (resultado.total > 0) {
      console.log(
        `[webhookCron] ${resultado.processados} processado(s), ` +
          `${resultado.ignorados} ignorado(s), ${resultado.erros} erro(s), ` +
          `${resultado.descartados} descartado(s).`
      );
    }

    return resultado;
  } catch (error) {
    console.error('[webhookCron] erro inesperado no worker:', error);
    return { erro: true, mensagem: error.message };
  } finally {
    emExecucao = false;
  }
}
