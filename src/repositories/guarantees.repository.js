import supabase from '../config/database.js';
import AppError from '../errors/AppError.js';
import { withTransaction } from '../utils/withTransaction.js';

// Traduz erros do Postgres que podem escapar dos inserts de garantia.
function translateGuaranteeError(error) {
  // Índice único parcial uq_garantia_ativa_por_contrato (art. 37).
  if (error.code === '23505' && error.constraint === 'uq_garantia_ativa_por_contrato') {
    return new AppError(
      'Este contrato já possui uma garantia ativa. É vedada mais de uma modalidade de garantia por contrato (Lei 8.245/91, art. 37).',
      409
    );
  }
  // Trigger trg_caucao_limite_legal (art. 38, §2º) e demais CHECKs.
  if (error.code === '23514' || error.code === '23P01') {
    return new AppError(error.message, 400);
  }
  return error;
}

// Insere a linha de detalhe conforme o tipo. Recebe o client da transação.
async function insertGuaranteeDetail(client, garantiaId, tipo, detail) {
  if (tipo === 'CAUCAO') {
    await client.query(
      `INSERT INTO garantia_caucao (
         garantia_id, modalidade, valor, banco, agencia, conta_poupanca, data_deposito,
         descricao_bem, registro_cartorio, comprovante_deposito_key
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        garantiaId,
        detail.modalidade,
        detail.valor ?? null,
        detail.banco || null,
        detail.agencia || null,
        detail.contaPoupanca || null,
        detail.dataDeposito || null,
        detail.descricaoBem || null,
        detail.registroCartorio || null,
        detail.comprovanteDepositoKey || null,
      ]
    );
    return;
  }

  if (tipo === 'SEGURO_FIANCA') {
    await client.query(
      `INSERT INTO garantia_seguro_fianca (
         garantia_id, seguradora, numero_apolice, vigencia_inicio, vigencia_fim,
         valor_cobertura, valor_premio, periodicidade_premio, status_aprovacao, apolice_key
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        garantiaId,
        detail.seguradora,
        detail.numeroApolice,
        detail.vigenciaInicio,
        detail.vigenciaFim,
        detail.valorCobertura,
        detail.valorPremio ?? null,
        detail.periodicidadePremio || null,
        detail.statusAprovacao ?? 'PENDENTE',
        detail.apoliceKey || null,
      ]
    );
    return;
  }

  // FIADOR: 1+ fiadores
  for (const fiador of detail.fiadores) {
    // Endereço do imóvel dado em garantia: se veio o objeto completo, cria a
    // linha em `enderecos` na mesma transação e usa o id; senão aceita um id já
    // existente (imovelGarantiaEnderecoId) ou fica nulo.
    let imovelGarantiaEnderecoId = fiador.imovelGarantiaEnderecoId ?? null;
    if (fiador.imovelGarantiaEndereco) {
      const endereco = fiador.imovelGarantiaEndereco;
      const enderecoResult = await client.query(
        `INSERT INTO enderecos (cep, estado, cidade, bairro, logradouro, numero, complemento)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          endereco.cep,
          endereco.estado,
          endereco.cidade,
          endereco.bairro,
          endereco.logradouro,
          endereco.numero ?? null,
          endereco.complemento ?? null,
        ]
      );
      imovelGarantiaEnderecoId = enderecoResult.rows[0].id;
    }

    try {
      await client.query(
        `INSERT INTO garantia_fiadores (
           garantia_id, usuario_id, renda_comprovada, comprovante_renda_key,
           imovel_garantia_endereco_id, imovel_garantia_matricula, imovel_garantia_quitado,
           estado_civil, regime_bens, conjuge_nome, conjuge_documento, outorga_conjugal
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          garantiaId,
          fiador.usuarioId,
          fiador.rendaComprovada ?? null,
          fiador.comprovanteRendaKey || null,
          imovelGarantiaEnderecoId,
          fiador.imovelGarantiaMatricula || null,
          fiador.imovelGarantiaQuitado ?? null,
          fiador.estadoCivil || null,
          fiador.regimeBens || null,
          fiador.conjugeNome || null,
          fiador.conjugeDocumento || null,
          fiador.outorgaConjugal ?? false,
        ]
      );
    } catch (error) {
      if (error.code === '23503') {
        throw new AppError(
          `Fiador informado (id ${fiador.usuarioId}) não existe.`,
          404
        );
      }
      throw error;
    }
  }
}

class GuaranteesRepository {
  async getGuaranteesByContract(contratoId) {
    const { data, error } = await supabase
      .from('garantias')
      .select(
        `id,
         contrato_id,
         tipo,
         status,
         data_inicio,
         data_fim,
         motivo_substituicao,
         caucao:garantia_caucao (
           modalidade, valor, banco, agencia, conta_poupanca, data_deposito,
           descricao_bem, registro_cartorio, comprovante_deposito_key,
           valor_devolvido, valor_retido, motivo_retencao, data_devolucao
         ),
         seguro:garantia_seguro_fianca (
           seguradora, numero_apolice, vigencia_inicio, vigencia_fim,
           valor_cobertura, valor_premio, periodicidade_premio, status_aprovacao, apolice_key
         ),
         fiadores:garantia_fiadores (
           usuario_id, renda_comprovada, comprovante_renda_key,
           imovel_garantia_endereco_id, imovel_garantia_matricula, imovel_garantia_quitado,
           estado_civil, regime_bens, conjuge_nome, conjuge_documento, outorga_conjugal,
           status, data_notificacao_exoneracao, data_fim_responsabilidade,
           usuario:usuarios!usuario_id ( id, nome_completo, documento, email, telefone ),
           imovel_garantia_endereco:enderecos!imovel_garantia_endereco_id (
             id, cep, estado, cidade, bairro, logradouro, numero, complemento
           )
         )`
      )
      .eq('contrato_id', contratoId)
      .order('id', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async getContractIdByGuarantee(garantiaId) {
    const { data, error } = await supabase
      .from('garantias')
      .select('contrato_id')
      .eq('id', garantiaId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data?.contrato_id ?? null;
  }

  async createGuarantee(contratoId, { tipo, ...detail }) {
    return withTransaction(async (client) => {
      const contrato = await client.query(
        `SELECT id FROM contratos WHERE id = $1`,
        [contratoId]
      );

      if (contrato.rows.length === 0) {
        throw new AppError('Contrato não encontrado.', 404);
      }

      let garantiaId;
      try {
        const garantiaResult = await client.query(
          `INSERT INTO garantias (contrato_id, tipo) VALUES ($1, $2) RETURNING id`,
          [contratoId, tipo]
        );
        garantiaId = garantiaResult.rows[0].id;

        await insertGuaranteeDetail(client, garantiaId, tipo, detail);
      } catch (error) {
        throw translateGuaranteeError(error);
      }

      return { id: garantiaId };
    });
  }

  async substituteGuarantee(garantiaId, motivo, { tipo, ...detail }) {
    return withTransaction(async (client) => {
      const atual = await client.query(
        `SELECT contrato_id, status FROM garantias WHERE id = $1`,
        [garantiaId]
      );

      if (atual.rows.length === 0) {
        throw new AppError('Garantia não encontrada.', 404);
      }

      if (atual.rows[0].status !== 'ATIVA') {
        throw new AppError(
          'Apenas uma garantia ativa pode ser substituída.',
          409
        );
      }

      const contratoId = atual.rows[0].contrato_id;

      // Encerra a atual ANTES de criar a nova, senão o índice único parcial
      // (uq_garantia_ativa_por_contrato) bloquearia a segunda linha ATIVA.
      await client.query(
        `UPDATE garantias
         SET status = 'SUBSTITUIDA', data_fim = CURRENT_DATE, motivo_substituicao = $1
         WHERE id = $2`,
        [motivo || null, garantiaId]
      );

      let novaId;
      try {
        const novaResult = await client.query(
          `INSERT INTO garantias (contrato_id, tipo) VALUES ($1, $2) RETURNING id`,
          [contratoId, tipo]
        );
        novaId = novaResult.rows[0].id;

        await insertGuaranteeDetail(client, novaId, tipo, detail);
      } catch (error) {
        throw translateGuaranteeError(error);
      }

      return { id: novaId };
    });
  }

  async registerCaucaoDevolucao(garantiaId, { valorDevolvido, valorRetido, motivoRetencao, dataDevolucao }) {
    return withTransaction(async (client) => {
      const garantia = await client.query(
        `SELECT g.tipo, c.data_devolucao_imovel
           FROM garantias g
           JOIN contratos c ON c.id = g.contrato_id
          WHERE g.id = $1`,
        [garantiaId]
      );

      if (garantia.rows.length === 0) {
        throw new AppError('Garantia não encontrada.', 404);
      }

      if (garantia.rows[0].tipo !== 'CAUCAO') {
        throw new AppError(
          'Devolução só se aplica a garantias do tipo caução.',
          400
        );
      }

      // Art. 39: a garantia se estende até a devolução efetiva do imóvel.
      if (!garantia.rows[0].data_devolucao_imovel) {
        throw new AppError(
          'A devolução da caução só pode ser registrada após a devolução do imóvel (informe data_devolucao_imovel no contrato).',
          409
        );
      }

      let result;
      try {
        result = await client.query(
          `UPDATE garantia_caucao
           SET valor_devolvido = $1, valor_retido = $2, motivo_retencao = $3, data_devolucao = $4
           WHERE garantia_id = $5`,
          [
            valorDevolvido ?? null,
            valorRetido ?? null,
            motivoRetencao || null,
            dataDevolucao,
            garantiaId,
          ]
        );
      } catch (error) {
        if (error.code === '23514') {
          throw new AppError(error.message, 400);
        }
        throw error;
      }

      await client.query(
        `UPDATE garantias SET status = 'ENCERRADA', data_fim = $1 WHERE id = $2`,
        [dataDevolucao, garantiaId]
      );

      return { updated: result.rowCount };
    });
  }

  async exonerarFiador(garantiaId, usuarioId, { dataNotificacao }) {
    return withTransaction(async (client) => {
      const fiador = await client.query(
        `SELECT status FROM garantia_fiadores WHERE garantia_id = $1 AND usuario_id = $2`,
        [garantiaId, usuarioId]
      );

      if (fiador.rows.length === 0) {
        throw new AppError('Fiador não encontrado nesta garantia.', 404);
      }

      if (fiador.rows[0].status === 'EXONERADO') {
        throw new AppError('Este fiador já está exonerado.', 409);
      }

      // Art. 40, X: o fiador exonerado responde por mais 120 dias após notificar.
      const result = await client.query(
        `UPDATE garantia_fiadores
         SET status = 'EXONERADO',
             data_notificacao_exoneracao = $1,
             data_fim_responsabilidade = ($1::date + INTERVAL '120 days')::date
         WHERE garantia_id = $2 AND usuario_id = $3
         RETURNING data_fim_responsabilidade`,
        [dataNotificacao, garantiaId, usuarioId]
      );

      return { dataFimResponsabilidade: result.rows[0].data_fim_responsabilidade };
    });
  }
}

export default new GuaranteesRepository();
