import PaymentsRepository from '../repositories/payments.repository.js';
import AppError from '../errors/AppError.js';

class PaymentsService {
  async getMyPayments(usuarioId) {
    const parcelas = await PaymentsRepository.getParcelasByUsuario(usuarioId);
    const today = new Date().toISOString().slice(0, 10);

    return parcelas.map((parcela) => {
      const valorLancamentos = parcela.lancamentos.reduce(
        (sum, item) => sum + Number(item.valor),
        0
      );
      const valorTotal = Number(parcela.valor_base) + valorLancamentos;
      const valorPago = parcela.pagamentos.reduce(
        (sum, item) => sum + Number(item.valor_pago),
        0
      );

      // A VENCIDA não é um status persistido: é derivada na leitura a partir
      // do vencimento, para não depender de um job agendado recalculando o
      // banco todo dia.
      const isVencida =
        ['ABERTA', 'PARCIAL'].includes(parcela.status) &&
        parcela.data_vencimento < today;

      return {
        ...parcela,
        valorTotal,
        valorPago,
        saldo: Math.max(valorTotal - valorPago, 0),
        statusEfetivo: isVencida ? 'VENCIDA' : parcela.status,
      };
    });
  }

  async registerPayment(parcelaId, usuarioId, paymentData) {
    if (!parcelaId) {
      throw new AppError('O ID da parcela é obrigatório.', 400);
    }

    return await PaymentsRepository.registerPayment(
      parcelaId,
      usuarioId,
      paymentData
    );
  }
}

export default new PaymentsService();
