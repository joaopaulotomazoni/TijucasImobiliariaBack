import supabase from '../config/database.js';
import AppError from '../errors/AppError.js';
import { withTransaction } from '../utils/withTransaction.js';

class PropertiesRepository {
  async getProperties() {
    const { data, error } = await supabase
      .from('imoveis')
      .select(
        `id,
         tipo_imovel,
         valor_aluguel_referencia,
         valor_condominio,
         valor_iptu,
         area_util,
         quartos,
         banheiros,
         vagas_garagem,
         matricula,
         inscricao_iptu,
         observacoes,
         status,
         endereco:enderecos!endereco_id (
           id,
           pais,
           cep,
           estado,
           cidade,
           bairro,
           logradouro,
           numero,
           complemento,
           latitude,
           longitude
         ),
         proprietario:usuarios!proprietario_id (
           id,
           nome_completo,
           documento,
           email,
           telefone
         )`
      )
      .order('id', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async registerProperties({
    tipoImovel,
    ownerId,
    valorAluguelReferencia,
    valorCondominio,
    valorIptu,
    areaUtil,
    quartos,
    banheiros,
    vagasGaragem,
    matricula,
    inscricaoIptu,
    observacoes,
    status,
    address,
  }) {
    return withTransaction(async (client) => {
      const enderecoResult = await client.query(
        `INSERT INTO enderecos (cep, estado, cidade, bairro, logradouro, numero, complemento)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          address.cep,
          address.estado,
          address.cidade,
          address.bairro,
          address.logradouro,
          address.numero ?? null,
          address.complemento ?? null,
        ]
      );
      const enderecoId = enderecoResult.rows[0].id;

      try {
        await client.query(
          `INSERT INTO imoveis (
             endereco_id, proprietario_id, tipo_imovel, valor_aluguel_referencia,
             valor_condominio, valor_iptu, area_util, quartos, banheiros,
             vagas_garagem, matricula, inscricao_iptu, observacoes, status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            enderecoId,
            ownerId,
            tipoImovel,
            valorAluguelReferencia,
            valorCondominio ?? null,
            valorIptu ?? null,
            areaUtil ?? null,
            quartos,
            banheiros,
            vagasGaragem,
            matricula || null,
            inscricaoIptu || null,
            observacoes || null,
            status,
          ]
        );
      } catch (error) {
        if (error.code === '23503') {
          throw new AppError('Proprietário informado não existe.', 404);
        }

        throw error;
      }
    });
  }

  async updateProperties(
    id,
    {
      tipoImovel,
      ownerId,
      valorAluguelReferencia,
      valorCondominio,
      valorIptu,
      areaUtil,
      quartos,
      banheiros,
      vagasGaragem,
      matricula,
      inscricaoIptu,
      observacoes,
      status,
      address,
    }
  ) {
    return withTransaction(async (client) => {
      const existingProperty = await client.query(
        `SELECT id FROM imoveis WHERE id = $1`,
        [id]
      );

      if (existingProperty.rows.length === 0) {
        throw new AppError('Imóvel não encontrado.', 404);
      }

      let enderecoId;

      if (address.id) {
        const refCountResult = await client.query(
          `SELECT
             (SELECT COUNT(*) FROM usuarios WHERE endereco_id = $1) +
             (SELECT COUNT(*) FROM imoveis WHERE endereco_id = $1 AND id != $2) AS other_refs`,
          [address.id, id]
        );
        const isSharedEndereco = Number(refCountResult.rows[0].other_refs) > 0;

        if (isSharedEndereco) {
          const enderecoResult = await client.query(
            `INSERT INTO enderecos (cep, estado, cidade, bairro, logradouro, numero, complemento)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [
              address.cep,
              address.estado,
              address.cidade,
              address.bairro,
              address.logradouro,
              address.numero ?? null,
              address.complemento ?? null,
            ]
          );
          enderecoId = enderecoResult.rows[0].id;
        } else {
          await client.query(
            `UPDATE enderecos
             SET cep = $1, estado = $2, cidade = $3, bairro = $4, logradouro = $5, numero = $6, complemento = $7
             WHERE id = $8 AND id = (SELECT endereco_id FROM imoveis WHERE id = $9)`,
            [
              address.cep,
              address.estado,
              address.cidade,
              address.bairro,
              address.logradouro,
              address.numero ?? null,
              address.complemento ?? null,
              address.id,
              id,
            ]
          );
          enderecoId = address.id;
        }
      } else {
        const enderecoResult = await client.query(
          `INSERT INTO enderecos (cep, estado, cidade, bairro, logradouro, numero, complemento)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            address.cep,
            address.estado,
            address.cidade,
            address.bairro,
            address.logradouro,
            address.numero ?? null,
            address.complemento ?? null,
          ]
        );
        enderecoId = enderecoResult.rows[0].id;
      }

      try {
        await client.query(
          `UPDATE imoveis
           SET endereco_id = $1, proprietario_id = $2, tipo_imovel = $3, valor_aluguel_referencia = $4,
               valor_condominio = $5, valor_iptu = $6, area_util = $7, quartos = $8, banheiros = $9,
               vagas_garagem = $10, matricula = $11, inscricao_iptu = $12, observacoes = $13, status = $14
           WHERE id = $15`,
          [
            enderecoId,
            ownerId,
            tipoImovel,
            valorAluguelReferencia,
            valorCondominio ?? null,
            valorIptu ?? null,
            areaUtil ?? null,
            quartos,
            banheiros,
            vagasGaragem,
            matricula || null,
            inscricaoIptu || null,
            observacoes || null,
            status,
            id,
          ]
        );
      } catch (error) {
        if (error.code === '23503') {
          throw new AppError('Proprietário informado não existe.', 404);
        }

        throw error;
      }
    });
  }

  async getOwners() {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, documento, nome_completo')
      .order('nome_completo', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async deleteProperties(id) {
    return withTransaction(async (client) => {
      const existingProperty = await client.query(
        `SELECT endereco_id FROM imoveis WHERE id = $1`,
        [id]
      );

      if (existingProperty.rows.length === 0) {
        throw new AppError('Imóvel não encontrado.', 404);
      }

      const enderecoId = existingProperty.rows[0].endereco_id;

      try {
        await client.query(`DELETE FROM imoveis WHERE id = $1`, [id]);
      } catch (error) {
        if (error.code === '23503') {
          throw new AppError(
            'Não é possível excluir este imóvel: existem contratos vinculados a ele.',
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

export default new PropertiesRepository();
