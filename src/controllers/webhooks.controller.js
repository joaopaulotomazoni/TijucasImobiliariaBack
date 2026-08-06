import WebhooksService from '../services/webhooks.service.js';
import { timingSafeEqual } from 'crypto';

function tokensMatch(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') {
    return false;
  }

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

class WebhooksController {
  // Endpoint público (fora do authMiddleware): validado por token de
  // cabeçalho, não por sessão de usuário. O 200 só é devolvido depois que
  // o evento está persistido; a conciliação ocorre fora da requisição.
  async receberAsaas(request, response, next) {
    try {
      const token = request.headers['asaas-access-token'];
      const configuredToken = process.env.ASAAS_WEBHOOK_TOKEN;

      // Esta rota continua sendo Asaas mesmo quando o provider de novas
      // emissões é temporariamente outro. Nunca pode operar em fail-open.
      if (
        !configuredToken ||
        configuredToken.length < 32 ||
        configuredToken.length > 255
      ) {
        return response.status(503).json({
          status: 'error',
          message: 'Token do webhook não configurado corretamente.',
        });
      }

      if (configuredToken && !tokensMatch(token, configuredToken)) {
        return response.status(401).json({
          status: 'error',
          message: 'Token de webhook inválido.',
        });
      }

      const recebido = await WebhooksService.receberAsaas(request.body);

      // Reduz a latência no caminho feliz, mas não é a garantia de entrega:
      // startup/cron retomam qualquer evento que continuar pendente.
      setImmediate(() => {
        void WebhooksService.processarEventoPorId(recebido.eventoId).catch(
          (error) => {
            console.error(
              `[webhook] falha inesperada ao disparar evento ${recebido.eventoId}:`,
              error
            );
          }
        );
      });

      return response.status(200).json({
        status: 'success',
        duplicate: recebido.duplicado,
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new WebhooksController();
