import { EmbedBuilder } from 'discord.js';
import { deteccaoDeSeason as config } from '../../config/index.js';
import { getActiveUsersWithBrawlhallaId, getBasesDeJogos1v1, getCurrentSeason, getMissionWeekStart, registrarSeason } from '../db.js';
import { fetchPlayerStatsNoResolve } from '../brawlhalla.js';
import { extractModeData } from '../tggCoins.js';

/**
 * Detecta a virada de season e registra a nova em `season`, que o `.games` usa como ponto de
 * partida. Não há endpoint que diga quando a season vira: o sinal é o contador de jogos ranqueados
 * voltar para trás. Dentro de uma season ele só sobe; na virada, zera.
 *
 * A base de comparação é o maior `initial_games_1v1` das duas últimas semanas em
 * `player_weekly_info`, sem tabela nova. Duas porque a season vira na quarta e a base da semana
 * nasce na quinta: no dia seguinte à virada, a base desta semana já é da season nova e só a da
 * semana anterior ainda guarda o número antigo.
 *
 * Erro de leitura não gera falso positivo: quando a API falha, `fetchPlayerStatsNoResolve` devolve
 * o cache antigo, que nunca é menor que o valor real. O pior caso é a detecção atrasar um dia.
 */
export async function verificarResetDeSeason(client, { gravar = true } = {}) {
  const atual = await getCurrentSeason();
  const diasDesdeAtual = (Date.now() - dataLocal(atual.started_at).getTime()) / 86_400_000;

  if (diasDesdeAtual < config.diasMinimosEntreSeasons) {
    console.log(`[SEASON] Season ${atual.season} começou há ${Math.floor(diasDesdeAtual)} dia(s); nada a verificar.`);
    return { status: 'recente', season: atual.season };
  }

  const semanaAtual = getMissionWeekStart();
  const semanaAnterior = menosSeteDias(semanaAtual);

  const base = new Map();
  for (const linha of await getBasesDeJogos1v1([semanaAtual, semanaAnterior])) {
    const id = String(linha.brawlhalla_id);
    base.set(id, Math.max(base.get(id) ?? 0, Number(linha.initial_games_1v1) || 0));
  }

  const candidatos = embaralhar(
    (await getActiveUsersWithBrawlhallaId())
      .map(u => ({ id: String(u.brawlhalla_id), nome: u.username, base: base.get(String(u.brawlhalla_id)) ?? 0 }))
      .filter(c => c.base >= config.minimoDeJogosNaBase)
  );

  const leituras = [];
  let tentativas = 0;

  for (const candidato of candidatos) {
    if (leituras.length >= config.amostra || tentativas >= config.maxTentativas) break;
    tentativas++;

    try {
      const stats = await fetchPlayerStatsNoResolve(candidato.id);
      const agora = extractModeData(stats, '1v1').games;
      leituras.push({ ...candidato, agora, caiu: agora < candidato.base });
    } catch (err) {
      console.warn(`[SEASON] Leitura falhou para ${candidato.id}: ${err.message}`);
    }
  }

  const resumo = leituras.map(l => `${l.nome} ${l.base}→${l.agora}`).join(', ');

  if (leituras.length < config.amostra) {
    console.warn(`[SEASON] Só ${leituras.length} de ${config.amostra} leituras em ${tentativas} tentativas; fica para amanhã. ${resumo}`);
    return { status: 'sem-amostra', leituras };
  }

  const cairam = leituras.filter(l => l.caiu).length;

  if (cairam < leituras.length) {
    // Uma ou outra queda isolada é leitura estranha da API, não virada: a regra pede todas.
    console.log(`[SEASON] Sem virada (${cairam}/${leituras.length} caíram): ${resumo}`);
    return { status: 'sem-reset', leituras };
  }

  const numero = atual.season + 1;
  const inicio = ultimaQuarta();
  console.log(`[SEASON] Virada detectada (${cairam}/${leituras.length} caíram): season ${numero} desde ${inicio}. ${resumo}`);

  if (!gravar) return { status: 'reset', season: numero, inicio, leituras };

  const criada = await registrarSeason(numero, inicio);
  if (!criada) {
    console.log(`[SEASON] Já havia season começando em ${inicio} ou depois; nada gravado.`);
    return { status: 'ja-registrada', leituras };
  }

  await avisarStaff(client, numero, inicio, leituras).catch(err => console.warn('[SEASON] Aviso não enviado:', err.message));
  return { status: 'reset', season: numero, inicio, leituras };
}

async function avisarStaff(client, numero, inicio, leituras) {
  if (!config.channelId) return;
  const canal = await client.channels.fetch(config.channelId);

  const [ano, mes, dia] = inicio.split('-');
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🏁 Season ${numero} detectada`)
    .setDescription(
      `O contador de jogos ranqueados voltou para trás nas ${leituras.length} contas conferidas, ` +
      `então registrei a **season ${numero}** começando na **quarta ${dia}/${mes}/${ano}**.\n` +
      'É a partir dela que o botão "Season" do `.games` conta. Se a data estiver errada, corrija na tabela `season` do Supabase.'
    )
    .addFields({
      name: 'Contas conferidas (jogos 1v1: base → agora)',
      value: leituras.map(l => `• ${l.nome}: ${l.base} → ${l.agora}`).join('\n'),
    });

  await canal.send({ embeds: [embed] });
}

// `started_at` é a quarta da virada: o `.games` soma um dia e usa a base de quinta 06:00, que é a
// primeira já da season nova. Seasons viram na quarta (as quatro registradas até 28/10/2026).
function ultimaQuarta() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() - 3 + 7) % 7));
  return formatar(d);
}

function menosSeteDias(weekStart) {
  const [data, hora] = weekStart.split(' ');
  const d = dataLocal(data);
  d.setDate(d.getDate() - 7);
  return `${formatar(d)} ${hora}`;
}

// Componente a componente: `new Date('YYYY-MM-DD')` é UTC e voltaria um dia no fuso de São Paulo.
function dataLocal(ymd) {
  const [ano, mes, dia] = String(ymd).slice(0, 10).split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

function formatar(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function embaralhar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
