---
layout: post
title:  "Where does gen_server store cast messages?"
author: "肖铁(Kevin)"
categories: erlang
---

I was wondering where a gen_server process store cast messages. I know you can send  
a message to it, then handle_info will be triggered. But what about handle_cast?  
What about handle_call? If I run gen_server:cast(ID, Msg), then what happened?  
Where the message go?  


We know that sending message is the only way when erlang processe want to communicate  
with each other. So the cast message must be in the process's message queue. But  
how does the gen_server process tell the difference between normal message and cast  
message?  


After reading the implementation of gen_server, I find out that gen_server:cast/2  
function transform the message from Msg to {'$gen_cast', Msg}. So when gen_server  
process receiving {'$gen_cast', Msg}, it call Mod:handle_cast/2. Same as gen_server:call/2,  
but transform the message to {'$gen_call', Msg}.


I was writting a high performance asynchronous pool these days. It gives me a different  
view of erlang, makes me thinking a lot of staffs.


Writting a blog in English is too hard for me! I hope it can practise my language,  
and I can speak like the locals some day.

Have fun! :)