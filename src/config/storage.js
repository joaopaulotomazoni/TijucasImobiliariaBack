import { S3Client } from '@aws-sdk/client-s3';
import AppError from '../errors/AppError.js';

let cachedClient = null;

// Instanciação preguiçosa: sem isto, o app inteiro deixaria de subir quando as
// variáveis AWS não estão configuradas (o S3Client valida a região no construtor).
// Assim, só quem realmente usa /uploads precisa das credenciais.
export function getS3Client() {
  if (!process.env.AWS_REGION || !process.env.AWS_S3_BUCKET) {
    throw new AppError(
      'O armazenamento de arquivos (S3) não está configurado no servidor.',
      503
    );
  }

  if (!cachedClient) {
    cachedClient = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      // Desde a v3.729.0 o SDK calcula checksum por padrão, o que "vaza" um
      // checksum de corpo vazio para dentro de presigned URLs (o comando é
      // assinado antes de o cliente enviar o arquivo), causando 403 no PUT
      // direto ao S3. WHEN_REQUIRED mantém o comportamento antigo.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  return cachedClient;
}

export const getBucket = () => process.env.AWS_S3_BUCKET;
