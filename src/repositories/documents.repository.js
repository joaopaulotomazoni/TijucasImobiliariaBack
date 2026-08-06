import { pool } from '../config/database.js';
import { withTransaction } from '../utils/withTransaction.js';

class DocumentsRepository {
  async getUser(usuarioId) {
    const { rows } = await pool.query(
      `SELECT id, nome_completo, email, perfil, ativo
       FROM usuarios WHERE id = $1`,
      [usuarioId]
    );
    return rows[0] ?? null;
  }

  async listByUser(usuarioId) {
    const { rows } = await pool.query(
      `SELECT d.id, d.usuario_id, d.tipo, d.nome_arquivo, d.s3_key,
              d.content_type, d.tamanho_bytes, d.status,
              d.observacao_analise, d.enviado_por, d.analisado_por,
              d.analisado_em, d.created_at, d.updated_at,
              reviewer.nome_completo AS analisado_por_nome
       FROM cliente_documentos d
       LEFT JOIN usuarios reviewer ON reviewer.id = d.analisado_por
       WHERE d.usuario_id = $1
       ORDER BY d.created_at DESC, d.id DESC`,
      [usuarioId]
    );
    return rows;
  }

  async create({ usuarioId, tipo, nomeArquivo, key, contentType, tamanhoBytes, enviadoPor }) {
    const { rows } = await pool.query(
      `INSERT INTO cliente_documentos (
         usuario_id, tipo, nome_arquivo, s3_key, content_type,
         tamanho_bytes, enviado_por
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [usuarioId, tipo, nomeArquivo, key, contentType, tamanhoBytes ?? null, enviadoPor]
    );
    return rows[0];
  }

  async review({ documentoId, status, observacao, analisadoPor }) {
    return withTransaction(async (client) => {
      const previous = await client.query(
        `SELECT status FROM cliente_documentos WHERE id = $1 FOR UPDATE`,
        [documentoId]
      );
      if (!previous.rows[0]) return null;
      const { rows } = await client.query(
        `UPDATE cliente_documentos
         SET status = $1, observacao_analise = $2, analisado_por = $3,
             analisado_em = now(), updated_at = now()
         WHERE id = $4
         RETURNING *`,
        [status, observacao || null, analisadoPor, documentoId]
      );
      await client.query(
        `INSERT INTO cliente_documento_revisoes (
           documento_id, status_anterior, status_novo, observacao, analisado_por
         )
         VALUES ($1, $2, $3, $4, $5)`,
        [
          documentoId,
          previous.rows[0].status,
          status,
          observacao || null,
          analisadoPor,
        ]
      );

      const user = await client.query(
        `SELECT id, nome_completo, email FROM usuarios WHERE id = $1`,
        [rows[0].usuario_id]
      );
      const titulo = status === 'APROVADO'
        ? 'Documento aprovado'
        : status === 'REPROVADO'
          ? 'Documento reprovado'
          : 'Documento em análise';
      const mensagem = `${rows[0].nome_arquivo}: ${titulo.toLowerCase()}${observacao ? ` — ${observacao}` : ''}.`;

      await client.query(
        `INSERT INTO notificacoes (
           usuario_id, tipo, titulo, mensagem, referencia_tipo, referencia_id
         ) VALUES ($1, 'DOCUMENTO_STATUS', $2, $3, 'CLIENTE_DOCUMENTO', $4)`,
        [rows[0].usuario_id, titulo, mensagem, rows[0].id]
      );

      return { documento: rows[0], usuario: user.rows[0], titulo, mensagem };
    });
  }

  async listNotifications(usuarioId) {
    const { rows } = await pool.query(
      `SELECT id, tipo, titulo, mensagem, referencia_tipo, referencia_id,
              lida_em, created_at
       FROM notificacoes
       WHERE usuario_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      [usuarioId]
    );
    return rows;
  }

  async markNotificationRead(id, usuarioId) {
    const { rows } = await pool.query(
      `UPDATE notificacoes SET lida_em = COALESCE(lida_em, now())
       WHERE id = $1 AND usuario_id = $2 RETURNING id, lida_em`,
      [id, usuarioId]
    );
    return rows[0] ?? null;
  }
}

export default new DocumentsRepository();
