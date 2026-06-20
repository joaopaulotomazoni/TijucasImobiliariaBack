import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { customAlphabet } from 'nanoid';
import { getS3Client, getBucket } from '../config/storage.js';
import AppError from '../errors/AppError.js';

// Integração externa isolada (mesmo espírito do EmailService — ai_patterns.md §3).
// O backend nunca recebe o arquivo: gera URLs pré-assinadas e o front fala direto
// com o S3. O banco guarda só a `key`, nunca uma URL pública/permanente (LGPD).

const nanoid = customAlphabet(
  '0123456789abcdefghijklmnopqrstuvwxyz',
  16
);

const CONTENT_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

// Namespaces permitidos por tipo de documento.
const NAMESPACES = {
  COMPROVANTE_RENDA: 'fiadores/comprovantes-renda',
  APOLICE_SEGURO: 'seguros/apolices',
  COMPROVANTE_PAGAMENTO: 'pagamentos/comprovantes',
};

const PUT_URL_TTL = 300; // 5 min para subir
const GET_URL_TTL = 300; // 5 min para visualizar

class StorageService {
  async createUploadUrl({ tipo, contentType }) {
    const namespace = NAMESPACES[tipo];
    if (!namespace) {
      throw new AppError('Tipo de documento inválido.', 400);
    }

    const extension = CONTENT_TYPES[contentType];
    if (!extension) {
      throw new AppError(
        'Tipo de arquivo não permitido. Aceitos: PDF, JPEG, PNG.',
        400
      );
    }

    const key = `${namespace}/${nanoid()}.${extension}`;

    const command = new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(getS3Client(), command, {
      expiresIn: PUT_URL_TTL,
    });

    return { uploadUrl, key };
  }

  async createDownloadUrl(key) {
    if (!key) {
      throw new AppError('A chave do arquivo é obrigatória.', 400);
    }

    // Só libera download de chaves dentro dos namespaces conhecidos.
    const isKnownNamespace = Object.values(NAMESPACES).some((ns) =>
      key.startsWith(`${ns}/`)
    );
    if (!isKnownNamespace) {
      throw new AppError('Chave de arquivo inválida.', 400);
    }

    const command = new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    });

    const downloadUrl = await getSignedUrl(getS3Client(), command, {
      expiresIn: GET_URL_TTL,
    });

    return { downloadUrl };
  }
}

export default new StorageService();
