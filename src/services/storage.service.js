import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
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
  DOCUMENTO_CLIENTE: 'clientes/documentos',
  COMPROVANTE_RESIDENCIA_ANTERIOR: 'clientes/residencia-anterior',
  CERTIDAO_IMOVEL_FIADOR: 'fiadores/certidoes-imovel',
  COMPROVANTE_CAUCAO: 'caucoes/comprovantes',
};

const CLIENT_DOWNLOAD_TYPES = [
  'COMPROVANTE_PAGAMENTO',
  'DOCUMENTO_CLIENTE',
  'COMPROVANTE_RESIDENCIA_ANTERIOR',
  'CERTIDAO_IMOVEL_FIADOR',
  'COMPROVANTE_CAUCAO',
];

const PUT_URL_TTL = 300; // 5 min para subir
const GET_URL_TTL = 300; // 5 min para visualizar
const MAX_FILE_SIZE = 10 * 1024 * 1024;

class StorageService {
  async createUploadUrl({ tipo, contentType, sizeBytes, userId }) {
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

    const normalizedUserId = String(userId);

    if (!/^\d+$/.test(normalizedUserId)) {
      throw new AppError('Usuário inválido para upload.', 400);
    }
    if (
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes < 1 ||
      sizeBytes > MAX_FILE_SIZE
    ) {
      throw new AppError('O arquivo deve possuir no máximo 10 MB.', 400);
    }

    const key = `${namespace}/users/${normalizedUserId}/${nanoid()}.${extension}`;

    const command = new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });

    const uploadUrl = await getSignedUrl(getS3Client(), command, {
      expiresIn: PUT_URL_TTL,
    });

    return { uploadUrl, key, sizeBytes };
  }

  async createDownloadUrl(key, { userId, perfil } = {}) {
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

    if (perfil === 'CLIENTE') {
      const isOwnKey = CLIENT_DOWNLOAD_TYPES.some((tipo) =>
        key.startsWith(`${NAMESPACES[tipo]}/users/${userId}/`)
      );

      if (!isOwnKey) {
        // 404 uniforme: não revela se a chave pertence a outra pessoa.
        throw new AppError('Arquivo não encontrado.', 404);
      }
    } else if (!['ADMIN', 'CORRETOR'].includes(perfil)) {
      throw new AppError('Arquivo não encontrado.', 404);
    }

    const command = new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ResponseContentDisposition: 'attachment',
      ResponseContentType: 'application/octet-stream',
    });

    const downloadUrl = await getSignedUrl(getS3Client(), command, {
      expiresIn: GET_URL_TTL,
    });

    return { downloadUrl };
  }

  assertKeyBelongsToUser(key, userId, allowedTypes) {
    const matches = allowedTypes.some((tipo) => {
      const namespace = NAMESPACES[tipo];
      return namespace && key.startsWith(`${namespace}/users/${userId}/`);
    });

    if (!matches) {
      throw new AppError('A chave do arquivo não pertence ao cliente informado.', 400);
    }
  }

  async assertUploadedObject(
    key,
    { expectedContentType, expectedSize } = {}
  ) {
    let head;
    try {
      head = await getS3Client().send(new HeadObjectCommand({
        Bucket: getBucket(),
        Key: key,
      }));
    } catch {
      throw new AppError('O arquivo enviado não foi encontrado.', 400);
    }

    const size = Number(head.ContentLength);
    const contentType = String(head.ContentType ?? '').split(';')[0].trim();
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_SIZE) {
      throw new AppError('O arquivo enviado possui tamanho inválido.', 400);
    }
    if (!CONTENT_TYPES[contentType]) {
      throw new AppError('O arquivo enviado possui tipo inválido.', 400);
    }
    if (expectedContentType && contentType !== expectedContentType) {
      throw new AppError('O tipo real do arquivo diverge do informado.', 400);
    }
    if (expectedSize !== undefined && Number(expectedSize) !== size) {
      throw new AppError('O tamanho real do arquivo diverge do informado.', 400);
    }

    const object = await getS3Client().send(new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Range: 'bytes=0-7',
    }));
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    const validSignature =
      (contentType === 'application/pdf' &&
        bytes.subarray(0, 5).toString() === '%PDF-') ||
      (contentType === 'image/jpeg' &&
        bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
      (contentType === 'image/png' &&
        bytes.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        ));
    if (!validSignature) {
      throw new AppError(
        'O conteúdo do arquivo não corresponde ao tipo permitido.',
        400
      );
    }

    return { contentType, size };
  }
}

export default new StorageService();
