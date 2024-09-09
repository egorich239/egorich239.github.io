---
layout: gitlog
title: tighten the rules about special forms
subtitle: here be undecidable dragons
commit: https://github.com/egorich239/lispm/commit/901334fa9f1d6db581cf0bd1446e1faea99baa90
---


Special forms are syntactic structures of the language, that evaluate
differently than the general application rule (i.e.: resolve the
function, evaluate the arguments, apply). And I certainly got them and
evapply wrong, at least previously. This commit fixes the behavior.
Or at least I think so.

Internally I use `evapply` to evaluate both regular applications and
special forms. One important difference of special forms is that they
evaluate on pure syntactic structure: when `evapply` observes
`(quote A)`, it passes the list `(A)` to the handler of `quote` special
form, but when it sees `(myfun A)`, it resolves `myfun` and gets the
value from the previously bound name `A`.

But what happens if `myfun` itself is bound to a special form as in
`(let ((myfun quote) (A 314)) (myfun A))`?
I can first resolve `myfun` to `quote`, and decide to not evaluate `A`
for the special form, then expression reduces to `A`.
Or I can decide that syntactically `myfun` is not a special form, and
reduce `myfun A` to `quote 314`, and then further reduce it to `314`.

I find the second option confusing, because biding symbol `quote` to
`myfun` changed the semantics of the expression. But the first option is
also very problematic, for a different reason, explained below.

Since lambdas are values in the language, I must take care to capture
all the free variables in a lambda definition when I construct it.
Furthermore, I need to take the capture decisions without evaluating
the lambda, i.e. based on its purely syntactic structure. Now imagine
the following function: `(lambda (myfun) (myfun A))`.
The problem is: I cannot tell whether to capture `A` until I start
evaluating an application of this lambda, because only then would I know
whether `myfun` is a special form (e.g. `quote`) and the answer is NO,
or whether it is a regular function and the answer is YES.

The only reasonable conclusion I draw from all these contradictions is
that special forms are, ahem, special, and must not be used as values.
In particular, the following expressions should be illegal in the
language:
- `(let ((myfun quote)) ())`
- `(((lambda () quote)) A)`

This then means that the only way to use a special form is by using its
true name at the beginning of an S-expression `(cond ...`, `(let ...`,
and we can always decide based on syntax whether something is a special
form or not.

