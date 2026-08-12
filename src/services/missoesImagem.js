import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'missoes');
const FUNDO = path.join(RAIZ, 'fundo-missoes.png');

// Medido nos 18 prints em 12/08/2026. Cada missão foi capturada na coluna que o jogo dá à
// posição dela no ciclo, então o x de cada arquivo já dizia o slot: os de elo/horda em ~50,
// botw em 466, os ranked em ~884, os de lobby em ~1314. Não é coincidência — é o mesmo fato
// que fez os CICLOS de weeklyMissionsService serem modelados por posição.
//
// O passo é uniforme (420) de propósito, em vez das posições originais (411, 418, 431): o que
// o olho percebe num card lado a lado é o espaçamento, não o desvio de 8px da captura. E os
// 462 de largura contra os 420 de passo não são erro — os cards são paralelogramos que se
// encaixam, e a sobra de um entra no vão do vizinho.
const SLOT_X = [50, 470, 890, 1310];
const SLOT_Y = 296;
const SLOT_W = 462;
const SLOT_H = 484;

/**
 * `sharp` é binário nativo e exige Node >= 20.9, enquanto o projeto declara >= 18. Importado no
 * topo, uma VM com Node velho não conseguiria nem iniciar o bot — a arte, que é a parte que pode
 * faltar sem prejuízo, derrubaria tudo. Sob demanda, o mesmo erro vira só um post sem imagem.
 */
let sharpPromise;
function carregarSharp() {
  sharpPromise ??= import('sharp').then((m) => m.default);
  return sharpPromise;
}

/**
 * Isola o card do print e o normaliza para o tamanho do slot. O recorte é medido em tempo de
 * execução (`trim`) porque os prints foram cortados à mão e variam ~3% entre si; fixar as
 * coordenadas exigiria remedir a tabela toda a cada arquivo que o usuário reexportasse.
 */
async function recortarCard(sharp, slug) {
  return sharp(path.join(RAIZ, `${slug}.png`))
    .trim({ threshold: 0 })
    .resize(SLOT_W, SLOT_H, { fit: 'fill' })
    .png()
    .toBuffer();
}

/**
 * Monta a arte da semana: o fundo do jogo com os quatro cards encaixados.
 *
 * Recebe os slugs na ordem das posições (o mesmo array de `slugsDaSemana`) e devolve o PNG
 * pronto para virar anexo. Estoura se faltar print — quem chama decide se anuncia sem imagem.
 */
export async function gerarImagemMissoes(slugs) {
  const sharp = await carregarSharp();
  const cards = await Promise.all(slugs.map((slug) => recortarCard(sharp, slug)));

  return sharp(FUNDO)
    .composite(cards.map((input, i) => ({ input, left: SLOT_X[i], top: SLOT_Y })))
    .png({ compressionLevel: 9 })
    .toBuffer();
}
