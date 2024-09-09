---
layout: gitlog_index
title: A small LISP interpreter in C
gitlog: lispm
---

git: [repo](https://github.com/egorich239/lispm)

This study is devoted to a C implementation of a small VM for a dialect of Lisp.
I aimed to fit it in 4K of code for the core language on x86-64 platform.
The core language in `lispm.c` supports `lambda`, `let`, `letrec` constructs,
has syntax for unsigned numbers 2 bits shorter than the native, implements
tail call optimization, a compacting garbage collector, tracks the overflow
of native call stack and machine's value stacks, and provides `panic!` builtin
to immediately abort the computation.
The `funs.c` expands the language with builtin functions for lists and integers.

As of writing `debug.c` needs some tl&c, same goes for tracing capabilities.
I also want to eventually properly unit test the functions in `lispm.c` and `lispm.h`.

Since I tend to hack-hack-hack much more than write blog posts,
I experimented with blogging right-there-and-then, i.e. directly in the
commit messages of the `main` branch. I wittingly called this approach git blogging.
Later though I discovered some elements of blog-chaining, since all my
ridiculous mistakes are now ingrained into the commit history. I was so embarrassed
to discover word "anigmatic" in one of the messages, that opted for some minimal
post-processing :-)

Below is the full list of posts that I created this way.
