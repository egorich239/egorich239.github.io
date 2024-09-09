---
layout: gitlog
title: monitor stack depths
subtitle: on measurements
commit: https://github.com/egorich239/lispm/commit/72634de1169604d1ae2cbc3eaf7a3cb85e365922
---


Before I venture into GC changes, I would like to lay the ground work
s.t. I can verify the impact of my future changes.

Apart from that, there was a long standing open problem with the VM --
it could segfault once it runs out of native call stack. Worse yet, if
this code would run on a machine without memory protection, it can
overwrite something crucial. Not cool.

I here introduce two more runtime calls, and guard every recursive
function with a check of the native stack depth.

