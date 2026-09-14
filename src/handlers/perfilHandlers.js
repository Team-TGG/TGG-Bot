// Dados e imagem do cartão do .profile. O desenho mora em services/perfilCartao.js; aqui é juntar o que
// ele recebe e guardar a imagem pronta.
import { getContasDoMembro, getPeakElo } from '../db.js';
import { fetchGuildMembersNewAPI } from '../brawlhalla.js';
import { getInsigniasGravadas, getPerfil } from '../insignias.js';
import { INSIGNIAS } from '../services/insigniasCatalogo.js';
import { desenharCartao, estiloDaInsignia } from '../services/perfilCartao.js';

export const VAGAS_DA_VITRINE = 8;

const POR_CHAVE = new Map(INSIGNIAS.map((i) => [i.chave, i]));
const ORDEM = new Map(INSIGNIAS.map((i, n) => [i.chave, n]));

/* Imagem pronta por membro, junto da assinatura do que ela desenha. Mudou tier, mensagem, vitrine, nick ou
   avatar, muda a assinatura e sai desenho novo; sem mudança, o mesmo PNG serve. Em memória: um restart só
   custa um desenho por membro. */
const cartoes = new Map();

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

  if (escolhidas.length) {
    return escolhidas
      .filter((chave) => POR_CHAVE.has(chave))
      .slice(0, VAGAS_DA_VITRINE)
      .map((chave) => paraVitrine(chave, tierPorChave.get(chave) ?? 0));
  }

  return [...tierPorChave]
    .map(([chave, tier]) => paraVitrine(chave, tier))
    .filter((v) => estiloDaInsignia(v))
    .sort((a, b) => nivel(b) - nivel(a) || ORDEM.get(a.chave) - ORDEM.get(b.chave))
    .slice(0, VAGAS_DA_VITRINE);
}

/* Rota em lote, não a individual, que devolve 404 intermitente (ver CLAUDE.md). `lida: false` é "não sei",
   e o cartão diz isso em vez de afirmar que a pessoa está fora da guilda. */
async function lerMembroNaGuilda(brawlhallaId) {
  try {
    const guilda = await fetchGuildMembersNewAPI();
    const membro = guilda.guild_members.find((m) => String(m.brawlhalla_id) === String(brawlhallaId)) ?? null;
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

  const [peak, gravadas, perfil, naGuilda] = await Promise.all([
    getContasDoMembro(usuario.brawlhalla_id).then(getPeakElo),
    getInsigniasGravadas([discordId]),
    getPerfil(discordId),
    lerMembroNaGuilda(usuario.brawlhalla_id),
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
