import { EmbedBuilder } from 'discord.js';
import pLimit from 'p-limit';
import { getLastWednesdayReference, getMissionWeekEnd } from '../db.js';
import { calcularContribuicaoSemanal } from './contribuicaoSemanal.js';
import { getBlindadosNaSemana, getBlindagensPendentes, getInativosDaSemana, inserirInativos } from '../inactivity.js';
import { inactivePlayers as config, discord as discordConfig } from '../../config/index.js';

/**
 * Inativação semanal — o que antes era feito à mão na página `relatorio_inativar.php` do site.
 *
 * Diferença importante para a página: ela mede **XP** (`player_elo_missions.guild_xp`, do sistema
 * antigo) e aqui se mede **contribuição** (guild points), que é o que a staff avalia e a unidade
 * real do limiar de 1.000. Os dois números não batem — o daqui é o certo.
 *
 * Fica de fora quem:
 *   - é officer/admin no `users.role` ou tem blindagem cobrindo a semana;
 *   - entrou na guilda durante a semana avaliada (não teve semana inteira para contribuir);
 *   - não pôde ser medido (sem base, base zerada, fora da guilda) — sem número não se acusa;
 *   - ficou dentro da tolerância sobre o mínimo (ver `LIMIAR_INATIVACAO`);
 *   - já está na lista desta semana.
 */

/** Contribuição mínima da semana - a regra que o membro conhece e que os avisos citam. */
export const CONTRIBUICAO_MINIMA = 1000;

/**
 * Folga sobre o mínimo, só para a inativação. Existe por erro de leitura da API de guild points:
 * o desvio normal é de 1 a 10 pontos e nunca tinha atrapalhado, mas em 08/2026 um membro com
 * 1.020 pontos foi lido como 902 (a hipótese é que os pontos tinham acabado de ser ganhos).
 * Começou em 10%, larga de propósito enquanto ninguém sabia o tamanho do desvio. Depois de três
 * semanas conferindo a leitura, o usuário fechou em **3%** (02/09/2026): 30 pontos cobrem com
 * sobra as diferenças de até 10 que aparecem na prática, e a folga larga estava poupando quem
 * simplesmente não jogou.
 *
 * A folga não muda a regra: os avisos continuam cobrando os 1.000, e o lembrete de domingo
 * também (ver contributionReminderService.js). Ela só evita marcar como inativo quem está na
 * fronteira, onde o erro da API decide o resultado.
 */
export const TOLERANCIA_INATIVACAO = 0.03;

/** Abaixo disso, inativo. */
export const LIMIAR_INATIVACAO = Math.round(CONTRIBUICAO_MINIMA * (1 - TOLERANCIA_INATIVACAO));

/**
 * A medição só vale entre **quarta 06:00 e quinta 06:00** — é a única janela em que a semana
 * medida já fechou e a base ainda é a dela. Antes da quarta 06:00 o número é parcial; depois da
 * quinta 06:00 `player_weekly_info` já virou para a semana nova e a conta passa a dar ~0 para
 * todo mundo, o que inativaria a guilda inteira.
 *
 * As duas pontas caem na mesma condição: `getMissionWeekEnd()` é a quarta 06:00 que fecha a
 * semana de missões corrente, e só dentro da janela o agora já passou dela.
 */
export function semanaFechada(agora = new Date()) {
  return agora.getTime() >= new Date(getMissionWeekEnd()).getTime();
}

/** `users.role` que nunca é inativado. */
const CARGOS_ISENTOS = new Set(['officer', 'admin']);

/**
 * Decide quem entra na lista. Função pura — dá para conferir a chamada inteira sem tocar no banco.
 *
 * Devolve os inativos e também os `poupados`, com o motivo de cada um, porque "ninguém foi
 * inativado" e "todo mundo estava blindado" precisam ser distinguíveis no resumo da staff.
 *
 * `limiar` é o corte de fato. O padrão é o mínimo com a tolerância; o lembrete de domingo passa
 * `CONTRIBUICAO_MINIMA` cheio, porque lá o objetivo é empurrar para a regra, não poupar ninguém.
 */
export function selecionarInativos({ linhas, blindados, jaNaLista, limiar = LIMIAR_INATIVACAO }) {
  const inativos = [];
  const poupados = [];

  for (const linha of linhas) {
    const poupar = (motivo) => poupados.push({ ...linha, motivoPoupado: motivo });

    if (jaNaLista.has(linha.brawlhallaId)) {
      poupar('JA_NA_LISTA');
      continue;
    }

    if (CARGOS_ISENTOS.has(linha.role)) {
      poupar('STAFF');
      continue;
    }

    if (blindados.has(linha.discordId)) {
      poupar('BLINDADO');
      continue;
    }

    // Sem base de comparação não há acusação possível: o número seria inventado
    if (linha.motivo) {
      poupar(linha.motivo);
      continue;
    }

    // Entrou no meio da semana — mesma isenção que a página do site sempre deu
    if (linha.entrouNaSemana) {
      poupar('ENTROU_NA_SEMANA');
      continue;
    }

    if (linha.contribuicao >= CONTRIBUICAO_MINIMA) {
      poupar('CONTRIBUIU');
      continue;
    }

    // Não bateu o mínimo, mas está dentro da folga: motivo próprio para a staff enxergar
    // quantos ficaram de fora só por causa dela e poder calibrar o número
    if (linha.contribuicao >= limiar) {
      poupar('TOLERANCIA');
      continue;
    }

    inativos.push(linha);
  }

  inativos.sort((a, b) => a.contribuicao - b.contribuicao);

  return { inativos, poupados };
}

/** Monta a lista da semana sem gravar nada. É o que o `.inativar` mostra antes de confirmar. */
export async function calcularInativosDaSemana() {
  const weekReference = getLastWednesdayReference();

  const [{ weekStart, linhas }, blindados, jaListados, pendentes] = await Promise.all([
    calcularContribuicaoSemanal(),
    getBlindadosNaSemana(weekReference),
    getInativosDaSemana(weekReference),
    getBlindagensPendentes(),
  ]);

  const jaNaLista = new Set(jaListados.map(r => String(r.brawlhalla_id)));

  const { inativos, poupados } = selecionarInativos({ linhas, blindados, jaNaLista });

  return { weekReference, weekStart, inativos, poupados, blindados, pendentes, fechada: semanaFechada() };
}

function embedAviso() {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('⚠️ Aviso de Inatividade')
    .setDescription(
      `Você fez menos de **${CONTRIBUICAO_MINIMA.toLocaleString('pt-BR')} de contribuição** na semana ` +
      `e foi marcado como inativo.\n\n` +
      `Veja o lembrete do TGG-Bot em <#${config.channelId}> para saber como sair da lista e evitar ` +
      `ser removido da guilda.\n\n` +
      `Se teve um motivo para não jogar, use \`.active <justificativa>\`. Se já sabe que vai ficar ` +
      `sem jogar nas próximas semanas, use \`.justificativa <motivo> <semanas>\`.`
    )
    .setTimestamp();
}

/**
 * Aplica o cargo de inativo e manda a DM. Concorrência limitada porque o Discord derruba lote
 * grande de chamadas — o `.inac-all` já fazia assim.
 */
export async function aplicarCargoEAvisar(client, inativos) {
  const guild = await client.guilds.fetch(discordConfig.guildId);
  await guild.members.fetch();

  const aviso = embedAviso();
  const limit = pLimit(5);

  let cargoAplicado = 0;
  let dmEnviada = 0;
  const falhas = [];

  await Promise.all(inativos.map(inativo => limit(async () => {
    const membro = guild.members.cache.get(inativo.discordId)
      || await guild.members.fetch(inativo.discordId).catch(() => null);

    if (!membro) {
      falhas.push({ discordId: inativo.discordId, nome: inativo.nome, erro: 'não está no Discord' });
      return;
    }

    if (!membro.roles.cache.has(config.inactiveRoleId)) {
      const ok = await membro.roles.add(config.inactiveRoleId).then(() => true).catch(err => {
        falhas.push({ discordId: inativo.discordId, nome: inativo.nome, erro: err.message });
        return false;
      });
      if (ok) cargoAplicado++;
    } else {
      cargoAplicado++;
    }

    // DM fechada é comum e não é falha da rotina — o aviso no canal ainda alcança a pessoa
    await membro.send({ embeds: [aviso] })
      .then(() => { dmEnviada++; })
      .catch(() => console.log(`[INATIVOS] DM bloqueada: ${inativo.nome} (${inativo.discordId})`));
  })));

  return { cargoAplicado, dmEnviada, falhas };
}

/** Aviso com as menções no canal de inativos. */
export function montarAnuncio(inativos) {
  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle('⚠️ Inativos da semana')
    .setDescription(
      `Quem está marcado abaixo fez menos de **${CONTRIBUICAO_MINIMA.toLocaleString('pt-BR')} de ` +
      `contribuição** na semana passada.\n\n` +
      `Para sair da lista, use \`.active <justificativa>\` - a justificativa precisa de pelo menos ` +
      `15 caracteres.\n` +
      `Para se blindar antes, quando já souber que vai ficar sem jogar, use ` +
      `\`.justificativa <motivo> <semanas>\` e espere a staff avaliar.`
    )
    .setTimestamp();

  return {
    content: inativos.map(i => `<@${i.discordId}>`).join(' '),
    embeds: [embed],
    allowedMentions: { users: inativos.map(i => i.discordId) },
  };
}

// O anúncio vai para `avisoChannelId` (log-guilda), não para o canal dos inativos: o `<#...>` da DM
// e o `.active` continuam apontando para `channelId`, que é onde o membro interage.
async function anunciar(client, payload) {
  if (!config.avisoChannelId) {
    console.warn('[INATIVOS] avisoChannelId não configurado - anúncio pulado');
    return false;
  }

  const canal = await client.channels.fetch(config.avisoChannelId).catch(() => null);

  if (!canal) {
    console.warn(`[INATIVOS] canal ${config.avisoChannelId} não encontrado - anúncio pulado`);
    return false;
  }

  await canal.send(payload);
  return true;
}

/**
 * Roda a inativação da semana: grava a lista, aplica o cargo, manda DM e avisa no canal.
 *
 * Repetir é seguro — quem já está na lista da semana é pulado, então rodar o cron e o `.inativar`
 * no mesmo dia não duplica ninguém.
 */
export async function inativarSemana(client) {
  const resultado = await calcularInativosDaSemana();
  const { weekReference, inativos } = resultado;

  // Trava dura: fora da janela o número não descreve a semana. Vale para o cron e para o comando.
  if (!resultado.fechada) {
    console.warn(`[INATIVOS] semana ainda não fechou (fecha ${getMissionWeekEnd()}) - nada gravado`);
    return { ...resultado, gravados: 0, anunciado: false, motivo: 'SEMANA_ABERTA' };
  }

  if (!inativos.length) {
    console.log(`[INATIVOS] semana ${weekReference}: ninguém abaixo de ${LIMIAR_INATIVACAO} - nada a fazer`);
    return { ...resultado, gravados: 0, anunciado: false };
  }

  await inserirInativos(inativos.map(i => i.brawlhallaId), weekReference);

  console.log(`[INATIVOS] semana ${weekReference}: ${inativos.length} marcados`);
  inativos.forEach(i => console.log(`  ${i.nome} (${i.brawlhallaId}) - ${i.contribuicao}`));

  const cargos = await aplicarCargoEAvisar(client, inativos).catch(err => {
    console.error('[INATIVOS] falha ao aplicar cargo/DM:', err.message);
    return { cargoAplicado: 0, dmEnviada: 0, falhas: [{ erro: err.message }] };
  });

  const anunciado = await anunciar(client, montarAnuncio(inativos)).catch(err => {
    console.error('[INATIVOS] falha ao anunciar:', err.message);
    return false;
  });

  if (cargos.falhas.length) console.warn('[INATIVOS] falhas:', cargos.falhas);

  return { ...resultado, gravados: inativos.length, ...cargos, anunciado };
}
