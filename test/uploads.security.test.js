import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AWS_REGION ||= 'us-east-1';
process.env.AWS_S3_BUCKET ||= 'unit-test-bucket';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const { default: StorageService } = await import(
  '../src/services/storage.service.js'
);

test('cliente não consegue assinar download de comprovante alheio', async () => {
  await assert.rejects(
    StorageService.createDownloadUrl(
      'pagamentos/comprovantes/users/2/file.pdf',
      { userId: 1, perfil: 'CLIENTE' }
    ),
    (error) => error.statusCode === 404
  );

  await assert.rejects(
    StorageService.createDownloadUrl(
      'fiadores/comprovantes-renda/users/1/file.pdf',
      { userId: 1, perfil: 'CLIENTE' }
    ),
    (error) => error.statusCode === 404
  );
});
