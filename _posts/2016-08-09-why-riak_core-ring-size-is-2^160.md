---
layout: post
title: "Why the riak_core's ring size is 2^160?"
author: "肖铁(Kevin)"
categories: erlang
---

When you want to let a vnode of riak_core do some job for you, like store a key-value data. You need to hash the key to an integer, so riak_core can find the right vnode to do the job. Because riak_core use SHA-1 hash function to generate the key to integer, and SHA-1 can only generate integer from 0 to 2^160. So if the ring's size bigger than 2^160, the vnodes which bigger than 2^160 will never be used.
