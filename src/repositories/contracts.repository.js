import supabase from '../config/database.js';
import AppError from '../errors/AppError.js';
import { withTransaction } from '../utils/withTransaction.js';

class ContractsRepository {
  async getContracts() {
    const { data, error } = await supabase
      .from('contratos')
      .select(
        `id,
         imovel_id,
         corretor_id,
         data_inicio,
         data_fim,
         valor_aluguel,
         dia_vencimento,
         indice_reajuste,
         periodicidade_reajuste_meses,
         percentual_multa_atraso,
         percentual_juros_mora_mensal,
         dias_tolerancia,
         taxa_administracao_percentual,
         data_devolucao_imovel,
         status,
         observacoes,
         imovel:imoveis!imovel_id (
           id,
           tipo_imovel,
           status,
           endereco:enderecos!endereco_id (
             id, cep, estado, cidade, bairro, logradouro, numero, complemento
           )
         ),
         inquilinos:contrato_inquilinos (
           principal,
           usuario:usuarios!usuario_id ( id, nome_completo, documento, email, telefone )
         )`
      )
      .order('id', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async getContractById(id) {
    const { data, error } = await supabase
      .from('contratos')
      .select(
        `id,
         imovel_id,
         corretor_id,
         data_inicio,
         data_fim,
         valor_aluguel,
         dia_vencimento,
         indice_reajuste,
         periodicidade_reajuste_meses,
         percentual_multa_atraso,
         percentual_juros_mora_mensal,
         dias_tolerancia,
         taxa_administracao_percentual,
         data_devolucao_imovel,
         status,
         observacoes,
         imovel:imoveis!imovel_id (
           id,
           tipo_imovel,
           status,
           endereco:enderecos!endereco_id (
             id, cep, estado, cidade, bairro, logradouro, numero, complemento
           )
         ),
         inquilinos:contrato_inquilinos (
           principal,
           usuario:usuarios!usuario_id ( id, nome_completo, documento, email, telefone )
         )`
      )
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async registerContract({
    imovelId,
    corretorId,
    dataInicio,
    dataFim,
    valorAluguel,
    diaVencimento,
    indiceReajuste,
    periodicidadeReajusteMeses,
    percentualMultaAtraso,
    percentualJurosMoraMensal,
    diasTolerancia,
    taxaAdministracaoPercentual,
    observacoes,
    inquilinos,
  }) {
    return withTransaction(async (client) => {
      const imovelResult = await client.query(
        `SELECT status FROM imoveis WHERE id = $1`,
        [imovelId]
      );

      if (imovelResult.rows.length === 0) {
        throw new AppError('Imóvel não encontrado.', 404);
      }

      if (imovelResult.rows[0].status !== 'DISPONIVEL') {
        throw new AppError(
          'O imóvel não está disponível para locação.',
          409
        );
      }

      let contratoId;
      try {
        const contratoResult = await client.query(
          `INSERT INTO contratos (
             imovel_id, corretor_id, data_inicio, data_fim, valor_aluguel, dia_vencimento,
             indice_reajuste, periodicidade_reajuste_meses, percentual_multa_atraso,
             percentual_juros_mora_mensal, dias_tolerancia, taxa_administracao_percentual, observacoes
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id`,
          [
            imovelId,
            corretorId ?? null,
            dataInicio,
            dataFim,
            valorAluguel,
            diaVencimento,
            indiceReajuste ?? 'IGPM',
            periodicidadeReajusteMeses ?? 12,
            percentualMultaAtraso ?? 2,
            percentualJurosMoraMensal ?? 1,
            diasTolerancia ?? 0,
            taxaAdministracaoPercentual ?? 0,
            observacoes || null,
          ]
        );
        contratoId = contratoResult.rows[0].id;
      } catch (error) {
        // Exclusão gist: dois contratos ATIVOS sobrepostos no mesmo imóvel.
        if (error.code === '23P01') {
          throw new AppError(
            'Já existe um contrato ativo para este imóvel neste período.',
            409
          );
        }
        throw error;
      }

      for (const inquilino of inquilinos) {
        try {
          await client.query(
            `INSERT INTO contrato_inquilinos (contrato_id, usuario_id, principal)
             VALUES ($1, $2, $3)`,
            [contratoId, inquilino.usuarioId, inquilino.principal ?? false]
          );
        } catch (error) {
          if (error.code === '23503') {
            throw new AppError(
              `Inquilino informado (id ${inquilino.usuarioId}) não existe.`,
              404
            );
          }
          throw error;
        }
      }

      await client.query(
        `UPDATE imoveis SET status = 'ALUGADO' WHERE id = $1`,
        [imovelId]
      );

      return { id: contratoId };
    });
  }

  async updateContract(
    id,
    {
      corretorId,
      dataInicio,
      dataFim,
      valorAluguel,
      diaVencimento,
      indiceReajuste,
      periodicidadeReajusteMeses,
      percentualMultaAtraso,
      percentualJurosMoraMensal,
      diasTolerancia,
      taxaAdministracaoPercentual,
      dataDevolucaoImovel,
      status,
      observacoes,
    }
  ) {
    return withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT id FROM contratos WHERE id = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        throw new AppError('Contrato não encontrado.', 404);
      }

      await client.query(
        `UPDATE contratos
         SET corretor_id = $1, data_inicio = $2, data_fim = $3, valor_aluguel = $4,
             dia_vencimento = $5, indice_reajuste = $6, periodicidade_reajuste_meses = $7,
             percentual_multa_atraso = $8, percentual_juros_mora_mensal = $9, dias_tolerancia = $10,
             taxa_administracao_percentual = $11, data_devolucao_imovel = $12, status = $13, observacoes = $14
         WHERE id = $15`,
        [
          corretorId ?? null,
          dataInicio,
          dataFim,
          valorAluguel,
          diaVencimento,
          indiceReajuste ?? 'IGPM',
          periodicidadeReajusteMeses ?? 12,
          percentualMultaAtraso ?? 2,
          percentualJurosMoraMensal ?? 1,
          diasTolerancia ?? 0,
          taxaAdministracaoPercentual ?? 0,
          dataDevolucaoImovel || null,
          status ?? 'ATIVO',
          observacoes || null,
          id,
        ]
      );
    });
  }

  async deleteContract(id) {
    return withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT imovel_id FROM contratos WHERE id = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        throw new AppError('Contrato não encontrado.', 404);
      }

      const imovelId = existing.rows[0].imovel_id;

      try {
        await client.query(`DELETE FROM contratos WHERE id = $1`, [id]);
      } catch (error) {
        if (error.code === '23503') {
          throw new AppError(
            'Não é possível excluir este contrato: existem parcelas ou pagamentos vinculados a ele.',
            409
          );
        }
        throw error;
      }

      // Libera o imóvel se não sobrar nenhum outro contrato ativo nele.
      const outrosAtivos = await client.query(
        `SELECT 1 FROM contratos WHERE imovel_id = $1 AND status = 'ATIVO' LIMIT 1`,
        [imovelId]
      );

      if (outrosAtivos.rows.length === 0) {
        await client.query(
          `UPDATE imoveis SET status = 'DISPONIVEL' WHERE id = $1`,
          [imovelId]
        );
      }
    });
  }
}

export default new ContractsRepository();
