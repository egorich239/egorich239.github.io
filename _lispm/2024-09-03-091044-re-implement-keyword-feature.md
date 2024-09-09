---
layout: gitlog
title: re-implement keyword feature
subtitle: haste makes waste
commit: https://github.com/egorich239/lispm/commit/b982576554fa543256e910e05a949fae0cc97ad4
---


I yesterday implemented the special kind of symbols that I called
self-referential. Upon some research later in the evening, I figured
that 1) the larger lisp community knows them as keywords, and 2) uses a
different syntax for them (i.e. starting with a colon).

Here I adjust to this practice while preserving the lexer support for
`#t`, `#err!`, which I also keep as keywords (i.e. `'#t` is `#t`). I
however forbid user-defined hash-symbols.

I'm not yet certain how I go futher about colon either. For now, I do
not treat colons in the body of a literal as something special, i.e.
`:foo` is a keyword whereas `f:o:o` is just a regular symbol.

