import { EmbedBuilder } from 'discord.js';
import { getEventosNaoAvisados, marcarEventosAvisados, getCadastroPorBrawlhallaIds } from '../db.js';
import { guildHistory as config } from '../../config/index.js';

/**
 * Aviso de movimentação na guilda do jogo: quem entrou, saiu, foi promovido ou rebaixado.
 *
 * A tabela `guild_membership_history` é escrita pelo cron do site (`automations/guild_history.php`,
 * fora deste repo) a cada 15 min. O bot lê as linhas com `avisado = false`, avisa e marca.
 *
 * `avisado` é a **única** coluna desta tabela que o bot escreve, e é uma exceção deliberada ao
 * "site escreve, bot lê": o controle precisa sobreviver a rodar o bot de outra máquina, coisa que
 * um arquivo local não faz. O cron do site não precisa saber da coluna — o `default false` do
 * schema já marca cada linha nova como pendente.
 */

// Ordem de exibição no embed, e o rótulo de cada ação. `action` fora desta lista é ignorada —
// se o cron do site inventar uma ação nova, o aviso não quebra, só não mostra.
const ACOES = [
  { action: 'saiu', titulo: '🚪 Saíram', cor: 0xed4245 },
  { action: 'entrou', titulo: '📥 Entraram', cor: 0x57f287 },
  { action: 'promovido', titulo: '⬆️ Promovidos', cor: 0x5865f2 },
  { action: 'rebaixado', titulo: '⬇️ Rebaixados', cor: 0xfaa61a },
];

/** Formata 'YYYY-MM-DDTHH:mm:ss' como 'DD/MM às HH:mm'. */
function quando(occurredAt) {
  const [data, hora = ''] = String(occurredAt).split('T');
  const [, mes, dia] = data.split('-');
  return `${dia}/${mes} às ${hora.slice(0, 5)}`;
}

/**
 * O que a staff precisa saber sobre o cadastro, e só isso: quem saiu continua contando em sync,
 * missões e inatividade enquanto estiver ativo, e quem entrou ainda não existe para o bot até
 * alguém rodar `.entrou`.
 */
function notaDeCadastro(evento, user) {
  if (evento.action === 'saiu') {
    if (!user) return 'sem cadastro no bot';
    return user.active ? '⚠️ ainda ativo no cadastro' : 'já inativo no cadastro';
  }

  if (evento.action === 'entrou') {
    if (!user) return '⚠️ falta `.entrou`';
    return user.active ? 'já cadastrado' : 'cadastro inativo';
  }

  return null;
}

function linha(evento, cadastro) {
  const user = cadastro.get(String(evento.brawlhalla_id));
  const partes = [`**${evento.nome}**`];

  // Em promoção/rebaixamento o rank é o destino, então a seta descreve melhor que o parêntese
  if (evento.rank) {
    partes.push(evento.action === 'promovido' || evento.action === 'rebaixado' ? `→ ${evento.rank}` : `(${evento.rank})`);
  }

  const cauda = [quando(evento.occurred_at)];
  if (user?.discord_id) cauda.push(`<@${user.discord_id}>`);

  const nota = notaDeCadastro(evento, user);
  if (nota) cauda.push(nota);

  return `${partes.join(' ')} - ${cauda.join(' · ')}`;
}

/** Payload do aviso. Exportado para dar pra conferir sem enviar nada. */
export function montarAnuncio(eventos, cadastro) {
  const embed = new EmbedBuilder()
    .setTitle('📋 Movimentação da guilda')
    .setTimestamp();

  let primeiraAcao = null;

  for (const { action, titulo, cor } of ACOES) {
    const doTipo = eventos.filter(e => e.action === action);
    if (!doTipo.length) continue;

    if (!primeiraAcao) {
      primeiraAcao = action;
      embed.setColor(cor);
    }

    const mostrados = doTipo.slice(0, config.maxPorAcao);
    const linhas = mostrados.map(e => linha(e, cadastro));

    const restante = doTipo.length - mostrados.length;
    if (restante > 0) linhas.push(`_… e mais ${restante}._`);

    embed.addFields({
      name: `${titulo} (${doTipo.length})`,
      value: linhas.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  return {
    embeds: [embed],
    // Aviso de log não pinga: a menção é só para a staff saber de quem se trata
    allowedMentions: { parse: [] },
  };
}

async function anunciar(client, payload) {
  if (!config.channelId) {
    console.warn('[HISTORICO] channelId não configurado - aviso pulado');
    return false;
  }

  const canal = await client.channels.fetch(config.channelId).catch(() => null);

  if (!canal) {
    console.warn(`[HISTORICO] canal ${config.channelId} não encontrado - aviso pulado`);
    return false;
  }

  await canal.send(payload);
  return true;
}

/**
 * Procura movimentação pendente e avisa no canal de log.
 *
 * A marcação vem **depois** do envio dar certo: se o Discord falhar, a próxima passada tenta os
 * mesmos eventos de novo. A troca é consciente — aviso repetido incomoda, aviso perdido some.
 */
export async function avisarMovimentacao(client) {
  let pendentes;

  try {
    pendentes = await getEventosNaoAvisados();
  } catch (err) {
    // 42703 = coluna inexistente. Sem ela a rotina não tem como saber o que já avisou, e insistir
    // a cada 15 min só enche o log — o recado precisa dizer o que fazer.
    if (err?.code === '42703') {
      console.error(
        '[HISTORICO] a coluna `avisado` não existe em guild_membership_history. Rode:\n' +
        '  alter table guild_membership_history add column avisado boolean not null default false;\n' +
        '  update guild_membership_history set avisado = true;'
      );
      return { novos: 0, anunciado: false, motivo: 'SEM_COLUNA' };
    }
    throw err;
  }

  if (!pendentes.length) return { novos: 0, anunciado: false };

  const conhecidos = pendentes.filter(e => ACOES.some(a => a.action === e.action));

  if (conhecidos.length) {
    const cadastro = await getCadastroPorBrawlhallaIds(conhecidos.map(e => e.brawlhalla_id));

    const anunciado = await anunciar(client, montarAnuncio(conhecidos, cadastro));
    if (!anunciado) return { novos: conhecidos.length, anunciado: false };
  }

  // Marca a leva inteira, inclusive a ação desconhecida que não virou aviso - senão a rotina
  // relê a mesma linha para sempre. Vale também para quem só entrou no resumo "… e mais N".
  await marcarEventosAvisados(pendentes.map(e => e.id));

  console.log(`[HISTORICO] ${conhecidos.length} evento(s) avisado(s), ${pendentes.length} marcado(s)`);
  return { novos: conhecidos.length, anunciado: conhecidos.length > 0 };
}
