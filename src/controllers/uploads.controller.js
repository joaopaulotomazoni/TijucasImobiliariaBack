import { z } from 'zod';
import StorageService from '../services/storage.service.js';

const presignSchema = z.object({
  tipo: z.enum(
    ['COMPROVANTE_RENDA', 'APOLICE_SEGURO', 'COMPROVANTE_PAGAMENTO'],
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
});

const downloadSchema = z.object({
  key: z.string({ required_error: 'A chave do arquivo é obrigatória.' }).min(1),
});

class UploadsController {
  async presign(request, response, next) {
    try {
      const { tipo, contentType } = presignSchema.parse(request.body);

      const { uploadUrl, key } = await StorageService.createUploadUrl({
        tipo,
        contentType,
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

      const { downloadUrl } = await StorageService.createDownloadUrl(key);

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
