---
layout: post
title:  "Erlang Pid!"
author: "肖铁(Kevin)"
categories: erlang
---

Why am I talking about pid? Everyone knows how to use it:  


**When you want to send a message to a process:**
{% highlight erlang %}
Pid ! fuck.
{% endhighlight %}


**Get information about a process:**
{% highlight erlang %}
erlang:process_info(Pid).
{% endhighlight %}


**Which node is the process in:**
{% highlight erlang %}
erlang:node(Pid).
{% endhighlight %}


Is that all? No, there's more things you don't know! Like what? Like what does the  
 number means in the pid? Process id < A.B.C > is composed of:

**A**, node id which is not arbitrary but the internal index for that node in dist_entry.  
(It is actually the atom slot integer for the node name. 0 is the local node, an  
 arbitrary number for a remote node)  
**B**, process index which refers to the internal index in the proctab, (0 -> MAXPROCS).  
**C**, Serial which increases every time MAXPROCS has been reached.  


You may take MAXPROCS and process_limit for mistake, But these are two different  
 things. The process_limit is the maximum number of simultaneously existing processes  
 in node. The MAXPROCS is just the maximum number of the process index, it length  
 15 bits, so the number may be 32768. If you start an node like this:


{% highlight console %}
erl +P 1024
{% endhighlight %}


The number of simultaneously existing process must smaller than 1024, so the bigest  
 pid of the node is <0.**1023**.0>, but when some process died, the index of pid will  
 growth, like <0.**1024**.0>, <0.**2058**.0>. When the index upto MAXPROCS, the index will  
 start with **0**. The third part of the pid will incease one, like <0.0.**1**>. **So we don't  
 need to worry about the pid will repeat when the node runs long enough.**


<!-- Se -->



<!-- term_to_binary(node()).
term_to_binary(self()).


Process id < A.B.C > is composed of:

A, node id which is not arbitrary but the internal index for that node in dist_entry. (It is actually the atom slot integer for the node name.)
B, process index which refers to the internal index in the proctab, (0 -> MAXPROCS).
C, Serial which increases every time MAXPROCS has been reached.
The creation tag of 2 bits is not displayed in the pid but is used internally and increases every time the node restarts.


So, you can se that the node name is internally stored in the pid. More info in this section of Learn You Some Erlang. -->