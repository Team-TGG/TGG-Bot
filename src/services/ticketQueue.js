// Fila de espera por tickets: descoberta de quem abriu cada ticket.
//
// Os canais são criados pelo Ticket Tool, um bot de fora — não temos como consultar o banco dele
// nem existe evento nosso no momento da abertura dos que já estão de pé. Então o autor precisa ser
// deduzido do que o canal carrega, e há três lugares onde a informação pode estar. Qual deles vale
// depende de como o Ticket Tool está configurado, e isso não dá para saber lendo código: por isso
// `detectarAutor` devolve o que **cada** método achou, e o `.scan-tickets` mostra os três lado a
// lado antes de a gente fixar um.
import { OverwriteType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { STAFF_ROLE_IDS } from '../../config/index.js';
import { inserirTicketsNovos, garantirAtividade, fecharTickets, reabrirTickets, getTicketsAbertosBasico } from '../tickets.js';

export const CATEGORIA_TICKETS_ID = '1460768037518180352';

const IDS_DE_STAFF = new Set(Object.values(STAFF_ROLE_IDS));

// Snowflake do Discord: 17 a 20 dígitos. Serve para achar ID solto em tópico e em texto de embed.
const SNOWFLAKE = /(\d{17,20})/;

function ehStaff(member) {
  return member.roles.cache.some(role => IDS_DE_STAFF.has(role.id));
}

/**
 * Método 1 — permission overwrites do canal.
 *
 * O Ticket Tool dá acesso ao autor com uma overwrite individual, separada das de cargo. Tirando
 * bots e staff, o que sobra é quem abriu. É o único método que não custa requisição nenhuma e
 * funciona em ticket que já está aberto há semanas.
 */
function autorPorOverwrites(channel, guild) {
  const candidatos = [];

  for (const [id, overwrite] of channel.permissionOverwrites.cache) {
    if (overwrite.type !== OverwriteType.Member) continue;

    const member = guild.members.cache.get(id);
    if (!member) {
      // Fora do cache é candidato mesmo assim: pode ser alguém que saiu do servidor, e sumir
      // com ele calado esconderia justamente o ticket órfão que a staff precisa ver.
      candidatos.push(id);
      continue;
    }

    if (member.user.bot) continue;
    if (ehStaff(member)) continue;

    candidatos.push(id);
  }

  return candidatos;
}

/** Método 2 — tópico do canal. O Ticket Tool costuma gravar o ID de quem abriu ali. */
function autorPorTopico(channel) {
  if (!channel.topic) return null;
  const achado = channel.topic.match(SNOWFLAKE);
  return achado ? achado[1] : null;
}

/**
 * Método 3 — primeira mensagem do canal.
 *
 * `after: '0'` traz a mais antiga, que é o embed de abertura do Ticket Tool. Custa uma requisição
 * por canal, então é o último recurso, não o primeiro.
 */
async function autorPorPrimeiraMensagem(channel) {
  const mensagens = await channel.messages.fetch({ limit: 1, after: '0' }).catch(() => null);
  const primeira = mensagens?.first();
  if (!primeira) return null;

  const mencionado = primeira.mentions.users.find(u => !u.bot);
  if (mencionado) return mencionado.id;

  const textoDosEmbeds = primeira.embeds
    .map(e => [e.description, e.title, ...(e.fields ?? []).map(f => `${f.name} ${f.value}`)].join(' '))
    .join(' ');

  const achado = `${primeira.content} ${textoDosEmbeds}`.match(SNOWFLAKE);
  return achado ? achado[1] : null;
}

/**
 * Quebra `<base>-<posição>` — a posição é o número no fim, a base é todo o resto.
 *
 * **Não assume prefixo nenhum.** A versão anterior exigia `guild-` literal e por isso não
 * reconhecia `guilda-fulano-3`: o nick saía nulo e o canal nunca era renomeado. Casar só o
 * número no fim é a mesma regra que o `.organize-tickets` usava antes de tudo isso, e serve
 * para qualquer prefixo que a staff resolva adotar.
 *
 * `base` é o que sobra para remontar o nome; `nick` é a base sem o prefixo, só para exibição.
 */
export function lerNomeDoTicket(nome) {
  const achado = nome.match(/^(.*)-(\d+)$/);

  const base = achado ? achado[1] : nome;
  const posicao = achado ? Number(achado[2]) : null;
  const nick = base.replace(/^guilda?-/i, '') || null;

  return { base, nick, posicao };
}

/**
 * Roda os três métodos no mesmo canal e devolve o que cada um achou, sem escolher por você.
 *
 * `escolhido` é a leitura preferida (overwrite única > tópico > primeira mensagem), mas os campos
 * crus vão junto de propósito: se dois métodos discordarem, é isso que aparece no relatório.
 */
export async function detectarAutor(channel, guild, { lerPrimeiraMensagem = 'se-preciso' } = {}) {
  const overwrites = autorPorOverwrites(channel, guild);
  const topico = autorPorTopico(channel);

  // Medido em 14/08/2026: a overwrite sozinha resolveu todos os tickets abertos, sem uma
  // divergência sequer, e o tópico veio vazio em todos. Ler a primeira mensagem custa uma
  // requisição por canal e o cron diário passa por todos — então ela só roda quando a
  // overwrite não fecha sozinha, que é o ticket com mais de um humano adicionado.
  const precisaDaMensagem = overwrites.length !== 1 && !topico;
  const primeiraMensagem = (lerPrimeiraMensagem === true || (lerPrimeiraMensagem === 'se-preciso' && precisaDaMensagem))
    ? await autorPorPrimeiraMensagem(channel)
    : null;

  let escolhido = null;
  let metodo = null;

  if (overwrites.length === 1) {
    escolhido = overwrites[0];
    metodo = 'overwrite';
  } else if (topico) {
    escolhido = topico;
    metodo = 'tópico';
  } else if (primeiraMensagem) {
    escolhido = primeiraMensagem;
    metodo = '1ª mensagem';
  } else if (overwrites.length > 1) {
    // Mais de um humano não-staff com acesso individual: normalmente é ticket onde alguém foi
    // adicionado depois. Não dá para adivinhar qual é o autor, então fica para a staff resolver.
    metodo = 'ambíguo';
  }

  return { overwrites, topico, primeiraMensagem, escolhido, metodo };
}

/**
 * Traz para o cache só os membros que aparecem nas overwrites e ainda não estão nele.
 *
 * Sem eles, `autorPorOverwrites` não distingue staff de autor e todo canal volta ambíguo. O
 * caminho óbvio seria `guild.members.fetch()` sem argumento, mas isso puxa o servidor inteiro —
 * caro demais para uma rotina que roda de 5 em 5 minutos. Aqui são algumas dezenas de IDs, e
 * depois da primeira passada quase sempre zero.
 */
async function aquecerCacheDeMembros(guild, canais) {
  const faltando = new Set();

  for (const canal of canais) {
    for (const [id, overwrite] of canal.permissionOverwrites.cache) {
      if (overwrite.type === OverwriteType.Member && !guild.members.cache.has(id)) {
        faltando.add(id);
      }
    }
  }

  if (faltando.size === 0) return;

  const ids = [...faltando];
  for (let i = 0; i < ids.length; i += 100) {
    // Quem saiu do servidor não volta no fetch e continua fora do cache — é o caso que
    // `autorPorOverwrites` trata como candidato mesmo assim, para o ticket órfão aparecer.
    await guild.members.fetch({ user: ids.slice(i, i + 100) }).catch(() => {});
  }
}

/**
 * Varre a categoria de tickets e devolve uma linha por canal, com o que cada método achou.
 * Só lê — não escreve no banco nem toca nos canais.
 */
export async function escanearTickets(guild, { lerPrimeiraMensagem = 'se-preciso' } = {}) {
  const categoria = guild.channels.cache.get(CATEGORIA_TICKETS_ID);
  if (!categoria) throw new Error('Categoria de tickets não encontrada.');

  const canais = [...guild.channels.cache
    .filter(c => c.parentId === CATEGORIA_TICKETS_ID && c.isTextBased())
    .values()]
    .sort((a, b) => a.rawPosition - b.rawPosition);

  await aquecerCacheDeMembros(guild, canais);

  const linhas = [];

  for (const canal of canais) {
    const { nick, posicao } = lerNomeDoTicket(canal.name);
    const deteccao = await detectarAutor(canal, guild, { lerPrimeiraMensagem });

    linhas.push({
      channelId: canal.id,
      nome: canal.name,
      nick,
      posicao,
      ...deteccao,
    });
  }

  return linhas;
}

export function montarCardDeAssumir(openerDiscordId) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎫 Ticket sem responsável')
    .setDescription(
      `Ticket de <@${openerDiscordId}>.\n\n` +
      'Um membro da staff (helper+) deve assumir clicando abaixo. ' +
      'O responsável é quem recebe aviso por DM quando este ticket ficar sem resposta.'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_assumir')
      .setLabel('Assumir ticket')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🙋')
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Põe a tabela de acordo com o que existe na categoria: cadastra ticket novo, fecha o que sumiu.
 *
 * É reconciliação, não evento, de propósito. `channelCreate`/`channelDelete` avisariam na hora,
 * mas só enquanto o bot está de pé: ticket aberto durante um deploy ou uma queda nunca seria
 * cadastrado, e ninguém perceberia — a pessoa simplesmente não pontuaria. Comparar os dois lados
 * de tempos em tempos se conserta sozinho depois de qualquer janela offline. O custo é a latência,
 * e ela não importa aqui: a posição só é recalculada uma vez por dia.
 */
export async function reconciliarTickets(guild) {
  const abertos = await getTicketsAbertosBasico();
  const conhecidos = new Set(abertos.map(t => t.channel_id));

  const linhas = await escanearTickets(guild);
  const comAutor = linhas.filter(l => l.escolhido);
  const semAutor = linhas.filter(l => !l.escolhido);

  // O diff é calculado contra a memória antes de qualquer escrita. Sem isso, o ciclo mandava as
  // ~60 linhas para o banco descartar uma a uma a cada passada — barato numa rotina de 5 min,
  // desperdício puro numa de 1 min.
  const novos = comAutor.filter(l => !conhecidos.has(l.channelId));
  const naCategoria = new Set(linhas.map(l => l.channelId));
  const sumiram = abertos.filter(t => !naCategoria.has(t.channel_id)).map(t => t.channel_id);

  const idsInseridos = await inserirTicketsNovos(novos.map(l => ({
    channel_id: l.channelId,
    opener_discord_id: l.escolhido,
    nick: l.nick,
    posicao: l.posicao,
  })));

  // Ticket que não inseriu mas está na categoria é canal que saiu e voltou: a linha existe,
  // fechada, e o `ignoreDuplicates` a ignorou calado. Sem reabrir, ele ficava fora da fila para
  // sempre — e o card não se repete, porque ele já foi postado quando o ticket era novo.
  const reabertos = await reabrirTickets(
    novos.filter(l => !idsInseridos.includes(l.channelId)).map(l => l.channelId)
  );

  const atividadesNovas = await garantirAtividade(novos.map(l => l.escolhido));
  const fechados = await fecharTickets(sumiram);

  for (const linha of novos.filter(l => idsInseridos.includes(l.channelId))) {
    const canal = guild.channels.cache.get(linha.channelId);
    if (!canal) continue;

    await canal.send(montarCardDeAssumir(linha.escolhido))
      .catch(err => console.warn(`[TICKETS] falha ao postar o card em ${linha.nome}: ${err.message}`));
  }

  // Devolve o estado final já calculado: quem chamou precisa dele para os mapas em memória, e
  // reconsultar seria a segunda leitura idêntica do mesmo ciclo.
  // Só os inseridos entram aqui, não os reabertos: o responsável de um ticket reaberto está no
  // banco e não foi lido nesta passada, então inventar `null` o apagaria da memória. Reaberto
  // entra no ciclo seguinte, já com o valor certo.
  const fechadosSet = new Set(sumiram);
  const atualizados = [
    ...abertos.filter(t => !fechadosSet.has(t.channel_id)),
    ...novos
      .filter(l => idsInseridos.includes(l.channelId))
      .map(l => ({
        channel_id: l.channelId,
        opener_discord_id: l.escolhido,
        responsavel_discord_id: null,
      })),
  ];

  return {
    total: linhas.length,
    novos: idsInseridos.length,
    reabertos,
    atividadesNovas,
    fechados,
    semAutor,
    abertos: atualizados,
  };
}
