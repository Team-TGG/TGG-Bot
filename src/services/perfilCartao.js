// Cartão do .profile em PNG. Recebe os dados prontos e só desenha: não lê banco nem API, então dá
// para gerar a prévia de qualquer membro sem subir o bot.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');
const FAMILIA = 'Montserrat';

/* Reserva para o que a Montserrat não tem: 12 dos 195 nicks usam símbolo, letra sobrescrita ou chinês e
   japonês (medido em 14/09/2026). Com as três, só o ࿐ de um nick fica sem desenho; a biblioteca não cai
   sozinha para fonte do sistema, e na VM talvez nem haja uma. */
const RESERVAS = [
  ['NotoSans-Variable.ttf', 'Noto Sans'],
  ['NotoSansSymbols2-Regular.ttf', 'Noto Sans Symbols 2'],
  ['NotoSansJP-Variable.ttf', 'Noto Sans JP'],
];

export const LARGURA = 1000;
export const ALTURA = 420;

/* A forma muda com o tier, e não só a cor: prata e platina se confundem pela cor, e o cartão precisa
   ser legível em preto e branco. Quando a arte da fase 3 chegar, trocam as formas, não os nomes.
   Os nomes passam por `t()` na hora de escrever; o inglês está em i18n/en/perfil.js. */
export const TIERS = [
  { nome: 'Bronze', cor: '#cd8a4f', forma: 'circulo' },
  { nome: 'Prata', cor: '#c7ccd6', forma: 'quadrado' },
  { nome: 'Ouro', cor: '#f2c14e', forma: 'hexagono' },
  { nome: 'Platina', cor: '#7fe0cf', forma: 'escudo' },
  { nome: 'Diamante', cor: '#7cc6ff', forma: 'gema' },
];

// Insígnia sem tiers: visual próprio, para não ser lida como tier nenhum (decisão do usuário, 14/09/2026).
export const UNICA = { nome: 'Conquistada', cor: '#b99cff', forma: 'selo' };

const RANKS = { Leader: 'Líder', Officer: 'Officer', Member: 'Membro', Recruit: 'Recruta' };

const COR = {
  texto: '#f4f5f8',
  suave: '#a3a9b8',
  apagado: '#697083',
  destaque: '#f2c14e',
  painel: 'rgba(255, 255, 255, 0.035)',
  borda: 'rgba(255, 255, 255, 0.07)',
};

/* Sob demanda pelo mesmo motivo do sharp em missoesImagem.js: é binário nativo, e se ele faltar na VM
   quem cai é o .profile, não o boot do bot. */
let canvasPromise;
function carregarCanvas() {
  canvasPromise ??= import('@napi-rs/canvas').then((m) => {
    for (const peso of ['Regular', 'SemiBold', 'Bold', 'ExtraBold']) {
      m.GlobalFonts.registerFromPath(path.join(FONTES, `Montserrat-${peso}.ttf`), FAMILIA);
    }
    for (const [arquivo, familia] of RESERVAS) {
      m.GlobalFonts.registerFromPath(path.join(FONTES, arquivo), familia);
    }
    return m;
  });
  return canvasPromise;
}

const PILHA = [FAMILIA, ...RESERVAS.map(([, familia]) => `"${familia}"`)].join(', ');
const fonte = (peso, tamanho) => `${peso} ${tamanho}px ${PILHA}`;

// ─── Texto ──────────────────────────────────────────────────────────────────

function caber(ctx, texto, largura, forcarReticencias = false) {
  if (!forcarReticencias && ctx.measureText(texto).width <= largura) return texto;

  let corte = texto;
  while (corte.length > 1 && ctx.measureText(`${corte}…`).width > largura) corte = corte.slice(0, -1);
  return `${corte.trimEnd()}…`;
}

// Diminui a fonte até caber e só corta abaixo do mínimo: "Conquistad…" não se lê como nome de insígnia.
function ajustarFonte(ctx, texto, largura, peso, maximo, minimo) {
  for (let tamanho = maximo; tamanho >= minimo; tamanho--) {
    ctx.font = fonte(peso, tamanho);
    if (ctx.measureText(texto).width <= largura) return texto;
  }
  return caber(ctx, texto, largura);
}

function quebrarLinhas(ctx, texto, largura, maxLinhas) {
  const todas = [];
  let atual = '';

  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (!atual || ctx.measureText(tentativa).width <= largura) {
      atual = tentativa;
    } else {
      todas.push(atual);
      atual = palavra;
    }
  }
  if (atual) todas.push(atual);

  const linhas = todas.slice(0, maxLinhas).map((linha) => caber(ctx, linha, largura));
  if (todas.length > maxLinhas) linhas[maxLinhas - 1] = caber(ctx, linhas[maxLinhas - 1], largura, true);
  return linhas;
}

export function tempoDeGuilda(entrouEm, t, agora = new Date()) {
  const dias = Math.floor((agora - entrouEm) / 86_400_000);
  if (dias < 1) return t('Entrou hoje na guilda');

  // Singular e plural como frases separadas, e não "dia(s)": o inglês precisa das duas formas.
  const dia = (n) => (n === 1 ? t('{n} dia', { n }) : t('{n} dias', { n }));
  const mes = (n) => (n === 1 ? t('{n} mês', { n }) : t('{n} meses', { n }));
  const ano = (n) => (n === 1 ? t('{n} ano', { n }) : t('{n} anos', { n }));

  const meses = Math.floor(dias / 30.44);
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;

  let tempo;
  if (dias < 30) tempo = dia(dias);
  else if (meses < 12) tempo = mes(meses);
  else tempo = resto ? t('{anos} e {meses}', { anos: ano(anos), meses: mes(resto) }) : ano(anos);

  return t('Na guilda há {tempo}', { tempo });
}

// ─── Formas ─────────────────────────────────────────────────────────────────

function misturar(hex, alvo, quanto) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const m = (c) => Math.round(c + (alvo - c) * quanto);
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
}

function poligono(ctx, cx, cy, r, lados, rotacao) {
  for (let i = 0; i < lados; i++) {
    const angulo = rotacao + (i * 2 * Math.PI) / lados;
    const x = cx + r * Math.cos(angulo);
    const y = cy + r * Math.sin(angulo);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function retanguloArredondado(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
}

function tracarForma(ctx, forma, cx, cy, r) {
  ctx.beginPath();

  switch (forma) {
    case 'circulo':
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    case 'quadrado':
      retanguloArredondado(ctx, cx - r * 0.86, cy - r * 0.86, r * 1.72, r * 1.72, r * 0.28);
      break;
    case 'hexagono':
      poligono(ctx, cx, cy, r * 1.04, 6, -Math.PI / 2);
      break;
    case 'escudo':
      ctx.moveTo(cx - r * 0.86, cy - r * 0.78);
      ctx.quadraticCurveTo(cx, cy - r * 1.06, cx + r * 0.86, cy - r * 0.78);
      ctx.lineTo(cx + r * 0.86, cy + r * 0.08);
      ctx.quadraticCurveTo(cx + r * 0.8, cy + r * 0.72, cx, cy + r * 1.06);
      ctx.quadraticCurveTo(cx - r * 0.8, cy + r * 0.72, cx - r * 0.86, cy + r * 0.08);
      break;
    case 'selo':
      for (let i = 0; i < 24; i++) {
        const raio = i % 2 === 0 ? r * 1.06 : r * 0.86;
        const angulo = -Math.PI / 2 + (i * Math.PI) / 12;
        const x = cx + raio * Math.cos(angulo);
        const y = cy + raio * Math.sin(angulo);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      break;
    case 'gema':
      ctx.moveTo(cx - r * 0.58, cy - r * 0.78);
      ctx.lineTo(cx + r * 0.58, cy - r * 0.78);
      ctx.lineTo(cx + r * 1.02, cy - r * 0.18);
      ctx.lineTo(cx, cy + r * 1.04);
      ctx.lineTo(cx - r * 1.02, cy - r * 0.18);
      break;
    default:
      throw new Error(`Forma de insígnia desconhecida: ${forma}`);
  }

  ctx.closePath();
}

/* Estilo que o desenho usa, ou null se não conquistada. A de 3 tiers para no Ouro, como o nome do tier
   diz. O tier é limitado ao que a insígnia tem hoje, porque `tier_maximo` nunca desce quando um corte muda
   (o Vínculo passou de 5 para 3 tiers em 14/09/2026). */
export function estiloDaInsignia({ tier, tiers }) {
  if (!(tier > 0)) return null;
  if (!tiers) return UNICA;
  return TIERS[Math.min(tier, tiers, TIERS.length) - 1];
}

function desenharInsignia(ctx, insignia, estilo, cx, cy, r) {
  ctx.save();

  tracarForma(ctx, estilo.forma, cx, cy, r);
  const brilho = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  brilho.addColorStop(0, misturar(estilo.cor, 255, 0.2));
  brilho.addColorStop(1, misturar(estilo.cor, 0, 0.45));
  ctx.fillStyle = brilho;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = misturar(estilo.cor, 0, 0.6);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = '#13151c';
  ctx.fill();

  // Ícone provisório até a arte: a inicial do nome, tingida na cor do tier.
  ctx.fillStyle = estilo.cor;
  ctx.font = fonte(800, Math.round(r * 0.58));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(insignia.nome.charAt(0).toUpperCase(), cx, cy + r * 0.04);

  ctx.restore();
}

function desenharVaga(ctx, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
  ctx.stroke();
  ctx.restore();
}

// ─── Blocos do cartão ───────────────────────────────────────────────────────

function desenharFundo(ctx) {
  const fundo = ctx.createLinearGradient(0, 0, LARGURA, ALTURA);
  fundo.addColorStop(0, '#171a23');
  fundo.addColorStop(1, '#0c0e13');
  ctx.fillStyle = fundo;
  ctx.fillRect(0, 0, LARGURA, ALTURA);

  ctx.fillStyle = COR.destaque;
  ctx.fillRect(0, 0, LARGURA, 4);
}

async function desenharAvatar(ctx, loadImage, avatar, nick) {
  const cx = 110;
  const cy = 110;
  const r = 70;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#252934';
  ctx.fill();

  const imagem = avatar ? await loadImage(avatar).catch(() => null) : null;

  if (imagem) {
    ctx.clip();
    ctx.drawImage(imagem, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = COR.suave;
    ctx.font = fonte(800, 56);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((nick || '?').charAt(0).toUpperCase(), cx, cy + 2);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.stroke();
}

function desenharIdentidade(ctx, { nick, rank, entrouEm, peak, t }) {
  const x = 208;
  const largura = 292;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = COR.texto;
  ctx.font = fonte(800, 34);
  ctx.fillText(caber(ctx, nick || t('Sem nick'), largura), x, 76);

  ctx.fillStyle = rank === 'Leader' || rank === 'Officer' ? COR.destaque : COR.suave;
  ctx.font = fonte(700, 19);
  // undefined = a leitura da guilda falhou; null = leu e a pessoa não está nela.
  const cargo = rank === undefined ? t('Cargo indisponível') : rank ? t(RANKS[rank] ?? rank) : t('Fora da guilda');
  ctx.fillText(cargo, x, 106);

  ctx.fillStyle = COR.suave;
  ctx.font = fonte(400, 16);
  ctx.fillText(caber(ctx, entrouEm ? tempoDeGuilda(entrouEm, t) : t('Tempo de guilda indisponível'), largura), x, 131);

  ctx.fillStyle = COR.apagado;
  ctx.font = fonte(700, 12);
  ctx.fillText(t('PEAK ELO'), x, 165);

  ctx.fillStyle = COR.texto;
  ctx.font = fonte(800, 30);
  const valor = peak ? t.numero(peak.elo) : '—';
  ctx.fillText(valor, x, 198);

  if (peak?.modo) {
    const larguraValor = ctx.measureText(valor).width;
    ctx.fillStyle = COR.suave;
    ctx.font = fonte(600, 16);
    ctx.fillText(peak.modo, x + larguraValor + 10, 198);
  }
}

function desenharMensagem(ctx, mensagem, t) {
  const x = 40;
  const y = 236;
  const w = 460;
  const h = 150;

  ctx.beginPath();
  retanguloArredondado(ctx, x, y, w, h, 14);
  ctx.fillStyle = COR.painel;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = COR.borda;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = COR.destaque;
  ctx.fillRect(x + 20, y + 22, 3, h - 44);

  const texto = mensagem?.trim();

  if (!texto) {
    ctx.fillStyle = COR.apagado;
    ctx.font = fonte(400, 16);
    ctx.fillText(t('Sem mensagem ainda.'), x + 40, y + 42);
    return;
  }

  ctx.fillStyle = '#dde0e8';
  ctx.font = fonte(400, 18);
  quebrarLinhas(ctx, texto, w - 60, 4).forEach((linha, i) => ctx.fillText(linha, x + 40, y + 40 + i * 28));
}

function desenharVitrine(ctx, vitrine, t) {
  const x = 524;
  const y = 24;
  const w = 452;
  const h = 372;

  ctx.beginPath();
  retanguloArredondado(ctx, x, y, w, h, 16);
  ctx.fillStyle = COR.painel;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = COR.borda;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COR.apagado;
  ctx.font = fonte(700, 12);
  ctx.fillText(t('VITRINE'), x + 20, y + 28);

  const colunas = 4;
  const larguraCelula = (w - 24) / colunas;
  const alturaLinha = 164;
  const topo = y + 42;
  const raio = 36;

  for (let i = 0; i < 8; i++) {
    const cx = x + 12 + larguraCelula * (i % colunas) + larguraCelula / 2;
    const linhaTopo = topo + alturaLinha * Math.floor(i / colunas);
    const cy = linhaTopo + 50;
    const insignia = vitrine[i];
    const estilo = insignia ? estiloDaInsignia(insignia) : null;

    if (!estilo) {
      desenharVaga(ctx, cx, cy, raio);
      continue;
    }

    desenharInsignia(ctx, insignia, estilo, cx, cy, raio);

    ctx.textAlign = 'center';
    ctx.fillStyle = COR.texto;
    ctx.fillText(ajustarFonte(ctx, insignia.nome, larguraCelula - 6, 700, 14, 11), cx, linhaTopo + 112);

    ctx.fillStyle = estilo.cor;
    ctx.font = fonte(600, 12);
    ctx.fillText(t(estilo.nome), cx, linhaTopo + 131);
  }
}

/**
 * `dados`: { avatar: Buffer|null, nick, rank, entrouEm: Date|null, peak: { elo, modo }|null, mensagem,
 * vitrine: até 8 { chave, nome, tier, tiers }, t }, com `tiers` = quantidade de tiers ou null na insígnia única,
 * `nome` já no idioma do cartão e `t` o tradutor de i18n/index.js nesse idioma.
 */
export async function desenharCartao(dados) {
  const { createCanvas, loadImage } = await carregarCanvas();
  const canvas = createCanvas(LARGURA, ALTURA);
  const ctx = canvas.getContext('2d');

  desenharFundo(ctx);
  await desenharAvatar(ctx, loadImage, dados.avatar, dados.nick);
  desenharIdentidade(ctx, dados);
  desenharMensagem(ctx, dados.mensagem, dados.t);
  desenharVitrine(ctx, dados.vitrine ?? [], dados.t);

  return canvas.encode('png');
}
