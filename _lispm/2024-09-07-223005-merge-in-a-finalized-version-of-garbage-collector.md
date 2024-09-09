---
layout: gitlog
title: merge in a finalized version of garbage collector
subtitle: and tell more about objects and their lifetime
commit: https://github.com/egorich239/lispm/commit/131f2e57687370d657c3c4f3e6aa2c1b580c6188
---


When I first came across the garbage collector in sectorlisp [^0], it
looked like a bit of dark magic, that I will never understand. However,
after having stared at this code for some time, I realized how it works,
and what assumptions about the VM it makes. Then I reproduced it in my
VM, and while I adjusted lexer, rewrote parser couple of times,
introduced semantic analysis, and tail call optimization, tracing and
debugging capabilities, -- while all that was happening -- for the
longest time garbage collector was the single unchanged piece of code in
the whole file. And even now as I changed its implementation, it still
follows the same idea, and makes the same assumptions.

The aim of garbage collector is to get rid of "stack objects" that are
no longer used. It achieves this goal by iterating over the tree of
stack objects from the root object, until some termination criteria, and
repacking this tree in a more compact way.

Let's unpack the previous paragraph.

Stack objects
-------------

First of all, let's talk about stack objects. The VM operates with
several kinds of objects. Many of them are visible to the user: the
empty list, literals, numeric values, CONS-objects, and LAMBDA-objects.
The identity of an object is encoded in a single `unsigned int`, that
uses its 2 lower bits to tag the kind of object:
- the empty list is represented by the value 0;
- the literals are represented by value `htable_offset << 2`, where
  `htable_offset` refers to the location of the literal descriptor in
  the hash table. The descriptor has two words: the first points to the
  literal name location in strings table, the second stores the
  currently assigned value for the name (see the previous post);
- the numeric values are stored as `(value << 2) | 1`.

The two lower bits `0b10` (aka 2) mark a stack object. A stack object
stores a reference to a VM's stack location. It also uses the bits 3-4
(1-based) to store the length of the object on stack: 0 for 2 words, 1
for 3 words, 2 for 4 words, 3 for 5 words. Whenever the VM needs to
allocate a 2-tuple, it subtracts two words from the current stack
pointer, and uses these two words on the stack to store the state of the
tuple. Each word in this state must be a valid object itself.

The most fundamental stack object is `(CONS a b)`. It is a pair, however
it is very common to represent lists as nested pair sequence:
`(CONS 1 (CONS 2 (CONS 3 ())))` corresponds to list of three elements:
1, 2, 3. One can note that such a structure produces an extermely
skewed binary tree. This observation is crucial later for the shallow
garbage collection implementation.

One particularly notable kind of CONS-object is a pair
`(CONS FORM ARGS)`, where `FORM` is one of the VM's evaluation rules:
COND, LET, LAMBDA, LETREC, (APPLY), (ASSOC), and `ARGS` represents its
arguments. The semantic analysis stage verifies the parsed code
correctness, and produces these forms as program code, that is used for
evaluation. Some `ARGS` are represented by 3-tuples, e.g. lambda is a
3-tuple of its capture list, its arguments, and its body.

The key takeaway is that VM uses its stack to keep 2- to 5-tuple
objects that represent results of lexing, parsing, semantic analysis and
evaluation.

... and their variety
---------------------

A user program produces exactly one object, which might be an error, an
atom, a lambda, or a list of atoms, lambdas or lists. During evaluation
there always is a single not fully reduced form that we reduce further
until we either get an error or a non-error result. A not fully reduced
expression has the previously mentioned form `E = (CONS FORM ARGS)`.
Notice that when we reduce an expression `E` in the context `C` to
expression `E1`, we can discard `E`, or at least its part that is not
shared with `E1`.

Besides these two major kinds of objects (values, and non-reduced
expressions), there are additional auxiliary objects. For example
5-tuples, described in the previous post and storing the state of
locally bound names. These objects are not reachable from the objects in
the previous paragraph.

Notice that all kind of objects mentioned so far can be refered to from
the hash table, because a literal is bound to such a value. This is
where a very important idea should sink in: we cannot freely move
objects on the stack at any time, because this would corrupt the
from the hash table.

The anatomy of the stack and hash table
---------------------------------------

One of the most fundamental properties of `eval()` is that it preserves
the state of the hash table before the call. If it changes anything
while performing its duties, then it reverses these changes before
returning.

Another important property of `eval()` is that it always returns a
value, never a non-reduced expression.

Imagine one had stack pointer value `sp0` before `eval()` call, and
`sp1 <= sp0` after the call. Also `eval()` returned some value `v`.

If `v` is not a stack object, then we know that we can discard
_everything_ between `sp1` and `sp0` -- those are the objects that
`eval()` allocated during its runtime, and they are neither refered from
the hash table (see the fundamental property above), nor from the
result.

Now, if `v` _is_ a stack object, then it is a reference to the root of a
tree of objects. The branches of this tree can go deeper than `sp0` in
the stack. For example, if `eval()` evaluated `(CONS a b)` for two stack
objects `a` and `b` then both these objects are located above `sp0` [^1],
whereas the resulting value `v` is somewhere between `sp1` and `sp0`,
and it contains references to `a` and `b` in its cells. We therefore
talk of the lower part of the tree (below `sp0`) and the upper part of
the tree (at `sp0` and above).

The important observation here is that we can reconstruct a dense
version of the lower part of the tree directly under `sp0`, because
1) this part of the tree was not bound to any name in the hash table
   before `eval()` started, hence it is not bound to anything in the
   hash table after (thanks to the fundamental property); and
2) except for the lower part of the tree `v`, no other object on the
   stack between `sp1` and `sp0` is referenced from anywhere. This
   includes the 5-tuples that were used during `eval()` to preserve the
   previous values associated with the literals -- these 5-tuples are no
   longer used.

How to invoke garbage collector
-------------------------------

The garbage collector receives two inputs: the root value `v` and the
`high_mark`, separating the lower part of the stack from the upper part
of the stack. The upper part of the stack is used by the `eval()` calls
higher in the execution stack, hence they may contain some objects that
should be neither moved nor deleted.

I memorize the `high_mark` at the entrance to `eval()`, then run the
main loop of evaluation, and after this is done, and the previous
bindings of the names are restored, the only important object on the
lower part of the stack is the return result of `eval()`. Hence, I call
the garbage collector with this result value and the memorized value of
`high_mark`.

This compactifies the lower part of the result tree to the top of the
available stack.

The anatomy of compactification
-------------------------------

When gc starts its work, the stack pointer is located at point that I
call `low_mark`. The first thing the garbage collector does is it
creates a copy of the lower part of the result tree _below_ the
`low_mark`. Then it copies the objects from below the `low_mark` to just
below the `high_mark`. This latter copy changes the location of all
nodes in the lower part of the tree by `high_mark - low_mark`, so the
former copy adjusts for this offset when it creates the nodes.

The shallow gc
--------------

The initial implementation of the garbage collector simply called
`gc0()` function for every subobject of a stack object. However, as
mentioned earlier, the trees that gc copies are extremely skewed, being
essentially linked lists with payload.

If we take this consideration into account, then we can iterate over the
linked list and call `gc0()` recursively for all elements _except_ the
next element pointer. This creates a reversed linked list copy of the
original list. I then reverse this linked list in-place, and voila -- I
have a reconstructed copy of the original linked list.

The fact that the linked list can contain 2-, 3-, 4-, or 5-tuple at each
position does not change anything in the overall algorithm.

Wrap up
-------

To reiterate on the statement at the top of the note: garbage collector
creates a compact copy of the lower part of the result tree at the part
of the stack that is used exclusively by the current `eval()` call after
this `eval()` call restored the state of the hash table. The termination
criteria for the tree walk is: either non-stack object or a stack object
in the upper part of the stack.

The shallow garbage collection avoids recursion over linked list by
first creating the reversed compact copy, and then reversing it in-place.


[^0]: https://github.com/jart/sectorlisp
[^1]: Reminder: stack grows down.
### verbose branch logs

* [[5ba384da](https://github.com/egorich239/lispm/commit/5ba384da0339a1031fdf6ffb0b741b3e0668416a)] step 11: avoid unnecessary gc call

   Each `eval()` call in `list_map(expr, eval)` moves the result at the
   very top of the available stack. Adding one more gc call after the
   mapping is done does not do anything to the stack.
   
* [[6898509f](https://github.com/egorich239/lispm/commit/6898509fa50a313e0c0517435a5e5b46b53cae35)] step 10: minor cleanup, some more bytes won

* [[fd4f7231](https://github.com/egorich239/lispm/commit/fd4f72318b506f7b332c00922d4652971dc62fab)] step 9: more straight-forward logic for gc
