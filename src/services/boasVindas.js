// Boas-vindas no #joins, no lugar do Apolo: a mesma imagem (fundo, título, avatar e nick), com a
// faixa do nick acompanhando o tamanho dele em vez de ter largura fixa (pedido do usuário, 19/10/2026).
// As medidas saíram da imagem do Apolo, que é 800×500.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttachmentBuilder } from 'discord.js';
import { boasVindas as config } from '../../config/index.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const FONTES = path.join(ASSETS, 'fonts');
export const FUNDO = path.join(ASSETS, 'boasvindas', 'fundo.png');

const LARGURA = 800;
const ALTURA = 500;
const TITULO = 'Bem-vindo(a) ao servidor da Team TGG!';

/* Liberation tem as mesmas medidas de Arial e Times, que são as do Apolo, e vem no repo porque a VM
   pode não ter fonte nenhuma instalada. As Noto atrás cobrem nick com símbolo, japonês e emoji. */
const RESERVAS = [
  ['NotoSans-Variable.ttf', 'Noto Sans'],
  ['NotoSansSymbols2-Regular.ttf', 'Noto Sans Symbols 2'],
  ['NotoSansJP-Variable.ttf', 'Noto Sans JP'],
  ['NotoColorEmoji-COLRv1.ttf', 'Noto Color Emoji'],
];
const pilha = (principal) => [principal, ...RESERVAS.map(([, f]) => `"${f}"`)].join(', ');
const FONTE_TITULO = pilha('"Liberation Sans"');
const FONTE_NICK = pilha('"Liberation Serif"');

const FAIXA = { cor: 'rgba(0, 0, 0, 0.6)', altura: 50 };
const FAIXA_TITULO = { x: 74, y: 39, largura: 652 };
const FAIXA_NICK = { y: 320, folga: 25, larguraMax: 652 };
const AVATAR = { x: 400, y: 230, raio: 70 };
const NICK = { maximo: 30, minimo: 20 };

// Sob demanda pelo mesmo motivo do perfilCartao.js: binário nativo faltando na VM derruba só as boas-vindas.
let canvasPromise;
function carregarCanvas() {
  canvasPromise ??= import('@napi-rs/canvas').then((m) => {
    m.GlobalFonts.registerFromPath(path.join(FONTES, 'LiberationSans-Regular.ttf'), 'Liberation Sans');
    m.GlobalFonts.registerFromPath(path.join(FONTES, 'LiberationSerif-Regular.ttf'), 'Liberation Serif');
    for (const [arquivo, familia] of RESERVAS) {
      m.GlobalFonts.registerFromPath(path.join(FONTES, arquivo), familia);
    }
    return m;
  });
  return canvasPromise;
}

function faixa(ctx, x, y, largura) {
  const raio = FAIXA.altura / 2;
  ctx.fillStyle = FAIXA.cor;
  ctx.beginPath();
  ctx.roundRect(x, y, largura, FAIXA.altura, raio);
  ctx.fill();
}

// Diminui a fonte até caber e só corta com reticência abaixo do mínimo
function ajustarNick(ctx, nick, largura) {
  for (let tamanho = NICK.maximo; tamanho >= NICK.minimo; tamanho--) {
    ctx.font = `${tamanho}px ${FONTE_NICK}`;
    if (ctx.measureText(nick).width <= largura) return { texto: nick, tamanho };
  }
  const partes = [...new Intl.Segmenter().segment(nick)].map((s) => s.segment);
  while (partes.length > 1 && ctx.measureText(`${partes.join('')}…`).width > largura) partes.pop();
  return { texto: `${partes.join('')}…`, tamanho: NICK.minimo };
}

/**
 * Desenha a imagem com os dados prontos — não fala com o Discord, então dá para gerar prévia sem bot.
 * @param {{ nick: string, avatar: Buffer, fundo: Buffer }} dados
 * @returns {Promise<Buffer>} PNG
 */
export async function desenharBoasVindas({ nick, avatar, fundo }) {
  const { createCanvas, loadImage } = await carregarCanvas();
  const canvas = createCanvas(LARGURA, ALTURA);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(await loadImage(fundo), 0, 0, LARGURA, ALTURA);

  faixa(ctx, FAIXA_TITULO.x, FAIXA_TITULO.y, FAIXA_TITULO.largura);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `35px ${FONTE_TITULO}`;
  ctx.fillText(TITULO, LARGURA / 2, 82);

  ctx.save();
  ctx.beginPath();
  ctx.arc(AVATAR.x, AVATAR.y, AVATAR.raio, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(await loadImage(avatar), AVATAR.x - AVATAR.raio, AVATAR.y - AVATAR.raio, AVATAR.raio * 2, AVATAR.raio * 2);
  ctx.restore();

  const { texto, tamanho } = ajustarNick(ctx, nick, FAIXA_NICK.larguraMax - FAIXA_NICK.folga * 2);
  const larguraFaixa = ctx.measureText(texto).width + FAIXA_NICK.folga * 2;
  faixa(ctx, (LARGURA - larguraFaixa) / 2, FAIXA_NICK.y, larguraFaixa);
  ctx.fillStyle = '#ffffff';
  // 0,4 da fonte abaixo do centro põe a linha de base onde o Apolo põe (357 com 30px)
  ctx.fillText(texto, LARGURA / 2, FAIXA_NICK.y + FAIXA.altura / 2 + tamanho * 0.4);

  return canvas.encode('png');
}

/** Listener de `guildMemberAdd`. Falha de desenho cai para a mensagem sem imagem, nunca em silêncio. */
export async function darBoasVindas(member) {
  if (!config.channelId || member.user.bot) return;

  try {
    const canal = member.guild.channels.cache.get(config.channelId)
      ?? await member.guild.channels.fetch(config.channelId);
    const mensagem = {
      content: `Bem-vindo(a), <@${member.id}>!`,
      allowedMentions: { users: [member.id] },
    };

    try {
      const [fundo, avatar] = await Promise.all([
        fs.readFile(FUNDO),
        fetch(member.user.displayAvatarURL({ extension: 'png', size: 256 })).then(async (r) => {
          if (!r.ok) throw new Error(`avatar HTTP ${r.status}`);
          return Buffer.from(await r.arrayBuffer());
        }),
      ]);
      const png = await desenharBoasVindas({ nick: member.user.username, avatar, fundo });
      mensagem.files = [new AttachmentBuilder(png, { name: 'boas-vindas.png' })];
    } catch (err) {
      console.warn(`[BoasVindas] Image failed for ${member.id}, sending text only: ${err.message}`);
    }

    await canal.send(mensagem);
  } catch (err) {
    console.warn(`[BoasVindas] Could not welcome ${member.id}: ${err.message}`);
  }
}
