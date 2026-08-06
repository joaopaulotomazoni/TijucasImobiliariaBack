import { pool } from '../config/database.js';

class DashboardRepository {
  async getSummary() {
    const { rows } = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM contratos WHERE status = 'ATIVO') AS contratos_ativos,
        (SELECT count(*)::int FROM parcelas
          WHERE status IN ('VENCIDA','PARCIAL')
             OR (status IN ('ABERTA','PENDENTE') AND data_vencimento < CURRENT_DATE)
        ) AS parcelas_inadimplentes,
        (SELECT count(*)::int FROM cliente_documentos
          WHERE status IN ('PENDENTE','EM_ANALISE')) AS documentos_pendentes,
        (SELECT count(*)::int
           FROM garantia_caucao gc
           JOIN garantias g ON g.id = gc.garantia_id
          WHERE g.status = 'ATIVA' AND gc.status_pagamento <> 'PAGO'
        ) AS caucoes_em_aberto,
        (SELECT count(*)::int FROM imoveis) AS total_imoveis,
        (SELECT count(DISTINCT proprietario_id)::int FROM imoveis
          WHERE proprietario_id IS NOT NULL) AS total_proprietarios
    `);

    const owners = await pool.query(`
      SELECT u.id, u.nome_completo, count(i.id)::int AS quantidade_imoveis
      FROM usuarios u
      JOIN imoveis i ON i.proprietario_id = u.id
      GROUP BY u.id
      ORDER BY quantidade_imoveis DESC, u.nome_completo
      LIMIT 20
    `);

    return { ...rows[0], imoveis_por_proprietario: owners.rows };
  }
}

export default new DashboardRepository();
