---
layout: post
title:  "Create your own behaviour"
author: "肖铁(Kevin)"
categories: erlang
---

I was writting an high performance asynchronous pool recently. I used gen_server  
as the behaviour of all the workers, workers doing their jobs by follow the message  
they received. Then I found out most of the function that gen_server supported are  
useless at this circumstances, like handle_call, handle_cast, code_change.  


Then I read gen_server.erl, it turns out that a lot of code is try to figure out  
which function should be called when there is a message send to an gen_server process.  
If the message is {'$gen_call', _} then handle_call is what we need, if the message  
is {'$gen_cast', _} then we should call handle_cast, otherwise we should call handle_info.  


But in the matter of fact, handle_info is the only callback I usually use. I don't  
use handle_call very often, and I cann't tell the diffence between handle_cast and  
handle_info, I nearly do not use handle_cast&code_change for one single time. So  
I think it's time to begin to create my own behaviour.


This behaviour I want to create is simple. It just have 3 callbacks: init/1, handle_msg/2,  
terminate/2. It can only handle message from process message queue. I call it gen_msg.  
I want gen_msg adhering to the OTP Design Principles, so I need to use proc_lib:start_link/3  
instead of erlang:spawn/3. There is some diffiences between normal processes and  
OTP processes.  


The gen_msg should also have some functions about system messages.  
The system messages are messages with a special meaning, used in the supervision tree.  
Typical system messages are requests for trace output, and requests to suspend or  
resume process execution (used during release handling). Processes implemented  
using standard behaviours automatically understand these messages. So I also have  
to implemant system_continue/3, system_terminate/4, write_debug/3, system_get_state/1,  
system_replace_state/2, format_status/2.  


The format_status/2 is used for give the otp real state of gen_msg process not all.  
If I don't export format_status/2, then a new term contain the state of gen_msg  
but with more information that you don't want to know will show in observer.


When gen_msg process start, do_init/3 will be called, then I will set the '$initial_call'  
in the process dictionary to module name of the process. Otherwise the value will be  
gen_msg. That will make process behaviour be undefined when we watch from observer.  
About this if you want to know more, check out sys:get_status/4.  


There is something I want to mention, proc_lib:init_ack(Parent, {ok, self()}).  
This means send {ok, self()} to the parent process which called proc_lib:start_link  
to start an gen_msg process, then the {ok, self()} will be the return value of  
proc_lib:start_link.  


That's it. The code is [here](https://github.com/wudixiaotie/hpap/blob/master/src/hpap/gen_msg.erl).  
This is the module which use gen_msg as its behaviour: [hpap_migration_control_center.erl](https://github.com/wudixiaotie/hpap/blob/master/src/hpap/hpap_migration_control_center.erl).


After I run some test between gen_msg([test_for_gen_msg.erl](https://github.com/wudixiaotie/simple_im/blob/master/apps/simple_im/test/test_for_gen_msg.erl)) and gen_server([test_for_gen_server.erl](https://github.com/wudixiaotie/simple_im/blob/master/apps/simple_im/test/test_for_gen_server.erl)), I found the performance improve obviously as shown below:  

```console
Erlang/OTP 18 [erts-7.1] [source] [64-bit] [smp:4:4] [async-threads:10] [hipe] [kernel-poll:true]

Eshell V7.1  (abort with ^G)
1> test_for_gen_msg:start_link().
{ok,<0.36.0>}
2> test_for_gen_server:start_link().
{ok,<0.38.0>}
3> test_for_gen_msg:test(10000).
ok
======gen_msg:  Times:10000 Cost:28706
4> test_for_gen_msg:test(10000).
ok
======gen_msg:  Times:10000 Cost:28861
5> test_for_gen_msg:test(10000).
ok
======gen_msg:  Times:10000 Cost:29590
6> test_for_gen_server:test(10000).
ok
======gen_server:  Times:10000 Cost:42785
7> test_for_gen_server:test(10000).
ok
======gen_server:  Times:10000 Cost:42638
8> test_for_gen_server:test(10000).
ok
======gen_server:  Times:10000 Cost:43177
9> test_for_gen_msg:test(50000).   
ok
======gen_msg:  Times:50000 Cost:1639784
10> test_for_gen_msg:test(50000).
ok
======gen_msg:  Times:50000 Cost:1618026
11> test_for_gen_msg:test(50000).
ok
======gen_msg:  Times:50000 Cost:1624411
12> test_for_gen_server:test(50000).
ok
======gen_server:  Times:50000 Cost:2451298
13> test_for_gen_server:test(50000).
ok
======gen_server:  Times:50000 Cost:2409513
14> test_for_gen_server:test(50000).
ok
======gen_server:  Times:50000 Cost:2414638
```

When they got 10000 messages, gen_msg took round 0.028 seconds to process them all,  
gen_server took 0.43. When the number of message increased to 50000, each time is  
1.6 seconds and 2.4 seconds.


So the result tells everything, gen_msg spent just 65% of what gen_server spent.  
I think it is some kind of success. Hahaha!!!  


Have fun, guys! :)