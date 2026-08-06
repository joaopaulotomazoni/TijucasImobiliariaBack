import 'dotenv/config';
import app from './app.js';
import {
  executarReconciliacaoCobrancas,
  iniciarBillingCron,
} from './jobs/billingCron.js';
import {
  executarProcessamentoWebhooks,
  iniciarWebhookCron,
} from './jobs/webhookCron.js';
import { validateEnvironment } from './config/validateEnv.js';

const PORT = process.env.PORT || 3000;
validateEnvironment();

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  iniciarBillingCron();
  iniciarWebhookCron();
  void executarReconciliacaoCobrancas();
  void executarProcessamentoWebhooks();
});
