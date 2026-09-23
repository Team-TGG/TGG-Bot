// Quem fica na faixa baixa de contribuição semana após semana — quarta 06:20.
//
// É o outro lado da régua de inatividade. A inativação pega quem ficou **abaixo** de 1.000 numa
// semana; aqui é quem passa raspando toda semana: entre `minimo` e `maximo` por `semanas`
// seguidas. Sozinha, cada uma dessas semanas é um número que ninguém questiona — juntas, são o
// padrão que a staff precisa ver antes de virar um caso de remoção.
//
// O alerta não pune nada: ele marca `@Officer` para **conversar** com a pessoa, e por isso vem
// com jogos e contribuição de cada semana. Um membro que jogou muito e pontuou pouco é conversa
// diferente de um que mal apareceu, e sem os dois números o officer teria que rodar `.scan` em
// cada um antes de saber qual dos dois está olhando.
import { EmbedBuilder } from 'discord.js';
import { getMissionWeekStart, formatDateTime, getContasVinculadasEmLote } from '../db.js';
import { getWeeklyInfoRows } from '../tggCoins.js';
import { fetchPlayerStatsNoResolve } from '../brawlhalla.js';
import { calcularContribuicaoSemanal } from './contribuicaoSemanal.js';
import { contribuicaoNaFaixa as config } from '../../config/index.js';

/**
 * As `semanas` semanas analisadas, da mais recente para a mais antiga.
 *
 * A primeira é a que **acabou de fechar**: na quarta 06:20 os guild points já pararam às 06:00 e
 * `player_weekly_info` só vira na quinta, então é a única janela em que ela pode ser medida — a
 * mesma de `semanaFechada()` na inativação. As outras saem inteiras da tabela.
 */
export function semanasAnalisadas(weekStart = getMissionWeekStart(), quantas = config.semanas) {
  const inicio = new Date(String(weekStart).replace(' ', 'T'));

  return Array.from({ length: quantas }, (_, i) => {
    const d = new Date(inicio);
    d.setDate(d.getDate() - 7 * i);
    return chaveDaSemana(formatDateTime(d));
  });
}

/**
 * Forma canônica do `week_start` para usar como chave em memória.
 *
 * O Postgres devolve `2026-09-03T06:00:00` e `getMissionWeekStart()` monta `2026-09-03 06:00:00`.
 * A consulta casa os dois sem reclamar — quem não casa é o `Map`, e o sintoma é um alerta que
 * nunca encontra ninguém, sem erro nenhum no log. As outras rotinas escaparam disso porque
 * filtram a semana no SQL e indexam só por conta.
 */
function chaveDaSemana(weekStart) {
  return String(weekStart).replace('T', ' ').slice(0, 19);
}

/** `null` quando qualquer um dos dois lados não foi registrado — 0 e "não sei" não se misturam. */
function ganhoEntre(baseDaSeguinte, baseDaSemana) {
  if (baseDaSeguinte == null || baseDaSemana == null) return null;
  if (Number(baseDaSeguinte) === 0 || Number(baseDaSemana) === 0) return null;

  return Math.max(0, Number(baseDaSeguinte) - Number(baseDaSemana));
}

/**
 * Jogos de uma semana fechada: a foto do fim menos a do começo, na **mesma linha**.
 *
 * `final_games` é gravado pelo cron do site no fechamento da semana, e `> 0` é o que diz que ele
 * chegou a ser gravado — mesma guarda que o `.scan` usa. Semana sem fechamento devolve `null`, e
 * o embed mostra "—": inventar 0 diria que a pessoa não jogou.
 *
 * `games` (a foto do começo) em 0 é a mesma armadilha da base zerada dos guild points: quem está
 * na guilda há semanas tem milhares de partidas na conta, então 0 ali quer dizer base não
 * registrada, e subtrair dele lê a carreira inteira como a semana — medido em 23/09/2026, um
 * membro saiu com 19.250 jogos numa semana.
 */
function jogosDaSemanaFechada(linha) {
  if (!linha || !(Number(linha.final_games) > 0)) return null;
  if (!(Number(linha.games) > 0)) return null;

  return Math.max(0, Number(linha.final_games) - Number(linha.games));
}

/**
 * Jogos de uma semana fechada **somando todas as contas vinculadas** do membro.
 *
 * Contribuição é medida só na conta da guilda de propósito (é ela que pontua), mas jogo é jogo em
 * qualquer conta: quem tem `.corrigir-id` joga numa conta e pontua em outra, e medir só a da
 * guilda mostrava alguém "sem jogar" enquanto jogava a semana inteira. Decisão do usuário
 * (23/09/2026).
 *
 * Conta sem base utilizável naquela semana **não entra na soma** em vez de contar 0 — alt
 * vinculada depois simplesmente não tem linha, e somar 0 por ela seria o mesmo número. Se nenhuma
 * conta puder ser medida, a semana toda vira `null`.
 */
function jogosDaSemanaPorContas(contas, porConta, weekStart) {
  let total = null;

  for (const conta of contas) {
    const jogos = jogosDaSemanaFechada(porConta.get(conta)?.get(weekStart));
    if (jogos === null) continue;

    total = (total ?? 0) + jogos;
  }

  return total;
}

/**
 * Função pura: recebe o que já foi lido e devolve quem está na faixa em **todas** as semanas.
 *
 * `contribuicoesDaSemanaCorrente` é o resultado de `calcularContribuicaoSemanal()` — a mesma
 * função que decide o MVP e a inativação. Ler de outra fonte faria este alerta discordar da
 * quarta-feira, que é o erro que [contribuicaoSemanal.js](./contribuicaoSemanal.js) existe para
 * evitar.
 *
 * Semana que não pôde ser medida **desclassifica** o membro em vez de contar como 0: acusar
 * alguém de um padrão de três semanas com uma delas em branco é acusar por falta de dado. Quem
 * entrou na guilda há menos de `semanas` semanas cai aqui por consequência, que é o certo — ele
 * não tem o padrão, tem pouco tempo de casa.
 */
export function selecionarNaFaixa({ contribuicoesDaSemanaCorrente, linhasPorConta, semanas }) {
  const naFaixa = [];

  for (const membro of contribuicoesDaSemanaCorrente) {
    if (membro.motivo) continue;

    const porSemana = linhasPorConta.get(membro.brawlhallaId) ?? new Map();

    const detalhe = semanas.map((weekStart, i) => {
      const linha = porSemana.get(weekStart);

      // A semana corrente (i = 0) é a única cujo ganho não está na tabela: a base da semana
      // seguinte ainda não existe, então ele vem da leitura viva. As demais são base da
      // seguinte menos a própria.
      const contribuicao = i === 0
        ? membro.contribuicao
        : ganhoEntre(porSemana.get(semanas[i - 1])?.guild_points, linha?.guild_points);

      // Jogos ficam para depois do filtro, em `medirJogos`: eles somam as contas vinculadas, e
      // levantar as contas de 197 membros para usar as de 17 seria trabalho jogado fora.
      return { weekStart, contribuicao, jogos: null };
    });

    const todasNaFaixa = detalhe.every(s =>
      s.contribuicao != null && s.contribuicao >= config.minimo && s.contribuicao <= config.maximo
    );

    if (!todasNaFaixa) continue;

    naFaixa.push({
      discordId: membro.discordId,
      brawlhallaId: membro.brawlhallaId,
      nome: membro.nome,
      role: membro.role,
      contas: [membro.brawlhallaId],
      semanas: detalhe,
    });
  }

  // Menor contribuição total primeiro: quem está mais perto da fronteira é com quem a conversa
  // é mais urgente.
  return naFaixa.sort((a, b) =>
    a.semanas.reduce((s, x) => s + x.contribuicao, 0) - b.semanas.reduce((s, x) => s + x.contribuicao, 0)
  );
}

/**
 * Preenche os jogos das três semanas dos membros **já filtrados**, somando todas as contas
 * vinculadas de cada um (`alt_ids` do `.corrigir-id` e `tgg_coins_achievements_alts` do
 * `.add-account`).
 *
 * Feito depois do filtro de propósito: as contas e as leituras de API de 197 membros seriam
 * trabalho jogado fora para usar as de uma dúzia — e a rota por conta falha calado em rajada
 * (ver as pegadinhas em docs/brawlhalla-api.md), então quanto menos chamadas, melhor.
 *
 * `NoResolve` porque a base de `player_weekly_info` é daquela conta exata: resolver para a main
 * compararia contas diferentes e daria jogos negativos.
 *
 * **A semana corrente é tudo ou nada.** Se qualquer conta com base utilizável não puder ser lida,
 * a semana inteira vira `null`: somar só as que responderam mostraria menos jogos do que a pessoa
 * fez, e "jogou pouco" é exatamente a leitura que o officer não pode tirar errada. As semanas
 * fechadas saem da tabela e não passam por isso.
 */
export async function medirJogos(membros, semanas) {
  if (!membros.length) return membros;

  const contasPorMembro = await getContasVinculadasEmLote(membros.map(m => m.brawlhallaId));

  for (const membro of membros) {
    membro.contas = contasPorMembro.get(membro.brawlhallaId) ?? [membro.brawlhallaId];
  }

  const todasAsContas = [...new Set(membros.flatMap(m => m.contas))];
  const rows = await getWeeklyInfoRows(todasAsContas, semanas);

  const porConta = new Map();
  for (const row of rows) {
    const id = String(row.brawlhalla_id);
    if (!porConta.has(id)) porConta.set(id, new Map());
    porConta.get(id).set(chaveDaSemana(row.week_start), row);
  }

  // Uma leitura por conta, reaproveitada pelos membros que a compartilhem — nenhum caso hoje,
  // mas o cache do fetch já resolveria de graça e o Map deixa a intenção explícita.
  const statsPorConta = new Map();
  let falharam = 0;

  for (const membro of membros) {
    for (const [i, semana] of semanas.entries()) {
      if (i > 0) {
        membro.semanas[i].jogos = jogosDaSemanaPorContas(membro.contas, porConta, semana);
        continue;
      }

      // Semana corrente: base na tabela, valor atual na API.
      let total = null;

      for (const conta of membro.contas) {
        const base = porConta.get(conta)?.get(semana)?.games;

        // Base 0 é base não registrada, não "nunca jogou" — ver `jogosDaSemanaFechada`.
        if (!(Number(base) > 0)) continue;

        if (!statsPorConta.has(conta)) {
          statsPorConta.set(conta, await fetchPlayerStatsNoResolve(conta).catch(() => null));
        }

        const atual = statsPorConta.get(conta)?.games;

        if (atual == null) {
          total = null;
          falharam++;
          break;
        }

        total = (total ?? 0) + Math.max(0, Number(atual) - Number(base));
      }

      membro.semanas[0].jogos = total;
    }
  }

  // Uma linha por rodada, e não por conta: com a API fora do ar a coluna inteira sai em "—", e
  // sem isto o log não diz se o embed veio vazio por ninguém ter jogado ou por ninguém ter sido
  // lido. A rodada não é abortada de propósito — contribuição é o número que importa, e ela já
  // está medida; o alerta com jogos faltando ainda serve.
  if (falharam > 0) {
    console.warn(`[FAIXA] jogos da semana corrente não lidos em ${falharam}/${membros.length} membro(s) - API indisponível`);
  }

  return membros;
}

/** Lê tudo e devolve quem está na faixa, com jogos e contribuição de cada semana. */
export async function calcularQuemEstaNaFaixa() {
  const { weekStart, linhas } = await calcularContribuicaoSemanal();
  const semanas = semanasAnalisadas(weekStart);

  const rows = await getWeeklyInfoRows(linhas.map(l => l.brawlhallaId), semanas);

  const linhasPorConta = new Map();
  for (const row of rows) {
    const id = String(row.brawlhalla_id);
    if (!linhasPorConta.has(id)) linhasPorConta.set(id, new Map());
    linhasPorConta.get(id).set(chaveDaSemana(row.week_start), row);
  }

  const naFaixa = selecionarNaFaixa({
    contribuicoesDaSemanaCorrente: linhas,
    linhasPorConta,
    semanas,
  });

  // Só os que vão para o embed pagam a chamada de API. O resto sai na contagem do rodapé.
  await medirJogos(naFaixa.slice(0, config.maxLinhas), semanas);

  return { weekStart, semanas, naFaixa };
}

function dataCurta(weekStart) {
  const [ano, mes, dia] = String(weekStart).slice(0, 10).split('-');
  return `${dia}/${mes}`;
}

const numero = n => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));

/**
 * Payload do alerta. Exportado para dar pra conferir sem enviar nada, como os `montarAnuncio` das
 * outras rotinas semanais. `comPing: false` é por onde uma prévia entra sem chamar a staff inteira
 * para um teste — foi assim que o embed foi conferido antes do primeiro cron.
 */
export function montarAlerta({ semanas, naFaixa, comPing = true }) {
  const periodo = `${dataCurta(semanas[semanas.length - 1])} a ${dataCurta(semanas[0])}`;

  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle('⚠️ Contribuição na faixa baixa')
    .setTimestamp();

  if (!naFaixa.length) {
    embed
      .setColor(0x57f287)
      .setTitle('✅ Ninguém na faixa baixa')
      .setDescription(
        `Nenhum membro ficou entre **${numero(config.minimo)}** e **${numero(config.maximo)}** de ` +
        `contribuição nas ${config.semanas} semanas de ${periodo}.`
      );

    return { embeds: [embed], allowedMentions: { parse: [] } };
  }

  const intro =
    `**${naFaixa.length}** membro(s) ficaram entre **${numero(config.minimo)}** e ` +
    `**${numero(config.maximo)}** de contribuição nas ${config.semanas} semanas seguidas de ` +
    `${periodo}. Eles passam do mínimo toda semana, então a inativação nunca os pega.\n\n` +
    `Vale chamar cada um para conversar — o ticket é aberto em <#${config.suporteChannelId}>.`;

  embed.setDescription(intro);

  const mostrados = naFaixa.slice(0, config.maxLinhas);

  // A lista é quebrada em vários embeds na mesma mensagem, e não cortada: um embed para em 25
  // campos e a mensagem inteira em 6.000 caracteres, então lista longa que cabe num embed só é
  // coincidência, não regra. Quebrar é o que deixa "ver todos" continuar valendo quando a faixa
  // crescer.
  const embeds = [embed];

  for (const [i, membro] of mostrados.entries()) {
    const posicaoNoEmbed = i % config.maxPorEmbed;

    if (i > 0 && posicaoNoEmbed === 0) {
      embeds.push(new EmbedBuilder().setColor(0xfaa61a));
    }

    // Campo inline sozinho empacota **três** por linha, não duas. O separador de largura zero
    // fecha a linha depois de cada par e é o único jeito de fixar duas — o Discord não tem
    // controle de colunas. Vai entre os pares, nunca no fim, senão sobra uma faixa vazia embaixo.
    if (posicaoNoEmbed > 0 && posicaoNoEmbed % 2 === 0) {
      embeds[embeds.length - 1].addFields({ name: '​', value: '​', inline: false });
    }

    // Semana por linha, da mais antiga para a mais nova: a conversa é sobre uma tendência, e
    // tendência se lê no sentido do tempo.
    const linhas = [...membro.semanas].reverse().map(s =>
      `🗓️ \`${dataCurta(s.weekStart)}\` **${numero(s.contribuicao)}** pts · ${numero(s.jogos)} ` +
      (s.jogos === 1 ? 'jogo' : 'jogos')
    );

    embeds[embeds.length - 1].addFields({
      // O nome vem da API do jogo e não tem teto: o Discord recusa o embed inteiro acima de 256.
      name: `👥 ${String(membro.nome).slice(0, 200)}`,
      // A menção primeiro: é por ela que o officer chega na pessoa, e o apelido do jogo sozinho
      // não dá para clicar.
      value: `<@${membro.discordId}>\n${linhas.join('\n')}`.slice(0, 1024),
      inline: true,
    });
  }

  const sobraram = naFaixa.length - mostrados.length;

  // Rodapé no último embed: é onde a lista termina, e é lá que a ressalva sobre o "—" adianta.
  embeds[embeds.length - 1].setFooter({
    text: sobraram > 0
      ? `… e mais ${sobraram} fora da lista · jogos somam todas as contas vinculadas · "—" = não medido`
      : 'Jogos somam todas as contas vinculadas · "—" = leitura falhou ou semana sem fechamento',
  });

  const cargo = comPing ? config.officerRoleId : null;

  return {
    ...(cargo ? { content: `<@&${cargo}>` } : {}),
    embeds,
    allowedMentions: cargo ? { roles: [cargo] } : { parse: [] },
  };
}

/**
 * Roda o alerta e posta no log-guilda. Chamado pelo cron da quarta 06:20.
 *
 * Silêncio quando não há ninguém: ao contrário do resumo da inativação, aqui "ninguém na faixa" é
 * a semana normal, e um embed verde toda quarta treinaria a staff a não abrir o canal. Quem monta
 * a lista vazia é `montarAlerta`, para quando alguém **perguntar** — não para o cron.
 */
export async function alertarContribuicaoNaFaixa(client) {
  if (!config.channelId) {
    console.warn('[FAIXA] channelId não configurado - alerta pulado');
    return { naFaixa: [], anunciado: false };
  }

  const { semanas, naFaixa } = await calcularQuemEstaNaFaixa();

  if (!naFaixa.length) {
    console.log('[FAIXA] ninguém na faixa baixa nesta semana');
    return { naFaixa, anunciado: false };
  }

  const canal = await client.channels.fetch(config.channelId).catch(() => null);

  if (!canal) {
    console.warn(`[FAIXA] canal ${config.channelId} não encontrado - alerta pulado`);
    return { naFaixa, anunciado: false };
  }

  await canal.send(montarAlerta({ semanas, naFaixa }));

  console.log(`[FAIXA] ${naFaixa.length} membro(s) na faixa baixa por ${config.semanas} semanas`);
  return { naFaixa, anunciado: true };
}
