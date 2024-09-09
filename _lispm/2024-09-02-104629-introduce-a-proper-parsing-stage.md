---
layout: gitlog
title: introduce a proper parsing stage
subtitle: on multiple birds and one stone
commit: https://github.com/egorich239/lispm/commit/fcf382ce1a7e9c384a908e284b93e1a759b2a965
---


As I was fixing the captures last week, I noted the abundance of
`lispm_cons_unpack_user()` calls due to the fact that I only check the
syntax structure of special forms during evaluation: program
`(cond (t))` would be successfully parsed, and only fail during
evaluation stage, when attempting to unpack two values in the first
branch of the conditional.
Birdy #1.

I also noticed that during `evcap()` evaluation of a lambda I do two
distinct things at once: 1) build up a list of free variables and check
that they are defined; and 2) capture free variables using the current
environment. In fact, the first of two things can be decided on the
syntax structure of the program, before we start evaluation.
Birdy #2.

It took me two attempts and several days to get through the changes, but
as a result I have a distinct parse stage, that performs both tasks. It
is based on replacing `Builtin::evcap` with `Builtin::parse` callback,
and introducing thing I called parse frame.

A parse frame tracks all the symbols that a special form defines, and
all the symbols that the form's body use. For example, when parsing a
lambda, I:
- allocate a new parse frame with `parse_frame_enter()` call;
- bind all lambda's formal parameters with `parse_frame_bind()` calls;
- then recursively `parse()` the lambda's body; which causes
  `parse_frame_use()` calls;
- deallocate the frame with `parse_frame_leave()` call. This call
  returns the list of variables that need to be captured to evaluate the
  frame.

For lambda, I store this list in the first cell of the triplet
`(captures, args, body)`, and `parse_lambda()` returns a lambda object,
refering to location of the triplet at the stack [^0].
At evaluation of the lambda I take this reference, and create a new
lambda object, refering to the location of triplet
`(asgns, args, body)`, where `asgns` is a list of pairs `(name, value)`.
At application of the lambda I take the assignments list and change the
association for the names to the corresponding values, and keep the old
values in the `shadow` object, which I use to restore them after lambda
application is fully evaluated.

In let-expressions parser, I trigger a new parse frame for every
assignment, but I ignore the resulting list of captures -- I however
benefit from the checks in `parse_frame_*()`:
- `parse_frame_bind()` checks that the literal is assignable, as I don't
  allow to redefine such symbols as `cons`, `let` or `t`, and that the
  symbol was not yet bound in the current frame (to prevent
   `(lambda (v v) ...)` syntax);
- `parse_frame_use()` checks that the name is bound to some value.

Killing these birds initially induced 450 bytes penalty, but I found
some optimizations that lowered this number to 250 bytes. Not good not
terrible.


[^0]: I plan to tell more about stack, htable, and garbage collection in a     later post when addressing the TODO open in gc implementation.
### verbose branch logs

* [[df953238](https://github.com/egorich239/lispm/commit/df953238cd2abb1fb3a47ee56c64eb4afd23ce15)] another optimization pass: 80 bytes less

   Large chunk of the savings is thanks to changing `lispm_st_obj_alloc()`
   to merely move the stack pointer, and off-loading the object
   initialization to the caller.
   
   Removing redundant checks in `evapply()` saved some more.
   
   The utility `parse_pair()` actually slightly pessimized the output with
   my local gcc, but I left it in nevertheless as I find that it better
   organizes the parser code.
   
   My favorite is the finding in `cons_reverse_inplace()`, where I realized
   that `M.stack + ...` evaluation is unnecessary and yields `cons[1]`.
   
* [[d73199d1](https://github.com/egorich239/lispm/commit/d73199d124be21cd7aaff67d3dbd44cac3b50b7b)] win back some 50 bytes

   Leaving the frame was more complicated than it should've been.
   
* [[d204d856](https://github.com/egorich239/lispm/commit/d204d856f39f07fe68a2aaec85d4eeba61e37a75)] long overdue: trace failed assertions

   Currently failed assertions are very uniniformative, essentially saying
   that a signal killed the process. This change finally brings a bit more
   information about the failure.
   
* [[2e15ddb2](https://github.com/egorich239/lispm/commit/2e15ddb207b6a19df3c1c9828538108a2e842abe)] a full parser passes tests

   It added whopping 500 bytes to the binary, reduce it maybe?
   
* [[d5983dcf](https://github.com/egorich239/lispm/commit/d5983dcf2f3db15b5e72519f8627c38d5880958a)] wip: Iteration over lispm/lrt0 done

   Submitting the current progress, the lispm/lrt0 binaries build alright,
   the rest does not yet build.
   
* [[9a22d549](https://github.com/egorich239/lispm/commit/9a22d54951a83ea6054bc1e1a4fc4ba661fab701)] allocate special symbols space for lexer tokens

   It has been a long standing TODO, that had no technical complications.
   
* [[21ef1f6f](https://github.com/egorich239/lispm/commit/21ef1f6f7ecdc9e3724e155e56619aed499e2662)] move htable key tag bits to lower bits

   I plan to also put lambdas into htable, and move captures analysis and
   syntactic structure checks to the parsing stage.
   