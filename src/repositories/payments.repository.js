import { pool } from '../config/database.js';
import AppError from '../errors/AppError.js';
import { withTransaction } from '../utils/withTransaction.js';

class PaymentsRepository {
  // Todas as parcelas dos contratos em que o usuário é inquilino, com os
  // lançamentos (aluguel/condomínio/multa/juros...) e pagamentos já
  // registrados, agregados via json_agg (leitura cross-tabela: consulta SQL
  // direta em vez do client supabase, que não faz esse tipo de agregação bem).
  async getParcelasByUsuario(usuarioId) {
    const { rows } = await pool.query(
      `SELECT
         p.id,
         p.contrato_id,
         to_char(p.competencia, 'YYYY-MM-DD') AS competencia,
         to_char(p.data_vencimento, 'YYYY-MM-DD') AS data_vencimento,
         p.valor_base,
         p.status,
         c.valor_aluguel,
         c.dia_vencimento,
         i.id AS imovel_id,
         i.tipo_imovel,
         e.logradouro, e.numero, e.bairro, e.cidade, e.estado,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'id', pl.id,
              'tipo', pl.tipo,
              'descricao', pl.descricao,
              'valor', pl.valor
            ))
            FROM parcela_lancamentos pl
            WHERE pl.parcela_id = p.id),
           '[]'::json
         ) AS lancamentos,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'id', pay.id,
              'valor_pago', pay.valor_pago,
              'data_pagamento', pay.data_pagamento,
              'forma_pagamento', pay.forma_pagamento,
              'comprovante_url', pay.comprovante_url
            ) ORDER BY pay.data_pagamento DESC)
            FROM pagamentos pay
            WHERE pay.parcela_id = p.id),
           '[]'::json
         ) AS pagamentos
       FROM parcelas p
       JOIN contratos c ON c.id = p.contrato_id
       JOIN imoveis i ON i.id = c.imovel_id
       JOIN enderecos e ON e.id = i.endereco_id
       WHERE EXISTS (
         SELECT 1 FROM contrato_inquilinos ci
         WHERE ci.contrato_id = c.id AND ci.usuario_id = $1
       )
       ORDER BY p.data_vencimento DESC`,
      [usuarioId]
    );

    return rows;
  }

  // Registra um pagamento contra uma parcela do próprio usuário (o join com
  // contrato_inquilinos garante que ninguém paga a parcela de outra pessoa) e
  // recalcula o status da parcela a partir da soma de tudo que já foi pago.
  async registerPayment(
    parcelaId,
    usuarioId,
    { valorPago, dataPagamento, formaPagamento, comprovanteKey }
  ) {
    return withTransaction(async (client) => {
      const parcelaResult = await client.query(
        `SELECT p.id, p.status
         FROM parcelas p
         JOIN contratos c ON c.id = p.contrato_id
         JOIN contrato_inquilinos ci ON ci.contrato_id = c.id
         WHERE p.id = $1 AND ci.usuario_id = $2`,
        [parcelaId, usuarioId]
      );

      if (parcelaResult.rows.length === 0) {
        throw new AppError('Parcela não encontrada.', 404);
      }

      const { status } = parcelaResult.rows[0];

      if (status === 'PAGA' || status === 'CANCELADA') {
        throw new AppError('Esta parcela já está paga ou cancelada.', 409);
      }

      await client.query(
        `INSERT INTO pagamentos (parcela_id, valor_pago, data_pagamento, forma_pagamento, comprovante_url, registrado_por)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          parcelaId,
          valorPago,
          dataPagamento,
          formaPagamento,
          comprovanteKey || null,
          usuarioId,
        ]
      );

      const totalsResult = await client.query(
        `SELECT
           p.valor_base
             + COALESCE((SELECT SUM(valor) FROM parcela_lancamentos WHERE parcela_id = p.id), 0) AS valor_total,
           COALESCE((SELECT SUM(valor_pago) FROM pagamentos WHERE parcela_id = p.id), 0) AS valor_pago_total
         FROM parcelas p WHERE p.id = $1`,
        [parcelaId]
      );

      const { valor_total, valor_pago_total } = totalsResult.rows[0];
      const newStatus =
        Number(valor_pago_total) >= Number(valor_total) ? 'PAGA' : 'PARCIAL';

      await client.query(`UPDATE parcelas SET status = $1 WHERE id = $2`, [
        newStatus,
        parcelaId,
      ]);

      return { id: Number(parcelaId), status: newStatus };
    });
  }
}

export default new PaymentsRepository();
