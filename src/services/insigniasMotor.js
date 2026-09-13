// Transforma o contexto de cada membro em tier por insígnia e grava. A leitura mora em
// insigniasLeitura.js; o que cada insígnia mede e os cortes, em insigniasCatalogo.js.
import { INSIGNIAS } from './insigniasCatalogo.js';
import { lerContextos } from './insigniasLeitura.js';
import { getInsigniasGravadas, gravarInsignias, registrarTiersAlcancados } from '../insignias.js';

const tierMaximoDe = (insignia) => (insignia.tiers ? insignia.tiers.length : 1);

export function tierDoValor(insignia, valor) {
  if (!insignia.tiers) return valor > 0 ? 1 : 0;

  let tier = 0;
  for (const corte of insignia.tiers) if (valor >= corte) tier++;
  return tier;
}

function montarLinha(discordId, chave, tier, valor, anterior, agora) {
  return {
    discord_id: discordId,
    badge_key: chave,
    tier,
    tier_maximo: Math.max(tier, anterior?.tier_maximo ?? 0),
    valor: Math.round(valor * 100) / 100,
    medido_em: agora.toISOString(),
    atualizado_em: agora.toISOString(),
  };
}

/**
 * Função pura: contexto de um membro + o que estava gravado para ele → linhas de `profile_badges`.
 * Insígnia que voltou "não sei" não gera linha, e a gravada fica como estava.
 */
export function calcularInsigniasDoMembro(contexto, gravadas, agora = new Date()) {
  const { discordId } = contexto.membro;
  const linhas = [];
  const tierDepois = new Map();

  for (const insignia of INSIGNIAS) {
    if (insignia.derivada) continue;

    const anterior = gravadas.get(insignia.chave);
    const medido = insignia.medir(contexto);

    if (medido === null || medido === undefined || Number.isNaN(medido)) {
      tierDepois.set(insignia.chave, anterior?.tier ?? 0);
      continue;
    }

    let valor = Number(medido);

    // Recorde: nunca desce. Ver `acumulacao` no catálogo.
    if (insignia.acumulacao === 'recorde' && anterior?.valor != null) {
      valor = Math.max(valor, Number(anterior.valor));
    }

    const tier = tierDoValor(insignia, valor);
    tierDepois.set(insignia.chave, tier);
    linhas.push(montarLinha(discordId, insignia.chave, tier, valor, anterior, agora));
  }

  // Completista depois das outras, sobre o tier que cada uma ficou nesta rodada (medido ou mantido).
  // O valor gravado é quantas já estão no máximo, para a lista mostrar "9 de 34".
  for (const derivada of INSIGNIAS.filter(i => i.derivada)) {
    const contam = INSIGNIAS.filter(i => !i.derivada && i.completista !== false);
    const noMaximo = contam.filter(i => tierDepois.get(i.chave) === tierMaximoDe(i)).length;

    linhas.push(montarLinha(discordId, derivada.chave, noMaximo === contam.length ? 1 : 0, noMaximo,
      gravadas.get(derivada.chave), agora));
  }

  return linhas;
}

/** Os tiers que ninguém tinha alcançado antes — só esses viram linha em `profile_badge_tiers`. */
function tiersAlcancadosAgora(linhas, gravadasPorMembro, agora) {
  const novos = [];

  for (const linha of linhas) {
    const jaTinha = gravadasPorMembro.get(linha.discord_id)?.get(linha.badge_key)?.tier_maximo ?? 0;

    for (let tier = jaTinha + 1; tier <= linha.tier; tier++) {
      novos.push({ discord_id: linha.discord_id, badge_key: linha.badge_key, tier, alcancado_em: agora.toISOString() });
    }
  }

  return novos;
}

/**
 * Recalcula as insígnias de todo membro ativo, ou só de `discordIds`.
 * Com `gravar: false` lê e calcula sem escrever nada — é assim que a validação roda.
 */
export async function recalcularInsignias({ discordIds = null, gravar = true } = {}) {
  const inicio = Date.now();
  const agora = new Date();

  const { contextos, leitura } = await lerContextos({ discordIds });

  // Sem gravar, as tabelas podem nem existir ainda; aí o cálculo parte do zero.
  const gravadas = gravar
    ? await getInsigniasGravadas(discordIds)
    : await getInsigniasGravadas(discordIds).catch(() => []);

  const gravadasPorMembro = new Map();
  for (const linha of gravadas) {
    if (!gravadasPorMembro.has(linha.discord_id)) gravadasPorMembro.set(linha.discord_id, new Map());
    gravadasPorMembro.get(linha.discord_id).set(linha.badge_key, linha);
  }

  const linhas = contextos.flatMap(contexto =>
    calcularInsigniasDoMembro(contexto, gravadasPorMembro.get(contexto.membro.discordId) ?? new Map(), agora));

  const tiers = tiersAlcancadosAgora(linhas, gravadasPorMembro, agora);

  if (gravar) {
    // Tiers primeiro: se o estado falhar depois, a próxima rodada reinsere os mesmos sem duplicar.
    // Na ordem contrária, um tier_maximo gravado sem o registro do tier perderia a data para sempre.
    await registrarTiersAlcancados(tiers);
    await gravarInsignias(linhas);
  }

  const resumo = { ...leitura, linhas: linhas.length, tiersNovos: tiers.length, duracaoMs: Date.now() - inicio };

  console.log(`[Insignias] ${gravar ? 'Recalculated' : 'Dry run'}: ${resumo.membros} members, `
    + `${resumo.contasSemLeitura}/${resumo.contas} accounts unread, `
    + `${resumo.rotasDeModo?.semRegistroNoFim ?? 0}/${resumo.rotasDeModo?.total ?? 0} ranked mode reads without record `
    + `(${resumo.rotasDeModo?.semRegistroNaVarredura ?? 0} before retry), ${resumo.linhas} rows, `
    + `${resumo.tiersNovos} new tiers, ${Math.round(resumo.duracaoMs / 1000)}s`);

  return { contextos, linhas, tiers, resumo };
}
