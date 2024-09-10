---
layout: gitlog
title: clean up internals of lispm.c
subtitle: it's Sunday cleanup time!
commit: https://github.com/egorich239/lispm/commit/5b599573ec9a9dcb5ffe2c88a4b81915a8817932
---


I moved all the bits hackery to internal-obj.h, and optimized the code
size such that it fits back into 4K limit, taking 4082 bytes according
to `make stat` with my GCC version. This time I left more extended
explanation in the branch commits.


### verbose branch logs

* [[6061537b](https://github.com/egorich239/lispm/commit/6061537bd3536c94c7eda6397b2399def8a8c3a7)] avoid unnecessary round trip through quote

   Previously I turned the parsed empty list and numeric value into an
   instruction to quote them. The `eval()` would then reduce the
   `(CONS QUOTE val)` to `(CONS () val)`, and then return `val`. Notably,
   this extra step of reducing `QUOTE` is not needed, and we can generate
   the `(CONS () val)` instruction at the semantic analysis phase.
   
* [[a679f6d2](https://github.com/egorich239/lispm/commit/a679f6d28b377e3cca03a7dda8e4b6954eb4622e)] introduce internal-obj.h

   I extract all the bit-tagging hackery from lispm.c to a separate
   internal header file. I also noted a typo in internal-macros.h filename.
   
   Another significant change is the rework of free/bound distinction. I
   rephrase it in terms of integer comparisons:
   - forall p q. BOUND_REC(p) > BOUND(q)
              && BOUND_REC(p) > FREE(q)
   - forall p. BOUND_REC(p+1) > BOUND_REC(p)
            && BOUND(p+1) > BOUND(p)
            && FREE(p+1) > FREE(p)
   - forall p. BOUND_REC(p) > BOUND(p) > FREE(p)
   
   Then lex_frame_use overwrites the current association only if it is
   larger than the previous association.
   
   Frame depth handling got trickier. I want to avoid the
   `lispm_shortnum_val()` calls in `evframe_set()`. This means that I need
   to store a shortnum in `M.frame_depth` during evaluation. For this
   reason I always keep a shortnum in this field, however:
   - `eval()` treats this depth as a shortnum; whereas
   - `sema()` treats this depth as a regular unsigned value.
   That is because I expect `eval()` can cause `sema()` through a recursive
   `lispm_eval0()` call caused by an extension, but I don't expect any
   semantic analysis function to call `eval()`.
   I also added `frame_depth_guard()` to verify in assertions mode that
   both `sema()` and `eval()` restore the frame_depth upon exit.
   
   A minor change is that I got rid of `lispm_is_valid_result()` check. I
   let the user decide which results they consider valid.
   
* [[20761412](https://github.com/egorich239/lispm/commit/20761412e4d2d6b675be6faaded52cde965bbd94)] make lispm_init() non-throwing

   Since this function is not expected to be guarded by `lispm_rt_try()`,
   it should not throw. This means that `htable_ensure()` must return an
   error status.
   
   I took this opportunity also to simplify the interaction between lexer
   and `htable_ensure()`. Now lexer always puts the currently read literal
   at `M.tp` position and makes it NUL-terminated, whereas `htable_hash`
   and `htable_ensure` rely on this convention.
   