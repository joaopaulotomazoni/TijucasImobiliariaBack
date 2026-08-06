import GuaranteesRepository from '../repositories/guarantees.repository.js';
import ContractsRepository from '../repositories/contracts.repository.js';
import AppError from '../errors/AppError.js';
import gatewayFactory from '../gateways/gatewayFactory.js';
import StorageService from './storage.service.js';
import { normalizePositiveBigintId } from '../utils/ids.js';

class GuaranteesService {
  async getGuaranteesByContract(contratoId) {
    if (!contratoId) {
      throw new AppError('O ID do contrato é obrigatório.', 400);
    }

    return await GuaranteesRepository.getGuaranteesByContract(contratoId);
  }

  async createGuarantee(contratoId, guaranteeData, actor) {
    if (!contratoId) {
      throw new AppError('O ID do contrato é obrigatório.', 400);
    }

    await this.assertBusinessRules(contratoId, guaranteeData, actor);

    return await GuaranteesRepository.createGuarantee(
      contratoId,
      guaranteeData,
      actor.userId
    );
  }

  async substituteGuarantee(garantiaId, motivo, guaranteeData, actor) {
    if (!garantiaId) {
      throw new AppError('O ID da garantia é obrigatório.', 400);
    }

    const contratoId =
      await GuaranteesRepository.getContractIdByGuarantee(garantiaId);

    if (!contratoId) {
      throw new AppError('Garantia não encontrada.', 404);
    }

    await this.assertBusinessRules(contratoId, guaranteeData, actor);

    return await GuaranteesRepository.substituteGuarantee(
      garantiaId,
      motivo,
      guaranteeData,
      actor.userId
    );
  }

  async registerCaucaoDevolucao(garantiaId, devolucaoData, actor) {
    if (!garantiaId) {
      throw new AppError('O ID da garantia é obrigatório.', 400);
    }

    return await GuaranteesRepository.registerCaucaoDevolucao(
      garantiaId,
      devolucaoData,
      actor.userId
    );
  }

  async exonerarFiador(garantiaId, usuarioId, exoneracaoData, actor) {
    if (!garantiaId || !usuarioId) {
      throw new AppError(
        'O ID da garantia e do fiador são obrigatórios.',
        400
      );
    }

    return await GuaranteesRepository.exonerarFiador(
      garantiaId,
      usuarioId,
      exoneracaoData,
      actor.userId
    );
  }

  async generateCaucaoPix(garantiaId) {
    const id = normalizePositiveBigintId(garantiaId, 'O ID da garantia');
    return GuaranteesRepository.withCaucaoLock(id, async (client) => {
      const existing = await GuaranteesRepository.getCaucaoCharge(id, client);
      if (existing?.ativa) return this.toPublicCaucaoCharge(existing);

      const caucao = await GuaranteesRepository.getCaucaoContext(id, client);
      if (!caucao) throw new AppError('Caução não encontrada.', 404);
      if (caucao.status !== 'ATIVA' || caucao.modalidade !== 'DINHEIRO') {
        throw new AppError('Apenas caução ativa em dinheiro aceita Pix.', 409);
      }
      if (caucao.status_pagamento === 'PAGO') {
        throw new AppError('Esta caução já está paga.', 409);
      }

      const tentativa = await GuaranteesRepository.getNextCaucaoAttempt(id, client);
      const gateway = gatewayFactory.resolve();
      const customer = await gateway.ensureCustomer({
        usuarioId: caucao.pagador_usuario_id,
        nome: caucao.pagador_nome,
        documento: caucao.pagador_documento,
        email: caucao.pagador_email,
        telefone: caucao.pagador_telefone,
      });
      const externalReference = `caucao-${id}-${tentativa}`;
      const charge = await gateway.createCharge({
        valor: Number(caucao.valor),
        dataVencimento: new Date().toISOString().slice(0, 10),
        externalReference,
        idempotencyKey: externalReference,
        customerId: customer.externalCustomerId,
        billingType: 'PIX',
        descricao: `Caução do contrato #${caucao.contrato_id}`,
      });
      const saved = await GuaranteesRepository.saveCaucaoCharge({
        garantiaId: id,
        tentativa,
        gateway: gateway.provider,
        externalPaymentId: charge.externalPaymentId,
        externalReference,
        qrCodePix: charge.qrCodePix,
        copiaColaPix: charge.copiaColaPix,
        urlFatura: charge.urlFatura,
        valor: Number(caucao.valor),
        statusGateway: charge.statusGateway,
        rawJson: charge.rawJson,
      }, client);
      return this.toPublicCaucaoCharge(saved);
    });
  }

  toPublicCaucaoCharge(charge) {
    return {
      id: charge.id,
      garantiaId: charge.garantia_id,
      qrCodePix: charge.qr_code_pix,
      copiaColaPix: charge.copia_cola_pix,
      urlFatura: charge.url_fatura,
      valor: Number(charge.valor),
      statusGateway: charge.status_gateway,
      ativa: charge.ativa,
    };
  }

  async getMyCaucoes(usuarioId) {
    const id = normalizePositiveBigintId(usuarioId, 'O ID do usuário');
    return GuaranteesRepository.listMyCaucoes(id);
  }

  async attachCaucaoProof(garantiaId, key, actor) {
    const id = normalizePositiveBigintId(garantiaId, 'O ID da garantia');
    StorageService.assertKeyBelongsToUser(key, actor.userId, ['COMPROVANTE_CAUCAO']);
    await StorageService.assertUploadedObject(key);
    const data = await GuaranteesRepository.attachCaucaoProof(id, key, {
      userId: actor.userId,
      isStaff: ['ADMIN', 'CORRETOR'].includes(actor.perfil),
    });
    if (!data) {
      const existing = await GuaranteesRepository.getCaucaoContext(id);
      if (existing) {
        throw new AppError(
          'O comprovante só pode ser enviado para uma caução pendente ou rejeitada.',
          409
        );
      }
      throw new AppError('Caução não encontrada.', 404);
    }
    return data;
  }

  async reviewCaucao(garantiaId, status, userId) {
    const id = normalizePositiveBigintId(garantiaId, 'O ID da garantia');
    const data = await GuaranteesRepository.reviewCaucao(id, status, userId);
    if (!data) throw new AppError('Caução não encontrada.', 404);
    return data;
  }

  // Regras que dependem de dados do contrato — validadas aqui com mensagem
  // amigável. O banco (trigger + CHECK) é a rede de segurança final.
  async assertBusinessRules(contratoId, guaranteeData, actor) {
    if (guaranteeData.tipo === 'CAUCAO' && guaranteeData.modalidade === 'DINHEIRO') {
      const contract = await ContractsRepository.getContractById(contratoId);

      if (contract && guaranteeData.valor > 3 * Number(contract.valor_aluguel)) {
        throw new AppError(
          `A caução em dinheiro não pode exceder 3 aluguéis (Lei 8.245/91, art. 38, §2º). Máximo permitido: ${
            3 * Number(contract.valor_aluguel)
          }.`,
          400
        );
      }
    }

    if (guaranteeData.tipo === 'FIADOR') {
      await GuaranteesRepository.assertUsersAreActiveClients(
        guaranteeData.fiadores.map((fiador) => fiador.usuarioId)
      );
      for (const fiador of guaranteeData.fiadores) {
        if (fiador.comprovanteRendaKey) {
          StorageService.assertKeyBelongsToUser(
            fiador.comprovanteRendaKey,
            actor.userId,
            ['COMPROVANTE_RENDA']
          );
          await StorageService.assertUploadedObject(fiador.comprovanteRendaKey);
        }
        if (fiador.certidaoImovelKey) {
          StorageService.assertKeyBelongsToUser(
            fiador.certidaoImovelKey,
            fiador.usuarioId,
            ['CERTIDAO_IMOVEL_FIADOR']
          );
          await StorageService.assertUploadedObject(fiador.certidaoImovelKey);
        }
        // CC art. 1.647, III: fiança de pessoa casada exige outorga conjugal,
        // salvo no regime de separação absoluta.
        if (
          fiador.estadoCivil === 'CASADO' &&
          fiador.regimeBens !== 'SEPARACAO_ABSOLUTA' &&
          !fiador.outorgaConjugal
        ) {
          throw new AppError(
            'A fiança prestada por pessoa casada exige a outorga do cônjuge (Código Civil, art. 1.647, III).',
            400
          );
        }
      }
    }
    if (guaranteeData.tipo === 'SEGURO_FIANCA' && guaranteeData.apoliceKey) {
      StorageService.assertKeyBelongsToUser(
        guaranteeData.apoliceKey,
        actor.userId,
        ['APOLICE_SEGURO']
      );
      await StorageService.assertUploadedObject(guaranteeData.apoliceKey);
    }
  }
}

export default new GuaranteesService();
