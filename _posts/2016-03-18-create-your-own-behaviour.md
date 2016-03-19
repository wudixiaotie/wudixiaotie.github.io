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


Have fun, guys! :)