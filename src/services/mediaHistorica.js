import { calcularContribuicaoSemanal, MOTIVOS } from './contribuicaoSemanal.js';

/**
 * Média de contribuição por semana **desde que os guild points existem** — a leitura de longo prazo,
 * o oposto da contribuição da semana corrente de [contribuicaoSemanal.js](./contribuicaoSemanal.js).
 *
 * Guild points acumulam, então o total atual dividido pelo número de semanas responde "quanto essa
 * pessoa rende por semana, em média". É o número que o `.scan` mostra desde sempre; aqui ele virou
 * função própria porque o `.ia` precisa do mesmo cálculo para a guilda inteira, e duas fórmulas
 * dariam dois números para a mesma pergunta.
 *
 * O divisor **não** é sempre a data fixa: para quem entrou depois dela conta-se a partir da entrada.
 * Dividir o total de um membro de duas semanas pelas ~36 desde 03/12/2025 não mede o rendimento
 * dele, mede há quanto tempo a guilda existe.
 */

/**
 * Data em que os guild points passaram a existir. É o piso do divisor: semana anterior a ela não
 * existia para ninguém, e contar desde antes achataria a média de todo membro antigo.
 */
export const GUILD_POINTS_DESDE = new Date(2025, 11, 3); // 03/12/2025 (mês é 0-indexado)

const SEMANA_MS = 7 * 86400000;

/** Contas sem média possível. Diferente dos motivos da semana: aqui só falta o total atual. */
export const MOTIVOS_MEDIA = {
  FORA_DA_GUILDA: 'FORA_DA_GUILDA',
  SEM_PONTOS: 'SEM_PONTOS',
};

/**
 * A fórmula, pura. `entradaEmMs` é quando a conta entrou na guilda (0 = desconhecida, cai no piso).
 *
 * O divisor é **fracionário**: contar semanas inteiras dividia 13 dias e meio por 1 e dobrava a
 * média de quem entrou há pouco (medido em 12/08/2026: quem entrou em 29/07 aparecia com 18.244 por
 * semana, o 3º maior da guilda, quando o certo era ~9.400). O piso de 1 semana continua, para quem
 * entrou há dois dias não sair com o acumulado inteiro como se fosse a média dele.
 */
export function calcularMediaHistorica({ pontosTotais, entradaEmMs = 0, agora = Date.now() }) {
  const inicio = Math.max(Number(entradaEmMs) || 0, GUILD_POINTS_DESDE.getTime());
  const semanas = Math.max(1, (agora - inicio) / SEMANA_MS);
  const desdeEntrada = inicio > GUILD_POINTS_DESDE.getTime();

  return {
    media: pontosTotais == null ? null : Math.round(Number(pontosTotais) / semanas),
    // Fracionário para o cálculo; quem exibe arredonda
    semanas,
    desdeEntrada,
    base: desdeEntrada
      ? 'semanas desde a entrada na guilda'
      : 'semanas desde 03/12/2025 (inicio dos guild points)',
  };
}

/**
 * Média histórica de todo membro ativo, montada em cima da leitura da semana — as duas precisam
 * exatamente dos mesmos dados (rota em lote `/v1/guild/members` + cadastro), então é uma chamada só.
 *
 * `SEM_BASE` e `BASE_ZERADA` **não** impedem a média: aqueles motivos são da subtração da semana, e
 * aqui só o total atual importa. Quem está sem linha de base da quinta aparece no ranking de média
 * normalmente, e é justamente de quem a staff tem menos informação na semana.
 */
export async function calcularMediasHistoricas() {
  const { weekStart, linhas } = await calcularContribuicaoSemanal();
  const agora = Date.now();

  const medidas = linhas.map((linha) => {
    if (linha.pontosTotais == null) {
      return {
        ...linha,
        media: null,
        semanas: null,
        motivoMedia: linha.motivo === MOTIVOS.FORA_DA_GUILDA
          ? MOTIVOS_MEDIA.FORA_DA_GUILDA
          : MOTIVOS_MEDIA.SEM_PONTOS,
      };
    }

    const { media, semanas, desdeEntrada } = calcularMediaHistorica({
      pontosTotais: linha.pontosTotais,
      entradaEmMs: Number(linha.joinDate || 0) * 1000,
      agora,
    });

    return { ...linha, media, semanas, desdeEntrada, motivoMedia: null };
  });

  return { weekStart, linhas: medidas };
}

/** Média e mediana **das médias** — cada membro pesa igual, independente de há quanto tempo entrou. */
export function estatisticasDasMedias(comMedia) {
  if (!comMedia.length) return { media: 0, mediana: 0, soma: 0, acima: 0, abaixo: 0 };

  const soma = comMedia.reduce((total, l) => total + l.media, 0);
  const media = Math.round(soma / comMedia.length);

  const ordenadas = [...comMedia].sort((a, b) => a.media - b.media);
  const meio = Math.floor(ordenadas.length / 2);
  const mediana = ordenadas.length % 2
    ? ordenadas[meio].media
    : Math.round((ordenadas[meio - 1].media + ordenadas[meio].media) / 2);

  return {
    media,
    mediana,
    soma,
    acima: comMedia.filter(l => l.media > media).length,
    abaixo: comMedia.filter(l => l.media <= media).length,
  };
}
