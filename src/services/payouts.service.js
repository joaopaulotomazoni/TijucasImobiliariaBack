import PayoutsRepository from '../repositories/payouts.repository.js';
import gatewayFactory from '../gateways/gatewayFactory.js';
import AppError from '../errors/AppError.js';
import { calcularValorRepasse } from './billing.domain.js';

class PayoutsService {
  // Fase 1: repasse sai da conta principal (não há subconta/split ainda).
  // Só pode ser disparado com a parcela em RECEBIDA (saldo liquidado) — nunca
  // em CONFIRMADA.
  async dispararRepasse(parcelaId, solicitadoPor) {
    const parcela = await PayoutsRepository.getParcelaParaRepasse(parcelaId);

    if (!parcela) {
      throw new AppError('Parcela não encontrada.', 404);
    }

    if (parcela.status !== 'RECEBIDA') {
      throw new AppError('Só é possível repassar parcelas com status RECEBIDA.', 409);
    }

    if (!parcela.proprietario_id) {
      throw new AppError('O imóvel deste contrato não tem proprietário definido.', 409);
    }

    const contaBancaria = await PayoutsRepository.getContaBancariaPrincipal(parcela.proprietario_id);

    if (!contaBancaria) {
      throw new AppError('O proprietário não possui conta bancária cadastrada para repasse.', 409);
    }

    const valor = calcularValorRepasse(parcela);

    if (valor <= 0) {
      throw new AppError('O valor calculado para repasse é zero ou negativo.', 409);
    }

    const gateway = gatewayFactory.resolve();
    if (gateway.supportsIdempotentTransfers !== true) {
      throw new AppError(
        'O repasse automático não está homologado para o gateway configurado.',
        501
      );
    }
    const idempotencyKey = `repasse-parcela-${parcelaId}`;
    const repasse = await PayoutsRepository.criarRepasse({
      parcelaId,
      contaBancariaId: contaBancaria.id,
      valor,
      solicitadoPor,
      idempotencyKey,
    });
    if (repasse.status === 'CONCLUIDO') {
      return { id: repasse.id, status: 'CONCLUIDO', valor, idempotente: true };
    }

    try {
      const transferencia = await gateway.transfer({
        valor,
        contaBancaria,
        idempotencyKey,
      });

      await PayoutsRepository.concluirRepasse(repasse.id, {
        externalTransferId: transferencia.externalTransferId,
      });

      return { id: repasse.id, status: 'CONCLUIDO', valor };
    } catch (error) {
      // Mantém PROCESSANDO. Uma falha de rede não prova que a transferência
      // externa falhou; a próxima execução reutiliza a mesma chave idempotente.
      throw new AppError(
        'Não foi possível confirmar o repasse. Reprocesse para conciliar com segurança.',
        502
      );
    }
  }

  async listarRepasses(proprietarioId) {
    return PayoutsRepository.listarRepassesPorProprietario(proprietarioId);
  }
}

export default new PayoutsService();
