# Issue tracker: GitHub

As Issues do vendedor, da PWA e do APK ficam em [`ismaelsouza/amendoas-app`](https://github.com/ismaelsouza/amendoas-app/issues). Para mudanças no painel ou na API, use [`ismaelsouza/amendoas-adm`](https://github.com/ismaelsouza/amendoas-adm/issues) e vincule as Issues dos dois canais pelo URL. O [mapa de decisões](https://github.com/ismaelsouza/amendoas-adm/issues/1) reúne as regras em discussão.

## Comandos

Confirme o destino com `gh repo view --json nameWithOwner`. Fora do clone, inclua `-R ismaelsouza/amendoas-app` nos comandos `gh issue`.

| Tarefa | Comando |
| --- | --- |
| Listar | `gh issue list --state all --limit 100 --json number,title,state,labels,url` |
| Ler | `gh issue view <n> --json number,title,body,labels,comments,parent,blockedBy` |
| Publicar Issue ou spec | `gh issue create --title "..." --body-file -` |
| Comentar | `gh issue comment <n> --body-file -` |
| Alterar rótulos | `gh issue edit <n> --add-label "..." --remove-label "..."` |
| Vincular subtarefa | `gh issue edit <pai> --add-sub-issue <filha>` |
| Vincular dependência | `gh issue edit <n> --add-blocked-by <n-ou-url>` |
| Encerrar após registrar o resultado | `gh issue close <n> --reason completed` |

`--body-file -` lê Markdown da entrada padrão. Para buscar todas as páginas, use `gh api --paginate 'repos/ismaelsouza/amendoas-app/issues?state=all&per_page=100' --jq '.[] | select(has("pull_request") | not)'`.

`awaiting-homologation` indica que a entrega está em HML e precisa do aceite do cliente. Registre o resultado na Issue antes de fechar. Confira as dependências com o ADM/API antes de assumir uma subtarefa do App.

## Pull requests as a triage surface

**PRs as a request surface: no.**
