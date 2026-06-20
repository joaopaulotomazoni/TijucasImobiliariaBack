import supabase from '../config/database.js';

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

  async saveVerifyUserCode({ userId, verifyCode }) {
    const now = new Date();
    const expires = new Date(now.getTime() + 15 * 60 * 1000);

    const { data, error } = await supabase.from('codigo_verificacao').upsert(
      {
        usuario_id: userId,
        codigo: verifyCode,
        created_at: now.toISOString(),
        expires_at: expires.toISOString(),
      },
      { onConflict: 'usuario_id' }
    );

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async getVerifyCode({ userId }) {
    const { data, error } = await supabase
      .from('codigo_verificacao')
      .select('codigo, expires_at')
      .eq('usuario_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data;
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
    const { data, error } = await supabase
      .from('usuarios')
      .update({ senha_hash: password })
      .eq('id', userId)
      .select('id, nome_completo, email, telefone, documento, perfil');

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async getUserByEmail({ email }) {
    const { data, error } = await supabase
      .from('usuarios')
      .select(
        'id, email, senha_hash, telefone, documento, nome_completo, perfil, email_verificado'
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
        'id, email, senha_hash, telefone, documento, nome_completo, perfil, email_verificado'
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
