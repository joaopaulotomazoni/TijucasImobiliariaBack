import supabase from '../config/database.js';
import AppError from '../errors/AppError.js';
import { withTransaction } from '../utils/withTransaction.js';
import { acquireContratoBillingTransactionLock } from '../utils/advisoryLocks.js';

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
         cobrancas_iniciais_iniciadas_em,
         cobrancas_iniciais_a_partir_de,
         cobrancas_iniciais_concluidas_em,
         data_devolucao_imovel,
         status,
         observacoes,
         migrado,
         proprietario_id_snapshot,
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
         cobrancas_iniciais_iniciadas_em,
         cobrancas_iniciais_a_partir_de,
         cobrancas_iniciais_concluidas_em,
         data_devolucao_imovel,
         status,
         observacoes,
         migrado,
         proprietario_id_snapshot,
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
    migrado,
    cobrancasIniciaisAPartirDe,
  }) {
    return withTransaction(async (client) => {
      const imovelResult = await client.query(
        `SELECT status, proprietario_id FROM imoveis WHERE id = $1 FOR UPDATE`,
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

      if (!imovelResult.rows[0].proprietario_id) {
        throw new AppError(
          'O imóvel precisa ter um proprietário antes da criação do contrato.',
          409
        );
      }

      if (corretorId) {
        const corretor = await client.query(
          `SELECT id FROM usuarios
           WHERE id = $1 AND perfil IN ('ADMIN', 'CORRETOR') AND ativo`,
          [corretorId]
        );
        if (corretor.rows.length === 0) {
          throw new AppError('Corretor responsável inválido ou inativo.', 400);
        }
      }

      const inquilinoIds = inquilinos.map((inquilino) => inquilino.usuarioId);
      const inquilinosResult = await client.query(
        `SELECT id FROM usuarios
         WHERE id = ANY($1::bigint[]) AND perfil = 'CLIENTE' AND ativo`,
        [inquilinoIds]
      );

      if (inquilinosResult.rows.length !== new Set(inquilinoIds).size) {
        throw new AppError(
          'Todos os inquilinos informados devem existir e possuir perfil de cliente.',
          400
        );
      }

      let contratoId;
      try {
        const contratoResult = await client.query(
          `INSERT INTO contratos (
             imovel_id, proprietario_id_snapshot, corretor_id, data_inicio, data_fim, valor_aluguel, dia_vencimento,
             indice_reajuste, periodicidade_reajuste_meses, percentual_multa_atraso,
             percentual_juros_mora_mensal, dias_tolerancia,
             taxa_administracao_percentual, observacoes,
             cobrancas_iniciais_a_partir_de, migrado
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           RETURNING id`,
          [
            imovelId,
            imovelResult.rows[0].proprietario_id,
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
            cobrancasIniciaisAPartirDe,
            migrado ?? false,
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
      inquilinos,
    }
  ) {
    return withTransaction(async (client) => {
      await acquireContratoBillingTransactionLock(client, id);

      const existing = await client.query(
        `SELECT id, status,
                to_char(data_inicio, 'YYYY-MM-DD') AS data_inicio,
                to_char(data_fim, 'YYYY-MM-DD') AS data_fim,
                valor_aluguel, dia_vencimento, indice_reajuste,
                periodicidade_reajuste_meses, percentual_multa_atraso,
                percentual_juros_mora_mensal, dias_tolerancia,
                taxa_administracao_percentual,
                cobrancas_iniciais_iniciadas_em,
                cobrancas_iniciais_concluidas_em,
                EXISTS (
                  SELECT 1 FROM parcelas p WHERE p.contrato_id = contratos.id
                ) AS possui_parcelas,
                EXISTS (
                  SELECT 1
                  FROM parcelas p
                  JOIN gateway_cobrancas gc ON gc.parcela_id = p.id
                  WHERE p.contrato_id = contratos.id
                ) AS possui_cobrancas_emitidas,
                EXISTS (
                  SELECT 1
                  FROM parcelas p
                  JOIN gateway_cobrancas gc ON gc.parcela_id = p.id
                  WHERE p.contrato_id = contratos.id AND gc.ativa
                ) AS possui_cobrancas_ativas
         FROM contratos
         WHERE id = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        throw new AppError('Contrato não encontrado.', 404);
      }

      const current = existing.rows[0];
      const terminalStatuses = new Set(['ENCERRADO', 'RESCINDIDO']);
      const allowedTransitions = {
        ATIVO: new Set(['ATIVO', 'INADIMPLENTE', 'ENCERRADO', 'RESCINDIDO']),
        INADIMPLENTE: new Set(['INADIMPLENTE', 'ATIVO', 'ENCERRADO', 'RESCINDIDO']),
      };

      if (corretorId) {
        const corretor = await client.query(
          `SELECT id FROM usuarios
           WHERE id = $1 AND perfil IN ('ADMIN', 'CORRETOR') AND ativo`,
          [corretorId]
        );
        if (corretor.rows.length === 0) {
          throw new AppError('Corretor responsável inválido ou inativo.', 400);
        }
      }

      if (inquilinos !== undefined) {
        const inquilinoIds = inquilinos.map(
          (inquilino) => inquilino.usuarioId
        );
        const inquilinosResult = await client.query(
          `SELECT id
           FROM usuarios
           WHERE id = ANY($1::bigint[]) AND perfil = 'CLIENTE' AND ativo`,
          [inquilinoIds]
        );

        if (inquilinosResult.rows.length !== new Set(inquilinoIds).size) {
          throw new AppError(
            'Todos os inquilinos informados devem existir e possuir perfil de cliente.',
            400
          );
        }

        const principalAtualResult = await client.query(
          `SELECT usuario_id
           FROM contrato_inquilinos
           WHERE contrato_id = $1 AND principal
           FOR UPDATE`,
          [id]
        );
        const principalAtualId = principalAtualResult.rows[0]?.usuario_id;
        const novoPrincipalId = inquilinos.find(
          (inquilino) => inquilino.principal
        )?.usuarioId;

        if (
          current.possui_cobrancas_emitidas &&
          String(principalAtualId) !== String(novoPrincipalId)
        ) {
          throw new AppError(
            'Não é possível alterar o inquilino principal após a emissão de boletos.',
            409
          );
        }
      }

      const financialTermsChanged =
        current.data_inicio !== dataInicio ||
        current.data_fim !== dataFim ||
        Number(current.valor_aluguel) !== Number(valorAluguel) ||
        Number(current.dia_vencimento) !== Number(diaVencimento) ||
        current.indice_reajuste !== (indiceReajuste ?? 'IGPM') ||
        Number(current.periodicidade_reajuste_meses) !==
          Number(periodicidadeReajusteMeses ?? 12) ||
        Number(current.percentual_multa_atraso) !==
          Number(percentualMultaAtraso ?? 2) ||
        Number(current.percentual_juros_mora_mensal) !==
          Number(percentualJurosMoraMensal ?? 1) ||
        Number(current.dias_tolerancia) !== Number(diasTolerancia ?? 0) ||
        Number(current.taxa_administracao_percentual) !==
          Number(taxaAdministracaoPercentual ?? 0);

      if (current.possui_parcelas && financialTermsChanged) {
        throw new AppError(
          'Não é possível alterar vigência, vencimento ou valores após a emissão de boletos.',
          409
        );
      }

      if (
        current.cobrancas_iniciais_iniciadas_em &&
        !current.cobrancas_iniciais_concluidas_em &&
        financialTermsChanged
      ) {
        throw new AppError(
          'Aguarde a conclusão do lote inicial de boletos antes de alterar os termos financeiros.',
          409
        );
      }

      const nextStatus = status ?? current.status;

      if (
        terminalStatuses.has(current.status) &&
        nextStatus !== current.status
      ) {
        throw new AppError(
          'Contratos encerrados ou rescindidos não podem ser reativados.',
          409
        );
      }

      if (
        allowedTransitions[current.status] &&
        !allowedTransitions[current.status].has(nextStatus)
      ) {
        throw new AppError('Transição de status do contrato inválida.', 409);
      }

      if (
        ['ENCERRADO', 'RESCINDIDO'].includes(nextStatus) &&
        !dataDevolucaoImovel
      ) {
        throw new AppError(
          'Informe a data de devolução do imóvel para finalizar o contrato.',
          400
        );
      }

      if (
        dataDevolucaoImovel &&
        (dataDevolucaoImovel < dataInicio ||
          dataDevolucaoImovel > new Date().toISOString().slice(0, 10))
      ) {
        throw new AppError(
          'A data de devolução deve estar entre o início do contrato e hoje.',
          400
        );
      }

      if (
        current.possui_cobrancas_ativas &&
        ['ENCERRADO', 'RESCINDIDO'].includes(nextStatus)
      ) {
        throw new AppError(
          'Cancele os boletos ativos antes de encerrar ou rescindir o contrato.',
          409
        );
      }

      if (inquilinos !== undefined) {
        await client.query(
          `DELETE FROM contrato_inquilinos WHERE contrato_id = $1`,
          [id]
        );

        for (const inquilino of inquilinos) {
          await client.query(
            `INSERT INTO contrato_inquilinos (contrato_id, usuario_id, principal)
             VALUES ($1, $2, $3)`,
            [id, inquilino.usuarioId, inquilino.principal ?? false]
          );
        }
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
          nextStatus,
          observacoes || null,
          id,
        ]
      );

      if (
        ['ENCERRADO', 'RESCINDIDO'].includes(nextStatus) &&
        !['ENCERRADO', 'RESCINDIDO'].includes(current.status)
      ) {
        await client.query(
          `UPDATE imoveis i
           SET status = 'DISPONIVEL'
           WHERE i.id = (
             SELECT imovel_id FROM contratos WHERE id = $1
           )
             AND NOT EXISTS (
               SELECT 1 FROM contratos c
               WHERE c.imovel_id = i.id
                 AND c.id <> $1
                 AND c.status IN ('ATIVO', 'INADIMPLENTE')
             )`,
          [id]
        );
      }
    });
  }

  async deleteContract(id) {
    return withTransaction(async (client) => {
      await acquireContratoBillingTransactionLock(client, id);

      const existing = await client.query(
        `SELECT imovel_id, cobrancas_iniciais_iniciadas_em,
                cobrancas_iniciais_concluidas_em
         FROM contratos WHERE id = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        throw new AppError('Contrato não encontrado.', 404);
      }

      const imovelId = existing.rows[0].imovel_id;

      if (
        existing.rows[0].cobrancas_iniciais_iniciadas_em &&
        !existing.rows[0].cobrancas_iniciais_concluidas_em
      ) {
        throw new AppError(
          'Não é possível excluir o contrato enquanto o lote inicial de boletos está pendente.',
          409
        );
      }

      const parcelas = await client.query(
        `SELECT 1 FROM parcelas WHERE contrato_id = $1 LIMIT 1`,
        [id]
      );

      if (parcelas.rows.length > 0) {
        throw new AppError(
          'Não é possível excluir um contrato com boletos gerados. Cancele as cobranças e encerre o contrato.',
          409
        );
      }

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
        `SELECT 1 FROM contratos
         WHERE imovel_id = $1 AND status IN ('ATIVO', 'INADIMPLENTE')
         LIMIT 1`,
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

  async registerHistoricalPayments(contratoId, pagamentos, registradoPor) {
    return withTransaction(async (client) => {
      await acquireContratoBillingTransactionLock(client, contratoId);
      const contract = await client.query(
        `SELECT id, migrado,
                to_char(data_inicio, 'YYYY-MM-DD') AS data_inicio,
                to_char(data_fim, 'YYYY-MM-DD') AS data_fim
         FROM contratos WHERE id = $1 FOR UPDATE`,
        [contratoId]
      );
      if (!contract.rows[0]) throw new AppError('Contrato não encontrado.', 404);
      if (!contract.rows[0].migrado) {
        throw new AppError(
          'Pagamentos históricos só podem ser registrados em contratos migrados.',
          409
        );
      }

      const result = [];
      for (const pagamento of pagamentos) {
        const competenciaDate = pagamento.competencia;
        if (
          competenciaDate < contract.rows[0].data_inicio ||
          competenciaDate > contract.rows[0].data_fim
        ) {
          throw new AppError('A competência histórica está fora da vigência do contrato.', 400);
        }
        if (
          pagamento.dataVencimento.slice(0, 7) !==
            competenciaDate.slice(0, 7) ||
          pagamento.dataVencimento < contract.rows[0].data_inicio ||
          pagamento.dataVencimento > contract.rows[0].data_fim
        ) {
          throw new AppError(
            'O vencimento histórico deve pertencer à competência e à vigência do contrato.',
            400
          );
        }
        if (pagamento.dataPagamento < contract.rows[0].data_inicio) {
          throw new AppError(
            'O pagamento histórico não pode ser anterior ao início do contrato.',
            400
          );
        }

        const existing = await client.query(
          `SELECT p.id, p.status,
                  EXISTS (SELECT 1 FROM gateway_cobrancas gc
                    WHERE gc.parcela_id = p.id AND gc.ativa) AS cobranca_ativa,
                  EXISTS (SELECT 1 FROM gateway_cobrancas gc
                    WHERE gc.parcela_id = p.id) AS cobranca_emitida,
                  EXISTS (SELECT 1 FROM pagamentos pay
                    WHERE pay.parcela_id = p.id
                      AND pay.estornado_em IS NULL) AS pagamento_registrado
           FROM parcelas p
           WHERE p.contrato_id = $1 AND p.competencia = $2
           FOR UPDATE`,
          [contratoId, competenciaDate]
        );

        if (existing.rows[0]?.cobranca_ativa) {
          throw new AppError(
            `A competência ${competenciaDate} possui boleto ativo; utilize a baixa presencial.`,
            409
          );
        }
        if (existing.rows[0]?.cobranca_emitida) {
          throw new AppError(
            `A competência ${competenciaDate} possui histórico no gateway e não pode ser marcada como migração.`,
            409
          );
        }
        if (existing.rows[0]?.pagamento_registrado) {
          throw new AppError(
            `A competência ${competenciaDate} já possui pagamento registrado.`,
            409
          );
        }

        let parcelaId = existing.rows[0]?.id;
        if (!parcelaId) {
          const parcela = await client.query(
            `INSERT INTO parcelas (
               contrato_id, competencia, data_vencimento, valor_base,
               status, forma_pagamento
             ) VALUES ($1, $2, $3, $4, 'PAGA', $5)
             RETURNING id`,
            [
              contratoId,
              competenciaDate,
              pagamento.dataVencimento,
              pagamento.valorPago,
              ['PIX', 'BOLETO', 'CARTAO'].includes(pagamento.formaPagamento)
                ? pagamento.formaPagamento
                : null,
            ]
          );
          parcelaId = parcela.rows[0].id;
        } else {
          await client.query(`UPDATE parcelas SET status = 'PAGA' WHERE id = $1`, [parcelaId]);
        }

        await client.query(
          `INSERT INTO pagamentos (
             parcela_id, valor_pago, data_pagamento, forma_pagamento,
             comprovante_key, registrado_por, origem
           ) VALUES ($1, $2, $3, $4, $5, $6, 'MIGRACAO')`,
          [
            parcelaId,
            pagamento.valorPago,
            pagamento.dataPagamento,
            pagamento.formaPagamento,
            pagamento.comprovanteKey || null,
            registradoPor,
          ]
        );
        result.push({ parcelaId, competencia: competenciaDate, existente: false });
      }
      return result;
    });
  }
}

export default new ContractsRepository();
