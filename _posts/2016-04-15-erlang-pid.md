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


If you send a Pid to other node, the first part of pid will change.  


**Node a**
{% highlight console %}
>erl -sname a

Erlang/OTP 18 [erts-7.1] [source] [64-bit] [smp:8:8] [async-threads:10] [kernel-poll:false]

Eshell V7.1  (abort with ^G)
(a@xiaotie-Inspiron-7720)1> register(shell, self()).
true
{% endhighlight %}


**Node b**
{% highlight console %}
>erl -sname b

Erlang/OTP 18 [erts-7.1] [source] [64-bit] [smp:8:8] [async-threads:10] [kernel-poll:false]

Eshell V7.1  (abort with ^G)
(b@xiaotie-Inspiron-7720)1> net_adm:ping('a@xiaotie-Inspiron-7720').
pong
(b@xiaotie-Inspiron-7720)2> {shell, 'a@xiaotie-Inspiron-7720'} ! self().
<0.39.0>
{% endhighlight %}


**Node a**
{% highlight console %}
(a@xiaotie-Inspiron-7720)2> flush().
Shell got <6807.39.0>
ok
{% endhighlight %}


You can see the first part of pid changed from 0 to 6807, this number is different  
 in each node. That means even there is a node c, the message it receive will not  
 be <6807.39.0>, but may be <7122.39.0> or whatever. Since you already know the pid  
 of process on the other node, you can send message to it directly.  


Then there is a problem, if **node b** want to store pid like **<0.39.0>** to some kind of  
 public database or cache like redis or postgresql, how could I do to make **node a** get  
 the remote type(<6807.39.0>) not the local type(<0.39.0>) when it read pid data  
 from db?


I use term_to_binary to solve the problem!


{% highlight console %}
Erlang/OTP 18 [erts-7.1] [source] [64-bit] [smp:8:8] [async-threads:10] [kernel-poll:false]

Eshell V7.1  (abort with ^G)
1> erlang:term_to_binary(node()).
<<131,100,0,13,110,111,110,111,100,101,64,110,111,104,111,
  115,116>>
2> erlang:term_to_binary(self()).
<<131,103,100,0,13,110,111,110,111,100,101,64,110,111,104,
  111,115,116,0,0,0,33,0,0,0,0,0>>
{% endhighlight %}


Like the highlight code above, as you can see binary **<<100,0,13,110,111,110,111,100,101,64,110,111,104,111,115,116>>**  
 both in node() and self(), it means the pid itself already contains the node info.  
So if I use erlang:term_to_binary to change the pid to binary, then store the binary  
 to redis, it will be an remote pid when other node get it and use erlang:binary_to_term  
 to transform it.


**So if you store the erlang pid to ssdb or redis or other kind of db, and want other  
node to read it, use erlang:term_to_binary.**


Have fun, guys! :)