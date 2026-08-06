import supabase from '../config/database.js';
import AppError from '../errors/AppError.js';
import { withTransaction } from '../utils/withTransaction.js';

class ClientsRepository {
  async registerClient({
    nomeCompleto,
    documento,
    email,
    telefone,
    rg,
    dataNascimento,
    endereco,
    contasBancarias,
  }) {
    return withTransaction(async (client) => {
      let enderecoId = null;
      if (endereco) {
        const enderecoResult = await client.query(
          `INSERT INTO enderecos (cep, estado, cidade, bairro, logradouro, numero, complemento)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            endereco.cep,
            endereco.estado,
            endereco.cidade,
            endereco.bairro,
            endereco.logradouro,
            endereco.numero ?? null,
            endereco.complemento ?? null,
          ]
        );
        enderecoId = enderecoResult.rows[0].id;
      }

      const usuarioResult = await client.query(
        `INSERT INTO usuarios (nome_completo, documento, email, telefone, rg, data_nascimento, endereco_id, perfil)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'CLIENTE')
         RETURNING id`,
        [
          nomeCompleto,
          documento,
          email,
          telefone,
          rg || null,
          dataNascimento || null,
          enderecoId,
        ]
      );
      const usuarioId = usuarioResult.rows[0].id;

      if (contasBancarias?.length) {
        for (const conta of contasBancarias) {
          await client.query(
            `INSERT INTO contas_bancarias
               (usuario_id, banco, agencia, conta, digito, tipo_conta, chave_pix, pix_key_type, cpf_cnpj_titular, principal)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              usuarioId,
              conta.banco,
              conta.agencia,
              conta.conta,
              conta.digito || null,
              conta.tipoConta,
              conta.chavePix || null,
              conta.pixKeyType || null,
              conta.cpfCnpjTitular || null,
              conta.principal ?? false,
            ]
          );
        }
      }
    });
  }

  async getClients() {
    const { data, error } = await supabase
      .from('usuarios')
      .select(
        `id,
         nome_completo,
         documento,
         email,
         telefone,
         rg,
         data_nascimento,
         endereco:enderecos!endereco_id (
           id,
           cep,
           estado,
           cidade,
           bairro,
           logradouro,
           numero,
           complemento
         ),
         contas_bancarias (
           id,
           banco,
           agencia,
           conta,
           digito,
           tipo_conta,
           chave_pix,
           pix_key_type,
           cpf_cnpj_titular,
           principal
         )`
      )
      .eq('perfil', 'CLIENTE')
      .order('id', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async updateClient(
    id,
    {
      nomeCompleto,
      documento,
      email,
      telefone,
      rg,
      dataNascimento,
      endereco,
      contasBancarias,
    }
  ) {
    return withTransaction(async (client) => {
      const existingClient = await client.query(
        `SELECT id FROM usuarios WHERE id = $1 AND perfil = 'CLIENTE'`,
        [id]
      );

      if (existingClient.rows.length === 0) {
        throw new AppError('Cliente não encontrado.', 404);
      }

      if (endereco) {
        if (endereco.id) {
          const refCountResult = await client.query(
            `SELECT
               (SELECT COUNT(*) FROM usuarios WHERE endereco_id = $1 AND id != $2) +
               (SELECT COUNT(*) FROM imoveis WHERE endereco_id = $1) AS other_refs`,
            [endereco.id, id]
          );
          const isSharedEndereco =
            Number(refCountResult.rows[0].other_refs) > 0;

          if (isSharedEndereco) {
            const enderecoResult = await client.query(
              `INSERT INTO enderecos (cep, estado, cidade, bairro, logradouro, numero, complemento)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id`,
              [
                endereco.cep,
                endereco.estado,
                endereco.cidade,
                endereco.bairro,
                endereco.logradouro,
                endereco.numero ?? null,
                endereco.complemento ?? null,
              ]
            );

            await client.query(
              `UPDATE usuarios SET endereco_id = $1 WHERE id = $2`,
              [enderecoResult.rows[0].id, id]
            );
          } else {
            await client.query(
              `UPDATE enderecos
               SET cep = $1, estado = $2, cidade = $3, bairro = $4, logradouro = $5, numero = $6, complemento = $7
               WHERE id = $8 AND id = (SELECT endereco_id FROM usuarios WHERE id = $9)`,
              [
                endereco.cep,
                endereco.estado,
                endereco.cidade,
                endereco.bairro,
                endereco.logradouro,
                endereco.numero ?? null,
                endereco.complemento ?? null,
                endereco.id,
                id,
              ]
            );
          }
        } else {
          const enderecoResult = await client.query(
            `INSERT INTO enderecos (cep, estado, cidade, bairro, logradouro, numero, complemento)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [
              endereco.cep,
              endereco.estado,
              endereco.cidade,
              endereco.bairro,
              endereco.logradouro,
              endereco.numero ?? null,
              endereco.complemento ?? null,
            ]
          );

          await client.query(
            `UPDATE usuarios SET endereco_id = $1 WHERE id = $2`,
            [enderecoResult.rows[0].id, id]
          );
        }
      }

      await client.query(
        `UPDATE usuarios
         SET nome_completo = $1, documento = $2, email = $3,
             email_verificado = CASE
               WHEN email IS DISTINCT FROM $3 THEN false
               ELSE email_verificado
             END,
             telefone = $4, rg = $5, data_nascimento = $6
         WHERE id = $7`,
        [
          nomeCompleto,
          documento,
          email,
          telefone,
          rg || null,
          dataNascimento || null,
          id,
        ]
      );

      if (contasBancarias) {
        await client.query(
          `UPDATE contas_bancarias SET principal = false WHERE usuario_id = $1`,
          [id]
        );

        const keptContaIds = [];

        for (const conta of contasBancarias) {
          if (conta.id) {
            await client.query(
              `UPDATE contas_bancarias
               SET banco = $1, agencia = $2, conta = $3, digito = $4, tipo_conta = $5,
                   chave_pix = $6, pix_key_type = $7, cpf_cnpj_titular = $8, principal = $9
               WHERE id = $10 AND usuario_id = $11`,
              [
                conta.banco,
                conta.agencia,
                conta.conta,
                conta.digito || null,
                conta.tipoConta,
                conta.chavePix || null,
                conta.pixKeyType || null,
                conta.cpfCnpjTitular || null,
                conta.principal ?? false,
                conta.id,
                id,
              ]
            );
            keptContaIds.push(conta.id);
          } else {
            const contaResult = await client.query(
              `INSERT INTO contas_bancarias
                 (usuario_id, banco, agencia, conta, digito, tipo_conta, chave_pix, pix_key_type, cpf_cnpj_titular, principal)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               RETURNING id`,
              [
                id,
                conta.banco,
                conta.agencia,
                conta.conta,
                conta.digito || null,
                conta.tipoConta,
                conta.chavePix || null,
                conta.pixKeyType || null,
                conta.cpfCnpjTitular || null,
                conta.principal ?? false,
              ]
            );
            keptContaIds.push(contaResult.rows[0].id);
          }
        }

        await client.query(
          `DELETE FROM contas_bancarias WHERE usuario_id = $1 AND id != ALL($2::bigint[])`,
          [id, keptContaIds]
        );
      }
    });
  }

  async deleteClient(id) {
    return withTransaction(async (client) => {
      const existingClient = await client.query(
        `SELECT endereco_id FROM usuarios WHERE id = $1 AND perfil = 'CLIENTE'`,
        [id]
      );

      if (existingClient.rows.length === 0) {
        throw new AppError('Cliente não encontrado.', 404);
      }

      const enderecoId = existingClient.rows[0].endereco_id;

      try {
        await client.query(`DELETE FROM usuarios WHERE id = $1`, [id]);
      } catch (error) {
        if (error.code === '23503') {
          throw new AppError(
            'Não é possível excluir este cliente: existem imóveis, contratos ou registros financeiros vinculados.',
            409
          );
        }

        throw error;
      }

      if (enderecoId) {
        const refCountResult = await client.query(
          `SELECT
             (SELECT COUNT(*) FROM usuarios WHERE endereco_id = $1) +
             (SELECT COUNT(*) FROM imoveis WHERE endereco_id = $1) AS other_refs`,
          [enderecoId]
        );

        if (Number(refCountResult.rows[0].other_refs) === 0) {
          await client.query(`DELETE FROM enderecos WHERE id = $1`, [
            enderecoId,
          ]);
        }
      }
    });
  }
}

export default new ClientsRepository();
