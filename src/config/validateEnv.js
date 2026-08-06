export function validateEnvironment() {
  const errors = [];
  if (!process.env.DATABASE_URL) errors.push('DATABASE_URL');
  if (!process.env.SUPABASE_URL) errors.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SECRET_KEY) errors.push('SUPABASE_SECRET_KEY');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET (mínimo 32 caracteres)');
  }
  if (
    process.env.AUTH_COOKIE_SAME_SITE &&
    !['strict', 'lax', 'none'].includes(
      process.env.AUTH_COOKIE_SAME_SITE.toLowerCase()
    )
  ) {
    errors.push('AUTH_COOKIE_SAME_SITE (strict, lax ou none)');
  }
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.CORS_ORIGINS) errors.push('CORS_ORIGINS');
    for (const name of [
      'EMAIL_USER',
      'EMAIL_PASS',
      'AWS_REGION',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_S3_BUCKET',
      'ASAAS_API_KEY',
      'ASAAS_API_URL',
    ]) {
      if (!process.env[name]) errors.push(name);
    }
    if (!process.env.ASAAS_WEBHOOK_TOKEN ||
        process.env.ASAAS_WEBHOOK_TOKEN.length < 32 ||
        process.env.ASAAS_WEBHOOK_TOKEN.length > 255) {
      errors.push('ASAAS_WEBHOOK_TOKEN (entre 32 e 255 caracteres)');
    }
    if ((process.env.PAYMENT_GATEWAY_PROVIDER || '').toUpperCase() !== 'ASAAS') {
      errors.push('PAYMENT_GATEWAY_PROVIDER=ASAAS');
    }
    if (process.env.ASAAS_API_URL?.includes('sandbox')) {
      errors.push('ASAAS_API_URL de produção');
    }
  }
  if (errors.length) {
    throw new Error(
      `Configuração obrigatória ausente ou inválida: ${errors.join(', ')}.`
    );
  }
}
