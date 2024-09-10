---
layout: gitlog
title: implement a minimalistic REPL
subtitle: ... and tell about its shortcomings
commit: https://github.com/egorich239/lispm/commit/76a224bddbaadf52423809649b92a095d5a2ca72
---


Good news first: I implemented a REPL [^0] for my machine. If you have a
Linux machine with `libreadline.so` and its headers set up, then
use `make repl && build/repl/repl` to try it out.

REPL is built as a combination of a very simple launcher, a couple of
additional builtins that I define in the `repl.c`, and the main loop
implemented in LISP `main.lispm`.

The way one extends builtins in LISPM is by using `LISPM_BUILTINS_EXT`
macro to define an array of `LispmBuiltin` objects. The `repl.c` defines
three extensions: `#io:readline`, `#io:print` and `#eval`. The first one
is a wrapper around GNU `readline()` call, and the latter two wrap
`lispm_print_short()` and `lispm_eval0()` correspondingly.

I am somewhat unhappy about the macro, as it currently enforces the
symbol to go into a particularly named section of the object file. Later
I use a GNU linker script to glue all these sections together into a
contiguous memory array. The upside of this solution is that it uniquely
maps a builtin definition to a small integer number -- its offset in the
builtins table. The downside is that it is outside of standard C, it is
not portable, and already prevents me from playing with LISPM on my
Macbook. I have an idea how to factor this magic out and provide an
alternative solution in standard C, but so far I was kicking this can
down the road.

I reconsidered what `#symbols` are, again. They can still be only
defined by a VM extension, but are not obliged to be self-referencing
keywords. Of course, `#t` and `#err!` still evaluate to themselves, but
`#io:readline` is just a regular extension function, and the symbol
resolves to the corresponding `LispmBuiltin` object.

I know how to implement `(define ` but decided to leave it out for now.

The least pleasant dirty secret of the current implementation is that
`ln` _does not_ carry the value of the input line, but only a boolean
flag "are we at eof?" The actual value of the line is stored in a static
variable. Hence, the program only works because `#io:readline` is
immediately followed by `#eval`.

The underlying deficiency of the VM is its inability to refer to a
native value from its own values stack: even though I can somehow map
the pointer returned from `readline()` to an integer value, I cannot
tell from `repl.c` when this value is safe to discard -- to do that I
would need a hint from garbage collector.


[^0]: <https://en.wikipedia.org/wiki/Read%E2%80%93eval%E2%80%93print_loop>
### verbose branch logs

* [[e0ce9663](https://github.com/egorich239/lispm/commit/e0ce9663f228b7781453233dd0b1f76a3385a963)] API cleanup

   provide non-throwing alternatives to both main API methods
   
* [[c984f3d4](https://github.com/egorich239/lispm/commit/c984f3d4a3a0281b8b0753e2315b011b7992e0ed)] reduce bit-shifting in gc0 and list_reverse_inplace

* [[b4c5249a](https://github.com/egorich239/lispm/commit/b4c5249a60cfbddf00f8ed97aca224d0ccbf2d65)] get rid of the limit on the builtin name length

* [[d1b59e8e](https://github.com/egorich239/lispm/commit/d1b59e8ed972341eee53b2f06bb91ebce7582ead)] clean up htable_ensure

   Instead of operating on the returned entry on the caller side, I now
   provide the initial value directly. Besides cleaner interface, this also
   saved some 30 bytes of binary size.
   
* [[20db1850](https://github.com/egorich239/lispm/commit/20db1850d7c6e6ef977af2a4726fed27a5acc99b)] an extremely bare to the bone REPL

   The REPL works, but keeps the state split between the LISP world and the
   native environment. For instance, the result of `#io:readline` is not a
   genuine value, and the result of `#eval ln` depends only on the internal
   state obtained during `io_readline`. I miss some capabilities for proper
   implementation, mainly a natural way to bind a VM value to a
   behind-the-scene state.
   
* [[f61a6297](https://github.com/egorich239/lispm/commit/f61a6297314be52e89f76648b84233d644c67422)] retire launcher

* [[693a9295](https://github.com/egorich239/lispm/commit/693a92953aee2d2fa16c07b5cf6a76b8b7e49487)] don't forget to free the previous input!
