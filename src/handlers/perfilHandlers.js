// Dados, imagem e botões do cartão do .profile. O desenho mora em services/perfilCartao.js; aqui é juntar o
// que ele recebe, guardar a imagem pronta e responder aos botões.
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getContasDoMembro, getPeakElo, getUserByDiscordId, loadAliases, resolveBrawlhallaId } from '../db.js';
import { fetchGuildMembersNewAPI } from '../brawlhalla.js';
import { getInsigniasGravadas, getPerfil, salvarPerfil } from '../insignias.js';
import { CATEGORIAS, INSIGNIAS } from '../services/insigniasCatalogo.js';
import { recalcularInsignias } from '../services/insigniasMotor.js';
import { desenharCartao, estiloDaInsignia, TIERS } from '../services/perfilCartao.js';
import { discord as discordConfig, perfil as config } from '../../config/index.js';
import { createErrorEmbed, createSuccessEmbed, createWarningEmbed } from '../../utils/discordUtils.js';

export const VAGAS_DA_VITRINE = 8;

const POR_CHAVE = new Map(INSIGNIAS.map((i) => [i.chave, i]));
const ORDEM = new Map(INSIGNIAS.map((i, n) => [i.chave, n]));
const ABAS = Object.entries(CATEGORIAS); // [['JOGO', 'Jogo'], ...]

/* Imagem pronta por membro, junto da assinatura do que ela desenha. Mudou tier, mensagem, vitrine, nick ou
   avatar, muda a assinatura e sai desenho novo; sem mudança, o mesmo PNG serve. Em memória: um restart só
   custa um desenho por membro. */
const cartoes = new Map();

/** `<@id>`, `<@!id>` ou o ID puro → o ID; qualquer outra coisa → null. */
export function lerAlvoDoArgumento(argumento) {
  return String(argumento ?? '').match(/^<@!?(\d{17,20})>$|^(\d{17,20})$/)?.slice(1).find(Boolean) ?? null;
}

// ─── Vitrine ─────────────────────────────────────────────────────────────────

function paraVitrine(chave, tier) {
  const insignia = POR_CHAVE.get(chave);
  return { chave, nome: insignia.nome, tiers: insignia.tiers?.length ?? null, tier };
}

const nivel = (v) => (v.tiers ? Math.min(v.tier, v.tiers) : 1);

/**
 * A vitrine que o cartão desenha. A escolhida pelo membro sai na ordem dele, e a que perdeu o tier vira vaga;
 * quem ainda não escolheu vê as 8 de maior tier (decisão do usuário, 14/09/2026), desempatadas pela ordem do
 * catálogo para não trocarem de lugar entre dois `.profile` seguidos.
 */
export function montarVitrine(gravadas, escolhidas = []) {
  const tierPorChave = new Map(
    gravadas.filter((g) => POR_CHAVE.has(g.badge_key)).map((g) => [g.badge_key, Number(g.tier)]),
  );

  // Posicional: espaço esvaziado é null e continua vazio, em vez de puxar os seguintes para trás.
  if (escolhidas.length) {
    return Array.from({ length: VAGAS_DA_VITRINE }, (_, i) => {
      const chave = escolhidas[i];
      return chave && POR_CHAVE.has(chave) ? paraVitrine(chave, tierPorChave.get(chave) ?? 0) : null;
    });
  }

  return [...tierPorChave]
    .map(([chave, tier]) => paraVitrine(chave, tier))
    .filter((v) => estiloDaInsignia(v))
    .sort((a, b) => nivel(b) - nivel(a) || ORDEM.get(a.chave) - ORDEM.get(b.chave))
    .slice(0, VAGAS_DA_VITRINE);
}

/** Põe `chave` no espaço; se ela já estava em outro, as duas trocam de lugar. `chave` null esvazia o espaço. */
export function colocarNaVitrine(chaves, espaco, chave) {
  const nova = [...chaves];
  const anterior = chave ? nova.indexOf(chave) : -1;
  if (anterior >= 0) nova[anterior] = nova[espaco];
  nova[espaco] = chave;
  return nova;
}

/* As 8 chaves que o membro está vendo agora. Na primeira edição, a vitrine automática vira a escolhida: trocar
   o espaço 3 não pode fazer as outras sete sumirem. */
async function lerChavesDaVitrine(dono) {
  const [gravadas, perfil] = await Promise.all([getInsigniasGravadas([dono]), getPerfil(dono)]);
  const vitrine = montarVitrine(gravadas, perfil?.vitrine ?? []);
  return Array.from({ length: VAGAS_DA_VITRINE }, (_, i) => vitrine[i]?.chave ?? null);
}

// ─── Cartão ──────────────────────────────────────────────────────────────────

/* Rota em lote, não a individual, que devolve 404 intermitente (ver CLAUDE.md). `lida: false` é "não sei",
   e o cartão diz isso em vez de afirmar que a pessoa está fora da guilda. */
async function lerMembroNaGuilda(ids) {
  try {
    const guilda = await fetchGuildMembersNewAPI();
    const membro = ids
      .map((id) => guilda.guild_members.find((m) => String(m.brawlhalla_id) === id))
      .find(Boolean) ?? null;
    return { lida: true, membro };
  } catch (err) {
    console.warn(`[PERFIL] guild members read failed: ${err.message}`);
    return { lida: false, membro: null };
  }
}

async function baixarAvatar(url) {
  try {
    const resposta = await fetch(url);
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    return Buffer.from(await resposta.arrayBuffer());
  } catch (err) {
    console.warn(`[PERFIL] avatar download failed: ${err.message}`);
    return null;
  }
}

/**
 * PNG do cartão. `usuario` é a linha de `users`; `membroDiscord`, o GuildMember (ou o User, para quem saiu do
 * servidor), de onde saem avatar e nome de reserva.
 */
export async function gerarCartaoDoPerfil(usuario, membroDiscord) {
  const discordId = String(usuario.discord_id);
  const cadastrada = String(usuario.brawlhalla_id);

  // Quem está cadastrado com a alt que entrou na guilda tem a principal em alt_ids: o elo sai dela e das
  // alts dela, como no .scan. Cargo e entrada saem da conta que está na guilda, por isso a cadastrada vem antes.
  await loadAliases();
  const principal = String(resolveBrawlhallaId(cadastrada));

  const [peak, gravadas, perfil, naGuilda] = await Promise.all([
    getContasDoMembro(principal).then((contas) => getPeakElo([...new Set([...contas, cadastrada])])),
    getInsigniasGravadas([discordId]),
    getPerfil(discordId),
    lerMembroNaGuilda([cadastrada, principal]),
  ]);

  const avatarUrl = membroDiscord?.displayAvatarURL?.({ extension: 'png', size: 256 }) ?? null;
  const joinDate = Number(naGuilda.membro?.join_date || 0);

  const dados = {
    nick: naGuilda.membro?.name ?? membroDiscord?.displayName ?? 'Sem nick',
    rank: naGuilda.lida ? (naGuilda.membro?.rank ?? null) : undefined,
    entrouEm: joinDate ? new Date(joinDate * 1000) : null,
    peak,
    mensagem: perfil?.mensagem ?? '',
    vitrine: montarVitrine(gravadas, perfil?.vitrine ?? []),
  };

  // O dia entra na assinatura porque o cartão escreve "na guilda há X dias".
  const assinatura = JSON.stringify({ ...dados, avatarUrl, dia: new Date().toDateString() });
  const guardado = cartoes.get(discordId);
  if (guardado?.assinatura === assinatura) return guardado.png;

  const avatar = avatarUrl ? await baixarAvatar(avatarUrl) : null;
  const png = await desenharCartao({ ...dados, avatar });

  // Avatar que falhou não fica guardado: o próximo .profile tenta de novo.
  if (avatar || !avatarUrl) cartoes.set(discordId, { assinatura, png });
  return png;
}

/* Os botões levam o dono no customId e são roteados em interactions.js, não por collector: o cartão fica no
   canal por horas, e um collector morreria no primeiro restart. */
export function botoesDoCartao(dono) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`perfil_btn_vitrine_${dono}`).setLabel('Vitrine').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`perfil_btn_mensagem_${dono}`).setLabel('Editar mensagem').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`perfil_btn_sync_${dono}`).setLabel('Sync').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`perfil_lista_${dono}_0_0`).setLabel('Todas as insígnias').setStyle(ButtonStyle.Secondary),
  );
}

/** O que o `.profile` manda e o que os botões reescrevem. `attachments: []` troca a imagem em vez de somar outra. */
export async function montarRespostaDoCartao(client, usuario, guild = null) {
  const dono = String(usuario.discord_id);
  const servidor = guild ?? await client.guilds.fetch(discordConfig.guildId);

  // Quem saiu do servidor não é GuildMember, mas o User ainda tem avatar e nome.
  const membro = await servidor.members.fetch(dono).catch(() => null)
    ?? await client.users.fetch(dono).catch(() => null);

  const png = await gerarCartaoDoPerfil(usuario, membro);

  return {
    embeds: [],
    attachments: [],
    files: [new AttachmentBuilder(png, { name: 'perfil.png' })],
    components: [botoesDoCartao(dono)],
  };
}

async function redesenharCartao(interaction, client, dono, mensagemId) {
  try {
    const usuario = await getUserByDiscordId(dono);
    if (!usuario?.active) return;

    const cartao = interaction.message?.id === mensagemId
      ? interaction.message
      : await interaction.channel?.messages.fetch(mensagemId);

    if (cartao) await cartao.edit(await montarRespostaDoCartao(client, usuario, interaction.guild));
  } catch (err) {
    // O que o membro salvou já está gravado; o cartão velho só mostra o estado anterior até o próximo .profile.
    console.warn(`[PERFIL] failed to redraw card ${mensagemId}: ${err.message}`);
  }
}

// ─── Interações ──────────────────────────────────────────────────────────────

const painel = (texto) => new EmbedBuilder().setColor(0x5865f2).setDescription(texto);
const linha = (componente) => new ActionRowBuilder().addComponents(componente);
const efemera = (payload) => ({ ...payload, flags: MessageFlags.Ephemeral });

async function soDono(interaction, dono) {
  if (interaction.user.id === dono) return true;

  await interaction.reply(efemera({
    embeds: [createErrorEmbed('Só o dono do perfil', 'Esse botão é de quem é dono do perfil. Abra o seu com `.profile`.')],
  }));
  return false;
}

function painelDeEspacos(dono, mensagemId, chaves, aviso = null) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`perfil_vespaco_${dono}_${mensagemId}`)
    .setPlaceholder('Escolha o espaço')
    .addOptions(chaves.map((chave, i) => ({
      label: `Espaço ${i + 1}`,
      description: chave ? POR_CHAVE.get(chave).nome : 'Vazio',
      value: String(i),
    })));

  const texto = aviso ? `${aviso}\n\nQuer trocar outro espaço?` : 'Qual espaço da vitrine você quer trocar?';
  return { embeds: [painel(texto)], components: [linha(select)] };
}

async function abrirVitrine(interaction, dono) {
  const chaves = await lerChavesDaVitrine(dono);
  await interaction.reply(efemera(painelDeEspacos(dono, interaction.message.id, chaves)));
}

async function escolherEspaco(interaction, dono, mensagemId) {
  const espaco = Number(interaction.values[0]);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`perfil_vcat_${dono}_${mensagemId}_${espaco}`)
    .setPlaceholder('Escolha a categoria')
    .addOptions(
      ...ABAS.map(([valor, nome]) => ({ label: nome, value: valor })),
      { label: 'Deixar o espaço vazio', value: 'VAZIO' },
    );

  await interaction.update({ embeds: [painel(`Espaço ${espaco + 1}: de qual categoria é a insígnia?`)], components: [linha(select)] });
}

async function escolherCategoria(interaction, client, dono, mensagemId, espaco) {
  const categoria = interaction.values[0];
  if (categoria === 'VAZIO') return salvarEspaco(interaction, client, dono, mensagemId, espaco, null);

  const nomeCategoria = CATEGORIAS[categoria];
  const tierPorChave = new Map((await getInsigniasGravadas([dono])).map((g) => [g.badge_key, Number(g.tier)]));

  // Só as conquistadas: vitrine é para mostrar o que o membro tem.
  const conquistadas = INSIGNIAS
    .filter((i) => i.categoria === nomeCategoria)
    .map((i) => ({ insignia: i, estilo: estiloDaInsignia({ tier: tierPorChave.get(i.chave) ?? 0, tiers: i.tiers?.length ?? null }) }))
    .filter((o) => o.estilo);

  if (!conquistadas.length) {
    const chaves = await lerChavesDaVitrine(dono);
    return interaction.update(painelDeEspacos(dono, mensagemId, chaves, `Você ainda não tem insígnia de ${nomeCategoria}.`));
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`perfil_vins_${dono}_${mensagemId}_${espaco}`)
    .setPlaceholder('Escolha a insígnia')
    .addOptions(conquistadas.map(({ insignia, estilo }) => ({ label: insignia.nome, description: estilo.nome, value: insignia.chave })));

  await interaction.update({ embeds: [painel(`Espaço ${espaco + 1}: qual insígnia de ${nomeCategoria}?`)], components: [linha(select)] });
}

async function salvarEspaco(interaction, client, dono, mensagemId, espaco, chave) {
  const chaves = colocarNaVitrine(await lerChavesDaVitrine(dono), espaco, chave);
  await salvarPerfil(dono, { vitrine: chaves });

  const aviso = chave
    ? `**${POR_CHAVE.get(chave).nome}** está no espaço ${espaco + 1}. O cartão está sendo atualizado.`
    : `O espaço ${espaco + 1} ficou vazio. O cartão está sendo atualizado.`;

  await interaction.update(painelDeEspacos(dono, mensagemId, chaves, aviso));
  await redesenharCartao(interaction, client, dono, mensagemId);
}

const formatar = (valor) => Math.floor(valor).toLocaleString('pt-BR');

// 7 e não 10: com a linha do que é contado, cada insígnia virou três linhas (pedido do usuário, 14/09/2026).
const POR_PAGINA = 7;
const ABAS_DA_LISTA = ['Faltando', ...Object.values(CATEGORIAS)];

export function barra(percentual) {
  const cheios = Math.floor(Math.max(0, Math.min(100, percentual)) / 10);
  return '▰'.repeat(cheios) + '▱'.repeat(10 - cheios);
}

/**
 * Onde o membro está numa insígnia. `percentual` conta do zero até o próximo corte (80 de 160 = 50%), como os
 * números da linha se leem; null quando não há barra: única, completa, em breve ou sem medição.
 */
export function situacaoDaInsignia(insignia, gravada) {
  const tiers = insignia.tiers?.length ?? null;
  const tier = Math.min(Number(gravada?.tier ?? 0), tiers ?? 1);
  const completa = tiers ? tier >= tiers : tier > 0;
  const proximo = tiers && !completa ? insignia.tiers[tier] : null;
  const valor = gravada?.valor == null ? null : Number(gravada.valor);
  const percentual = proximo != null && valor != null ? Math.min(100, Math.floor((valor / proximo) * 100)) : null;

  return { insignia, tier, tiers, estilo: estiloDaInsignia({ tier, tiers }), completa, proximo, valor, percentual };
}

/* Três linhas: nome e tier, o que é contado e a barra. O que é contado vai sempre, até na completa: o nome não
   se explica sozinho, e "18 / 26 semanas seguidas" sem dizer seguidas de quê não informa nada (pedido do
   usuário, 14/09/2026). Por isso a barra sai sem unidade — a linha de cima já diz. */
export function linhaDaLista({ insignia, tier, tiers, estilo, completa, proximo, valor, percentual }) {
  const nome = `**${insignia.nome}**`;
  const mede = insignia.descricao;

  if (insignia.pendente) return `${nome} · em breve\n${mede}`;
  if (completa) return `${nome} · ${estilo.nome}${tiers ? ' · completa' : ''}\n${mede}`;
  if (!tiers) return `${nome} · bloqueada\n${mede}`;

  const alvo = TIERS[tier].nome;
  const progresso = valor == null
    ? `${barra(0)} sem medição ainda · ${alvo} com ${formatar(proximo)}`
    : `${barra(percentual)} ${percentual}% · ${formatar(valor)} / ${formatar(proximo)}`;

  return `${nome} · ${estilo?.nome ?? 'bloqueada'} → ${alvo}\n${mede}\n${progresso}`;
}

/**
 * Aba 0, "Faltando": tudo que não está no máximo, de todas as categorias, da mais perto do próximo tier para a
 * mais longe. Sem barra (única bloqueada, sem medição) vai para o fim; "em breve" não entra, não há o que fazer.
 */
export function itensDaAba(aba, gravadas) {
  const situacoes = INSIGNIAS.map((i) => situacaoDaInsignia(i, gravadas.get(i.chave)));

  if (aba > 0) return situacoes.filter((s) => s.insignia.categoria === ABAS_DA_LISTA[aba]);

  return situacoes
    .filter((s) => !s.completa && !s.insignia.pendente)
    .sort((a, b) => (b.percentual ?? -1) - (a.percentual ?? -1) || ORDEM.get(a.insignia.chave) - ORDEM.get(b.insignia.chave));
}

async function mostrarLista(interaction, dono, abaPedida, paginaPedida) {
  const gravadas = new Map((await getInsigniasGravadas([dono])).map((g) => [g.badge_key, g]));
  const aba = ABAS_DA_LISTA[abaPedida] ? abaPedida : 0;
  const itens = itensDaAba(aba, gravadas);

  const paginas = Math.max(1, Math.ceil(itens.length / POR_PAGINA));
  const pagina = Math.min(Math.max(0, paginaPedida), paginas - 1);

  const resumo = aba === 0
    ? `${itens.length} faltando`
    : `${itens.filter((s) => s.completa).length} de ${itens.length} completas`;

  const corpo = itens.length
    ? itens.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA).map(linhaDaLista).join('\n\n')
    : 'Nada faltando: todas as insígnias disponíveis estão no máximo.';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Insígnias · ${ABAS_DA_LISTA[aba]}`)
    .setDescription(`Perfil de <@${dono}> · ${resumo}\n\n${corpo}`)
    .setFooter({ text: `Página ${pagina + 1} de ${paginas} · semana vai de quinta a quinta · recalculadas todo dia às 04:00` });

  // O sufixo `_aba` evita customId repetido: sem ele, a aba atual e o "Anterior" da página 2 teriam o mesmo.
  const abas = new ActionRowBuilder().addComponents(ABAS_DA_LISTA.map((nome, i) => new ButtonBuilder()
    .setCustomId(`perfil_lista_${dono}_${i}_0_aba`)
    .setLabel(nome)
    .setStyle(i === aba ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(i === aba)));

  const components = [abas];

  if (paginas > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`perfil_lista_${dono}_${aba}_${pagina - 1}`).setLabel('Anterior')
        .setStyle(ButtonStyle.Secondary).setDisabled(pagina === 0),
      new ButtonBuilder().setCustomId(`perfil_lista_${dono}_${aba}_${pagina + 1}`).setLabel('Próxima')
        .setStyle(ButtonStyle.Secondary).setDisabled(pagina === paginas - 1),
    ));
  }

  const payload = { embeds: [embed], components };

  // Do cartão, abre efêmera; dentro dela, trocar de aba reescreve a mesma mensagem.
  if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) return interaction.update(payload);
  return interaction.reply(efemera(payload));
}

async function sincronizar(interaction, client, dono) {
  const perfil = await getPerfil(dono);
  const liberaEm = (perfil?.ultimo_sync_em ? new Date(perfil.ultimo_sync_em).getTime() : 0) + config.syncCooldownMs;

  if (liberaEm > Date.now()) {
    return interaction.reply(efemera({
      embeds: [createErrorEmbed('Sync em espera', `Você pode sincronizar de novo <t:${Math.ceil(liberaEm / 1000)}:R>.`)],
    }));
  }

  // Carimbado antes de começar: a leitura leva meio minuto de API, e dois cliques rodariam duas varreduras.
  await salvarPerfil(dono, { ultimo_sync_em: new Date().toISOString() });
  await interaction.deferReply(efemera({}));

  const { tiers } = await recalcularInsignias({ discordIds: [dono] });

  await interaction.editReply({
    embeds: [createSuccessEmbed('Insígnias atualizadas', tiers.length
      ? `${tiers.length} tier(s) novo(s) desde a última leitura. O cartão está sendo atualizado.`
      : 'Nada mudou desde a última leitura.')],
  });

  if (tiers.length) await redesenharCartao(interaction, client, dono, interaction.message.id);
}

async function abrirModalDeMensagem(interaction, dono) {
  const perfil = await getPerfil(dono);

  const campo = new TextInputBuilder()
    .setCustomId('mensagem')
    .setLabel('Mensagem do perfil')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(config.mensagemMax)
    .setRequired(false)
    .setPlaceholder('Deixe vazio para tirar a mensagem do cartão');

  if (perfil?.mensagem) campo.setValue(perfil.mensagem);

  await interaction.showModal(new ModalBuilder()
    .setCustomId(`perfil_modal_${dono}_${interaction.message.id}`)
    .setTitle('Editar perfil')
    .addComponents(linha(campo)));
}

async function salvarMensagem(interaction, client, dono, mensagemId) {
  const texto = interaction.fields.getTextInputValue('mensagem').replace(/\s+/g, ' ').trim();
  await salvarPerfil(dono, { mensagem: texto || null });

  await interaction.reply(efemera({
    embeds: [createSuccessEmbed(texto ? 'Mensagem salva' : 'Mensagem removida', 'O cartão está sendo atualizado.')],
  }));
  await redesenharCartao(interaction, client, dono, mensagemId);
}

/**
 * Botões, menus e modal do cartão, todos com prefixo `perfil_`. "Todas as insígnias" é de qualquer um que vê o
 * cartão; o resto, só do dono (decisão do usuário, 14/09/2026).
 */
export async function handlePerfilInteracao(interaction, client) {
  const [, acao, ...partes] = interaction.customId.split('_');

  // Cartão enviado antes da paginação tem `perfil_lista_<dono>_0`, sem página: vira a primeira.
  if (acao === 'lista') return mostrarLista(interaction, partes[0], Number(partes[1]) || 0, Number(partes[2]) || 0);

  if (acao === 'btn') {
    const [qual, dono] = partes;
    if (!(await soDono(interaction, dono))) return;
    if (qual === 'vitrine') return abrirVitrine(interaction, dono);
    if (qual === 'mensagem') return abrirModalDeMensagem(interaction, dono);
    if (qual === 'sync') return sincronizar(interaction, client, dono);
  }

  const [dono, mensagemId, espaco] = partes;
  if (!(await soDono(interaction, dono))) return;

  if (acao === 'vespaco') return escolherEspaco(interaction, dono, mensagemId);
  if (acao === 'vcat') return escolherCategoria(interaction, client, dono, mensagemId, Number(espaco));
  if (acao === 'vins') return salvarEspaco(interaction, client, dono, mensagemId, Number(espaco), interaction.values[0]);
  if (acao === 'modal') return salvarMensagem(interaction, client, dono, mensagemId);

  console.warn(`[PERFIL] unknown customId: ${interaction.customId}`);
}

// ─── Staff ───────────────────────────────────────────────────────────────────

/**
 * `.limpar-perfil`: apaga a mensagem, avisa a pessoa por DM e registra em log-guilda com o texto removido
 * (decisão do usuário, 14/09/2026). DM fechada não impede a limpeza; o registro diz que ela não chegou.
 */
export async function limparMensagemDoPerfil(client, { alvoId, staffId }) {
  const perfil = await getPerfil(alvoId);
  if (!perfil?.mensagem) return { limpou: false };

  await salvarPerfil(alvoId, { mensagem: null });

  const dmEntregue = await client.users.fetch(alvoId)
    .then((usuario) => usuario.send({
      embeds: [createWarningEmbed('Mensagem do perfil removida',
        'A staff removeu a mensagem do seu perfil por não seguir as regras do servidor. '
        + 'Você pode escrever outra pelo botão **Editar mensagem** do `.profile`.')],
    }))
    .then(() => true)
    .catch(() => false);

  const log = await client.channels.fetch(config.logChannelId).catch(() => null);
  const registro = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('Mensagem de perfil removida')
    .addFields(
      { name: 'Membro', value: `<@${alvoId}>`, inline: true },
      { name: 'Staff', value: `<@${staffId}>`, inline: true },
      { name: 'DM', value: dmEntregue ? 'entregue' : 'não chegou (DM fechada)', inline: true },
      { name: 'Mensagem removida', value: perfil.mensagem.slice(0, 1024) },
    )
    .setTimestamp();

  await log?.send({ embeds: [registro], allowedMentions: { parse: [] } })
    .catch((err) => console.warn(`[PERFIL] failed to log profile cleanup: ${err.message}`));

  return { limpou: true, dmEntregue };
}
