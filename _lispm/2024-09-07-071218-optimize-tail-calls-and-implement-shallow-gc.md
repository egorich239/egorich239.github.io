---
layout: gitlog
title: optimize tail calls and implement shallow gc
subtitle: one does not simply
commit: https://github.com/egorich239/lispm/commit/fdb323d2e5e7488e519ef1db8a3cafad63704fc9
---


I didn't plan to implement tail call optimization, but as I wrote first
version of shallow gc [^0], and wanted to stress test it by doing
something on the long lists (see tests/eval/gc), I came across a problem
with the following example:

```scheme
    (list
        (make-list 6)
        (length-list (make-list 2000))
    )
```

The first part just creates a list of length 6 (so that I could check
that it works), whereas the second one creates the list of length 2000,
then evaluates its length and dismisses the list.

I figured that the second line overflowed the execution stack even if
garbage collector does not handle the long list recursively.  Why?
Because every construct in the language caused a recursive function call
in the interpreter:

```scheme
(gdb) bt
  #0  eval (syn=21845) at lispm.c:450
  #1  0x0000555555557ea1 in evlis (li=67104002) at lispm.c:405
  #2  0x00005555555582ee in evapply (expr=67104002) at lispm.c:439
  #3  0x00005555555586cf in eval (syn=67103906) at lispm.c:464
  #4  0x00005555555581ad in evapply_lambda (fn=67102022, args=67101394) at lispm.c:424
  #5  0x000055555555848e in evapply (expr=67102850) at lispm.c:446
  #6  0x00005555555586cf in eval (syn=67102786) at lispm.c:464
  #7  0x0000555555557ea1 in evlis (li=67102882) at lispm.c:405
  #8  0x00005555555582ee in evapply (expr=67102882) at lispm.c:439
  #9  0x00005555555586cf in eval (syn=67102498) at lispm.c:464
  #10 0x00005555555581ad in evapply_lambda (fn=67102454, args=67102066) at lispm.c:424
  #11 0x00005555555582c3 in evletrec (arg=67102418) at lispm.c:432
  #12 0x00005555555586cf in eval (syn=67102386) at lispm.c:464
  #13 0x000055555555871b in lispm_eval0 (
      pc=0x55555555f103 "\n(letrec\n    (\n        (make-list. (lambda (n acc) (cond\n", ' ' <repeats 12 times>, "((eq? n 0) acc)\n", ' ' <repeats 12 times>, "(#t (make-list. (- n 1) (cons n acc)))\n        )))\n        (make-list (lambda (n) (make-list. n ())))\n "...,
      pc_end=0x555555560146 "") at lispm.c:469
```

This predictably ended up with:

=== Runtime statistics ===
  native stack depth (max): 16496
  object stack depth (max): 2477
gc-pressure: FAIL
  expected: ((1 2 3 4 5 6) 2000)
  actual: #err!

So, the garbage collector is in fact not the bottle neck for our stack,
but rather the evaluation process itself [^1]. My first thought upon this
discovery was "but I don't want to implement tail call optimization! I
have no idea how to do it!" Couple of days later I think I can tell, how
I did it :-)

The original evaluation model was based on several things:
1. The semantic analysis stage provided each LAMBDA, LET and LETREC form
   with the information about their captures (which names they use from
   the external lexical scope), and their arguments (which names they
   define to use inside their body) [^2].
2. During evaluation, I kept currently assigned value of every name in
   the VM's hash table. The hash table has space for two words for a
   literal: the first word is used to point to the literal's name, the
   second I used to store the currently assigned value.
3. When entering LAMBDA, LET, LETREC forms, I replaced the current
   values in the htable with the values in the captures list, and
   evaluated values of the arguments. In order to restore the state of
   the htable on leaving the forms, I kept shadow list with previous
   associations of the names. These shadow lists were numerous and
   embedded in the state of the corresponding `ev*()` functions.

The core idea of tail call optimization is that to evaluate some
expression means to substitute its variables and simplify the
expression. For example, consider the following expression:
`(cond ((eq? x 3) foo) ((eq? x 1) bar))`.
It is reduced differently depending on the context:
- with `[x = 3]` it is reduced to `foo`;
- with `[x = 1]` it is reduced to `bar`;
- with `[x = 0]` it is reduced to `#err!`.

For each of the syntactic forms in the language -- quote, lambda, let,
letrec, cond -- I can describe the rewrite rule. With this the `eval`
becomes the sequence of rewriting actions.

The major complication here is that some forms introduce new assignments
to some names in the context, or shadow the values previously assigned
to these names: `((lambda (x) (* 3 x)) 8) -1-> [x = 8] (* 3 x) -2-> 24`.
I need some means of restoring the state of the assignments after
evaluation is done.

One simple solution to that is to keep the list of all assignments
inside the `eval()`, so at `-1->` transition one also does something
like `shadow = CONS((x, <previous value of x>), shadow)` inside the
interpreter. Then before leaving `eval()` one iterates over this list,
and reverse the assignments.

Unfortunately this approach defeats the purpose, or rather subsitutes
the native stack exhaustion with values stack exhaustion. The following
snippet would see `n` and `acc` shadowed 2000 times whereas I _never_
need any value in the middle of this list.

```scheme
(letrec
    (
        (make-list. (lambda (n acc) (cond
            ((eq? n 0) acc)
            (#t (make-list. (- n 1) (cons n acc)))
        )))
        (make-list (lambda (n) (make-list. n ())))
    )
    (make-list 2000))
```

In fact all I need is a way to answer whether this current eval has
already cached the previous value of a variable [^3]. To achieve the
similar goal during semantic analysis I write the `frame_depth` of the
variable definition into the second word of the htable. It would be nice
to do something similar at evaluation time, however we have only one
word to store both the value assigned to the name and the depth of the
assignment. Bummer!

I didn't want to add one more word to the htable structure. I rely on
the htable size being a power of two, so I'd have to add 2 more cells
or fundamentally shift my understanding of the htable.

Instead, I introduced special value `<OFFS> 11 11`, where OFFS is a
reference into the stack, holding a 5-tuple of the form
`(next-var-ref current-value frame-depth previous-value literal)`.
Assigning a value to a name then means the following:
- if htable already points to a 5-tuple with `frame-depth` matching
  the current frame depth, simply overwrite the `current-value`;
- otherwise allocate the 5-tuple and fill in its fields, writing the
  current htable association into `previous-value` cell.
Getting value associated to a name thus is done by looking at htable
value cell, and if it has the `11 11` special form, then looking further
into the associated 5-tuple.

I keep all the 5-tuples used by the current `eval()` in the `M.frame`
list, using `next-var-ref` to link its individual elements.
Before leaving `eval()` I go through the list and assign
`previous-value` to each `literal`.

One more crucial observation about these 5-tuples: they are referenced
from the htable. This means, that one must take care that garbage
collector does not destroy them and does not move them. I will discuss
it in further details in the next post.

To wrap things up: in order to implement tail calls:
- I changed all `ev*()` functions to produce a reduced expression in the
  current context;
- I changed the `eval()` function to loop over those reductions;
- I had to change the way the value assignments are stored and restored;
- I still rely on semantic analysis to produce the full list of captures
  and arguments for each frame.


[^0]: More on garbage collector, how it works and which assumptions it     makes, -- in the next post.
[^1]: It's really obvious in hindsight!
[^2]: In fact, there was something fishy with LET, as it didn't truly     follow this route, and ignored the change of lexical state caused by     each individual assignment in the assignment list.
[^3]: One impractical alternative to that would be to cache _all_     variables in the VM on every eval.
### verbose branch logs

* [[a776e190](https://github.com/egorich239/lispm/commit/a776e1909c7edbe5e3c8b4c1e0a79825082cc537)] step 1: Make program completely uniform

   I make every program recursively consist of `(FORM, args)` pairs,
   including for quoting and resolving a name. This is a prerequisite to
   turning eval into a loop.
   
* [[9dad56f4](https://github.com/egorich239/lispm/commit/9dad56f4b3c0abc494739b8cd21017906c4d49a4)] step 2: Make _all_ recursive ev*() use eval

   Now everything is ready to change the eval to the loop.
   
* [[f4bcd616](https://github.com/egorich239/lispm/commit/f4bcd6162233041ba0a075eb331cc432bcc066d7)] step 3: implement tailrec

   Turned out to be more sophisticated than I anticipated.
   
* [[aa49b491](https://github.com/egorich239/lispm/commit/aa49b4914492f0e6f2511bdf7655f2b19f75f08f)] step 4: minor renamings

* [[670c3091](https://github.com/egorich239/lispm/commit/670c30917c54f957dbed48fe5ff2bde8c3ad264b)] step 5: shallow gc

* [[c4295bb4](https://github.com/egorich239/lispm/commit/c4295bb42b5b62d9c0cc2022e9798ccda8204b79)] step 6: oops! I actually never GC'd!

   I moved the objects around, but never reset the M.sp pointer :-)
   Fixed
   
* [[dbb33ed1](https://github.com/egorich239/lispm/commit/dbb33ed195227d9e0fd149f8998baee8ff0dfeed)] step 7: some cleanup and dedup

* [[9e0003f6](https://github.com/egorich239/lispm/commit/9e0003f6b74e5945b243713ad4531fd8eff75c1c)] step 8: maintain current frame in M.frame

   This allows me to avoid the communication protocol between `ev*()` and
   `eval()` where they output additional list of assignments together with
   the continuation.
   