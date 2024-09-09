---
layout: gitlog
title: report errors via trace mechanism
subtitle: "I saw the angel in the marble and carved until I set him free"
commit: https://github.com/egorich239/lispm/commit/810b288990e8733e4a1c787322240ca7000a993d
---


At some point in the past I implemented human readable error messaging,
because I really needed some context when something went wrong. A mere
!EVAL is very uninformative. I allocated the first 256 bytes of strings
memory for the storage of an error message, and a single word at the
very bottom of the stack for an additional context symbol.

This worked but it didn't feel right. I allocated the buffer and defined
`lispm_error_message_get()/set()` functions even in non-VERBOSE mode
when they are useless, and in fact wasteful. I could've protected all of
it with `#if/#end` macros but that would change API between the two
modes, and would also impede on the minimalism principle [^0].

In fact, I think that the minimalism is an important instrument for
thought experiments. In this particular case it manifests itself in two
questions:
- is my development environment sufficient without error messages?
- is VM well defined without error messages?

The answer to the first one is NO. By saving on these features I lose
my time on very repetitive scenarios in GDB sessions, which all look the
same modulo slight variations in the frame number and variable name:

```scheme
br longjmp
r
fr 3
p literal_name(p)
call lispm_print_short(p)
```

The answer to the second question is YES. A bug-free VM implementation
running a bug-free terminating program with sufficient resources never
needs introspection features. Those are as we all know impractical
assumptions, so we still want some means of looking into the VM, but
what is the least intrusive way to do so, inducing the minimal overload
on the design of the VM?

The observer already has full access to the state of `lispm` symbol,
i.e. the current state of the VM, because it actually provides this
symbol, declared as an `extern` object in `lispm.c` library.

Beyond the state, a keen observer would be interested in VM actions.
And that's where the mechanism of callbacks comes in handy: let the
observer manage all the state and side-effects of the trace callbacks,
and remove this state from the VM.

The ground work for trace callbacks has actually already been laid when
I needed full application history (as opposed to the current stack
frame).

In this commit I add `panic` trace event that is activated when
`LISPM_EVAL_CHECK()` condition fails, shortly before the VM stops.


[^0]: See development principles in README file.