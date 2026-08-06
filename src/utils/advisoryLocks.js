export function contratoBillingLockKey(contratoId) {
  return `contrato-billing:${contratoId}`;
}

export async function acquireContratoBillingTransactionLock(client, contratoId) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
    [contratoBillingLockKey(contratoId)]
  );
}
