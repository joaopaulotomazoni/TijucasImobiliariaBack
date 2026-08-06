import { pool } from '../config/database.js';
import AppError from '../errors/AppError.js';
import { withTransaction } from '../utils/withTransaction.js';

class PayoutsRepository {
  async getParcelaParaRepasse(parcelaId) {
    const { rows } = await pool.query(
      `SELECT p.id, p.status, p.valor_base,
              c.proprietario_id_snapshot AS proprietario_id
       FROM parcelas p
       JOIN contratos c ON c.id = p.contrato_id
       WHERE p.id = $1`,
      [parcelaId]
    );

    if (rows.length === 0) {
      return null;
    }

    const lancamentosResult = await pool.query(
      `SELECT tipo, valor, beneficiario FROM parcela_lancamentos WHERE parcela_id = $1`,
      [parcelaId]
    );

    return { ...rows[0], lancamentos: lancamentosResult.rows };
  }

  async getContaBancariaPrincipal(usuarioId) {
    const { rows } = await pool.query(
      `SELECT id, banco, agencia, conta, digito, tipo_conta, chave_pix, pix_key_type, cpf_cnpj_titular
       FROM contas_bancarias
       WHERE usuario_id = $1 AND principal
       LIMIT 1`,
      [usuarioId]
    );

    return rows[0] || null;
  }

  // O UNIQUE em repasses (parcela_id) WHERE status <> 'FALHOU' garante que
  // duas tentativas concorrentes de repasse para a mesma parcela não criem
  // duas transferências — a segunda cai no catch abaixo.
  async criarRepasse({
    parcelaId,
    contaBancariaId,
    valor,
    solicitadoPor,
    idempotencyKey,
  }) {
    return withTransaction(async (client) => {
      const parcelaResult = await client.query(
        `SELECT status FROM parcelas WHERE id = $1 FOR UPDATE`,
        [parcelaId]
      );

      if (parcelaResult.rows.length === 0) {
        throw new AppError('Parcela não encontrada.', 404);
      }

      if (parcelaResult.rows[0].status !== 'RECEBIDA') {
        throw new AppError('Só é possível repassar parcelas com status RECEBIDA.', 409);
      }

      try {
        const insertResult = await client.query(
          `INSERT INTO repasses (
             parcela_id, conta_bancaria_id, valor, metodo, status,
             solicitado_por, idempotency_key
           )
           VALUES ($1, $2, $3, 'PIX', 'PROCESSANDO', $4, $5)
           RETURNING id, status`,
          [parcelaId, contaBancariaId, valor, solicitadoPor, idempotencyKey]
        );

        return { id: insertResult.rows[0].id };
      } catch (error) {
        if (error.code === '23505') {
          const existing = await client.query(
            `SELECT id, status FROM repasses
             WHERE idempotency_key = $1`,
            [idempotencyKey]
          );
          if (existing.rows[0]?.status === 'CONCLUIDO') {
            return { ...existing.rows[0], idempotente: true };
          }
          if (existing.rows[0]?.status === 'PROCESSANDO') {
            return { ...existing.rows[0], retomada: true };
          }
          throw new AppError(
            'Já existe um repasse incompatível para esta parcela.',
            409
          );
        }
        throw error;
      }
    });
  }

  async concluirRepasse(repasseId, { externalTransferId }) {
    return withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE repasses SET status = 'CONCLUIDO', external_transfer_id = $1, efetivado_em = now()
         WHERE id = $2 RETURNING parcela_id`,
        [externalTransferId, repasseId]
      );

      await client.query(`UPDATE parcelas SET status = 'REPASSADA' WHERE id = $1`, [
        result.rows[0].parcela_id,
      ]);
    });
  }

  async falharRepasse(repasseId, motivo) {
    await pool.query(`UPDATE repasses SET status = 'FALHOU', motivo_falha = $1 WHERE id = $2`, [
      motivo,
      repasseId,
    ]);
  }

  async listarRepassesPorProprietario(proprietarioId) {
    const { rows } = await pool.query(
      `SELECT r.id, r.parcela_id, r.valor, r.metodo, r.status, r.solicitado_em, r.efetivado_em,
              p.competencia, p.contrato_id
       FROM repasses r
       JOIN parcelas p ON p.id = r.parcela_id
       JOIN contratos c ON c.id = p.contrato_id
       WHERE c.proprietario_id_snapshot = $1
       ORDER BY r.solicitado_em DESC`,
      [proprietarioId]
    );

    return rows;
  }
}

export default new PayoutsRepository();
