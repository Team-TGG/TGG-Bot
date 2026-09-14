// As insígnias do .profile: nome, cortes e o que cada uma mede. Mudar um corte, um nome ou uma
// descrição é editar só aqui — o motor e o cron não precisam saber.
//
// `chave` é o que fica gravado no banco e NUNCA muda; `nome` é o que o membro vê e pode mudar à
// vontade. Remover uma insígnia daqui não apaga as linhas gravadas dela.
//
// `descricao` é a linha que o membro lê logo abaixo do nome em "todas as insígnias": diz exatamente o que
// é contado (modo, período, se soma as contas). Nome não se explica sozinho: "Constante" de quê?
//
// `medir(contexto)` devolve número, booleano ou null. null é "não sei": o tier gravado fica como
// estava. O formato do contexto está em lerContextos (insigniasLeitura.js).
//
// `acumulacao`:
//   'atual'   — vale o que foi medido, e o tier pode cair (streak quebrada, warn, inativação).
//   'recorde' — nunca desce. Obrigatório no que vem das rotas por conta da v1: elas falham calado
//               (404 de carga lido como "sem registro") e as vitórias ranked zeram a cada
//               temporada. Nessas, o valor gravado é o maior já medido.
//
// Os cortes saíram da medição de 13/09/2026 sobre os 200 membros (relatório "Insígnias TGG") e das
// decisões do usuário em 08/09/2026.

export const CATEGORIAS = {
  JOGO: 'Jogo',
  GUILDA: 'Guilda',
  DISCORD: 'Discord',
  ECONOMIA: 'Economia',
};

const { JOGO, GUILDA, DISCORD, ECONOMIA } = CATEGORIAS;

export const INSIGNIAS = [
  // ─── Jogo: acumulado (quem você é) ──────────────────────────────────────────
  {
    chave: 'vitorias_total', nome: 'Conquistador', categoria: JOGO, unidade: 'vitórias',
    descricao: 'Vitórias em qualquer modo, desde sempre, somando todas as suas contas',
    tiers: [5000, 11000, 21000, 36000, 48000], acumulacao: 'recorde',
    medir: (c) => c.jogo?.vitorias,
  },
  {
    chave: 'vitorias_ranked', nome: 'Competidor', categoria: JOGO, unidade: 'vitórias',
    descricao: 'Vitórias ranqueadas de 1v1, 2v2 e 3v3 somadas, na sua melhor temporada',
    tiers: [170, 350, 550, 750, 950], acumulacao: 'recorde',
    medir: (c) => c.jogo?.ranked.total,
  },
  {
    chave: 'vitorias_ranked_1v1', nome: 'Duelista', categoria: JOGO, unidade: 'vitórias',
    descricao: 'Vitórias ranqueadas de 1v1 na sua melhor temporada',
    tiers: [35, 90, 160, 300, 450], acumulacao: 'recorde',
    medir: (c) => c.jogo?.ranked.v1,
  },
  {
    // A v1 só devolve dupla com 10+ jogos, então quem joga 2v2 avulso aparece com menos
    // vitórias do que tem. Aceito pelo usuário em 03/09/2026.
    chave: 'vitorias_ranked_2v2', nome: 'Parceiro', categoria: JOGO, unidade: 'vitórias',
    descricao: 'Vitórias ranqueadas de 2v2 na sua melhor temporada (só duplas com 10+ partidas)',
    tiers: [70, 200, 400, 550, 750], acumulacao: 'recorde',
    medir: (c) => c.jogo?.ranked.v2,
  },
  {
    chave: 'vitorias_ranked_3v3', nome: 'Tático', categoria: JOGO, unidade: 'vitórias',
    descricao: 'Vitórias ranqueadas de 3v3 na sua melhor temporada',
    tiers: [15, 25, 50, 130, 200], acumulacao: 'recorde',
    medir: (c) => c.jogo?.ranked.v3,
  },

  // ─── Jogo: recorde de uma semana (o que você fez) ───────────────────────────
  {
    chave: 'recorde_semana_ranked', nome: 'Arrancada', categoria: JOGO, unidade: 'vitórias numa semana',
    descricao: 'Vitórias ranqueadas de 1v1, 2v2 e 3v3 somadas, na sua melhor semana',
    tiers: [60, 90, 130, 190, 300], acumulacao: 'atual',
    medir: (c) => c.semanal.vitorias?.total ?? null,
  },
  {
    chave: 'recorde_semana_1v1', nome: 'Rajada', categoria: JOGO, unidade: 'vitórias numa semana',
    descricao: 'Vitórias ranqueadas de 1v1 na sua melhor semana',
    tiers: [10, 25, 45, 70, 110], acumulacao: 'atual',
    medir: (c) => c.semanal.vitorias?.v1 ?? null,
  },
  {
    chave: 'recorde_semana_2v2', nome: 'Sincronia', categoria: JOGO, unidade: 'vitórias numa semana',
    descricao: 'Vitórias ranqueadas de 2v2 na sua melhor semana',
    tiers: [40, 70, 120, 160, 250], acumulacao: 'atual',
    medir: (c) => c.semanal.vitorias?.v2 ?? null,
  },
  {
    chave: 'recorde_semana_3v3', nome: 'Ofensiva', categoria: JOGO, unidade: 'vitórias numa semana',
    descricao: 'Vitórias ranqueadas de 3v3 na sua melhor semana',
    tiers: [7, 15, 40, 80, 200], acumulacao: 'atual',
    medir: (c) => c.semanal.vitorias?.v3 ?? null,
  },

  // ─── Jogo: volume ───────────────────────────────────────────────────────────
  {
    chave: 'dano', nome: 'Devastador', categoria: JOGO, unidade: 'de dano',
    descricao: 'Dano causado em todas as partidas, desde sempre, somando todas as suas contas',
    tiers: [4_200_000, 9_900_000, 17_000_000, 31_000_000, 48_000_000], acumulacao: 'recorde',
    medir: (c) => c.jogo?.dano,
  },
  {
    chave: 'horas_jogo', nome: 'Incansável', categoria: JOGO, unidade: 'horas',
    descricao: 'Horas em partida, desde sempre, somando todas as suas contas',
    tiers: [500, 1000, 2000, 2800, 4300], acumulacao: 'recorde',
    medir: (c) => c.jogo?.horasDeJogo,
  },
  {
    chave: 'horas_arma', nome: 'Especialista', categoria: JOGO, unidade: 'horas',
    descricao: 'Horas com a sua arma mais usada, somando todas as lendas que usam essa arma',
    tiers: [90, 200, 350, 500, 850], acumulacao: 'recorde',
    medir: (c) => c.jogo?.horasArmaMaisUsada,
  },
  {
    chave: 'level_conta', nome: 'Veterano', categoria: JOGO, unidade: 'level',
    descricao: 'Level da sua conta de level mais alto',
    tiers: [25, 50, 75, 90, 100], acumulacao: 'recorde',
    medir: (c) => c.jogo?.levelConta,
  },
  {
    chave: 'level_lenda', nome: 'Mestre', categoria: JOGO, unidade: 'level',
    descricao: 'Level da sua lenda de level mais alto',
    tiers: [10, 25, 50, 75, 100], acumulacao: 'recorde',
    medir: (c) => c.jogo?.levelLendaMaximo,
  },
  {
    // 60 e não 70 no topo: só existem 70 lendas, e o maior medido em 09/2026 foi 67.
    chave: 'lendas_nivel_25', nome: 'Polivalente', categoria: JOGO, unidade: 'lendas',
    descricao: 'Lendas diferentes no level 25 ou mais',
    tiers: [4, 9, 25, 40, 60], acumulacao: 'recorde',
    medir: (c) => c.jogo?.lendasNivel25,
  },

  // ─── Guilda ─────────────────────────────────────────────────────────────────
  {
    // Conta a entrada mais recente (decisão do usuário): quem saiu e voltou recomeça.
    chave: 'tempo_guilda', nome: 'Raiz', categoria: GUILDA, unidade: 'semanas',
    descricao: 'Semanas desde a sua entrada na guilda (vale a entrada mais recente)',
    tiers: [4, 12, 26, 40, 52], acumulacao: 'atual',
    medir: (c) => (c.guilda ? c.guilda.semanas : null),
  },
  {
    chave: 'contribuicao_total', nome: 'Pilar', categoria: GUILDA, unidade: 'guild points',
    descricao: 'Guild points acumulados na guilda',
    tiers: [40_000, 100_000, 200_000, 300_000, 500_000], acumulacao: 'atual',
    medir: (c) => (!c.guilda ? null : c.guilda.presente ? c.guilda.pontos : 0),
  },
  {
    // Só conta de 08/2026 em diante: antes disso a API devolvia guild points errados.
    chave: 'recorde_contribuicao', nome: 'Pico', categoria: GUILDA, unidade: 'guild points numa semana',
    descricao: 'Guild points ganhos na sua melhor semana (conta de agosto/2026 em diante)',
    tiers: [5000, 10_000, 20_000, 30_000, 40_000], acumulacao: 'atual',
    medir: (c) => c.semanal.contribuicao,
  },
  {
    chave: 'semanas_sem_inativar', nome: 'Constante', categoria: GUILDA, unidade: 'semanas seguidas',
    descricao: 'Semanas seguidas, até hoje, sem cair na inativação de quarta-feira',
    tiers: [4, 8, 16, 26, 52], acumulacao: 'atual',
    medir: (c) => c.semanasSemInativar,
  },
  {
    chave: 'mvp_total', nome: 'Destaque', categoria: GUILDA, unidade: 'semanas como MVP',
    descricao: 'Semanas em que você foi MVP da guilda',
    tiers: [2, 6, 12, 18, 26], acumulacao: 'atual',
    medir: (c) => c.mvp?.total ?? null,
  },
  {
    // Staff conta pela regra do cargo: recebe sem ocupar vaga, mas só se estiver acima do corte.
    chave: 'mvp_streak', nome: 'Dinastia', categoria: GUILDA, unidade: 'semanas seguidas',
    descricao: 'Sua maior sequência de semanas seguidas como MVP',
    tiers: [2, 4, 6, 8, 10], acumulacao: 'atual',
    medir: (c) => c.mvp?.maiorSequencia ?? null,
  },
  {
    chave: 'entrou_guilda', nome: 'Bem-vindo', categoria: GUILDA,
    descricao: 'Estar na guilda do jogo',
    tiers: null, acumulacao: 'recorde',
    medir: (c) => (c.guilda ? c.guilda.presente : null),
  },

  // ─── Discord ────────────────────────────────────────────────────────────────
  {
    chave: 'mensagens', nome: 'Tagarela', categoria: DISCORD, unidade: 'mensagens',
    descricao: 'Mensagens enviadas no servidor do Discord',
    // Cortes do usuário em 14/09/2026: com 1k..10k o Diamante era o tier mais cheio depois do Bronze.
    tiers: [500, 3000, 10_000, 25_000, 50_000], acumulacao: 'atual',
    medir: (c) => c.atividade?.mensagens ?? null,
  },
  {
    chave: 'horas_call', nome: 'Voz Ativa', categoria: DISCORD, unidade: 'horas',
    descricao: 'Horas em call no servidor do Discord (canal AFK não conta)',
    // Cortes do usuário em 14/09/2026, pelo mesmo motivo do Tagarela.
    tiers: [20, 50, 100, 175, 300], acumulacao: 'atual',
    medir: (c) => c.atividade?.horasCall ?? null,
  },
  {
    chave: 'motd', nome: 'Locutor', categoria: DISCORD, unidade: 'MOTDs',
    descricao: 'Mensagens do dia enviadas com o .motd',
    tiers: [1, 2, 4, 6, 10], acumulacao: 'atual',
    medir: (c) => c.discord.motds,
  },
  {
    chave: 'contas_vinculadas', nome: 'Vínculo', categoria: DISCORD, unidade: 'contas',
    descricao: 'Contas alternativas vinculadas à sua',
    // 3 tiers, não 5: 93% da guilda tem zero contas vinculadas (decisão do usuário, 14/09/2026).
    tiers: [1, 2, 3], acumulacao: 'atual',
    medir: (c) => c.discord.contasVinculadas,
  },
  {
    chave: 'sem_marcar_topson', nome: 'Trégua', categoria: DISCORD, unidade: 'dias',
    descricao: 'Sua maior sequência de dias inteiros sem marcar o Topson',
    // Maior sequência e vale para todos, inclusive quem nunca marcou (decisões do usuário, 14/09/2026).
    tiers: [1, 2, 3, 4, 5], acumulacao: 'recorde',
    medir: (c) => c.discord.diasSemMarcarTopson,
  },
  {
    chave: 'usou_help', nome: 'Curioso', categoria: DISCORD,
    descricao: 'Usar o .help',
    tiers: null, acumulacao: 'recorde',
    medir: (c) => c.discord.usouHelp,
  },
  {
    chave: 'entrou_site', nome: 'Explorador', categoria: DISCORD,
    descricao: 'Entrar no site da TGG',
    tiers: null, acumulacao: 'recorde', pendente: 'depende do site gravar o login',
    medir: () => null,
  },
  {
    chave: 'aniversario', nome: 'Aniversariante', categoria: DISCORD,
    descricao: 'Registrar seu aniversário com o .birthday',
    tiers: null, acumulacao: 'atual',
    medir: (c) => c.discord.aniversario,
  },
  {
    chave: 'quiz', nome: 'Gênio', categoria: DISCORD,
    descricao: 'Acertar o .quiz',
    tiers: null, acumulacao: 'atual',
    medir: (c) => c.discord.quiz,
  },
  {
    // Perde ao tomar warn e volta com .unwarn ou quando o warn expira. Fora do Completista por
    // decisão do usuário (08/09/2026): um warn antigo trancaria a insígnia lendária para sempre.
    chave: 'ficha_limpa', nome: 'Ficha Limpa', categoria: DISCORD,
    descricao: 'Não ter nenhum warn ativo',
    tiers: null, acumulacao: 'atual', completista: false,
    medir: (c) => c.discord.warnsAtivos === 0,
  },
  {
    chave: 'completista', nome: 'Completista', categoria: DISCORD, unidade: 'insígnias no máximo',
    descricao: 'Ter todas as outras insígnias no tier máximo (Ficha Limpa não entra)',
    tiers: null, acumulacao: 'atual', derivada: true, completista: false,
    medir: () => null,
  },

  // ─── Economia ───────────────────────────────────────────────────────────────
  {
    // Total ganho, não saldo: gastar na loja não tira a insígnia (decisão do usuário, 14/09/2026).
    chave: 'tgg_coins', nome: 'Cofre', categoria: ECONOMIA, unidade: 'TGG Coins',
    descricao: 'TGG Coins ganhos no total, de qualquer forma (gastar não desconta)',
    tiers: [300, 2100, 8000, 17_500, 28_000], acumulacao: 'atual',
    medir: (c) => c.economia.coinsGanhos,
  },
  {
    // A maior sequência, não a atual, como a Dinastia (decisão do usuário, 14/09/2026).
    chave: 'streak_daily', nome: 'Assíduo', categoria: ECONOMIA, unidade: 'dias seguidos',
    descricao: 'Sua maior sequência de dias seguidos no .daily',
    tiers: [3, 7, 30, 60, 100], acumulacao: 'recorde',
    medir: (c) => c.economia.streakDaily,
  },
  {
    chave: 'conquistas', nome: 'Colecionador', categoria: ECONOMIA, unidade: 'conquistas',
    descricao: 'Tiers de conquistas semanais concluídos (cada tier conta um)',
    tiers: [15, 30, 50, 70, 100], acumulacao: 'atual',
    medir: (c) => c.economia.conquistas,
  },
  {
    chave: 'itens_loja', nome: 'Freguês', categoria: ECONOMIA, unidade: 'itens',
    descricao: 'Itens comprados na loja',
    tiers: [1, 3, 10, 25, 45], acumulacao: 'atual',
    medir: (c) => c.economia.itensComprados,
  },
  {
    chave: 'cores_evento', nome: 'Camaleão', categoria: ECONOMIA, unidade: 'cores',
    descricao: 'Cores de evento diferentes compradas na loja',
    tiers: [1, 2, 3, 4, 5], acumulacao: 'atual',
    medir: (c) => c.economia.coresDeEvento,
  },
  {
    chave: 'vip', nome: 'VIP', categoria: ECONOMIA,
    descricao: 'Comprar o VIP na loja',
    tiers: null, acumulacao: 'atual',
    medir: (c) => c.economia.comprouVip,
  },
];
