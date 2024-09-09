---
layout: gitlog
title: remove long numeric objects

commit: https://github.com/egorich239/lispm/commit/01388344afbdbd04f7c5b301fc407b85ddcb1511
---

LISPM identifies every object by a single `unsigned int` value.
Historically I called this concept `Sym` for "symbol" and made it a
typedef to `unsigned` [^0].

The kind of object is determined by the two lower tag bits.
The literals `ABC` are tagged with two zeros, the numeric values are
tagged with `01`. The value is stored in the upper 30 bits (with a 32
bit unsigned).

At some point I considered that for my bootstrap I will have to go
through a stage of an interpreter, that have to work with full length
numeric values, and probably even double word pointers.

And that's how the concept of a "long" numeral was born: I decided to
chain "short" numerals similar to how `cons` chains elements of the
list.

There was one fundamental problem with these numerals however -- they
had to be considered an atom. 1073741823 and 1073741824 are the objects
of the same nature: `atom?` should return true, and `eq?` should
evaluate equality of two atom objects, even if at least one of
them was a long numeral. Changing `atom?` is simple, although it does
look alien (see changes to `lispm_sym_is_atom()`).

But changing `eq?` is the real deal breaker. Before introducing long
numerals, all atoms were uniquely identified by the `Sym` value: I use a
hashtable to keep all observed literals, and two literals equal (as
strings) if and only if their offsets in this hashmap match [^1]. And two
short numeric values equal iff their representation as `Sym` equals [^2].
Checking equality of long numerals requires looking _into_ the objects
themselves, i.e. iterating over stack lists, making `eq?` operation
linear in the length of the numeral. Yikes!

Still, at the moment I introduced them, I thought it to be a reasonable
compromise, and limited the `eq?` to only consider the first pair of
objects, expecting that the list is very short. But it did look ugly.

As time passed, I realized that this complication to the VM itself is
unnecessary, as it is rarely needed in practice. And when it is, I can
probably implement the long arithmetic in LISP itself.

Here I remove the long numerals from the core, adjust LRT0 arithmetics,
and codify in tests the behavior. There are couple more unrelated
changes that I had to do along the way:
- `testeval.c` segfaulted on a wrong lexeme, as it tried to `longjmp` to
  an uninitialized state; I wrapped the parser into `lispm_rt_try()`
  call [^1];
- a potentially uninitialized value was found by GCC in `evapply` when I
  turned on `-Oz`, I patched it quickly, but this does look fishy, so I
  would like to revisit it later;
- turning off assertions and verbose messaging also raises unused
  symbols warning in `debug.c`, I patched it quickly, but some tl&c is
  needed there as well.

I also measured the sizes of `lispm.o` and `lrt0.o` text sections, in
the optimized mode, and I am tempted to move numerals to `lispm.o`, but
before I do that I wanted to further adjust some parser features to
avoid some repetitive typing in the bootstrap project [^3]:
- lispm.o: .text: 3389; with .data+.rodata: 3864
- lrt0.o:  .text: 1438; with .data+.rodata: 2110


[^0]: I now consider changing both.
[^1]: It is a great topic for a future post.
[^2]: I had to forbid numeric atoms with leading zeroes to make it happen.     Leading zeros are problematic: 007 and 7 are clearly very different     atoms -- the two leading zeros do not change the integer value, but     drastically change the meaning of the symbol to an average person     acquainted to pop culture.
[^3]: It is sitting in a private GH repo nearby, and I want it to mature     before I open it. I am also confused as hell how to properly     license it, with a mix of Apache, MIT, and GPL code that I intend     to use along the way.