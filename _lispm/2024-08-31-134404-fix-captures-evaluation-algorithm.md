---
layout: gitlog
title: fix captures evaluation algorithm
subtitle: on virtue of attentive reading and on my favorite mantra
commit: https://github.com/egorich239/lispm/commit/9730deb141f21b8a8d5fa8daaccd47e4d77638c9
---


I didn't plan to fix anything about captures evaluation. In fact, I was
unaware that they were broken in the first place. But then I attempted a
refactoring of how cons-values are unpacked and handled in lispm.c.
One thing about cons-values is that they are absolutely fundamental to
the VM implementation: a parsed program is nothing but an atom or a
list. So we unpack those values A LOT, and naturally refactoring it
essentially walks you through the whole code of the lispm.c.

And while reading the code again during the refactoring, I noticed
several things about capture evaluation algorithm, that made me exclaim
"wow this is broken!"

I briefly touched the topic of captures in my previous post [~1]:
whenever we evaluate an expression of form
`(lambda (x y) (+ x (* m y)))`, we construct a lambda object.
This object consists of three things: the list of lambda's formal
arguments `(x y)`, the body, and the capture list.
In this case `m` is a free variable in the lambda body, hence we must
capture its value from the surrounding context, for example:

```scheme
; This expression...
(let ((m 3)) (lambda (x y) (+ x (* m y))))

; ... produces the following lambda object
(
  ((m 3))        ; the list of captures
  (x y)          ; the list of formal arguments
  (+ x (* m y))  ; the body
```

The captures evaluation algorithm shall understand the special forms,
for example `(lambda (x y) (list (quote m) x y))` does not capture `m`,
whereas `(lambda (x y) (* ((lambda (x) (+ m x)) y) (+ x y))` does.
In its core the algorithm can be described recursively: iterate over all
subparts of expression and append every not yet mentioned free variable
(and its associated value) to the captures list. The devil is in the
details.

First of all, there should be some storage of values for the currently
bound names. I store this information in the global hash table (aka
htable): whenever I need to evaluate the value of a literal, I look it
up in htable, and return the currently associated value. I have to be
careful to maintain proper state of the htable when entering and leaving
applications of lambda and `let`-constructions.

Secondly, I want to [^0] answer the question "is symbol already in the
list of captures" without iterating through the whole list. I achieve it
by using the special value `LISPM_SYM_FREE`:
- whenever I see a literal in the expression, I look for its association
  in htable;
- if it is `LISPM_SYM_NO_ASSOC`, then this symbol is not bound to a
  value, and the program fails;
- if it is builtin (and hence readonly) symbol, then I do nothing --
  their value is global and immutable for the whole life time of the
  program;
- if it is a regular value, then I add the pair `(literal, value)` into
  the captures list, and put `LISPM_SYM_FREE` into the htable instead.
  Next time I come across `LISPM_SYM_FREE`, I know that it is already in
  the captures list.

One more caveat concerns nested lambdas and let-expressions, because
they define additional names. I use `LISPM_SYM_BOUND` marker for those
names. Whenever I enter a `(lambda ...` syntactic structure, I mark all
its formal parameters with `LISPM_SYM_BOUND` marker and preserve their
previous value in another list (see `shadow` lists in
`lispm_evcap_lambda()` and `lispm_evcap_let()`). Then after evaluating
captures of their expressions, I restore the bound variables to their
previous state.

Finally, one last important thing to do is cleanup: after I've computed
the capture list, I must restore the state of the htable. Luckily this
is easily achieved by iterating over the captures `(name, value)` list
and setting the correspondingly `name`d literals in the htable to their
correspoding `value`s.

This is it for the attentive reading part. Now for my personal mantra.

EVERY TIME I WRITE A TEST, I FIND A BUG IN THE CODE.

It does not matter whether it is my code or someone else's.
It also does not matter if the code is new or old. The new code is
literally never tried in practice, so it is very prone to errors.
And if I am inclined to write a test for an old code, this is already
likely because it looks fishy and/or enigmatic to me: in this case I
either find the bug in the code under test, or in my understanding of
the code expressed in the test.

With that in mind, I implemented `test-captures.c` as part of this
change, and populated it with some tests listed in `tests/captures/`
directory. The fact that there is a testing infrastructure is of value
by itself even if the number of tests is initially low. In my case this
latter consideration paid off immediately: I realized there's a bug in
my code already while writing this post, and it took me just 2-3 minutes
to save the draft, switch the branch, and append
`tests/captures/shadowed-var` test to the suite to confirm my suspicion.

In next episode I plan to finally do something about the fact that I
still can't reasonably test evaluation failures.


[^0]: At this very moment I realized that I forgot to restore the state of     htable after captures evaluation. I had to stop writing, and go     commit another patch to the branch with the change.
### verbose branch logs

* [[3a6eb980](https://github.com/egorich239/lispm/commit/3a6eb9805cd44f9b81fc73bdff3afcd3d6456562)] restore the state of htable after captures are evaluated

   (Quick) evaluation of captures relies heavily on changing the state of
   htable. We should not forget to restore the state once we are done
   evaluating.
   
* [[51ead271](https://github.com/egorich239/lispm/commit/51ead27177d2595cb0b0c90c5bfd166e3d6f5b9a)] implemented tests for evcap algorithm

* [[351ac002](https://github.com/egorich239/lispm/commit/351ac002a773f6d3a08e4da641343ab66e2be96e)] wip: fixes to evlet applied, tests pending

   I have changed evlet for the better, however in order to properly test
   it, I need to extend trace callbacks, and ensure that tests are always
   built with tracing on. So I also reorganized the main Makefile and moved
   tests to a separate directory.
   