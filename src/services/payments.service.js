import PaymentsRepository from '../repositories/payments.repository.js';
import AppError from '../errors/AppError.js';
import { dataAtualIso } from '../utils/businessDays.js';
import {
  ordenarParcelasDoCliente,
  resumirParcelaParaCliente,
} from './payments.domain.js';
import { normalizePositiveBigintId } from '../utils/ids.js';

class PaymentsService {
  async getMyPayments(usuarioId) {
    const normalizedUsuarioId = normalizePositiveBigintId(
      usuarioId,
      'O ID do usuário'
    );
    const parcelas = await PaymentsRepository.getParcelasByUsuario(
      normalizedUsuarioId
    );
    const today = dataAtualIso();
    const parcelasResumidas = parcelas.map((parcela) =>
      resumirParcelaParaCliente(parcela, today)
    );

    return ordenarParcelasDoCliente(parcelasResumidas, today);
  }

  async getMyBoleto(parcelaId, usuarioId) {
    const normalizedParcelaId = normalizePositiveBigintId(
      parcelaId,
      'O ID da parcela'
    );
    const normalizedUsuarioId = normalizePositiveBigintId(
      usuarioId,
      'O ID do usuário'
    );

    const cobranca = await PaymentsRepository.getUltimaCobrancaByUsuario(
      normalizedParcelaId,
      normalizedUsuarioId
    );

    if (!cobranca) {
      // Uma única resposta evita revelar se a parcela existe, mas pertence a
      // outro cliente.
      throw new AppError('Boleto não encontrado.', 404);
    }

    return {
      id: cobranca.id,
      parcelaId: cobranca.parcela_id,
      gateway: cobranca.gateway,
      externalPaymentId: cobranca.external_payment_id,
      linhaDigitavel: cobranca.linha_digitavel,
      codigoBarras: cobranca.codigo_barras,
      urlBoleto: cobranca.url_boleto,
      urlFatura: cobranca.url_fatura,
      qrCodePix: cobranca.qr_code_pix,
      copiaColaPix: cobranca.copia_cola_pix,
      valor: Number(cobranca.valor),
      dataVencimento: cobranca.data_vencimento,
      statusGateway: cobranca.status_gateway,
      ativa: cobranca.ativa,
    };
  }

}

export default new PaymentsService();
