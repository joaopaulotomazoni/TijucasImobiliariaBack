// Funções puras — sem I/O, 100% testáveis sem gateway nem banco.
//
// Convenção dos lançamentos derivados aqui:
//   CONDOMINIO/IPTU  -> beneficiario='IMOBILIARIA' (repassados a terceiros,
//                        não são parte do repasse ao proprietário)
//   TAXA (comissão)  -> beneficiario='IMOBILIARIA', valor NEGATIVO (não é
//                        cobrada do inquilino; é o que reduz o repasse)
//
// Por isso o valor cobrado do inquilino ignora os lançamentos tipo=TAXA, e o
// valor repassado ao proprietário soma valor_base + lançamentos do
// proprietário + o lançamento TAXA (negativo) — nunca um percentual sobre o
// total da parcela, que erraria sempre que houver condomínio/IPTU embutido.

import {
  percentageOfMoney,
  roundMoney,
  sumMoney,
} from '../utils/money.js';

export function calcularComissao(input) {
  const comissaoTipo = input.comissaoTipo ?? input.comissao_tipo;
  const comissaoValorFixo =
    input.comissaoValorFixo ?? input.comissao_valor_fixo;
  const taxaAdministracaoPercentual =
    input.taxaAdministracaoPercentual ??
    input.taxa_administracao_percentual;
  const valorAluguel = input.valorAluguel ?? input.valor_aluguel;

  if (comissaoTipo === 'FIXO') {
    return roundMoney(comissaoValorFixo ?? 0);
  }

  return percentageOfMoney(
    valorAluguel,
    taxaAdministracaoPercentual ?? 0
  );
}

export function montarLancamentos({ valorCondominio, valorIptu, comissao }) {
  const lancamentos = [];

  if (Number(valorCondominio) > 0) {
    lancamentos.push({
      tipo: 'CONDOMINIO',
      descricao: 'Condomínio',
      valor: roundMoney(valorCondominio),
      beneficiario: 'IMOBILIARIA',
    });
  }

  if (Number(valorIptu) > 0) {
    lancamentos.push({
      tipo: 'IPTU',
      descricao: 'IPTU',
      valor: roundMoney(valorIptu),
      beneficiario: 'IMOBILIARIA',
    });
  }

  if (comissao > 0) {
    lancamentos.push({
      tipo: 'TAXA',
      descricao: 'Taxa de administração',
      valor: roundMoney(-comissao),
      beneficiario: 'IMOBILIARIA',
    });
  }

  return lancamentos;
}

export function calcularValorCobranca({ valorBase, lancamentos }) {
  const valoresCobrados = lancamentos
    .filter((lancamento) => lancamento.tipo !== 'TAXA')
    .map((lancamento) => lancamento.valor);

  return sumMoney([valorBase, ...valoresCobrados]);
}

export function calcularValorRepasse(input) {
  const valorBase = input.valorBase ?? input.valor_base;
  const { lancamentos } = input;
  const valoresProprietario = lancamentos
    .filter((lancamento) => lancamento.beneficiario === 'PROPRIETARIO')
    .map((lancamento) => lancamento.valor);

  const comissoes = lancamentos
    .filter((lancamento) => lancamento.tipo === 'TAXA')
    .map((lancamento) => lancamento.valor);

  return sumMoney([valorBase, ...valoresProprietario, ...comissoes]);
}
