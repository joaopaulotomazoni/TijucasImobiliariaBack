import { parseIsoDate } from '../utils/isoDate.js';

export const MAX_MESES_COBRANCA_EM_LOTE = 12;

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Monta as competências mensais que devem ser emitidas para um contrato.
 *
 * A primeira cobrança nunca vence antes do início da vigência. A agenda é
 * limitada tanto pela data final do contrato quanto por 12 meses. Quando a
 * reconciliação começa no meio do mês, inclui o vencimento daquele mês mesmo
 * que ele tenha acabado de passar; assim uma indisponibilidade do job não
 * transforma a competência em uma lacuna permanente.
 */
export function montarAgendaCobrancas({
  dataInicio,
  dataFim,
  diaVencimento,
  aPartirDe = dataInicio,
  limite = MAX_MESES_COBRANCA_EM_LOTE,
}) {
  const inicioContrato = parseIsoDate(dataInicio, 'dataInicio');
  const fimContrato = parseIsoDate(dataFim, 'dataFim');
  const inicioSolicitado = parseIsoDate(aPartirDe, 'aPartirDe');
  const inicioJanela =
    inicioContrato.getTime() >= inicioSolicitado.getTime()
      ? inicioContrato
      : inicioSolicitado;

  if (fimContrato.getTime() < inicioContrato.getTime()) {
    throw new RangeError('dataFim não pode ser anterior a dataInicio.');
  }

  if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 28) {
    throw new RangeError('diaVencimento deve estar entre 1 e 28.');
  }

  if (!Number.isInteger(limite) || limite < 1) {
    throw new RangeError('limite deve ser um número inteiro maior que zero.');
  }

  const quantidadeMaxima = Math.min(limite, MAX_MESES_COBRANCA_EM_LOTE);
  const cursor = new Date(
    Date.UTC(
      inicioJanela.getUTCFullYear(),
      inicioJanela.getUTCMonth(),
      diaVencimento
    )
  );

  // No mês em que o contrato começa, um dia de vencimento anterior ao início
  // da vigência é inválido. Nos meses de reconciliação posteriores, um
  // vencimento já passado deve ser recuperado como boleto vencido.
  if (
    cursor.getTime() < inicioContrato.getTime() &&
    cursor.getUTCFullYear() === inicioContrato.getUTCFullYear() &&
    cursor.getUTCMonth() === inicioContrato.getUTCMonth()
  ) {
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const agenda = [];

  while (
    agenda.length < quantidadeMaxima &&
    cursor.getTime() <= fimContrato.getTime()
  ) {
    const competencia = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1)
    );

    agenda.push({
      competencia: formatIsoDate(competencia),
      dataVencimento: formatIsoDate(cursor),
    });

    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return agenda;
}
