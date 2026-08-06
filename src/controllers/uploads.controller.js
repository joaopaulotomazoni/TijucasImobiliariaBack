import { z } from 'zod';
import StorageService from '../services/storage.service.js';
import AppError from '../errors/AppError.js';

const presignSchema = z.object({
  tipo: z.enum(
    [
      'COMPROVANTE_RENDA',
      'APOLICE_SEGURO',
      'COMPROVANTE_PAGAMENTO',
      'DOCUMENTO_CLIENTE',
      'COMPROVANTE_RESIDENCIA_ANTERIOR',
      'CERTIDAO_IMOVEL_FIADOR',
      'COMPROVANTE_CAUCAO',
    ],
    {
      required_error: 'O tipo de documento é obrigatório.',
      invalid_type_error: 'Tipo de documento inválido.',
    }
  ),
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png'], {
    required_error: 'O tipo do arquivo é obrigatório.',
    invalid_type_error:
      'Tipo de arquivo não permitido. Aceitos: PDF, JPEG, PNG.',
  }),
  ownerUserId: z.number().int().positive().optional(),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
});

const downloadSchema = z.object({
  key: z.string({ required_error: 'A chave do arquivo é obrigatória.' }).min(1),
});

class UploadsController {
  async presign(request, response, next) {
    try {
      const { tipo, contentType, ownerUserId, sizeBytes } =
        presignSchema.parse(request.body);
      const { userId, perfil } = request.user;

      if (!['ADMIN', 'CORRETOR', 'CLIENTE'].includes(perfil)) {
        throw new AppError('Perfil sem permissão para upload.', 403);
      }

      if (
        perfil === 'CLIENTE' &&
        ![
          'COMPROVANTE_PAGAMENTO',
          'DOCUMENTO_CLIENTE',
          'COMPROVANTE_RESIDENCIA_ANTERIOR',
          'CERTIDAO_IMOVEL_FIADOR',
          'COMPROVANTE_CAUCAO',
        ].includes(tipo)
      ) {
        throw new AppError('Tipo de documento não permitido.', 403);
      }

      const targetUserId = ['ADMIN', 'CORRETOR'].includes(perfil)
        ? (ownerUserId ?? userId)
        : userId;

      const { uploadUrl, key } = await StorageService.createUploadUrl({
        tipo,
        contentType,
        sizeBytes,
        userId: targetUserId,
      });

      return response.status(200).json({
        status: 'success',
        body: { uploadUrl, key },
      });
    } catch (error) {
      next(error);
    }
  }

  async download(request, response, next) {
    try {
      const { key } = downloadSchema.parse(request.query);

      const { downloadUrl } = await StorageService.createDownloadUrl(
        key,
        request.user
      );

      return response.status(200).json({
        status: 'success',
        data: { downloadUrl },
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new UploadsController();
