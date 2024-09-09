---
layout: gitlog
title: specify trace event in LISPM_EVAL_CHECK args

commit: https://github.com/egorich239/lispm/commit/747e4d20b436908265e781998273727a6785aa9e
---

I noticed very long ago that the `ctx` argument to `LISPM_EVAL_CHECK`
has its shortcomings. For example, it is impossible to naturally use it
in lexer before we added the symbol to the strings table. In addition,
sometimes I'd like to pass more than one symbol of context.

This change uses the established tracing capabilities to outsource the
mechanics of error handling to the environment, because the behavior of
VM itself does not depend on the kind of error -- it always terminates
regardless.

I also patch tests to recognize errors, although I am not happy with the
way it is currently done. I have an idea how to make it better.

As a bonus, this change reduces the .text section by more than 100
bytes in optimized mode. Probably, because I pass one argument less to
`lispm_abort`

