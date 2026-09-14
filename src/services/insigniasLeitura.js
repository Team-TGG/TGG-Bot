// Lê tudo que as insígnias medem e monta um contexto por membro. Não calcula tier — isso é do
// motor (insigniasMotor.js), que recebe o contexto pronto, e do catálogo, que diz o que cada
// insígnia tira dele.
//
// A regra que atravessa o arquivo: null é "não sei", nunca zero. Leitura que falhou vira null e o
// motor mantém o tier de ontem; zero só sai de dado lido que deu zero. É a mesma distinção do
// contribuicaoSemanal.js, e aqui pesa mais, porque a v1 falha calada (ver lerApi).
import { apiFetch } from '../brawlhalla.js';
import { getActiveUsersWithBrawlhallaId, getLastWednesdayReference } from '../db.js';
import { getFontesInsignias, getVinculosDeContas } from '../insignias.js';
import { brawlhalla as brawlhallaConfig, insignias as config } from '../../config/index.js';

const V1 = 'https://api.brawlhalla.com/v1';
const DIA_MS = 24 * 60 * 60 * 1000;

/* Guild points anteriores a 08/2026 não são confiáveis (a API devolvia valor errado). Vale só
   para contribuição: as vitórias por modo de player_weekly_info saem de outro campo e servem desde
   o começo da tabela. */
const INICIO_GUILD_POINTS_CONFIAVEIS = '2026-08-01';

// ─── API ──────────────────────────────────────────────────────────────────────

/* Teto de chamadas em voo. Não é a cota (2000/5min, que o apiFetch controla): é o quanto a gateway
   aguenta ao mesmo tempo. Medido em 02/09/2026 — 20 chamadas em série passam todas, 32 simultâneas
   dão 18 respostas 502. */
const EM_VOO_MAX = 4;

/* E um intervalo mínimo entre chamadas, porque teto de simultaneidade não é ritmo. Sem ele a varredura
   corria a ~13 req/s: bateu no limite de 2.000/5min 71 vezes e passou 13 dos 14 minutos esperando o
   limitador, que a cada liberação soltava uma rajada. Nessa rajada as rotas de modo devolveram 404
   falso para metade da guilda (13/09/2026) — consultadas uma a uma, 20 de 20 responderam de primeira.
   300 ms dá ~1.000 chamadas por janela, metade da cota: o limitador, que é compartilhado com os
   comandos do bot, não chega a entrar em ação. */
const INTERVALO_MINIMO_MS = 300;

/* Na rota base, 404 é quase sempre ruído de carga: a conta existe e está no banco. Nas rotas de
   modo, 404 é a resposta normal de quem nunca jogou aquele modo, e insistir só custa tempo. */
const ROTA_BASE = { tentativas: 5, tentativas404: 5, esperaMs: 250 };
const ROTA_MODO = { tentativas: 4, tentativas404: 2, esperaMs: 250 };
// Repescagem das rotas de modo: em série e com folga entre tentativas, longe da carga da varredura.
const ROTA_MODO_CALMA = { tentativas: 3, tentativas404: 2, esperaMs: 1000 };

const FALHOU = Symbol('falhou');

let emVoo = 0;
const fila = [];
let proximaSaida = 0;

async function ocuparVaga() {
  if (emVoo < EM_VOO_MAX) {
    emVoo++;
    return;
  }
  await new Promise(resolve => fila.push(resolve));
}

// A vaga passa direto para quem está esperando, sem decrementar: decrementar e acordar em dois
// passos deixava uma chamada nova entrar no meio e o teto estourar aos poucos.
function liberarVaga() {
  const proximo = fila.shift();
  if (proximo) proximo();
  else emVoo--;
}

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function respeitarRitmo() {
  const agora = Date.now();
  const espera = Math.max(0, proximaSaida - agora);
  // A reserva do horário acontece antes do await, então duas chamadas nunca saem juntas.
  proximaSaida = Math.max(agora, proximaSaida) + INTERVALO_MINIMO_MS;
  if (espera) await esperar(espera);
}

/**
 * Devolve o JSON, `null` para 404 confirmado ou `FALHOU`.
 *
 * O 404 só é aceito depois de repetido porque, sob carga, a v1 devolve 404 para conta que existe
 * — e 404 também é a resposta legítima de "sem registro", então o erro passa como dado. Na
 * primeira rodada da medição (02/09/2026) 183 dos 200 membros saíram com zero vitória sem um
 * único erro registrado.
 */
async function lerApi(url, { tentativas, tentativas404, esperaMs }) {
  for (let t = 1; t <= tentativas; t++) {
    await ocuparVaga();
    await respeitarRitmo();
    let erro = null;

    try {
      return await apiFetch(url);
    } catch (err) {
      erro = err;
    } finally {
      liberarVaga();
    }

    if (erro.status === 404 && t >= tentativas404) return null;

    // Outro 4xx não melhora insistindo.
    if (erro.status >= 400 && erro.status < 500 && erro.status !== 404 && erro.status !== 429) return FALHOU;

    if (t < tentativas) await esperar(esperaMs * t);
  }

  return FALHOU;
}

const semLeitura = (valor) => valor === null || valor === FALHOU;

function contarModosSemRegistro(ids, leituras) {
  let n = 0;
  for (const id of ids) {
    const { r1, r3, duplas } = leituras.get(id);
    n += [r1, r3, duplas].filter(semLeitura).length;
  }
  return n;
}

async function lerConta(id) {
  const [geral, r1, r3, duplas] = await Promise.all([
    lerApi(`${V1}/player/stats?brawlhalla_id=${id}`, ROTA_BASE),
    lerApi(`${V1}/player/stats?brawlhalla_id=${id}&mode=ranked_1v1`, ROTA_MODO),
    lerApi(`${V1}/player/stats?brawlhalla_id=${id}&mode=ranked_3v3`, ROTA_MODO),
    lerApi(`${V1}/player/teams?brawlhalla_id=${id}`, ROTA_MODO),
  ]);

  return { geral, r1, r3, duplas };
}

async function lerContas(ids) {
  const leituras = new Map();
  await Promise.all(ids.map(async id => leituras.set(id, await lerConta(id))));

  // Repescagem em série: 404 de carga não se resolve insistindo no meio da própria carga. Na
  // medição, foi o que levou de 166 para 200 membros com leitura boa.
  for (let passada = 1; passada <= 3; passada++) {
    const faltando = ids.filter(id => semLeitura(leituras.get(id).geral));
    if (!faltando.length) break;

    for (const id of faltando) {
      leituras.get(id).geral = await lerApi(`${V1}/player/stats?brawlhalla_id=${id}`, ROTA_BASE);
    }
  }

  const modosSemRegistroNaVarredura = contarModosSemRegistro(ids, leituras);

  // Repescagem das rotas de modo, em série e sem pressa. null aqui é ambíguo ("não joga o modo" ou 404
  // de carga) e nada na resposta separa os dois; o que escapa numa noite entra pelo `recorde` numa das
  // seguintes. Ver "Insígnias do .profile" no CLAUDE.md.
  for (const id of ids) {
    const leitura = leituras.get(id);
    if (semLeitura(leitura.geral)) continue;

    if (semLeitura(leitura.r1)) leitura.r1 = await lerApi(`${V1}/player/stats?brawlhalla_id=${id}&mode=ranked_1v1`, ROTA_MODO_CALMA);
    if (semLeitura(leitura.r3)) leitura.r3 = await lerApi(`${V1}/player/stats?brawlhalla_id=${id}&mode=ranked_3v3`, ROTA_MODO_CALMA);
    if (semLeitura(leitura.duplas)) leitura.duplas = await lerApi(`${V1}/player/teams?brawlhalla_id=${id}`, ROTA_MODO_CALMA);
  }

  // Vai para o log de cada rodada: é o que mostra, noite a noite, se as leituras de modo estão convergindo.
  return {
    leituras,
    rotasDeModo: {
      total: ids.length * 3,
      semRegistroNaVarredura: modosSemRegistroNaVarredura,
      semRegistroNoFim: contarModosSemRegistro(ids, leituras),
    },
  };
}

async function lerMembrosDaGuilda() {
  const guildId = process.env.BRAWLHALLA_CLAN_ID || brawlhallaConfig.clanId;
  const dados = await lerApi(`${V1}/guild/members?guild_id=${guildId}`, ROTA_BASE);

  if (semLeitura(dados) || !Array.isArray(dados.guild_members)) return null;
  return new Map(dados.guild_members.map(m => [String(m.brawlhalla_id), m]));
}

/** legend_id → [arma 1, arma 2]. `null` se a leitura falhou. */
async function lerArmasDasLendas() {
  const armas = new Map();

  for (let pagina = 1; ; pagina++) {
    const dados = await lerApi(`${V1}/static/legends?page=${pagina}&max_results=100`, ROTA_BASE);
    if (semLeitura(dados)) return null;

    for (const lenda of dados.legends ?? []) {
      armas.set(Number(lenda.legend_id), [lenda.weapon_one, lenda.weapon_two]);
    }

    if (pagina >= (dados.total_pages || 1)) return armas;
  }
}

// ─── Agregação por membro ─────────────────────────────────────────────────────

/* Soma todas as contas do membro (decisão do usuário). Vitórias ranked são da TEMPORADA atual,
   não da vida inteira: medido em 13/09/2026, o veterano com 63 mil vitórias tinha 24 de ranked
   1v1, e na semana seguinte à virada de 24/06 a base de 166 contas caiu pela metade. */
function somarJogo(contas, leituras, armas) {
  const levelPorLenda = new Map();
  const segundosPorArma = new Map();
  let vitorias = 0, dano = 0, segundosDeJogo = 0, levelConta = 0, v1 = 0, v2 = 0, v3 = 0;

  for (const id of contas) {
    const { geral, r1, r3, duplas } = leituras.get(id);

    // Uma conta sem leitura deixa o total desconhecido: somar só as que responderam entregaria um
    // número menor que o real com cara de certo.
    if (semLeitura(geral)) return null;

    vitorias += Number(geral.wins || 0);
    // Level é da conta: duas contas nível 100 não fazem uma de 200.
    levelConta = Math.max(levelConta, Number(geral.level || 0));

    for (const lenda of geral.legends ?? []) {
      const legendId = Number(lenda.legend_id);

      dano += Number(lenda.damage_dealt || 0);
      segundosDeJogo += Number(lenda.match_time || 0);
      // A mesma lenda em duas contas conta uma vez, com o maior level.
      levelPorLenda.set(legendId, Math.max(levelPorLenda.get(legendId) ?? 0, Number(lenda.level || 0)));

      // Por TIPO de arma: o martelo do Bödvar e o do Gnash são o mesmo martelo.
      const [arma1, arma2] = armas?.get(legendId) ?? [];
      if (arma1) segundosPorArma.set(arma1, (segundosPorArma.get(arma1) ?? 0) + Number(lenda.time_held_weapon_one || 0));
      if (arma2) segundosPorArma.set(arma2, (segundosPorArma.get(arma2) ?? 0) + Number(lenda.time_held_weapon_two || 0));
    }

    if (!semLeitura(r1)) v1 += Number(r1.wins || 0);
    if (!semLeitura(r3)) v3 += Number(r3.wins || 0);
    if (!semLeitura(duplas)) {
      for (const dupla of duplas.teams?.ranked_2v2 ?? []) v2 += Number(dupla.wins || 0);
    }
  }

  const niveis = [...levelPorLenda.values()];

  return {
    vitorias,
    dano,
    horasDeJogo: segundosDeJogo / 3600,
    horasArmaMaisUsada: armas ? Math.max(0, ...segundosPorArma.values()) / 3600 : null,
    levelConta,
    levelLendaMaximo: niveis.length ? Math.max(...niveis) : 0,
    lendasNivel25: niveis.filter(n => n >= 25).length,
    ranked: { v1, v2, v3, total: v1 + v2 + v3 },
  };
}

function semanasAdjacentes(a, b) {
  return Math.round((new Date(b.week_start) - new Date(a.week_start)) / DIA_MS) === 7;
}

/* Base 0 é ambígua como na contribuição: "nunca venceu" ou "semana não registrada". Contar contra
   ela lê o acumulado inteiro como ganho de uma semana — na medição, 385 vitórias de 1v1 em 7 dias
   que eram 157. Diferença negativa é virada de temporada e vale 0. */
function ganhoDaSemana(inicio, fim) {
  const base = Number(inicio || 0);
  if (base === 0) return null;
  return Math.max(0, Number(fim || 0) - base);
}

/** O melhor ganho de uma semana, somando as contas do membro na mesma semana. */
function recordesSemanais(contas, semanasPorConta) {
  const ganhos = new Map();
  let mediuVitorias = false;
  let mediuContribuicao = false;

  for (const id of contas) {
    const linhas = semanasPorConta.get(id) ?? [];

    for (let i = 0; i + 1 < linhas.length; i++) {
      const [antes, depois] = [linhas[i], linhas[i + 1]];
      // Buraco de 14 ou 21 dias jogaria duas ou três semanas numa só (39 pares na tabela em 09/2026).
      if (!semanasAdjacentes(antes, depois)) continue;

      const semana = ganhos.get(antes.week_start) ?? { v1: 0, v2: 0, v3: 0, pontos: 0 };

      for (const [campo, modo] of [['initial_wins_1v1', 'v1'], ['initial_wins_2v2', 'v2'], ['initial_wins_3v3', 'v3']]) {
        const ganho = ganhoDaSemana(antes[campo], depois[campo]);
        if (ganho !== null) {
          semana[modo] += ganho;
          mediuVitorias = true;
        }
      }

      if (antes.week_start >= INICIO_GUILD_POINTS_CONFIAVEIS) {
        const ganho = ganhoDaSemana(antes.guild_points, depois.guild_points);
        if (ganho !== null) {
          semana.pontos += ganho;
          mediuContribuicao = true;
        }
      }

      ganhos.set(antes.week_start, semana);
    }
  }

  const semanas = [...ganhos.values()];
  const maior = (f) => semanas.reduce((m, s) => Math.max(m, f(s)), 0);

  return {
    vitorias: mediuVitorias
      ? { v1: maior(s => s.v1), v2: maior(s => s.v2), v3: maior(s => s.v3), total: maior(s => s.v1 + s.v2 + s.v3) }
      : null,
    contribuicao: mediuContribuicao ? maior(s => s.pontos) : null,
  };
}

function voltarSemanas(referencia, semanas) {
  const [ano, mes, dia] = referencia.split('-').map(Number);
  // Componente a componente: new Date('YYYY-MM-DD') é UTC e voltaria um dia no fuso de São Paulo.
  const data = new Date(ano, mes - 1, dia - 7 * semanas);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

/* A inativação da quarta 06:10 grava a semana que fecha naquele dia. Antes dela a semana ainda não
   foi avaliada, e contar com ela daria +1 semana a todo mundo por algumas horas — o cron das
   insígnias roda 04:00, então isso aconteceria toda quarta. */
function ancoraDaInatividade(agora) {
  const referencia = getLastWednesdayReference();
  const minutos = agora.getHours() * 60 + agora.getMinutes();
  const quartaAntesDaInativacao = agora.getDay() === 3 && minutos < 6 * 60 + 10;
  return quartaAntesDaInativacao ? voltarSemanas(referencia, 1) : referencia;
}

function contarSemanasSemInativar(brawlhallaId, inatividade, semanasDeGuilda) {
  if (semanasDeGuilda === null) return null;

  const { inativoEm, ancora, inicio } = inatividade;
  let semanas = 0;

  if (inicio) {
    for (let ref = ancora; ref >= inicio; ref = voltarSemanas(ref, 1)) {
      if (inativoEm.has(`${brawlhallaId}|${ref}`)) break;
      semanas++;
    }
  }

  // Quem entrou há 3 semanas não tem 28 semanas sem ficar inativo — a medição cometeu esse erro.
  return inicio ? Math.min(semanas, Math.floor(semanasDeGuilda)) : Math.floor(semanasDeGuilda);
}

function contarPor(linhas, coluna) {
  const contagem = new Map();
  for (const linha of linhas) {
    const chave = String(linha[coluna]);
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  return contagem;
}

function agruparConjuntos(linhas, chave, valor) {
  const grupos = new Map();
  for (const linha of linhas) {
    const k = String(linha[chave]);
    if (!grupos.has(k)) grupos.set(k, new Set());
    grupos.get(k).add(String(linha[valor]));
  }
  return grupos;
}

// ─── Entrada ──────────────────────────────────────────────────────────────────

/**
 * Um contexto por membro ativo (ou só pelos `discordIds` pedidos), mais o resumo da leitura.
 * O formato do contexto é o que o catálogo lê em cada `medir`.
 */
export async function lerContextos({ discordIds = null } = {}) {
  const inicio = Date.now();
  const agora = new Date();

  const [ativos, vinculos] = await Promise.all([getActiveUsersWithBrawlhallaId(), getVinculosDeContas()]);
  const usuarios = discordIds ? ativos.filter(u => discordIds.includes(String(u.discord_id))) : ativos;

  if (!usuarios.length) return { contextos: [], leitura: { membros: 0 } };

  const altsPorMain = agruparConjuntos(vinculos, 'main_id', 'alt_id');
  const contasPorMembro = new Map(usuarios.map(u => {
    const main = String(u.brawlhalla_id);
    return [String(u.discord_id), [main, ...(altsPorMain.get(main) ?? [])]];
  }));
  const todasAsContas = [...new Set([...contasPorMembro.values()].flat())];

  // Guilda e lendas antes da rajada de contas: depois dela a v1 já está degradada, e na medição a
  // rota de lendas voltou vazia justamente por ter vindo depois.
  const [fontes, membrosDaGuilda, armas] = await Promise.all([
    getFontesInsignias({
      discordIds: discordIds ? usuarios.map(u => String(u.discord_id)) : null,
      contas: discordIds ? todasAsContas : null,
    }),
    lerMembrosDaGuilda(),
    lerArmasDasLendas(),
  ]);

  const { leituras, rotasDeModo } = await lerContas(todasAsContas);

  // Índices do banco
  const semanasPorConta = new Map();
  for (const linha of fontes.semanas) {
    const id = String(linha.brawlhalla_id);
    if (!semanasPorConta.has(id)) semanasPorConta.set(id, []);
    semanasPorConta.get(id).push(linha);
  }
  for (const linhas of semanasPorConta.values()) linhas.sort((a, b) => (a.week_start < b.week_start ? -1 : 1));

  // Total ganho, de todo tipo: `vw_tgg_coins_wallet_total` soma as entradas sem descontar gasto.
  const ganhos = new Map(fontes.carteiras.map(c => [String(c.discord_id), Number(c.balance || 0)]));

  // A coluna guarda o número antigo de quem perdeu a streak: é sequência feita de verdade, e o `recorde`
  // do catálogo segura o valor quando a pessoa recomeça do 1.
  const streak = new Map(fontes.streaks.map(s => [String(s.discord_id), Number(s.streak || 0)]));
  const conquistas = contarPor(fontes.conquistas, 'discord_id');
  const compras = contarPor(fontes.compras, 'discord_id');
  const motds = contarPor(fontes.motds, 'discord_id');
  const aniversarios = new Set(fontes.aniversarios.map(a => String(a.user_id)));
  const quizzes = new Set(fontes.quizzes.map(q => String(q.discord_id)));

  const tipoDoItem = new Map(fontes.loja.map(item => [item.id, item.type]));
  const coresDeEvento = agruparConjuntos(
    fontes.compras.filter(c => tipoDoItem.get(c.shop_id) === 'EVENT_ROLE'), 'discord_id', 'shop_id');
  const compraramVip = new Set(fontes.compras.filter(c => c.shop_id === config.vipShopId).map(c => String(c.discord_id)));

  // Warn expirado é apagado por deleteExpiredWarnings, mas só em certos momentos. Contar pela data
  // não depende de a limpeza ter rodado.
  const warnsAtivos = contarPor(
    fontes.warns.filter(w => !w.expires_at || new Date(w.expires_at) > agora), 'user_id');

  const inatividade = {
    inativoEm: new Set(fontes.inativacoes.map(i => `${i.brawlhalla_id}|${i.week_reference}`)),
    ancora: ancoraDaInatividade(agora),
    inicio: fontes.inicioInatividade,
  };

  const semanasDeMvp = fontes.mvps ? [...new Set(fontes.mvps.map(m => m.week_start))].sort().reverse() : null;
  const mvpsPorMembro = fontes.mvps ? agruparConjuntos(fontes.mvps, 'discord_id', 'week_start') : null;
  const atividadePorMembro = fontes.atividades ? new Map(fontes.atividades.map(a => [String(a.discord_id), a])) : null;
  const usaramHelp = fontes.usosDoHelp ? new Set(fontes.usosDoHelp.map(u => String(u.discord_id))) : null;

  const contextos = usuarios.map(usuario => {
    const discordId = String(usuario.discord_id);
    const main = String(usuario.brawlhalla_id);
    const contas = contasPorMembro.get(discordId);
    const naGuilda = membrosDaGuilda?.get(main) ?? null;

    const semanasDeGuilda = !membrosDaGuilda ? null
      : !naGuilda?.join_date ? 0
      : (agora.getTime() - Number(naGuilda.join_date) * 1000) / (7 * DIA_MS);

    let mvp = null;
    if (semanasDeMvp) {
      const minhas = mvpsPorMembro.get(discordId) ?? new Set();
      // A MAIOR sequência já feita, não a atual (decisão do usuário, 13/09/2026). Com 14 a 28 MVPs por
      // semana quase ninguém está numa sequência agora: pela atual, 8 dos 195 ativos pegavam a insígnia.
      let corrida = 0, maiorSequencia = 0;
      for (const semana of semanasDeMvp) {
        corrida = minhas.has(semana) ? corrida + 1 : 0;
        maiorSequencia = Math.max(maiorSequencia, corrida);
      }
      mvp = { total: minhas.size, maiorSequencia };
    }

    let atividade = null;
    if (atividadePorMembro) {
      const linha = atividadePorMembro.get(discordId);
      atividade = {
        mensagens: Number(linha?.mensagens_iniciais || 0) + Number(linha?.mensagens_contadas || 0),
        horasCall: Number(linha?.horas_call_iniciais || 0) + Number(linha?.segundos_call_contados || 0) / 3600,
      };
    }

    return {
      membro: { discordId, brawlhallaId: main, contas },
      jogo: somarJogo(contas, leituras, armas),
      // null = a rota em lote falhou; `presente: false` = leu e a conta não está na guilda.
      guilda: membrosDaGuilda
        ? {
          presente: !!naGuilda,
          semanas: semanasDeGuilda,
          pontos: naGuilda?.guild_points == null ? null : Number(naGuilda.guild_points),
        }
        : null,
      semanal: recordesSemanais(contas, semanasPorConta),
      semanasSemInativar: contarSemanasSemInativar(main, inatividade, semanasDeGuilda),
      mvp,
      atividade,
      economia: {
        coinsGanhos: ganhos.get(discordId) ?? 0,
        streakDaily: streak.get(discordId) ?? 0,
        conquistas: conquistas.get(discordId) ?? 0,
        itensComprados: compras.get(discordId) ?? 0,
        coresDeEvento: coresDeEvento.get(discordId)?.size ?? 0,
        comprouVip: compraramVip.has(discordId),
      },
      discord: {
        motds: motds.get(discordId) ?? 0,
        contasVinculadas: altsPorMain.get(main)?.size ?? 0,
        aniversario: aniversarios.has(discordId),
        quiz: quizzes.has(discordId),
        usouHelp: usaramHelp ? usaramHelp.has(discordId) : null,
        warnsAtivos: warnsAtivos.get(discordId) ?? 0,
      },
    };
  });

  const contasSemLeitura = todasAsContas.filter(id => semLeitura(leituras.get(id).geral)).length;

  return {
    contextos,
    leitura: {
      membros: contextos.length,
      contas: todasAsContas.length,
      contasSemLeitura,
      membrosSemJogo: contextos.filter(c => c.jogo === null).length,
      guildaLida: !!membrosDaGuilda,
      lendasLidas: !!armas,
      rotasDeModo,
      mvpDisponivel: !!fontes.mvps,
      atividadeDisponivel: !!fontes.atividades,
      helpDisponivel: !!fontes.usosDoHelp,
      leituraMs: Date.now() - inicio,
    },
  };
}
