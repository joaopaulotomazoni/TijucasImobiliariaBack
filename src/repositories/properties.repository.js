import supabase, { pool } from '../config/database.js';
import AppError from '../errors/AppError.js';
import { withTransaction } from '../utils/withTransaction.js';

const PROPERTY_SELECT = `id,
  numero_referencia,
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
  )`;

class PropertiesRepository {
  async getProperties() {
    const { data, error } = await supabase
      .from('imoveis')
      .select(PROPERTY_SELECT)
      .order('id', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async getPropertyById(id) {
    const { data, error } = await supabase
      .from('imoveis')
      .select(PROPERTY_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async registerProperties({
    numeroReferencia,
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
      const owner = await client.query(
        `SELECT id FROM usuarios
         WHERE id = $1 AND perfil = 'CLIENTE' AND ativo`,
        [ownerId]
      );
      if (owner.rows.length === 0) {
        throw new AppError(
          'O proprietário deve ser um cliente ativo.',
          400
        );
      }
      if (status === 'ALUGADO') {
        throw new AppError(
          'O imóvel só pode ficar alugado pela criação de um contrato.',
          409
        );
      }

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
             endereco_id, proprietario_id, numero_referencia, tipo_imovel, valor_aluguel_referencia,
             valor_condominio, valor_iptu, area_util, quartos, banheiros,
             vagas_garagem, matricula, inscricao_iptu, observacoes, status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            enderecoId,
            ownerId,
            numeroReferencia || null,
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
        if (error.code === '23505') {
          throw new AppError('O número de referência do imóvel já está em uso.', 409);
        }
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
      numeroReferencia,
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
        `SELECT id, proprietario_id, status,
                EXISTS (
                  SELECT 1 FROM contratos c
                  WHERE c.imovel_id = imoveis.id
                    AND c.status IN ('ATIVO', 'INADIMPLENTE')
                ) AS possui_contrato_vigente
         FROM imoveis WHERE id = $1 FOR UPDATE`,
        [id]
      );

      if (existingProperty.rows.length === 0) {
        throw new AppError('Imóvel não encontrado.', 404);
      }

      const current = existingProperty.rows[0];
      const owner = await client.query(
        `SELECT id FROM usuarios
         WHERE id = $1 AND perfil = 'CLIENTE' AND ativo`,
        [ownerId]
      );
      if (owner.rows.length === 0) {
        throw new AppError(
          'O proprietário deve ser um cliente ativo.',
          400
        );
      }
      if (
        current.possui_contrato_vigente &&
        String(current.proprietario_id) !== String(ownerId)
      ) {
        throw new AppError(
          'Não é possível trocar o proprietário enquanto houver contrato vigente.',
          409
        );
      }
      if (current.possui_contrato_vigente && status !== 'ALUGADO') {
        throw new AppError(
          'Um imóvel com contrato vigente deve permanecer com status ALUGADO.',
          409
        );
      }
      if (!current.possui_contrato_vigente && status === 'ALUGADO') {
        throw new AppError(
          'O imóvel só pode ficar alugado pela criação de um contrato.',
          409
        );
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
           SET endereco_id = $1, proprietario_id = $2, numero_referencia = $3,
               tipo_imovel = $4, valor_aluguel_referencia = $5,
               valor_condominio = $6, valor_iptu = $7, area_util = $8,
               quartos = $9, banheiros = $10, vagas_garagem = $11,
               matricula = $12, inscricao_iptu = $13, observacoes = $14, status = $15
           WHERE id = $16`,
          [
            enderecoId,
            ownerId,
            numeroReferencia || null,
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
        if (error.code === '23505') {
          throw new AppError('O número de referência do imóvel já está em uso.', 409);
        }
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
      .eq('perfil', 'CLIENTE')
      .order('nome_completo', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async getOwnersPortfolio() {
    const { rows } = await pool.query(
      `SELECT u.id, u.nome_completo, u.documento, u.email, u.telefone,
              count(i.id)::int AS quantidade_imoveis,
              COALESCE(json_agg(json_build_object(
                'id', i.id,
                'numeroReferencia', i.numero_referencia,
                'tipo', i.tipo_imovel,
                'status', i.status,
                'logradouro', e.logradouro,
                'numero', e.numero,
                'bairro', e.bairro,
                'cidade', e.cidade,
                'estado', e.estado
              ) ORDER BY i.id), '[]'::json) AS imoveis
       FROM usuarios u
       JOIN imoveis i ON i.proprietario_id = u.id
       LEFT JOIN enderecos e ON e.id = i.endereco_id
       GROUP BY u.id
       ORDER BY u.nome_completo`
    );
    return rows;
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
