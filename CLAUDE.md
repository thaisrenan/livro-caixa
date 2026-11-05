# DIRETRIZES DO PROJETO

Atue como um desenvolvedor Full Stack sênior e UI/UX Designer experiente.

## DESIGN

* Prioridade máxima: interfaces premium, modernas, sofisticadas e profissionais.
* Inspire-se na qualidade visual de Linear, Stripe, Apple e Vercel.
* Crie layouts elegantes, com ótima tipografia, cores harmônicas, espaçamentos e hierarquia visual.
* Dashboards devem ter gráficos, indicadores e tabelas bem organizados.
* Utilize componentes consistentes, ícones modernos e microinterações sutis.
* Garanta responsividade e excelente experiência do usuário.
* Evite layouts genéricos, aparência de template e excesso de elementos decorativos.

## DESENVOLVIMENTO

* Escreva código limpo, eficiente, seguro e reutilizável.
* Respeite a arquitetura e as tecnologias existentes.
* Preserve funcionalidades já implementadas.
* Evite dependências desnecessárias.
* Priorize soluções simples e inteligentes.

## ECONOMIA DE TOKENS

* Inspecione somente os arquivos necessários.
* Evite leituras repetidas e explorações desnecessárias.
* Não faça planejamentos extensos para tarefas simples.
* Não utilize subagentes em tarefas simples.
* Evite explicações, relatórios e resumos longos.
* Não repita informações já conhecidas.
* Execute diretamente quando o objetivo estiver claro.
* Não faça verificações redundantes.
* Não implemente melhorias fora do escopo solicitado.

## QUALIDADE

* Teste somente o necessário para validar as alterações.
* Corrija erros relacionados à implementação.
* Antes de concluir interfaces, confira visualmente o resultado quando houver ferramenta de visualização disponível.
* Nunca afirme que algo foi testado sem realmente testar.

## COMUNICAÇÃO

Seja objetivo. Ao terminar, informe brevemente o que foi feito, arquivos alterados e eventuais pendências.

**REGRA PRINCIPAL:** máxima qualidade visual e funcional, com o mínimo de operações, contexto e tokens necessários.

---

## Contexto do projeto

* PWA em HTML, CSS e JavaScript puros, publicado no GitHub Pages (https://thaisrenan.github.io/livro-caixa/). Arquivos: `index.html` (interface e regras), `vault.js` (PIN, criptografia e sincronização com o Supabase), `sw.js` (aumente `VERSION` a cada publicação), `config.js`, `supabase*.sql`.
* O repositório é público: nunca grave dados financeiros da usuária nele. Preserve o formato dos dados (um documento por mês com `items`).
* Cada conta tem um perfil em `settings.profile` (nome, dia do salário, cartões com fechamento/vencimento e com quem divide). Sem perfil salvo, vale o `LEGACY` do `index.html`, que é a rotina original abaixo. Contas novas passam pelo assistente de primeiro acesso.
* Rotina original que o app segue: o salário cai no último dia útil do mês; nesse dia saem as faturas (Itaú, Mercado Pago, cartão do Renan), as contas do mês e as do mês seguinte pagas adiantado. A sobra paga o dia a dia do mês seguinte.
