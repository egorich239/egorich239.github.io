---
layout: gitlog
title: avoid stack growth during tail calls
subtitle: on how I accidentally missed the point
commit: https://github.com/egorich239/lispm/commit/74510b284fa3d64d2415636344da83ce8252cfd2
---


My previous implementation of tail calls was broken. I noticed it after
I implemented garbage collection callbacks for extension-provided types.
My first demo of these callbacks was done in REPL for the input strings,
and the destructor was never called.

After some debugging, I noticed that my `evframe_set` implementation has
an undesired property: if stack pointer was `sp0` at the enter into
`eval()`, then the stack below `sp0` contains a mix of the evaluated
value, the 5-tuple records of the frame vars, and garbage, _and_ I
cannot easily tell which 5-tuple records are referred from the hash
table, and which can be safely discarded. I also cannot easily move the
5-tuples, since they are referenced from the hash table.

This meant, that for the code below there will always be only one
5-tuple, recording the current state of `p` and one for the state of
`q`, but with every recursive step, a new record will be created for
each of them lower at the stack. Of course, all these records will be
discraded at once when the loop is over, but the stack may overflow by
that time. I needed to do something about it.

```scheme
(letrec
    (
        (fib. (lambda (n p q) (cond
            ((eq? n 1) p)
            (#t (fib. (- n 1) (+ p q :modulo) p))
        )))
        (fib (lambda (n) (fib. n 1 0)))
    )
    (fib 1000000)
)
```

I returned back to the drawing board, and figured that the main reason
why I use 5-tuple is that I am not completely precise which names are
captured during the `letrec` evaluation. I omitted the recursively
defined names from all the embedded lexical scopes. If I were to
correctly include them, then every construct in the program would carry
the information about the variables it uses. This in turn would mean
that I will be able to return to much simpler scheme, where the current
value is stored in the hash table, and the shadow frame keeps the
limited information, how to restore the names to the previous state:
- every time I enter `eval`, I initialize an empty shadow state;
- whenever the value of a variable changes, it is added to the shadow
  state;
- whenever I leave `eval` I restore the values from the shadow;
- whenever `eval` gets into `evapply`, it evaluates all the captures and
  arguments of the function, stores them in a list L, then reverts the
  state of the hash table from the current shadow, resets the shadow
  state to empty, _and_ finally applies list L to the hash table.

This essentially resurrects the original idea of shadow lists, but
1) takes into account that I only need to store the most recent shadow
list; and 2) does it in a form friendly to the existing eval loop.
More importantly, I can garbage collect after the previous shadow is
fully reverted, and before the new values are applied. And _this_
garbage collection can keep the stack finite even in the presence of
infinite tail recursion.

I added the above code as a separate test. I also reduced the size of
list in the `gc-pressure` test to 2000, because the current garbage
collection is (overly?) eager, and moves the full list at every
iteration of `make-list.` which means quadratic behavior. There are ways
to improve here, but I decided not to focus on them for now.


### verbose branch logs

* [[cfffa75f](https://github.com/egorich239/lispm/commit/cfffa75fb185bdc46ad093c8406bb350e2ce4452)] remove bindrec

   this way each lambda fully describes the list of its captures
   
* [[33014f0f](https://github.com/egorich239/lispm/commit/33014f0ff47d88a348ebdb2652006ebb5907740a)] implement a different frames accounting

   This should be much more gc-friendly, and allows me to not accumulate
   the state over the nested calls. The previous implementation grew the
   stack unbounded with each tail call
   
* [[dbfab7b9](https://github.com/egorich239/lispm/commit/dbfab7b97124995eab627cbc163ee97b6b03b23f)] actually truly provide tail call optimization

   Verify by a test that the stack growth is limited.
   Downside: current GC implementation gives n^2 performance on the
   gc-pressure test, because it repacks the list fully at each iteration of
   make-list. There are some optimizations that I can think of, but I am
   not eager to implement them.
   
* [[bbd221a7](https://github.com/egorich239/lispm/commit/bbd221a7b92a5bec443533f8584fdf9e22ea49d8)] rearrange the checks a bit

   The idea is that `evassoc` checks what it returns, same as the `evapply`
   binding. However `evlambda` is more relaxed, because it can get
   `BUILTIN_REC_INDEX` from the previous `evletrec` call.
   
* [[8e66adc3](https://github.com/egorich239/lispm/commit/8e66adc392fd61a6f5a743a84f017ded2158f11e)] remove unnecessary code

   1. evframe_set() calls are not needed, and actually pessimize the
      runtime behavior in evapply()
   2. the guard has low value
   