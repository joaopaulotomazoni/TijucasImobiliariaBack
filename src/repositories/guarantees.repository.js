import supabase, { pool } from '../config/database.js';
import AppError from '../errors/AppError.js';
import { withTransaction } from '../utils/withTransaction.js';

// Traduz erros do Postgres que podem escapar dos inserts de garantia.
function translateGuaranteeError(error) {
  // Índice único parcial uq_garantia_ativa_por_contrato (art. 37).
  if (error.code === '23505' && error.constraint === 'uq_garantia_ativa_por_contrato') {
    return new AppError(
      'Este contrato já possui uma garantia ativa. É vedada mais de uma modalidade de garantia por contrato (Lei 8.245/91, art. 37).',
      409
    );
  }
  // Trigger trg_caucao_limite_legal (art. 38, §2º) e demais CHECKs.
  if (error.code === '23514' || error.code === '23P01') {
    return new AppError(error.message, 400);
  }
  return error;
}

// Insere a linha de detalhe conforme o tipo. Recebe o client da transação.
async function insertGuaranteeDetail(client, garantiaId, tipo, detail) {
  if (tipo === 'CAUCAO') {
    await client.query(
      `INSERT INTO garantia_caucao (
         garantia_id, modalidade, valor, banco, agencia, conta_poupanca, data_deposito,
         descricao_bem, registro_cartorio, comprovante_deposito_key
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        garantiaId,
        detail.modalidade,
        detail.valor ?? null,
        detail.banco || null,
        detail.agencia || null,
        detail.contaPoupanca || null,
        detail.dataDeposito || null,
        detail.descricaoBem || null,
        detail.registroCartorio || null,
        detail.comprovanteDepositoKey || null,
      ]
    );
    return;
  }

  if (tipo === 'SEGURO_FIANCA') {
    await client.query(
      `INSERT INTO garantia_seguro_fianca (
         garantia_id, seguradora, numero_apolice, vigencia_inicio, vigencia_fim,
         valor_cobertura, valor_premio, periodicidade_premio, status_aprovacao, apolice_key
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        garantiaId,
        detail.seguradora,
        detail.numeroApolice,
        detail.vigenciaInicio,
        detail.vigenciaFim,
        detail.valorCobertura,
        detail.valorPremio ?? null,
        detail.periodicidadePremio || null,
        detail.statusAprovacao ?? 'PENDENTE',
        detail.apoliceKey || null,
      ]
    );
    return;
  }

  // FIADOR: 1+ fiadores
  for (const fiador of detail.fiadores) {
    // Endereço do imóvel dado em garantia: se veio o objeto completo, cria a
    // linha em `enderecos` na mesma transação e usa o id; senão aceita um id já
    // existente (imovelGarantiaEnderecoId) ou fica nulo.
    let imovelGarantiaEnderecoId = fiador.imovelGarantiaEnderecoId ?? null;
    if (fiador.imovelGarantiaEndereco) {
      const endereco = fiador.imovelGarantiaEndereco;
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
      imovelGarantiaEnderecoId = enderecoResult.rows[0].id;
    }

    try {
      await client.query(
        `INSERT INTO garantia_fiadores (
           garantia_id, usuario_id, renda_comprovada, comprovante_renda_key,
           certidao_imovel_key,
           imovel_garantia_endereco_id, imovel_garantia_matricula, imovel_garantia_quitado,
           estado_civil, regime_bens, conjuge_nome, conjuge_documento, outorga_conjugal
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          garantiaId,
          fiador.usuarioId,
          fiador.rendaComprovada ?? null,
          fiador.comprovanteRendaKey || null,
          fiador.certidaoImovelKey || null,
          imovelGarantiaEnderecoId,
          fiador.imovelGarantiaMatricula || null,
          fiador.imovelGarantiaQuitado ?? null,
          fiador.estadoCivil || null,
          fiador.regimeBens || null,
          fiador.conjugeNome || null,
          fiador.conjugeDocumento || null,
          fiador.outorgaConjugal ?? false,
        ]
      );
    } catch (error) {
      if (error.code === '23503') {
        throw new AppError(
          `Fiador informado (id ${fiador.usuarioId}) não existe.`,
          404
        );
      }
      throw error;
    }
  }
}

class GuaranteesRepository {
  async withCaucaoLock(garantiaId, callback) {
    const client = await pool.connect();
    const lockKey = `caucao:${garantiaId}`;
    try {
      await client.query(
        `SELECT pg_advisory_lock(hashtextextended($1::text, 0))`,
        [lockKey]
      );
      return await callback(client);
    } finally {
      await client.query(
        `SELECT pg_advisory_unlock(hashtextextended($1::text, 0))`,
        [lockKey]
      ).catch(() => undefined);
      client.release();
    }
  }

  async getGuaranteesByContract(contratoId) {
    const { data, error } = await supabase
      .from('garantias')
      .select(
        `id,
         contrato_id,
         tipo,
         status,
         data_inicio,
         data_fim,
         motivo_substituicao,
         caucao:garantia_caucao (
           modalidade, valor, banco, agencia, conta_poupanca, data_deposito,
           descricao_bem, registro_cartorio, comprovante_deposito_key,
           status_pagamento, pago_em, analisado_por, analisado_em,
           valor_devolvido, valor_retido, motivo_retencao, data_devolucao,
           cobranca:caucao_cobrancas (
             id, gateway, external_payment_id, external_reference,
             qr_code_pix, copia_cola_pix, url_fatura, valor,
             status_gateway, ativa, tentativa, created_at
           )
         ),
         seguro:garantia_seguro_fianca (
           seguradora, numero_apolice, vigencia_inicio, vigencia_fim,
           valor_cobertura, valor_premio, periodicidade_premio, status_aprovacao, apolice_key
         ),
         fiadores:garantia_fiadores (
           usuario_id, renda_comprovada, comprovante_renda_key, certidao_imovel_key,
           imovel_garantia_endereco_id, imovel_garantia_matricula, imovel_garantia_quitado,
           estado_civil, regime_bens, conjuge_nome, conjuge_documento, outorga_conjugal,
           status, data_notificacao_exoneracao, data_fim_responsabilidade,
           usuario:usuarios!usuario_id ( id, nome_completo, documento, email, telefone ),
           imovel_garantia_endereco:enderecos!imovel_garantia_endereco_id (
             id, cep, estado, cidade, bairro, logradouro, numero, complemento
           )
         )`
      )
      .eq('contrato_id', contratoId)
      .order('id', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return data.map((guarantee) => ({
      ...guarantee,
      caucao: (guarantee.caucao ?? []).map((caucao) => ({
        ...caucao,
        cobranca: [...(caucao.cobranca ?? [])].sort(
          (first, second) =>
            Number(second.ativa) - Number(first.ativa) ||
            Number(second.tentativa) - Number(first.tentativa)
        ),
      })),
    }));
  }

  async getContractIdByGuarantee(garantiaId) {
    const { data, error } = await supabase
      .from('garantias')
      .select('contrato_id')
      .eq('id', garantiaId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data?.contrato_id ?? null;
  }

  async assertUsersAreActiveClients(userIds) {
    const uniqueIds = [...new Set(userIds.map(String))];
    const { rows } = await pool.query(
      `SELECT id FROM usuarios
       WHERE id = ANY($1::bigint[]) AND perfil = 'CLIENTE' AND ativo`,
      [uniqueIds]
    );
    if (rows.length !== uniqueIds.length) {
      throw new AppError('Todos os fiadores devem ser clientes ativos.', 400);
    }
  }

  async createGuarantee(contratoId, { tipo, ...detail }, realizadoPor) {
    return withTransaction(async (client) => {
      const contrato = await client.query(
        `SELECT id FROM contratos WHERE id = $1`,
        [contratoId]
      );

      if (contrato.rows.length === 0) {
        throw new AppError('Contrato não encontrado.', 404);
      }

      let garantiaId;
      try {
        const garantiaResult = await client.query(
          `INSERT INTO garantias (contrato_id, tipo) VALUES ($1, $2) RETURNING id`,
          [contratoId, tipo]
        );
        garantiaId = garantiaResult.rows[0].id;

        await insertGuaranteeDetail(client, garantiaId, tipo, detail);
        await this.auditGuarantee(client, {
          garantiaId,
          acao: 'CRIACAO',
          before: null,
          after: { contratoId, tipo },
          userId: realizadoPor,
        });
      } catch (error) {
        throw translateGuaranteeError(error);
      }

      return { id: garantiaId };
    });
  }

  async substituteGuarantee(garantiaId, motivo, { tipo, ...detail }, realizadoPor) {
    return withTransaction(async (client) => {
      const atual = await client.query(
        `SELECT contrato_id, status FROM garantias WHERE id = $1`,
        [garantiaId]
      );

      if (atual.rows.length === 0) {
        throw new AppError('Garantia não encontrada.', 404);
      }

      if (atual.rows[0].status !== 'ATIVA') {
        throw new AppError(
          'Apenas uma garantia ativa pode ser substituída.',
          409
        );
      }

      const contratoId = atual.rows[0].contrato_id;

      // Encerra a atual ANTES de criar a nova, senão o índice único parcial
      // (uq_garantia_ativa_por_contrato) bloquearia a segunda linha ATIVA.
      await client.query(
        `UPDATE garantias
         SET status = 'SUBSTITUIDA', data_fim = CURRENT_DATE, motivo_substituicao = $1
         WHERE id = $2`,
        [motivo || null, garantiaId]
      );

      let novaId;
      try {
        const novaResult = await client.query(
          `INSERT INTO garantias (contrato_id, tipo) VALUES ($1, $2) RETURNING id`,
          [contratoId, tipo]
        );
        novaId = novaResult.rows[0].id;

        await insertGuaranteeDetail(client, novaId, tipo, detail);
        await this.auditGuarantee(client, {
          garantiaId,
          acao: 'SUBSTITUICAO',
          before: atual.rows[0],
          after: { novaGarantiaId: novaId, tipo, motivo: motivo || null },
          userId: realizadoPor,
        });
      } catch (error) {
        throw translateGuaranteeError(error);
      }

      return { id: novaId };
    });
  }

  async registerCaucaoDevolucao(garantiaId, { valorDevolvido, valorRetido, motivoRetencao, dataDevolucao }, realizadoPor) {
    return withTransaction(async (client) => {
      const garantia = await client.query(
        `SELECT g.tipo, g.status, c.data_devolucao_imovel,
                gc.valor, gc.status_pagamento,
                gc.valor_devolvido, gc.valor_retido, gc.data_devolucao
           FROM garantias g
           JOIN contratos c ON c.id = g.contrato_id
           JOIN garantia_caucao gc ON gc.garantia_id = g.id
          WHERE g.id = $1`,
        [garantiaId]
      );

      if (garantia.rows.length === 0) {
        throw new AppError('Garantia não encontrada.', 404);
      }

      if (garantia.rows[0].tipo !== 'CAUCAO') {
        throw new AppError(
          'Devolução só se aplica a garantias do tipo caução.',
          400
        );
      }
      if (
        garantia.rows[0].status !== 'ATIVA' ||
        garantia.rows[0].status_pagamento !== 'PAGO'
      ) {
        throw new AppError(
          'Somente uma caução ativa e paga pode ser devolvida.',
          409
        );
      }

      // Art. 39: a garantia se estende até a devolução efetiva do imóvel.
      if (!garantia.rows[0].data_devolucao_imovel) {
        throw new AppError(
          'A devolução da caução só pode ser registrada após a devolução do imóvel (informe data_devolucao_imovel no contrato).',
          409
        );
      }
      if (
        dataDevolucao < String(garantia.rows[0].data_devolucao_imovel).slice(0, 10) ||
        dataDevolucao > new Date().toISOString().slice(0, 10)
      ) {
        throw new AppError(
          'A devolução da caução deve ocorrer entre a devolução do imóvel e hoje.',
          400
        );
      }
      const devolvido = Number(valorDevolvido ?? 0);
      const retido = Number(valorRetido ?? 0);
      if (Math.round((devolvido + retido) * 100) !== Math.round(Number(garantia.rows[0].valor) * 100)) {
        throw new AppError(
          'A soma dos valores devolvido e retido deve ser igual ao valor da caução.',
          400
        );
      }
      if (retido > 0 && !motivoRetencao?.trim()) {
        throw new AppError('Informe o motivo do valor retido.', 400);
      }

      let result;
      try {
        result = await client.query(
          `UPDATE garantia_caucao
           SET valor_devolvido = $1, valor_retido = $2, motivo_retencao = $3, data_devolucao = $4
           WHERE garantia_id = $5`,
          [
            valorDevolvido ?? null,
            valorRetido ?? null,
            motivoRetencao || null,
            dataDevolucao,
            garantiaId,
          ]
        );
      } catch (error) {
        if (error.code === '23514') {
          throw new AppError(error.message, 400);
        }
        throw error;
      }

      await client.query(
        `UPDATE garantias SET status = 'ENCERRADA', data_fim = $1 WHERE id = $2`,
        [dataDevolucao, garantiaId]
      );
      await this.auditGuarantee(client, {
        garantiaId,
        acao: 'DEVOLUCAO_CAUCAO',
        before: garantia.rows[0],
        after: { valorDevolvido: devolvido, valorRetido: retido, dataDevolucao },
        userId: realizadoPor,
      });

      return { updated: result.rowCount };
    });
  }

  async exonerarFiador(garantiaId, usuarioId, { dataNotificacao }, realizadoPor) {
    return withTransaction(async (client) => {
      const fiador = await client.query(
        `SELECT gf.status, g.status AS garantia_status, g.data_inicio
         FROM garantia_fiadores gf
         JOIN garantias g ON g.id = gf.garantia_id
         WHERE gf.garantia_id = $1 AND gf.usuario_id = $2`,
        [garantiaId, usuarioId]
      );

      if (fiador.rows.length === 0) {
        throw new AppError('Fiador não encontrado nesta garantia.', 404);
      }

      if (fiador.rows[0].status === 'EXONERADO') {
        throw new AppError('Este fiador já está exonerado.', 409);
      }
      if (fiador.rows[0].garantia_status !== 'ATIVA') {
        throw new AppError('A garantia não está ativa.', 409);
      }
      if (
        dataNotificacao < String(fiador.rows[0].data_inicio).slice(0, 10) ||
        dataNotificacao > new Date().toISOString().slice(0, 10)
      ) {
        throw new AppError(
          'A notificação deve estar entre o início da garantia e hoje.',
          400
        );
      }

      // Art. 40, X: o fiador exonerado responde por mais 120 dias após notificar.
      const result = await client.query(
        `UPDATE garantia_fiadores
         SET status = 'EXONERADO',
             data_notificacao_exoneracao = $1,
             data_fim_responsabilidade = ($1::date + INTERVAL '120 days')::date
         WHERE garantia_id = $2 AND usuario_id = $3
         RETURNING data_fim_responsabilidade`,
        [dataNotificacao, garantiaId, usuarioId]
      );
      await this.auditGuarantee(client, {
        garantiaId,
        acao: 'EXONERACAO_FIADOR',
        before: fiador.rows[0],
        after: result.rows[0],
        userId: realizadoPor,
      });

      return { dataFimResponsabilidade: result.rows[0].data_fim_responsabilidade };
    });
  }

  async getCaucaoContext(garantiaId, executor = pool) {
    const { rows } = await executor.query(
      `SELECT g.id, g.contrato_id, g.status, gc.modalidade, gc.valor,
              gc.status_pagamento,
              u.id AS pagador_usuario_id, u.nome_completo AS pagador_nome,
              u.documento AS pagador_documento, u.email AS pagador_email,
              u.telefone AS pagador_telefone
       FROM garantias g
       JOIN garantia_caucao gc ON gc.garantia_id = g.id
       JOIN contrato_inquilinos ci ON ci.contrato_id = g.contrato_id AND ci.principal
       JOIN usuarios u ON u.id = ci.usuario_id
       WHERE g.id = $1`,
      [garantiaId]
    );
    return rows[0] ?? null;
  }

  async getCaucaoCharge(garantiaId, executor = pool) {
    const { rows } = await executor.query(
      `SELECT * FROM caucao_cobrancas
       WHERE garantia_id = $1
       ORDER BY ativa DESC, tentativa DESC, id DESC
       LIMIT 1`,
      [garantiaId]
    );
    return rows[0] ?? null;
  }

  async getNextCaucaoAttempt(garantiaId, executor = pool) {
    const { rows } = await executor.query(
      `SELECT COALESCE(max(tentativa), 0)::int + 1 AS tentativa
       FROM caucao_cobrancas WHERE garantia_id = $1`,
      [garantiaId]
    );
    return rows[0].tentativa;
  }

  async saveCaucaoCharge(data, executor = pool) {
    const { rows } = await executor.query(
      `INSERT INTO caucao_cobrancas (
         garantia_id, gateway, external_payment_id, external_reference,
         qr_code_pix, copia_cola_pix, url_fatura, valor,
         status_gateway, raw_json, tentativa
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        data.garantiaId, data.gateway, data.externalPaymentId,
        data.externalReference, data.qrCodePix, data.copiaColaPix,
        data.urlFatura, data.valor, data.statusGateway,
        data.rawJson ? JSON.stringify(data.rawJson) : null, data.tentativa,
      ]
    );
    return rows[0];
  }

  async listMyCaucoes(usuarioId) {
    const { rows } = await pool.query(
      `SELECT g.id, g.contrato_id, g.status, gc.valor, gc.status_pagamento,
              gc.comprovante_deposito_key,
              cc.id AS cobranca_id, cc.qr_code_pix, cc.copia_cola_pix,
              cc.url_fatura, cc.status_gateway, cc.ativa,
              i.tipo_imovel, e.logradouro, e.numero, e.cidade, e.estado
       FROM garantias g
       JOIN garantia_caucao gc ON gc.garantia_id = g.id
       JOIN contrato_inquilinos ci ON ci.contrato_id = g.contrato_id
       JOIN contratos c ON c.id = g.contrato_id
       JOIN imoveis i ON i.id = c.imovel_id
       JOIN enderecos e ON e.id = i.endereco_id
       LEFT JOIN LATERAL (
         SELECT charge.*
         FROM caucao_cobrancas charge
         WHERE charge.garantia_id = g.id
         ORDER BY charge.ativa DESC, charge.tentativa DESC, charge.id DESC
         LIMIT 1
       ) cc ON true
       WHERE ci.usuario_id = $1 AND g.status = 'ATIVA'
       ORDER BY g.id DESC`,
      [usuarioId]
    );
    return rows;
  }

  async attachCaucaoProof(garantiaId, key, actor) {
    return withTransaction(async (client) => {
      const previous = await client.query(
        `SELECT gc.*
         FROM garantia_caucao gc
         JOIN garantias g ON g.id = gc.garantia_id
         WHERE gc.garantia_id = $1
           AND g.status = 'ATIVA'
           AND gc.status_pagamento IN ('PENDENTE', 'REJEITADO')
           AND ($2::boolean OR EXISTS (
             SELECT 1 FROM contrato_inquilinos ci
             WHERE ci.contrato_id = g.contrato_id AND ci.usuario_id = $3
           ))
         FOR UPDATE OF gc`,
        [garantiaId, actor.isStaff, actor.userId]
      );
      if (!previous.rows[0]) return null;
      const { rows } = await client.query(
        `UPDATE garantia_caucao
         SET comprovante_deposito_key = $1, status_pagamento = 'EM_ANALISE',
             analisado_por = NULL, analisado_em = NULL, updated_at = now()
         WHERE garantia_id = $2
         RETURNING *`,
        [key, garantiaId]
      );
      await this.auditGuarantee(client, {
        garantiaId,
        acao: 'ENVIO_COMPROVANTE_CAUCAO',
        before: previous.rows[0],
        after: rows[0],
        userId: actor.userId,
      });
      return rows[0];
    });
  }

  async reviewCaucao(garantiaId, status, userId) {
    return withTransaction(async (client) => {
      const previous = await client.query(
        `SELECT gc.*, g.status AS garantia_status
         FROM garantia_caucao gc
         JOIN garantias g ON g.id = gc.garantia_id
         WHERE gc.garantia_id = $1
         FOR UPDATE OF gc`,
        [garantiaId]
      );
      const current = previous.rows[0];
      if (!current) return null;
      if (
        current.garantia_status !== 'ATIVA' ||
        current.status_pagamento !== 'EM_ANALISE' ||
        !current.comprovante_deposito_key
      ) {
        throw new AppError(
          'A caução precisa estar em análise e possuir comprovante para ser revisada.',
          409
        );
      }
      const { rows } = await client.query(
        `UPDATE garantia_caucao
         SET status_pagamento = $1, analisado_por = $2, analisado_em = now(),
             pago_em = CASE WHEN $1 = 'PAGO' THEN COALESCE(pago_em, now()) ELSE pago_em END,
             updated_at = now()
         WHERE garantia_id = $3 RETURNING *`,
        [status, userId, garantiaId]
      );
      await this.auditGuarantee(client, {
        garantiaId,
        acao: 'REVISAO_CAUCAO',
        before: current,
        after: rows[0],
        userId,
      });
      return rows[0];
    });
  }

  async auditGuarantee(executor, { garantiaId, acao, before, after, userId }) {
    await executor.query(
      `INSERT INTO garantia_auditoria (
         garantia_id, acao, estado_anterior, estado_novo, realizado_por
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        garantiaId,
        acao,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        userId,
      ]
    );
  }

  async getCaucaoByExternalId(client, externalPaymentId) {
    const { rows } = await client.query(
      `SELECT cc.*, gc.status_pagamento
       FROM caucao_cobrancas cc
       JOIN garantia_caucao gc ON gc.garantia_id = cc.garantia_id
       WHERE cc.external_payment_id = $1 AND cc.gateway = 'ASAAS'
       FOR UPDATE OF cc, gc`,
      [externalPaymentId]
    );
    return rows[0] ?? null;
  }

  async applyCaucaoGatewayEvent(client, cobranca, event, paymentStatus) {
    const received = event === 'PAYMENT_RECEIVED';
    const confirmed = event === 'PAYMENT_CONFIRMED';
    const terminal = received || [
      'PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED',
      'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_DELETED',
    ].includes(event);
    await client.query(
      `UPDATE caucao_cobrancas
       SET status_gateway = $1, ativa = $2, updated_at = now()
       WHERE id = $3`,
      [paymentStatus ?? event, !terminal, cobranca.id]
    );
    if (received || confirmed) {
      await client.query(
        `UPDATE garantia_caucao
         SET status_pagamento = CASE
               WHEN status_pagamento = 'PAGO' THEN status_pagamento
               ELSE $1
             END,
             pago_em = CASE WHEN $1 = 'PAGO' THEN now() ELSE pago_em END,
             updated_at = now()
         WHERE garantia_id = $2`,
        [received ? 'PAGO' : 'EM_ANALISE', cobranca.garantia_id]
      );
    } else if (event === 'PAYMENT_DELETED') {
      await client.query(
        `UPDATE garantia_caucao
         SET status_pagamento = CASE
               WHEN status_pagamento = 'PAGO' THEN status_pagamento
               ELSE 'PENDENTE'
             END,
             updated_at = now()
         WHERE garantia_id = $1`,
        [cobranca.garantia_id]
      );
    } else if ([
      'PAYMENT_REFUNDED',
      'PAYMENT_PARTIALLY_REFUNDED',
      'PAYMENT_CHARGEBACK_REQUESTED',
    ].includes(event)) {
      await client.query(
        `UPDATE garantia_caucao SET status_pagamento = 'REJEITADO', updated_at = now()
         WHERE garantia_id = $1`,
        [cobranca.garantia_id]
      );
    }
  }
}

export default new GuaranteesRepository();
