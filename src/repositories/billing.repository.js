import { pool } from '../config/database.js';
import AppError from '../errors/AppError.js';
import { withTransaction } from '../utils/withTransaction.js';
import { contratoBillingLockKey } from '../utils/advisoryLocks.js';

class BillingRepository {
  async getContratoParaCobranca(contratoId, executor = pool) {
    const { rows } = await executor.query(
      `SELECT c.id, c.status, c.valor_aluguel, c.comissao_tipo, c.comissao_valor_fixo,
              c.taxa_administracao_percentual, c.dia_vencimento,
              to_char(c.data_inicio, 'YYYY-MM-DD') AS data_inicio,
              to_char(c.data_fim, 'YYYY-MM-DD') AS data_fim,
              to_char(c.cobrancas_iniciais_a_partir_de, 'YYYY-MM-DD')
                AS cobrancas_iniciais_a_partir_de,
              c.cobrancas_iniciais_concluidas_em,
              i.valor_condominio, i.valor_iptu,
              c.proprietario_id_snapshot AS proprietario_id,
              pagador.usuario_id AS pagador_usuario_id,
              pagador.nome_completo AS pagador_nome,
              pagador.documento AS pagador_documento,
              pagador.email AS pagador_email,
              pagador.telefone AS pagador_telefone
       FROM contratos c
       JOIN imoveis i ON i.id = c.imovel_id
       LEFT JOIN LATERAL (
         SELECT u.id AS usuario_id, u.nome_completo, u.documento,
                u.email, u.telefone
         FROM contrato_inquilinos ci
         JOIN usuarios u ON u.id = ci.usuario_id
         WHERE ci.contrato_id = c.id AND ci.principal
         LIMIT 1
       ) pagador ON true
       WHERE c.id = $1`,
      [contratoId]
    );

    return rows[0] || null;
  }

  // Toda emissão do mesmo contrato usa a mesma conexão e o mesmo lock. Isso
  // coordena lote, emissão avulsa e alterações contratuais sem reservar uma
  // conexão enquanto o callback tenta obter outra do pool.
  async withContratoBillingLock(contratoId, callback) {
    const client = await pool.connect();
    const lockKey = contratoBillingLockKey(contratoId);
    let lockAcquired = false;
    const timeoutMs = Math.min(
      Math.max(Number(process.env.BILLING_LOCK_TIMEOUT_MS || 10000), 1000),
      60000
    );

    try {
      await client.query(`SELECT set_config('statement_timeout', $1, false)`, [
        `${timeoutMs}ms`,
      ]);
      await client.query(
        `SELECT pg_advisory_lock(hashtextextended($1::text, 0))`,
        [lockKey]
      );
      lockAcquired = true;
      await client.query(`SELECT set_config('statement_timeout', '0', false)`);

      return await callback(client);
    } catch (error) {
      if (error.code === '57014' && !lockAcquired) {
        throw new AppError(
          'Outro processamento financeiro deste contrato está em andamento.',
          503
        );
      }

      throw error;
    } finally {
      try {
        if (lockAcquired) {
          await client.query(
            `SELECT pg_advisory_unlock(hashtextextended($1::text, 0))`,
            [lockKey]
          );
        }
      } finally {
        await client
          .query(`SELECT set_config('statement_timeout', '0', false)`)
          .catch(() => undefined);
        client.release();
      }
    }
  }

  async getContratosAtivosParaReconciliacao() {
    const { rows } = await pool.query(
      `SELECT id,
              to_char(cobrancas_iniciais_a_partir_de, 'YYYY-MM-DD')
                AS cobrancas_iniciais_a_partir_de,
              cobrancas_iniciais_concluidas_em
       FROM contratos
       WHERE status IN ('ATIVO', 'INADIMPLENTE')
       ORDER BY cobrancas_iniciais_concluidas_em NULLS FIRST, id ASC`
    );

    return rows;
  }

  async marcarCobrancasIniciaisConcluidas(contratoId, executor = pool) {
    await executor.query(
      `UPDATE contratos
       SET cobrancas_iniciais_concluidas_em = COALESCE(
         cobrancas_iniciais_concluidas_em,
         now()
       )
       WHERE id = $1`,
      [contratoId]
    );
  }

  async parcelaJaExiste(contratoId, competencia, executor = pool) {
    const { rows } = await executor.query(
      `SELECT id FROM parcelas WHERE contrato_id = $1 AND competencia = $2`,
      [contratoId, competencia]
    );

    return rows.length > 0;
  }

  async getOrCreateGatewayCustomer(
    client,
    { usuarioId, gateway, createExternalCustomer }
  ) {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [`gateway-customer:${gateway}:${usuarioId}`]
    );

    const existing = await client.query(
      `SELECT external_customer_id
       FROM gateway_customers
       WHERE usuario_id = $1 AND gateway = $2`,
      [usuarioId, gateway]
    );

    if (existing.rows[0]) {
      return existing.rows[0].external_customer_id;
    }

    const externalCustomerId = await createExternalCustomer();

    if (!externalCustomerId) {
      throw new AppError(
        'O gateway não retornou a identificação do pagador.',
        502
      );
    }

    const inserted = await client.query(
      `INSERT INTO gateway_customers (
         usuario_id, gateway, external_customer_id
       ) VALUES ($1, $2, $3)
       ON CONFLICT (usuario_id, gateway) DO NOTHING
       RETURNING external_customer_id`,
      [usuarioId, gateway, externalCustomerId]
    );

    if (inserted.rows[0]) {
      return inserted.rows[0].external_customer_id;
    }

    const concurrent = await client.query(
      `SELECT external_customer_id
       FROM gateway_customers
       WHERE usuario_id = $1 AND gateway = $2`,
      [usuarioId, gateway]
    );

    return concurrent.rows[0]?.external_customer_id;
  }

  // A persistência local roda na mesma transação que verificou a competência.
  // Se ela falhar depois da chamada externa, o adapter reutiliza a cobrança
  // pela chave idempotente no retry.
  async criarParcelaComCobranca(
    {
      contratoId,
      competencia,
      dataVencimento,
      valorBase,
      lancamentos,
      externalReference,
      cobranca,
    },
    transactionClient
  ) {
    const persist = async (client) => {
      let parcela;

      try {
        const parcelaResult = await client.query(
          `INSERT INTO parcelas (contrato_id, competencia, data_vencimento, valor_base, status, forma_pagamento, external_reference)
           VALUES ($1, $2, $3, $4, 'PENDENTE', 'BOLETO', $5)
           RETURNING id, contrato_id,
                     to_char(competencia, 'YYYY-MM-DD') AS competencia,
                     to_char(data_vencimento, 'YYYY-MM-DD') AS data_vencimento,
                     valor_base, status, forma_pagamento, external_reference`,
          [contratoId, competencia, dataVencimento, valorBase, externalReference]
        );
        parcela = parcelaResult.rows[0];
      } catch (error) {
        if (error.code === '23505') {
          throw new AppError(
            'Já existe cobrança gerada para esta competência.',
            409
          );
        }
        throw error;
      }

      for (const lancamento of lancamentos) {
        await client.query(
          `INSERT INTO parcela_lancamentos (parcela_id, tipo, descricao, valor, beneficiario)
           VALUES ($1, $2, $3, $4, $5)`,
          [parcela.id, lancamento.tipo, lancamento.descricao, lancamento.valor, lancamento.beneficiario]
        );
      }

      await client.query(
        `INSERT INTO gateway_cobrancas (
           parcela_id, gateway, external_payment_id, linha_digitavel, codigo_barras,
           url_boleto, url_fatura, qr_code_pix, copia_cola_pix, valor, data_vencimento,
           status_gateway, raw_json
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          parcela.id,
          cobranca.gateway ?? 'ASAAS',
          cobranca.externalPaymentId,
          cobranca.linhaDigitavel ?? null,
          cobranca.codigoBarras ?? null,
          cobranca.urlBoleto ?? null,
          cobranca.urlFatura ?? null,
          cobranca.qrCodePix ?? null,
          cobranca.copiaColaPix ?? null,
          cobranca.valor,
          dataVencimento,
          cobranca.statusGateway ?? null,
          cobranca.rawJson ? JSON.stringify(cobranca.rawJson) : null,
        ]
      );

      const { rawJson: _rawJson, ...cobrancaPublica } = cobranca;

      return { ...parcela, lancamentos, cobranca: cobrancaPublica };
    };

    if (transactionClient) {
      return persist(transactionClient);
    }

    return withTransaction(persist);
  }

  async listarParcelas({ contratoId, status }) {
    const params = [];
    const condicoes = [];

    if (contratoId) {
      params.push(contratoId);
      condicoes.push(`p.contrato_id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      condicoes.push(`p.status = $${params.length}`);
    }

    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT p.id, p.contrato_id,
              to_char(p.competencia, 'YYYY-MM-DD') AS competencia,
              to_char(p.data_vencimento, 'YYYY-MM-DD') AS data_vencimento,
              p.valor_base,
              p.status, p.forma_pagamento, p.external_reference
              ,p.valor_base + COALESCE((
                 SELECT sum(pl.valor) FROM parcela_lancamentos pl
                 WHERE pl.parcela_id = p.id AND pl.tipo <> 'TAXA'
               ), 0) AS valor_total,
              EXISTS (SELECT 1 FROM gateway_cobrancas gc
                WHERE gc.parcela_id = p.id AND gc.ativa) AS possui_cobranca_ativa
       FROM parcelas p
       ${where}
       ORDER BY p.data_vencimento DESC`,
      params
    );

    return rows;
  }

  async getParcelaDetalhe(parcelaId) {
    const { rows } = await pool.query(
      `SELECT
         p.id, p.contrato_id,
         to_char(p.competencia, 'YYYY-MM-DD') AS competencia,
         to_char(p.data_vencimento, 'YYYY-MM-DD') AS data_vencimento,
         p.valor_base,
         p.status, p.forma_pagamento, p.external_reference, p.tentativa,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'id', pl.id, 'tipo', pl.tipo, 'descricao', pl.descricao,
              'valor', pl.valor, 'beneficiario', pl.beneficiario
            ))
            FROM parcela_lancamentos pl WHERE pl.parcela_id = p.id),
           '[]'::json
         ) AS lancamentos,
         (SELECT json_build_object(
            'externalPaymentId', gc.external_payment_id,
            'linhaDigitavel', gc.linha_digitavel,
            'urlBoleto', gc.url_boleto,
            'urlFatura', gc.url_fatura,
            'copiaColaPix', gc.copia_cola_pix,
            'statusGateway', gc.status_gateway
          )
          FROM gateway_cobrancas gc
          WHERE gc.parcela_id = p.id
          ORDER BY gc.ativa DESC, gc.created_at DESC
          LIMIT 1
         ) AS cobranca,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'id', pay.id, 'valorPago', pay.valor_pago,
              'dataPagamento', pay.data_pagamento, 'formaPagamento', pay.forma_pagamento,
              'origem', pay.origem, 'registradoPor', pay.registrado_por,
              'comprovanteKey', pay.comprovante_key, 'createdAt', pay.created_at
            ) ORDER BY pay.data_pagamento DESC)
            FROM pagamentos pay
            WHERE pay.parcela_id = p.id AND pay.estornado_em IS NULL),
           '[]'::json
         ) AS pagamentos
       FROM parcelas p
       WHERE p.id = $1`,
      [parcelaId]
    );

    return rows[0] || null;
  }

  async getCobrancaAtiva(parcelaId) {
    const { rows } = await pool.query(
      `SELECT id, parcela_id, gateway, external_payment_id, linha_digitavel,
              codigo_barras, url_boleto, url_fatura, qr_code_pix,
              copia_cola_pix, valor,
              to_char(data_vencimento, 'YYYY-MM-DD') AS data_vencimento,
              status_gateway
       FROM gateway_cobrancas
       WHERE parcela_id = $1 AND ativa
       LIMIT 1`,
      [parcelaId]
    );

    return rows[0] || null;
  }

  async listarCobrancasAtivasDoContrato(contratoId, executor = pool) {
    const { rows } = await executor.query(
      `SELECT p.id AS parcela_id, p.status, gc.gateway,
              gc.external_payment_id
       FROM parcelas p
       JOIN gateway_cobrancas gc ON gc.parcela_id = p.id AND gc.ativa
       WHERE p.contrato_id = $1
       ORDER BY p.data_vencimento, p.id`,
      [contratoId]
    );
    return rows;
  }

  async cancelarCobrancaAtiva(parcelaId) {
    return withTransaction(async (client) => {
      const parcelaResult = await client.query(
        `SELECT id, status FROM parcelas WHERE id = $1 FOR UPDATE`,
        [parcelaId]
      );

      if (parcelaResult.rows.length === 0) {
        throw new AppError('Parcela não encontrada.', 404);
      }

      const { status } = parcelaResult.rows[0];

      if (['CONFIRMADA', 'RECEBIDA', 'PAGA', 'REPASSADA', 'CANCELADA', 'ESTORNADA'].includes(status)) {
        throw new AppError('Esta cobrança não pode mais ser cancelada.', 409);
      }

      const cobrancaResult = await client.query(
        `UPDATE gateway_cobrancas SET ativa = false WHERE parcela_id = $1 AND ativa RETURNING external_payment_id`,
        [parcelaId]
      );

      await client.query(`UPDATE parcelas SET status = 'CANCELADA' WHERE id = $1`, [parcelaId]);

      return {
        id: String(parcelaId),
        externalPaymentId: cobrancaResult.rows[0]?.external_payment_id ?? null,
      };
    });
  }

  async getContextoBaixaManual(parcelaId, executor = pool) {
    const { rows } = await executor.query(
      `SELECT p.id AS parcela_id, p.contrato_id, p.status AS parcela_status,
              p.valor_base + COALESCE((
                SELECT sum(pl.valor) FROM parcela_lancamentos pl
                WHERE pl.parcela_id = p.id AND pl.tipo <> 'TAXA'
              ), 0) AS valor_total,
              gc.id AS gateway_cobranca_id, gc.gateway,
              gc.external_payment_id, gc.ativa,
              bm.id AS baixa_id, bm.status AS baixa_status,
              bm.gateway_cancelado_em, bm.concluida_em
       FROM parcelas p
       LEFT JOIN gateway_cobrancas gc
         ON gc.parcela_id = p.id
        AND (gc.ativa OR gc.id = (
          SELECT gateway_cobranca_id FROM baixas_manuais WHERE parcela_id = p.id
        ))
       LEFT JOIN baixas_manuais bm ON bm.parcela_id = p.id
       WHERE p.id = $1
       ORDER BY gc.ativa DESC, gc.created_at DESC
       LIMIT 1`,
      [parcelaId]
    );
    return rows[0] ?? null;
  }

  async iniciarBaixaManual(executor, data) {
    const { rows } = await executor.query(
      `INSERT INTO baixas_manuais (
         parcela_id, gateway_cobranca_id, solicitado_por, valor_pago,
         data_pagamento, forma_pagamento, comprovante_key, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'INICIADA')
       ON CONFLICT (parcela_id) DO UPDATE SET
         solicitado_por = CASE
           WHEN baixas_manuais.status = 'CONCLUIDA' THEN baixas_manuais.solicitado_por
           ELSE EXCLUDED.solicitado_por END,
         valor_pago = CASE
           WHEN baixas_manuais.status = 'CONCLUIDA' THEN baixas_manuais.valor_pago
           ELSE EXCLUDED.valor_pago END,
         data_pagamento = CASE
           WHEN baixas_manuais.status = 'CONCLUIDA' THEN baixas_manuais.data_pagamento
           ELSE EXCLUDED.data_pagamento END,
         forma_pagamento = CASE
           WHEN baixas_manuais.status = 'CONCLUIDA' THEN baixas_manuais.forma_pagamento
           ELSE EXCLUDED.forma_pagamento END,
         comprovante_key = CASE
           WHEN baixas_manuais.status = 'CONCLUIDA' THEN baixas_manuais.comprovante_key
           ELSE EXCLUDED.comprovante_key END,
         status = CASE
           WHEN baixas_manuais.status IN ('CONCLUIDA','GATEWAY_CANCELADO')
             THEN baixas_manuais.status
           ELSE 'INICIADA' END,
         erro_mensagem = NULL,
         updated_at = now()
       RETURNING *`,
      [
        data.parcelaId,
        data.gatewayCobrancaId,
        data.solicitadoPor,
        data.valorPago,
        data.dataPagamento,
        data.formaPagamento,
        data.comprovanteKey || null,
      ]
    );
    return rows[0];
  }

  async marcarBaixaGatewayCancelado(executor, baixaId) {
    await executor.query(
      `UPDATE baixas_manuais
       SET status = 'GATEWAY_CANCELADO', gateway_cancelado_em = now(),
           erro_mensagem = NULL, updated_at = now()
       WHERE id = $1 AND status <> 'CONCLUIDA'`,
      [baixaId]
    );
  }

  async marcarFalhaBaixaManual(executor, baixaId, mensagem) {
    await executor.query(
      `UPDATE baixas_manuais
       SET status = 'FALHA', erro_mensagem = $1, updated_at = now()
       WHERE id = $2 AND status <> 'CONCLUIDA'`,
      [String(mensagem).slice(0, 2000), baixaId]
    );
  }

  async finalizarBaixaManual(client, baixaId) {
    const audit = await client.query(
      `SELECT * FROM baixas_manuais WHERE id = $1 FOR UPDATE`,
      [baixaId]
    );
    const baixa = audit.rows[0];
    if (!baixa) throw new AppError('Baixa manual não encontrada.', 404);
    if (baixa.status === 'CONCLUIDA') return baixa;
    if (baixa.status !== 'GATEWAY_CANCELADO') {
      throw new AppError('O boleto ainda não foi cancelado no gateway.', 409);
    }

    await client.query(
      `UPDATE gateway_cobrancas
       SET ativa = false, status_gateway = 'CANCELLED_MANUAL'
       WHERE id = $1`,
      [baixa.gateway_cobranca_id]
    );
    await client.query(
      `INSERT INTO pagamentos (
         parcela_id, valor_pago, data_pagamento, forma_pagamento,
         comprovante_key, registrado_por, origem
       ) VALUES ($1, $2, $3, $4, $5, $6, 'PRESENCIAL')`,
      [
        baixa.parcela_id,
        baixa.valor_pago,
        baixa.data_pagamento,
        baixa.forma_pagamento,
        baixa.comprovante_key,
        baixa.solicitado_por,
      ]
    );
    await client.query(
      `UPDATE parcelas SET status = 'PAGA',
         forma_pagamento = CASE WHEN $1 IN ('PIX','BOLETO','CARTAO') THEN $1 ELSE NULL END
       WHERE id = $2`,
      [baixa.forma_pagamento, baixa.parcela_id]
    );
    const { rows } = await client.query(
      `UPDATE baixas_manuais
       SET status = 'CONCLUIDA', concluida_em = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [baixaId]
    );
    return rows[0];
  }

  // As duas funções abaixo recebem `client` porque rodam DENTRO da mesma
  // transação do processamento do webhook (idempotência + atualização de
  // status + registro do pagamento precisam ser atômicos).
  async getGatewayCobrancaPorExternalId(client, externalPaymentId, gateway = 'ASAAS') {
    const { rows } = await client.query(
      `SELECT gc.parcela_id, p.status,
              p.valor_base + COALESCE(
                (SELECT SUM(valor) FROM parcela_lancamentos WHERE parcela_id = p.id AND tipo <> 'TAXA'),
                0
              ) AS valor_total
       FROM gateway_cobrancas gc
       JOIN parcelas p ON p.id = gc.parcela_id
       WHERE gc.external_payment_id = $1 AND gc.gateway = $2
       FOR UPDATE OF gc, p`,
      [externalPaymentId, gateway]
    );

    return rows[0] || null;
  }

  async atualizarStatusParcela(client, parcelaId, status) {
    await client.query(`UPDATE parcelas SET status = $1 WHERE id = $2`, [status, parcelaId]);
  }

  async atualizarStatusGateway(
    client,
    externalPaymentId,
    statusGateway,
    gateway = 'ASAAS'
  ) {
    await client.query(
      `UPDATE gateway_cobrancas
       SET status_gateway = $1
       WHERE external_payment_id = $2 AND gateway = $3`,
      [statusGateway, externalPaymentId, gateway]
    );
  }

  async atualizarAtividadeCobranca(
    client,
    externalPaymentId,
    ativa,
    gateway = 'ASAAS'
  ) {
    await client.query(
      `UPDATE gateway_cobrancas
       SET ativa = $1
       WHERE external_payment_id = $2 AND gateway = $3`,
      [ativa, externalPaymentId, gateway]
    );
  }

  async registrarPagamentoGateway(client, { parcelaId, valorPago, dataPagamento, formaPagamento, gatewayEventId }) {
    await client.query(
      `INSERT INTO pagamentos (parcela_id, valor_pago, data_pagamento, forma_pagamento, gateway_event_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [parcelaId, valorPago, dataPagamento, formaPagamento, gatewayEventId]
    );
  }

  async getTotalPagamentosAtivos(client, parcelaId) {
    const { rows } = await client.query(
      `SELECT COALESCE(sum(valor_pago), 0) AS total
       FROM pagamentos
       WHERE parcela_id = $1 AND estornado_em IS NULL`,
      [parcelaId]
    );
    return Number(rows[0].total);
  }

  async estornarPagamentosGateway(client, parcelaId) {
    await client.query(
      `UPDATE pagamentos
       SET estornado_em = COALESCE(estornado_em, now())
       WHERE parcela_id = $1
         AND gateway_event_id IS NOT NULL
         AND estornado_em IS NULL`,
      [parcelaId]
    );
  }
}

export default new BillingRepository();
