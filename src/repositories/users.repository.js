import supabase, { pool } from '../config/database.js';

class UsersRepository {
  async verifyUserExistence({ email, document }) {
    const [emailResult, documentResult] = await Promise.all([
      supabase
        .from('usuarios')
        .select('email_verificado')
        .eq('email', email)
        .maybeSingle(),
      supabase
        .from('usuarios')
        .select('documento')
        .eq('documento', document)
        .maybeSingle(),
    ]);

    if (emailResult.error) {
      throw new Error(emailResult.error.message);
    }

    if (documentResult.error) {
      throw new Error(documentResult.error.message);
    }

    if (emailResult.data) {
      return { exists: true, reason: emailResult.data.email_verificado };
    }

    if (documentResult.data) {
      return { exists: true, reason: 'document' };
    }

    return { exists: false };
  }

  async saveNewUser({
    fullName,
    email,
    phone,
    document,
    password,
    rg,
    dataNascimento,
  }) {
    const { data, error } = await supabase
      .from('usuarios')
      .insert({
        nome_completo: fullName,
        email,
        telefone: phone,
        documento: document,
        senha_hash: password,
        rg,
        data_nascimento: dataNascimento,
      })
      .select('id, nome_completo, email');

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async updateUserInfo({
    fullName,
    email,
    phone,
    document,
    password,
    rg,
    dataNascimento,
  }) {
    const { data, error } = await supabase
      .from('usuarios')
      .update({
        nome_completo: fullName,
        telefone: phone,
        documento: document,
        senha_hash: password,
        rg,
        data_nascimento: dataNascimento,
      })
      .eq('email', email)
      .select('id, nome_completo, email');

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async saveVerifyUserCode({ userId, verifyCode, tipo }) {
    const now = new Date();
    const expires = new Date(now.getTime() + 15 * 60 * 1000);

    const { data, error } = await supabase.from('codigo_verificacao').upsert(
      {
        usuario_id: userId,
        codigo: verifyCode,
        tipo,
        usado_em: null,
        tentativas_falhas: 0,
        created_at: now.toISOString(),
        expires_at: expires.toISOString(),
      },
      { onConflict: 'usuario_id,tipo' }
    );

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async getVerifyCode({ userId, tipo }) {
    const { data, error } = await supabase
      .from('codigo_verificacao')
      .select('id, codigo, expires_at, created_at, tentativas_falhas')
      .eq('usuario_id', userId)
      .eq('tipo', tipo)
      .is('usado_em', null)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async registerFailedVerificationAttempt({ id }) {
    const { rows } = await pool.query(
      `UPDATE codigo_verificacao
       SET tentativas_falhas = tentativas_falhas + 1,
           usado_em = CASE
             WHEN tentativas_falhas + 1 >= 5 THEN now()
             ELSE usado_em
           END
       WHERE id = $1 AND usado_em IS NULL
       RETURNING tentativas_falhas`,
      [id]
    );

    return rows[0]?.tentativas_falhas ?? null;
  }

  async consumeVerifyCode({ id }) {
    const { data, error } = await supabase
      .from('codigo_verificacao')
      .update({ usado_em: new Date().toISOString() })
      .eq('id', id)
      .is('usado_em', null)
      .select('id');

    if (error) {
      throw new Error(error.message);
    }

    return data.length === 1;
  }

  async updateUserEmailStatus({ userId }) {
    const { data, error } = await supabase
      .from('usuarios')
      .update({ email_verificado: true })
      .eq('id', userId)
      .select('id');

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async updateUserPassword({ userId, password }) {
    const { rows } = await pool.query(
      `UPDATE usuarios
       SET senha_hash = $1,
           password_changed_at = now(),
           auth_version = auth_version + 1
       WHERE id = $2
       RETURNING id, nome_completo, email, telefone, documento, perfil,
                 auth_version`,
      [password, userId]
    );
    return rows;
  }

  async getUserByEmail({ email }) {
    const { data, error } = await supabase
      .from('usuarios')
      .select(
        'id, email, senha_hash, telefone, documento, nome_completo, perfil, email_verificado, ativo, auth_version'
      )
      .eq('email', email)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async getUserById({ userId }) {
    const { data, error } = await supabase
      .from('usuarios')
      .select(
        'id, email, senha_hash, telefone, documento, nome_completo, perfil, email_verificado, ativo, auth_version'
      )
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }
}

export default new UsersRepository();
