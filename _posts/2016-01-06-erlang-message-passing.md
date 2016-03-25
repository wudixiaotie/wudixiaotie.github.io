---
layout: post
title:  "Erlang Message Passing"
author: "肖铁(Kevin)"
categories: erlang
---

##我的疑问

按照[Beam Internal Doc -- DelayedDealloc!](/erlang/2015/12/29/beam-internal-doc-DelayedDealloc.html)说的意思，我以为这个Delayed Dealloc只是在调度器进行任务迁移的时候才有用。直到重新看了褚霸的文章，原来现代的多核cpu（又叫smp--Symmetric Multi-Processing对称多处理器）在设计的时候为了保证可扩展性的目的，为每个cpu单独分配了一部分内存，这样cpu和自己的内存组成的节点在一起称为NUMA（Non-Uniform Memory Access）系统。好处是cpu和内存在物理上都是分布，扩展性得到了有效的提高，每个cpu访问自己本地的内存速度远远快于远程访问其他cpu的内存。而我们的ERTS（erlang run-time system）为了也能从NUMA系统结构中受益，在SMP模式下，每个scheduler都对应一个CPU并且有自己的一套alloctor，所以每个scheduler所分配的内存都是CPU所属内存，这样效率是最高的。按照褚霸的意思消息的发送会导致释放瓶颈，而延迟释放则有效的解决了这个瓶颈，我就研究了一下ERTS的message passing。


##消息的发送

发消息的流程是这样的，在erlang进程层面是发消息的进程A先在自己的堆空间创建个待发送消息的副本，然后生成一个通知（包含指向A堆空间消息副本的指针）并把通知放入接收消息的进程B的mailbox中。

B的mailbox实际实现上是2个队列（位于进程的PCB中）：

1. **接收队列**  
    接收队列用来接收A进程的通知，这个队列是有锁的，因为同时会有好多进程访问这部分内存，为了防止数据竞争，所以加了锁。
2. **处理队列**  
    这个队列是没锁的，B进程优先去这个队列取消息，当这个队列为空则接收队列把自己的消息追加到本队列。


当进程A进行GC的时候，位于其私有堆中的待发送消息的副本就会被合并到进程B的私有堆中。假设进程A所在的scheduler被绑定到CPU_A上，而进程B所在的scheduler被当定到CPU_B上。那么这个消息的副本实际上是被CPU_A对应的线程创建在了CPU_A对应的内存中了，然后CPU_B上的线程有个指针指向这个内存，每次访问这个内存都要CPU远程内存访问，据说比直接访问本地内存效率低了40%。



**那么问题来了，Delayed Dealloc实际上也没解决这个问题啊？！**

Delayed Dealloc不是解决这个问题的，而是解决每次线程要释放内存， 如果内存属于远程内存就要产生等待，你等我，我能他，等来等去效率低。而延迟释放，每次要释放内存都由创建线程释放，当前线程不用等待，可以继续执行，效率提高很多。
