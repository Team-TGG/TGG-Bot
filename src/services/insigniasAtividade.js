// Contador de mensagens e tempo de call do servidor, para as insígnias Tagarela e Voz Ativa.
//
// O total de cada membro é a exportação do Apolo (`player_activity.*_iniciais`, de 13/09/2026) mais
// o que este contador soma depois dela (`*_contadas`). Mesmo desenho do ticketActivity.js: acumula em
// memória e grava em bloco a cada ciclo — perder um ciclo se o processo cair é o preço de não ir ao
// banco a cada mensagem de ~200 pessoas.
//
// Só roda em produção (decisão do usuário, 02/09/2026): dois processos com o mesmo token contam cada
// mensagem duas vezes, e aqui a contagem é permanente.
import { getAllUsers, formatDateTime } from '../db.js';
import { getAtividadeContada, gravarAtividadeContada, registrarLancamento, registrarMarcacoesTopson } from '../insignias.js';
import { discord as discordConfig, insignias as insigniasConfig, STAFF_ROLE_IDS } from '../../config/index.js';

const INTERVALO_MS = 5 * 60 * 1000;
const CHAVE_TREGUA = 'sem_marcar_topson';

// Só a menção escrita no texto: `message.mentions.users` traz também o autor da mensagem respondida,
// e resposta a mensagem do Topson não é marcação (decisão do usuário). Marcar o cargo @Leader também
// quebra a Trégua: chega no Topson do mesmo jeito (decisão do usuário, 14/09/2026).
const MENCAO_TOPSON = new RegExp(`<@!?${insigniasConfig.topsonId}>|<@&${STAFF_ROLE_IDS.leader}>`);

const mensagensPendentes = new Map();  // discordId -> quantidade
const segundosPendentes = new Map();   // discordId -> segundos
const emCall = new Map();              // discordId -> instante da última âncora (ms)
const marcacoesPendentes = new Map();  // `discordId|dia` -> { discord_id, dia }

let membrosAtivos = new Set();
let timer = null;
let gravando = false;
let treguaLancada = false;

const diaDe = (instante) => formatDateTime(new Date(instante)).slice(0, 10);

function somar(mapa, chave, valor) {
  if (valor <= 0) return;
  mapa.set(chave, (mapa.get(chave) ?? 0) + valor);
}

// Só membro com cadastro ativo conta (decisão do usuário, 02/09/2026). Leitura que falha mantém a
// lista anterior: esvaziá-la pararia a contagem de todo mundo até o ciclo seguinte.
async function recarregarMembros() {
  try {
    membrosAtivos = new Set((await getAllUsers()).map(u => String(u.discord_id)));
  } catch (err) {
    console.warn(`[INSIGNIAS ATIVIDADE] failed to reload active members: ${err.message}`);
  }
}

export function registrarMensagemParaInsignias(message) {
  if (!timer) return;
  if (!message.guild || message.guild.id !== discordConfig.guildId) return;
  if (message.author.bot) return;

  // Antes do filtro de ativo: quem vira membro depois precisa chegar com a marcação no histórico.
  registrarMarcacaoTopson(message);

  if (!membrosAtivos.has(message.author.id)) return;

  somar(mensagensPendentes, message.author.id, 1);
}

function registrarMarcacaoTopson(message) {
  if (message.author.id === insigniasConfig.topsonId) return;
  if (!MENCAO_TOPSON.test(message.content)) return;

  const dia = diaDe(message.createdTimestamp);
  marcacoesPendentes.set(`${message.author.id}|${dia}`, { discord_id: message.author.id, dia });
}

async function gravarMarcacoesTopson() {
  if (!marcacoesPendentes.size) return;

  const linhas = [...marcacoesPendentes.values()];
  marcacoesPendentes.clear();

  try {
    await registrarMarcacoesTopson(linhas);
    console.log(`[INSIGNIAS ATIVIDADE] Topson mentions: ${linhas.length} row(s)`);
  } catch (err) {
    // O insert ignora repetidos, então devolver à fila não duplica; perder a marcação daria a Trégua a quem marcou.
    for (const linha of linhas) marcacoesPendentes.set(`${linha.discord_id}|${linha.dia}`, linha);
    console.error(`[INSIGNIAS ATIVIDADE] Topson mentions flush failed: ${err.message}`);
  }
}

// O primeiro dia gravado é o começo da Trégua. Tenta a cada ciclo até conseguir, para uma falha no boot
// não empurrar o lançamento para o próximo restart.
async function lancarTregua() {
  if (treguaLancada) return;

  try {
    await registrarLancamento(CHAVE_TREGUA, diaDe(Date.now()));
    treguaLancada = true;
  } catch (err) {
    console.warn(`[INSIGNIAS ATIVIDADE] failed to register Trégua launch: ${err.message}`);
  }
}

// Canal de AFK não conta, como no ticketActivity: é para onde o Discord manda quem parou de interagir.
function contaComoCall(state) {
  if (!state.channelId) return false;
  return state.channelId !== state.guild.afkChannelId;
}

/** Credita o tempo desde a última âncora e reancora no instante dado, sem tirar da call. */
function creditar(discordId, agora) {
  const desde = emCall.get(discordId);
  if (desde === undefined) return;

  somar(segundosPendentes, discordId, Math.floor((agora - desde) / 1000));
  emCall.set(discordId, agora);
}

export function registrarVozParaInsignias(oldState, newState) {
  if (!timer) return;
  if ((newState.guild ?? oldState.guild)?.id !== discordConfig.guildId) return;

  const discordId = newState.id ?? oldState.id;
  if (!membrosAtivos.has(discordId)) return;

  const antes = contaComoCall(oldState);
  const depois = contaComoCall(newState);
  const agora = Date.now();

  if (!antes && depois) {
    emCall.set(discordId, agora);
  } else if (antes && !depois) {
    creditar(discordId, agora);
    emCall.delete(discordId);
  }
  // Trocar de canal (antes && depois) não mexe em nada: a âncora continua valendo.
}

async function gravarCiclo() {
  // Ciclo lento não pode encostar no seguinte: os dois leriam o mesmo total e um somaria por cima do outro.
  if (gravando) return;
  gravando = true;

  try {
    await recarregarMembros();

    const agora = Date.now();

    // Reancora quem está em call, para uma call de horas entrar aos poucos e sobreviver a restart.
    // Quem perdeu o cadastro ativo com a call aberta é creditado até aqui e solto.
    for (const discordId of [...emCall.keys()]) {
      creditar(discordId, agora);
      if (!membrosAtivos.has(discordId)) emCall.delete(discordId);
    }

    const mensagens = new Map(mensagensPendentes);
    const segundos = new Map(segundosPendentes);
    mensagensPendentes.clear();
    segundosPendentes.clear();

    const ids = [...new Set([...mensagens.keys(), ...segundos.keys()])];
    if (!ids.length) return;

    try {
      const jaContado = new Map((await getAtividadeContada(ids)).map(l => [String(l.discord_id), l]));

      await gravarAtividadeContada(ids.map(discordId => ({
        discord_id: discordId,
        mensagens_contadas: Number(jaContado.get(discordId)?.mensagens_contadas || 0) + (mensagens.get(discordId) ?? 0),
        segundos_call_contados: Number(jaContado.get(discordId)?.segundos_call_contados || 0) + (segundos.get(discordId) ?? 0),
        atualizado_em: new Date(agora).toISOString(),
      })));

      console.log(`[INSIGNIAS ATIVIDADE] flush: ${ids.length} member(s)`);
    } catch (err) {
      // A gravação é uma requisição só, então falhou inteira: devolver o ciclo à fila não conta nada em dobro.
      for (const discordId of ids) {
        somar(mensagensPendentes, discordId, mensagens.get(discordId) ?? 0);
        somar(segundosPendentes, discordId, segundos.get(discordId) ?? 0);
      }
      console.error(`[INSIGNIAS ATIVIDADE] flush failed: ${err.message}`);
    }
  } finally {
    gravando = false;
  }
}

/**
 * Liga o contador. Quem já estava em call quando o bot subiu não gera `voiceStateUpdate`, então é
 * semeado aqui — sem isso, o tempo da call em andamento só entraria depois de a pessoa sair e voltar.
 */
export async function iniciarContadorDeAtividade(client) {
  if (timer) return;

  await recarregarMembros();

  const agora = Date.now();
  const guild = client.guilds.cache.get(discordConfig.guildId);
  for (const state of guild?.voiceStates.cache.values() ?? []) {
    if (membrosAtivos.has(state.id) && contaComoCall(state)) emCall.set(state.id, agora);
  }

  await lancarTregua();

  timer = setInterval(() => {
    gravarCiclo().catch(err => console.error('[INSIGNIAS ATIVIDADE] cycle failed:', err));
    gravarMarcacoesTopson();
    lancarTregua();
  }, INTERVALO_MS);

  console.log(`[INSIGNIAS ATIVIDADE] counter active - ${INTERVALO_MS / 60000} min cycle, `
    + `${membrosAtivos.size} active member(s), ${emCall.size} in call`);
}
