class WebhooksRepository {
  async registrarEvento(
    client,
    { gateway, externalEventId, eventType, payload }
  ) {
    const { rows } = await client.query(
      `INSERT INTO webhook_events (
         gateway, external_event_id, event_type, payload_json
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (gateway, external_event_id) DO NOTHING
       RETURNING id, status`,
      [gateway, externalEventId, eventType, JSON.stringify(payload)]
    );

    if (rows[0]) {
      return { id: rows[0].id, status: rows[0].status, novo: true };
    }

    const existente = await client.query(
      `SELECT id, status
       FROM webhook_events
       WHERE gateway = $1 AND external_event_id = $2`,
      [gateway, externalEventId]
    );

    return existente.rows[0]
      ? { ...existente.rows[0], novo: false }
      : null;
  }

  async buscarParaProcessar(
    client,
    { eventoId = null, maxTentativas }
  ) {
    const { rows } = await client.query(
      `SELECT id, gateway, external_event_id, event_type, payload_json,
              status, tentativas
       FROM webhook_events
       WHERE status IN ('RECEBIDO', 'ERRO')
         AND tentativas < $1
         AND proxima_tentativa_em <= now()
         AND ($2::bigint IS NULL OR id = $2)
       ORDER BY proxima_tentativa_em, recebido_em, id
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [maxTentativas, eventoId]
    );

    return rows[0] ?? null;
  }

  async marcarConcluido(client, id, status, mensagem = null) {
    const { rows } = await client.query(
      `UPDATE webhook_events
       SET status = $1,
           tentativas = tentativas + 1,
           erro_mensagem = $2,
           processado_em = now(),
           descartado_em = CASE WHEN $1 = 'DESCARTADO' THEN now() ELSE NULL END
       WHERE id = $3
       RETURNING status, tentativas`,
      [status, mensagem, id]
    );

    return rows[0] ?? null;
  }

  async marcarFalha(
    client,
    { id, mensagem, maxTentativas, backoffSeconds }
  ) {
    const { rows } = await client.query(
      `UPDATE webhook_events
       SET tentativas = tentativas + 1,
           status = CASE
             WHEN tentativas + 1 >= $1 THEN 'DESCARTADO'
             ELSE 'ERRO'
           END,
           erro_mensagem = $2,
           proxima_tentativa_em = CASE
             WHEN tentativas + 1 >= $1 THEN proxima_tentativa_em
             ELSE now() + make_interval(secs => $3)
           END,
           processado_em = CASE
             WHEN tentativas + 1 >= $1 THEN now()
             ELSE NULL
           END,
           descartado_em = CASE
             WHEN tentativas + 1 >= $1 THEN now()
             ELSE NULL
           END
       WHERE id = $4
       RETURNING status, tentativas, proxima_tentativa_em`,
      [maxTentativas, mensagem, backoffSeconds, id]
    );

    return rows[0] ?? null;
  }
}

export default new WebhooksRepository();
