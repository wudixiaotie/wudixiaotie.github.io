---
layout: post
title:  "Production environment-diagnose"
author: "肖铁(Kevin)"
categories: erlang
---

How to diagnose problems in production environment? The answer is [recon](https://github.com/ferd/recon). Great tool  
 in production to diagnose Erlang problems.  


Set the current unit to be used by recon_alloc. This effects all functions that return bytes:
{% highlight erlang %}
recon_alloc:set_unit(X1::byte | kilobyte | megabyte | gigabyte).
{% endhighlight %}


CPU useage top 5 processes:
{% highlight erlang %}
recon:proc_count(reductions, 5).
{% endhighlight %}


Memory useage top 5 processes:
{% highlight erlang %}
recon:proc_count(memory, 5).
{% endhighlight %}


Message queue length top 5 processes:
{% highlight erlang %}
recon:proc_count(message_queue_len, 5).
{% endhighlight %}


Total heap size top 5 processes:
{% highlight erlang %}
recon:proc_count(total_heap_size, 5).
{% endhighlight %}


Heap size top 5 processes:
{% highlight erlang %}
recon:proc_count(heap_size, 5).
{% endhighlight %}