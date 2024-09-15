---
layout: gitlog
title: implement custom destructors for extensions

commit: https://github.com/egorich239/lispm/commit/df5c6eaaf23f442ec990496f380ad2a2b7a7121f
---

Ever since I landed the initial version of REPL, I was unhappy about the
fact that `#io:readline` did not actually bind to the user input. And
that in turn was caused by the lack of means to `free()` the memory
buffer allocated by the `readline()` -- the VM never signalled that the
value is no longer used.

Here I solve the problem by introducing special "type tag" builtins. I
expect these values to only ever be used in the 0th slot of a stack
object (the same one that can store "next" link in the linked list).
During garbage collection, I iterate through the discarded memory, and
if I find a type tag, then I call the corresponding destructor.
In order to not destruct the values that were merely moved, I added
`src[0] = NIL` line into the collection loop of the garbage collector --
this way the type tags of values that are moved by garbage collection
are overwritten before the cleanup loop.

I demo this whole mechanics in the REPL.


### verbose branch logs

* [[690e6b60](https://github.com/egorich239/lispm/commit/690e6b604f6d081fded5b36d172cce45ffe74c75)] implement type tags and destructed values

* [[eba3fb7a](https://github.com/egorich239/lispm/commit/eba3fb7abe1b568fad92e8129fefe08c8ac3d17c)] remove dead code
