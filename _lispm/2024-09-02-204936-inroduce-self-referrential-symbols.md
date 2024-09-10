---
layout: gitlog
title: inroduce self-referrential symbols

commit: https://github.com/egorich239/lispm/commit/767d14615cf224a75faea02faa958d08f06c811a
---

I introduce a whole new class of atoms of the form `#foo`.
Their major characterstic is that they evaluate to themselves, and
cannot be bound to anything else.
I then convert the builtins `atom?` and `eq?` to return `#t`.
I also return `#err!` for any kind of error, which allows me to simplify
the debugging and tests.


### verbose branch logs

* [[0bce766b](https://github.com/egorich239/lispm/commit/0bce766b565a8583e53d530dddefd44314053a7d)] implement self-referential symbols

   I like the idea of having special symbols of #form, that evalutate to
   themselves and cannot be overriden.
   
* [[184aae85](https://github.com/egorich239/lispm/commit/184aae850463959d14169a07679654f208ab8ed8)] extract hash tests to a separate file

   I also document the intent to eventually test the assignment failure and
   parsing failure, but they both manifest as a parse error, and my current
   test runner aborts at the first sight of it.
   