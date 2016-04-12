---
layout: post
title:  "Production environment-diagnose"
author: "肖铁(Kevin)"
categories: erlang
---

How to diagnose problems in production environment? The answer is [recon](https://github.com/ferd/recon). Great tool  
 in production to diagnose Erlang problems.  


**Set the current unit to be used by recon_alloc. This effects all functions that return bytes:**
{% highlight erlang %}
recon_alloc:set_unit(X1::byte | kilobyte | megabyte | gigabyte).
{% endhighlight %}


**CPU useage top 5 processes:**
{% highlight erlang %}
recon:proc_count(reductions, 5).
{% endhighlight %}


**Memory useage top 5 processes:**
{% highlight erlang %}
recon:proc_count(memory, 5).
{% endhighlight %}


**Message queue length top 5 processes:**
{% highlight erlang %}
recon:proc_count(message_queue_len, 5).
{% endhighlight %}


**Total heap size top 5 processes:**
{% highlight erlang %}
recon:proc_count(total_heap_size, 5).
{% endhighlight %}


**Heap size top 5 processes:**
{% highlight erlang %}
recon:proc_count(heap_size, 5).
{% endhighlight %}


**Memory:**
{% highlight erlang %}
recon_alloc:memory(used).
{% endhighlight %}


In production, if some node is long-term running, for example years, the key processes  
 of the node will have a big memory used, but the heap_size is small, why? Beause  
 there will be too many mbc(multiblock carrier), most of them is almost empty,  
 but not. There always be some blocks in it which have data. Like pricture below:  


![mbcs]({{ site.url }}/images/mbcs.png)


Normal garbage collection only remove or deallocate the block which data is useless,  
 but do not deallocate the mbc. The block in mbc will be reused when the size of  
 data fit the remainning room of the mbc. But most of the time it doesn't fit.  
So a new mbc is allocated in heap. As the node runs, more memory is allocted, but  
 the used is very low.


You may say "The erlang vm is suck!". No, the designer of the Beam knew there  
 will be a situation like this. So they give the Beam a strategy when process do  
 the normal gargage collection for some times, it will do a **fullsweep GC**.  


What is fullsweep GC? Unlike the normal GC, the fullsweep GC dealloced the mbc.  
When a fullsweep GC happens, Beam will try to gather the block which contains data  
 to some of the mbcs as much as possible, so these mbcs is full of data, the remains  
 mbcs which is full of empty blocks can be deallocated. That is why after the  
 fullsweep GC the memory of the process reduce.  


How do we controll what is the time to let the process have a fullsweep GC? When  
we create a process, we use spawn_opt(Module, Function, Args, [{fullsweep_after, 10}]).  
That means this process will do a fullsweep GC after it have done 10 times normal GC.  
If we use spawn to create a process, the default fullsweep_after is 65535.  


Have fun, guys! :)