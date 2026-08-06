import { pool } from '../config/database.js';

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
         (SELECT json_build_object(
            'id', gc.id,
            'gateway', gc.gateway,
            'externalPaymentId', gc.external_payment_id,
            'linhaDigitavel', gc.linha_digitavel,
            'codigoBarras', gc.codigo_barras,
            'urlBoleto', gc.url_boleto,
            'urlFatura', gc.url_fatura,
            'qrCodePix', gc.qr_code_pix,
            'copiaColaPix', gc.copia_cola_pix,
            'valor', gc.valor,
            'dataVencimento', to_char(gc.data_vencimento, 'YYYY-MM-DD'),
            'statusGateway', gc.status_gateway,
            'ativa', gc.ativa
          )
          FROM gateway_cobrancas gc
          WHERE gc.parcela_id = p.id
          -- A cobrança deixa de ser pagável após confirmação/recebimento,
          -- mas continua visível no histórico do inquilino.
          ORDER BY gc.ativa DESC, gc.created_at DESC
          LIMIT 1
         ) AS cobranca,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'id', pl.id,
              'tipo', pl.tipo,
              'descricao', pl.descricao,
              'valor', pl.valor
            ))
            FROM parcela_lancamentos pl
            WHERE pl.parcela_id = p.id AND pl.tipo <> 'TAXA'),
           '[]'::json
         ) AS lancamentos,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'id', pay.id,
              'valor_pago', pay.valor_pago,
              'data_pagamento', pay.data_pagamento,
              'forma_pagamento', pay.forma_pagamento,
              'origem', pay.origem
            ) ORDER BY pay.data_pagamento DESC)
            FROM pagamentos pay
            WHERE pay.parcela_id = p.id AND pay.estornado_em IS NULL),
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
       ORDER BY p.data_vencimento ASC, p.id ASC`,
      [usuarioId]
    );

    return rows;
  }

  async getUltimaCobrancaByUsuario(parcelaId, usuarioId) {
    const { rows } = await pool.query(
      `SELECT gc.id, gc.parcela_id, gc.gateway, gc.external_payment_id, gc.linha_digitavel,
              gc.codigo_barras, gc.url_boleto, gc.url_fatura, gc.qr_code_pix,
              gc.copia_cola_pix, gc.valor,
              to_char(gc.data_vencimento, 'YYYY-MM-DD') AS data_vencimento,
              gc.status_gateway, gc.ativa
       FROM gateway_cobrancas gc
       JOIN parcelas p ON p.id = gc.parcela_id
       WHERE gc.parcela_id = $1
         AND EXISTS (
           SELECT 1
           FROM contrato_inquilinos ci
           WHERE ci.contrato_id = p.contrato_id AND ci.usuario_id = $2
         )
       ORDER BY gc.ativa DESC, gc.created_at DESC
       LIMIT 1`,
      [parcelaId, usuarioId]
    );

    return rows[0] || null;
  }

}

export default new PaymentsRepository();
