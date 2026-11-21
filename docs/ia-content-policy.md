# Conteúdo da IA do servidor

Revisão: 21/11/2026. A IA é pública para membros, exclusivamente no canal `1437416406038872225`.
A regra vale para `.ia`, `.ai`, `.pergunta`, `.perguntar`, `.consulta`, `.consultar` e `/ia`,
inclusive quando o autor é staff ou admin.

## Regras

O servidor exige conteúdo SFW, inclusive em perguntas recebidas. O filtro bloqueia pedidos e
respostas com conteúdo sexual explícito, exploração de menores, gore, ódio, assédio, ameaças
reais, incentivo à automutilação, crimes, golpes, doxxing e credenciais, além de abuso da plataforma.
A avaliação contextual também cobre spam/raids, self-bots, evasão, cheats/pirataria e desinformação
perigosa. Não há exceções para staff, personagem, tradução ou pedidos para ignorar as regras.

Gameplay de Brawlhalla sem detalhes gráficos, estatísticas públicas de jogadores, humor leve,
prevenção de golpes, denúncias legítimas e pedidos de apoio emocional são permitidos.

## Verificação

1. O canal é conferido antes de qualquer consulta do comando.
2. A pergunta passa pela API de moderação (`omni-moderation-latest`) e por um classificador
   contextual (`gpt-6-luna`, ou o modelo OpenAI configurado) com JSON estrito.
3. Só depois da aprovação o bot escolhe uma ferramenta e busca os dados.
4. A redação recebe instruções SFW. Resultados de ferramentas são tratados como dados não confiáveis.
5. Antes de publicar, o bot examina a resposta inteira e o embed, incluindo títulos, nomes, campos e
   rodapé. Conteúdo reprovado retém o embed completo; não publica os dados brutos como alternativa.

Credenciais reconhecíveis são bloqueadas localmente. O filtro normaliza letras Unicode e certos
caracteres invisíveis e não corta a resposta antes de examiná-la. Texto grande demais, JSON inválido,
recusa do classificador, falta de chave, timeout ou erro de serviço suspendem a publicação.

O filtro usa `OPENAI_API_KEY` mesmo com Ollama/Gemini. As decisões estruturadas têm limite de 256
tokens e timeout de até 15 segundos por chamada. Isso acrescenta latência e chamadas à Responses API.

Recusas usam mensagens fixas e não repetem o conteúdo reprovado. Os logs da IA registram apenas
a ferramenta e a direção/categoria do bloqueio, sem perguntas, respostas ou argumentos crus.
Menções automáticas são desativadas na resposta. A moderação do comando não aplica punições
nem apaga automaticamente a mensagem original enviada pelo usuário.

Classificação automática pode errar. As regras e os exemplos de teste precisam ser revistos quando
as políticas do Discord mudarem; este filtro não garante conformidade absoluta da aplicação.

## Referências

- [Termos de uso do Discord](https://discord.com/terms)
- [Diretrizes da comunidade](https://discord.com/guidelines)
- [Política para desenvolvedores](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)
- [API de moderação](https://developers.openai.com/api/docs/guides/moderation)
