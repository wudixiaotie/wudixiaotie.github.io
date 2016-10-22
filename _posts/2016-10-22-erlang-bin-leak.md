---
layout: post
title: "Erlang bin leak"
author: "肖铁(Kevin)"
categories: erlang
---

```erlang
recon:bin_leak(5).
recon:proc_count(memory, 5).
recon:info(A,B,C).
```

Set fullsweep_after to 0.
vm_args.-env ERL_FULLSWEEP_AFTER