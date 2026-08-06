import fakeGateway from './fakeGateway.js';
import asaasGateway from './asaasGateway.js';

const GATEWAYS = {
  FAKE: fakeGateway,
  ASAAS: asaasGateway,
};

class GatewayFactory {
  resolve(providerName) {
    const provider = (
      providerName ||
      process.env.PAYMENT_GATEWAY_PROVIDER ||
      'FAKE'
    ).toUpperCase();

    if (provider === 'FAKE' && process.env.NODE_ENV === 'production') {
      throw new Error(
        'O fakeGateway não pode ser utilizado em ambiente de produção.'
      );
    }

    const gateway = GATEWAYS[provider];

    if (!gateway) {
      throw new Error(`Gateway de pagamento não configurado: ${provider}`);
    }

    return gateway;
  }
}

export default new GatewayFactory();
