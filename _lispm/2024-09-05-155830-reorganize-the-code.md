---
layout: gitlog
title: reorganize the code
subtitle: on how cleanup drives further development
commit: https://github.com/egorich239/lispm/commit/712dcdd6b294a1d434b34c498d6d703b9158eca9
---


When I started to clean up the code my approximate idea was to get rid
of repetitive patterns in lispm.c and separate various parts of the VM.
I didn't anticipate any significant semantic changes.

I started by roughly splitting the code into several files. Then I
replaced repetitive pattern of list iteration with `FOR_EACH`
construct:

```scheme
FOR_EACH(elem, sequence) { do_something(elem); }
```

While I was doing it, I ripped the benefit of reduced syntax noise and
the fact that I once again iterated over significant portion of the
code.

I noticed several places with `C(C(name, val), next)` pattern, and that
itched -- I felt that such objects could be better represented by
triplets `T(name, val, next)`, except I used such triplets to store
properties of lambda. But the revelation followed: it is always possible
to distinguish the purpose of the triplet by the context. A lambda would
always be denoted `('LAMBDA lambda_triplet)` in the evaluation phase,
and I can use `('COND branches_triplet)` without confusing them during
evaluation. Furthermore, such triplets can also have the same linked
list structure as the CONS objects. This latter revelation is important
for two reasons.

One reason is that I use the pattern "build linked list, then reverse it
in place" on multiple occasions. For example, while iterating through
branches of conditionals we do `T(cond, expr, previous_conditionals)`,
but as the very last step we reverse this list, because during
evaluation we want to consider conditionals in the order of their
appearance in the text.

The second reason of its importance has to do with the garbage
collector. It is currently the only piece of lispm.c that goes into deep
recursion: while performing its duty, it essentially rebuilds the list,
originating at the current root of the stack [^0], and does it by recursively
calling itself for every element of the list. This of course gives a
high risk of overflowing the runtime stack. Eliminating this problem not
only for CONS-lists but also for things like triplet-lists of
conditionals requires some common approach on representing these
recursive objects.

Guided by these considerations I made the unthinkable: I changed the
representation of CONS :-) More specifically, I decreed that all
recursive structures will have the pointer to the next element at offset
zero at their stack location. So it is now `CDR CAR` on the stack
instead of `CAR CDR`. This convention allowed me to use exactly one
argument in `list_reverse_inplace` function.

I also introduced the `(apply)` special form, because I noticed several
things:
1. At some stage of my refactoring the post-semantic-analysis program
   would look like `(FORM arg)`, where `FORM` is one of the builtin
   syntactic forms (cond, quote, lambda,...). The only exception to this
   rule was the function application, and it lead to overly complex body
   of `eval` function.
2. I checked in `evapply()` whether builtin was a special form or not.
   With the new structure of the program, I know that it is never a
   special form inside `(apply)` because every special form is
   represented by the pair listed in (1).

I deliberately made `(apply)` not a valid literal such that a user
cannot invoke it directly, because I don't want to accidentally
introduce late binding:

```scheme
(let ((parms '(a 3))
     (apply cons parms))  ; is `a` in the environment?
                          ; what if list parms came from a completely
                          ; different part of the program?
```

Having `(apply)` as a special form, that can only be invoked internally
by the VM itself provides me enough control over what can be passed as
`parms` list.

While doing all that, I noticed a bug in my implementation of `letrec`:

```scheme
(let ((c 3)) (letrec ((c c)) c))   ; evaluates to 3
(letrec ((c c)) c)                 ; unbound variable
```

The latter behavior is correct -- a variable cannot be recursively
defined as itself [^1], but I accidentally allowed it in the former
scenario. The fix was rather straightforward: before entering the
lamdba, created by the `letrec` definition, I must mark all lambda
argument names unbound. This will not pose a problem for recursive
functions, because I don't evaluate their _bodies_ when binding them to
the names, but it will terminate the VM in both of the examples above.

Having done all of the above, I rearranged the code, renamed some types
(most notably `Sym` is now known as `LispmObj`) and made a pass through
the comments. One part that I don't really like is the non-standard
dependency on linker for builtins, but I could not come up with an
alternative that would make me happier.


[^0]: More on the objects lifetime and garbage collection in a future     episode, when I fix the deep recursion.
[^1]: Or as any immediately evaluated expression where it participates,     e.g. `(letrec ((c (* 2 c))) c)`
### verbose branch logs

* [[fff6eea8](https://github.com/egorich239/lispm/commit/fff6eea809e8dcf0a12708eb4d87f04935bba76c)] step 1: chunk API into logical blocks

   sidenote: forcing lispm_cons_alloc always_inline blows up the size from
   4044 to 4500+ bytes
   
* [[ea479a1e](https://github.com/egorich239/lispm/commit/ea479a1e9e1eb41ba176a7c2e9ea15f6475db70d)] step 2: reorganize builtins

   I now allocate the top of the stack to hold the symbols for builtins.
   
   I will likely later make it once again a property of `Lispm` object, and
   remove the GNU extensions and linker script.
   
* [[a69666ab](https://github.com/egorich239/lispm/commit/a69666ab9867ec8921ba4f58215b2fefff7fd692)] step 3: further separate parts of the VM

   lispm.c:      core syntax of the language
   lispm-funs.c: core functions
   lrt0.c:       further memory management functions
   
* [[787157f6](https://github.com/egorich239/lispm/commit/787157f6f2545705468ac0bd05d20799eb52da7b)] step 3: finalize the builtins

   I gave up on the idea of making builtins independent of linker, as it is
   hard to then identify builtin within an extension module.
   
* [[9b24d706](https://github.com/egorich239/lispm/commit/9b24d706c9a3c894fffe2c486a3828503b472861)] step 4: introduce FOR_EACH to iterate over lists

* [[d9d9ab7c](https://github.com/egorich239/lispm/commit/d9d9ab7c320bad18a6ab747628d8f0f8f85103e0)] step 5: introduce triplets

   Reuse lambda stack word internally as a triplet object.
   In fact, the semantics of the triplet is always derived from the
   context, so I can even make it a part of public API.
   
* [[fa593206](https://github.com/egorich239/lispm/commit/fa593206a417176a34e39f09f5076805a8b06ee1)] step 6: introduce triplets, quads, and pentas

   I noticed several `C(C(a, b), c)` patterns in `lispm.c` which made me
   think. In the end I realize that `lambda` is not expressed by the
   triplet itself, but rather by the pair `C(SYM_LAMBDA, triplet)`, and the
   triplet can be either prototype or closure. Nothing then prevents me
   from reusing the triplets for other purposes as well.
   
* [[e2eac8fd](https://github.com/egorich239/lispm/commit/e2eac8fd5ac5f22a1637571f539c0000a169e906)] step 7: prep to change layout of stack objects

* [[cd771127](https://github.com/egorich239/lispm/commit/cd7711279c984b4a519c4613d6675409267682b3)] step 8: put "next" field at the head of stack obj

   This simplifies `list_reverse_inplace()` and anticipated changes to GC.
   
* [[34ccbf85](https://github.com/egorich239/lispm/commit/34ccbf8550e78ab491522af0bd9f1cc68972bffb)] step 9: introduce '(apply)' special form

   This makes the program after semantic stage look very uniform:
   it is either an atom, or a pair `(form args)`, where `form` is a special
   form, and args are its parameters.
   
   In case of the `(apply)` form specifically the first argument can either
   be a builtin function, or a lambda, it can never be a special form
   itself, which simplifies the logic of evapply drastically.
   
* [[e11b88f7](https://github.com/egorich239/lispm/commit/e11b88f7d6c0ffdc16dec08ac77990ea5cb71c32)] step 10: patch a bug in letrec

   Previously `(let ((c 3)) (letrec ((c c)) c))` returned 3, because
   `(c c)` bound the value to the one in the containing frame. This is
   wrong behavior, because expressions on the right hand side of
   assignments in `letrec` should already refer to the objects defined in
   `letrec`. In this particular example, the evaluation should cause an
   error (either infinite recursion, or undefined symbol).
   
   This can be achieved by unbinding all the `letrec` names before passing
   them into the implementation lambda.
   
* [[33a6e50b](https://github.com/egorich239/lispm/commit/33a6e50bea7a2c78f93e3b7a02fa1fd9f9af1797)] step 11: provide some structure to the directory

   liblispm/ the source code
   tests/    tests
   build/	  target directory for builds
   
   Builds are now coming in four fashions: 00 01 10 11.
   00 is non verbose, non assertive, optimized for size
   11 is the opposite
   
* [[e661713e](https://github.com/egorich239/lispm/commit/e661713e5ee750762dac75a71e7c85cf4486f9f0)] step 12: massively rename types and functions
