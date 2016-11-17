---
layout: post
title: "Erlang && SmartOS bin leak"
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

```shell
prstat -c -p 76967 1    # 1 means interval is 1 second
prstat -c -u howl 1    # -u means user is howl
kstat -pc zone_memory_cap
kstat -p memory_cap:394:8a185b30-ad05-6a3a-fa20-fc190f
```