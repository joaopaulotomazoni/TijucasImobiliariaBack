// Sem calendário de feriados: cobre só fim de semana. Suficiente para não
// marcar VENCIDA uma parcela cujo vencimento caiu em sábado/domingo antes do
// próximo dia útil.
function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function proximoDiaUtil(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);

  while (isWeekend(date)) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return date.toISOString().slice(0, 10);
}

export function dataAtualIso(
  timeZone = process.env.APP_TIMEZONE || 'America/Sao_Paulo'
) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}
