---
layout: gitlog
title: implement letrec
subtitle: how a "simple" feature can guide VM development
commit: https://github.com/egorich239/lispm/commit/454da517bebabdc89311e2209c9058bbe32fadef
---


I've pondered the topic of recursion several times since inception of
the VM, and repeatedly failed to grasp it.

My first attempts to use recursive functions predated the introduction
of `lambda`s as values. They were just a syntactic construct: if
something started with `((lambda ...`, I assumed it was a function
application, and evaluated it as such. At that time I already had `let`,
so I bound quoted lambdas to their names and then used `(eval fact)`
that I had in the language to "materialize" those. That's when I noticed
that eval is evil. It took me some time to understand why: it binds the
names at the time of evaluation, which is counter-intuitive (to me), and
is very hard to control even when I know about this behavior.

Enlightened this way, I implemented the lambdas as values, which
affected the design of the VM drastically: I had to introduce another
stack object -- closure (although I called it lambda) -- encapsulating
the captures, the list of arguments and the body. In order to provide
the right environment during the closure evaluation, I started to use
previously unused "value" field in the hash table to keep the current
assignment for each name. In order to restore the environment upon
leaving a closure I had to implement so called "shadow lists" -- they
would keep the previous associations of the names used by the current
lambda [^0].

Excited, I copied Y-combinator definition in LISP from Wikipedia.
This is when I learnt that I have no clue how it works, but it worked
nevertheless, the following returned 120.

```scheme
(let
    (
        (Y (lambda (f)
            ((lambda (i) (i i))
                (lambda (i)
                    (f (lambda (x) ((i i) x)))))))

        (fact (lambda (fact) (lambda (n) (cond
            ((eq? 1 n) 1)
            (#t (* n (fact (- n 1))))
        ))))
        (fact (Y fact))
    )
    (fact 5)
)
```

There was one caveat: it only worked with single-argument functions.
Looking back, I suspect that that's due to my mistake -- I didn't have
`apply` in my language, so I simplified `(apply (i i) x)` to
`((i i) x)`. Probably, if I had `apply` then I could've rewritten
`(fact (Y fact))` as `(fact (lambda (n)) (Y fact) (list n))`, but I am
still not sure.

Anyways, at this point I found a slightly less elegant solution to the
problem of multiple arguments recursion, and gave up:

```scheme
(let
    (
        (fact. (lambda (fact.) (lambda (n s) (cond
            ((eq? 1 n) 1)
            (#t (* n ((fact. fact.) (- n s) s)))
        ))))

        (fact (fact. fact.))
    )
    (fact 5 1)
)
```

The core of the problem with the recursion always laid in the fact that
I would want to use a yet not fully defined name, and the
`(fact (fact. fact.))` trick produced the function that would use
`(fact. fact.)` next time to generate the next instantiation of the
function.

The final turn came about yesterday and the final understanding came
today, when I realized that in order to get `letrec` all I need is to
keep the recursive symbols away from any captures, so a
`(letrec ((f <fbody>)) (f 5))` is similar to
`((lambda (f) (f 5)) <fbody>)` where `<fbody>` is the sequence of tokens
representing the definition of function `f`. One cannot write this
latter `lambda` in the language, because the semantic analysis
would notice an unbound name `f`, however for the `letrec`
implementation we can relax the requirements and keep `f` out of capture
list of `<fbody>`. Then the lambda application would actually succeed
and produce the desired result, because we would first bind `f` to the
`<fbody>`, and then apply `<fbody>` to 5 in a context, that already
contains the definition of `f`.

Furthermore, we can also do that for co-recursive functions: two or more
functions calling each other in a loop. And that's exactly how I treat
all definitions in `letrec` -- they all know about each other at the
opening bracket of `letrec`. In order to achieve that I had to separate
the parsing and semantic analysis phase -- one more significant change
of the architecture, but for the better.

With this landed, I plan to wrap up the development of the language.
I will follow up with cleanup, renaming everything and restructuring the
libraries.
Then I plan to address a long-standing TODO of removing deeply nested
recursive calls in garbage collector and introduce the call stack depth
guard.


[^0]: I also used this mechanics to evaluate let-expressions.
### verbose branch logs

* [[b93f872a](https://github.com/egorich239/lispm/commit/b93f872ab8c7bcbefe24bb8908d459ad271a9477)] implement letrec

   I didn't have a plan for it yesterday morning, but couldn't resist the
   temptation when I figured that it should be possible yesterday in the
   evening :-)
   
* [[a6d1f225](https://github.com/egorich239/lispm/commit/a6d1f225d746c4e8a3ec617878bb4bb6d801947d)] extract semantic analysis in its own phase

   Essentially paying the price of the past mistakes. Mixing parsing and
   semantic analysis was okay-ish previously, but it stays in the way of
   implementing `letrec`, because the way I envision the latter is by
   transforming `(letrec ((a abody) (b bbody) body)` into
   `((lambda (a b) body) (abody bbody))` but in a way that binds `a` and
   `b` into the definitions of `abody` and `bbody`, and for that I should
   scan all the names before going into the semantic analysis of the
   bodies.
   
* [[d3e0c8c4](https://github.com/egorich239/lispm/commit/d3e0c8c43283a1b79c355e7d4a1031b75e1162da)] move builins and tokens into `00 11` sub-namespace

   I plan to introduce `PARSE_SYM_REC` in `11 11` group of special objects,
   and I will need the full 28 bits of payload to store pointer to the
   stack object representing the unevaluated recursive function.
   
   For that reason I need to free up this part of the space from lexical
   symbols. Luckily, I can pack both builtins and lexical symbols into
   subnamespace of `00 11`, since I never expect too many of those.
   In fact, I now use the whole 8 lower bits to distinguish between
   builtins and lexemes, because 24 bits is more than enough for the
   payload in these categories.
   