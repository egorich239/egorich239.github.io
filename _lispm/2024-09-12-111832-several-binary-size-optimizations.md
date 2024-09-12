---
layout: gitlog
title: several binary size optimizations
subtitle: on arranging some space for a new feature
commit: https://github.com/egorich239/lispm/commit/dc94fb758302156f417db3185000f3f3a047e6e5
---


I would like to introduce optional type tags for stack objects. The idea
would be to call "destructor" function when the tagged object is deleted
by the garbage collector. However, adding this logic to GC costs some
100 bytes of binary code, and that overflows my self-imposed limit of
4096 bytes. Hence, I needed to do something about the binary size.

Most changes here are straightforward, but one is peculiar. I've made
several futile attempts to optimize the lexer size. This one is more
successful. It builds on several ideas:
1. The first symbol of a lexeme determines its kind: number, literal, or
   #literal. I memorize it in `state`.
2. I organize states in the hierarchy `S_HASH_ATOM < S_ATOM < S_NUM`,
   and directly link the value of `state` with the corresponding symbol
   category in the `lexer.inc.h`. Once the `state` is set at the first
   symbol, it cannot change, and the category of further atom symbols
   must have _at least_ the same value as `state`.
3. I split the logic into the scan loop, that checks the above, and
   interpretation logic, that takes a valid lexeme, and returns it as an
   object. This latter part also checks some corner cases.

This trickery got me 18 bytes which accounts to about 1/3 of the savings
in this branch.


### verbose branch logs

* [[e81de3f5](https://github.com/egorich239/lispm/commit/e81de3f5ce289209b1a6c0d2f52a2d1db1ab439b)] rename sema->aux, introduce explicit SYNTAX tag

   I plan to reuse `aux` as `dtor` for TYPETAG values.
   
* [[ae827b85](https://github.com/egorich239/lispm/commit/ae827b85a98a07a0ed9fe161fb0470fc39b6b006)] minor binary size optimizations

* [[35a40cb1](https://github.com/egorich239/lispm/commit/35a40cb1bb7849df4467fb45c5e5a78d62671a6e)] first step to factoring out linker dependency

   I moved linker-specific code to intrinsics. In principle, a different
   implementation of these intrinsics possible in standard C.
   
   I also moved some bits around in `lispm.c` to further reduce the binary
   footprint.
   
* [[f76e7201](https://github.com/egorich239/lispm/commit/f76e7201ef38e8ac13e4ad29fe65b29249afec35)] lexer optimization: attempt 1

   Saves some bytes, but I have a better idea
   
* [[b55b9208](https://github.com/egorich239/lispm/commit/b55b92083da3c31bf61968d497f6706372a3846e)] slightly more compact lexer
