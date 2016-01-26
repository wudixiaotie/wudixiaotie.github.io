---
layout: post
title:  "Beam Internal Doc -- ThreadProgress!"
author: "肖铁(Kevin)"
categories: erlang
---

##问题

###知道什么时候线程完成对一个数据结构体的访问

当多个线程都要访问同一个数据结构体时，你通常想要知道什么时候所有的线程都完成对这个结构体的访问。举个例子，需要知道什么时候能安全的释放掉某个数据结构体。一个简单的方式是对所有访问这个数据结构体的线程进行引用计数。这种方式的缺点是引用计数所存储的cache line需要与所有涉及到的处理器进行通信。这种通信的消耗极度昂贵并且如果引用计数被频繁访问会使得并发性能严重下降。这也就是为啥我们想要通过其他途径来跟踪线程的进展而不是通过引用计数的方式。

###知道所有对内存的改动都是始终被监控着的

不同的硬件架构有不同的内存模型。有些架构非常会积极的对内存访问进行指令重排（什么是指令重排呢？以前说过内存屏障，其实指令重排就是要进行内存屏障的原因。指令重排就是因为CPU要提高速度，所以对代码变成的指令进行重新排序。一个指令的执行被分成：取指、译码、访存、执行、写回、等若干个阶段。然后，多条指令可以同时存在于流水线中，同时被执行。指令流水线并不是串行的，并不会因为一个耗时很长的指令在“执行”阶段呆很长时间，而导致后续的指令都卡在“执行”之前的阶段上。相反，流水线是并行的，多个指令可以同时处于同一个阶段，只要CPU内部相应的处理部件未被占满即可。相比于串行+阻塞的方式，流水线像这样并行的工作，效率是非常高的。但是某些指令是必须要等到另外一个指令执行后才能正确执行，如果有依赖关系的两个指令之间距离过近，则后一个指令肯定要等待一段时间，以便第一个指令执行完成，那么为了不让这种指令等待的情况发生，编译器就会在生成指令的时候，把有依赖关系的指令故意分开很远的距离，这样当CPU开始执行后一个指令的时候，之前的指令早就得到结果了。以上就是指令重排，也叫CPU乱序执行。）而另一些架构只有少数情况才会进行指令重排。但是所有现代硬件都会发生CPU指令重排。当用锁来保证多线程下的所有内存访问就不会产生CPU指令重排。锁会保证内存访问回事按顺序的。当我们用无锁算法时就应该考虑硬件架构带来的指令重排。

硬件内存屏障或者内存栅栏是用来保证内存访问必须有序的指令。不同的硬件架构有不同的内存屏障。无锁算法就必须要用到内存屏障来保证内存的访问顺序，从而避免算法崩溃。同时内存屏障也是很耗费资源的指令，所以你通常要尽量少用这些指令。

##解决这些问题的功能

Erlang虚拟机的“thread progress”（有人翻译成线程进度追踪）就是解决这些问题的。之所以命名“thread progress”，是因为我们需要它去确定一组线程是否全部达到一定的进度，从让他们发生两个特殊事件。

这组我们感兴趣的进程叫做托管（managed）线程。我们只能获取托管线程的信息，因为这些线程必须要经常性的报告进度。而不是所有的Erlang虚拟机线程都需要频繁的报告进度。这些不是托管线程的线程叫做非托管（unmanaged）线程。异步线程池里的线程就是非托管线程。异步线程可以被阻塞很长时间，由此导致不能频繁的报告进度。现阶段只有调度器线程和两个其他线程是托管线程（这两个其他线程是：完成辅助工作的线程和系统消息分发线程）。

##Thread Progress Events

ERTS的任何线程都有可能使用“线程进度功能”，来确定何时所有托管线程已发生了至少一次下列事件：

1. 线程已经从其他代码那里返回到线程进度功能中的某个已知状态中，这个状态不依赖于任何其他代码。
2. 线程执行完了一次完整的内存屏障。

这些事件必须保证和其他内存操作不会同时发生。怎么来保证呢？首先要初始化“线程进度操作”。线程在初始化“线程进度操作”后轮寻操作的完成情况。在每个托管线程的“线程进度操作”初始化后和完成前，这两个事件都必须发生至少一次。由于通过内存来通信可以让我们在“线程进度操作”完成后得知内存的状态，从而保证了上述规则。我们把线程的这种从开始到完成的过程叫做“线程进度”。

假设线程进度功能是开启的，很多算法都可以又简单又比直接想到的算法有效。看下面的例子。

由于可以确定事件No1是什么时候发生的，我们可以很容易的知道什么时候所有的托管线程都完成了对数据结构体的访问。怎么确定呢？现有某个函数F的实现，F使用了一个数据结构体D。每当D被访问时，都会通过D的引用去查找D。当线程离开函数F的时候，对D的引用都会被销毁。如果我们移除查找D的可能性，然后等到所有托管线程都发生过事件No1，这时他们都没有对数据结构体D的引用。这是如果使用引用计数，所有的处理器都会把引用计数器载入到自己拥有的缓存当中，每次某个处理器访问D时会更新自己所属的缓存中的引用计数和内存中的引用计数，其他的处理器所属缓存中的引用计数都会失效，而现实情况是，整个引用计数所属的缓存行都失效了，而不仅仅是引用计数，因为对处理器来说载入和失效都是以缓存行为单位的。所以每次某个处理器更新引用计数，对应的缓存行要重新写入到内存，然后其他所有的处理器都要从内存中重新读取含有引用计数的缓存行到自己的缓存中。

通过确定事件No2什么时候发生，从而使得必须要多个线程同步数据的复杂的内存修改变得很容易，而不用通过加锁来实现。做内存修改时，先是发出了完整的内存屏障，然后等待直到事件No2在所有的托管线程都发生，然后发布这次修改，我们就知道所有的托管线程在去读这部分内存的时候得到的都是统一的修改结果。其他的托管线程再读取这个内存的时候不必在使用额外的内存屏障了。

##Implementation of the Thread Progress Functionality

###Requirement on the Implementation

为了有能力确定什么时候所有托管线程到达了一个状态，什么状态呢？我们感兴趣的状态，我们需要在所有涉及到的线程之间通讯。我们当然想让这中通信消耗最小。

我们还想

<br />
<br />

#=========================原文=========================

Thread Progress
===============

Problems
--------

### Knowing When Threads Have Completed Accesses to a Data Structure ###

When multiple threads access the same data structure you often need to
know when all threads have completed their accesses. For example, in
order to know when it is safe to deallocate the data structure. One
simple way to accomplish this is to reference count all accesses to
the data structure. The problem with this approach is that the cache
line where the reference counter is located needs to be communicated
between all involved processors. Such communication can become
extremely expensive and will scale poorly if the reference counter is
frequently accessed. That is, we want to use some other approach of
keeping track of threads than reference counting.

### Knowing That Modifications of Memory is Consistently Observed ###

Different hardware architectures have different memory models. Some
architectures allows very aggressive reordering of memory accesses
while other architectures only reorder a few specific cases. Common to
all modern hardware is, however, that some type of reordering will
occur. When using locks to protect all memory accesses made from
multiple threads such reorderings will not be visible. The locking
primitives will ensure that the memory accesses will be ordered. When
using lock free algorithms one do however have to take this reordering
made by the hardware into account.

Hardware memory barriers or memory fences are instructions that can be
used to enforce order between memory accesses. Different hardware
architectures provide different memory barriers. Lock free algorithms
need to use memory barriers in order to ensure that memory accesses
are not reordered in such ways that the algorithm breaks down. Memory
barriers are also expensive instructions, so you typically want to
minimize the use of these instructions.

Functionality Used to Address These Problems
-------------------------------------------

The "thread progress" functionality in the Erlang VM is used to
address these problems. The name "thread progress" was chosen since we
want to use it to determine when all threads in a set of threads have
made such progress so that two specific events have taken place for
all them.

The set of threads that we are interested in we call managed
threads. The managed threads are the only threads that we get any
information about. These threads *have* to frequently report
progress. Not all threads in the system are able to frequently report
progress. Such threads cannot be allowed in the set of managed threads
and are called unmanaged threads. An example of unmanaged threads are
threads in the async thread pool. Async threads can be blocked for
very long times and by this be prevented from frequently reporting
progress. Currently only scheduler threads and a couple of other
threads are managed threads.

### Thread Progress Events ###

Any thread in the system may use the thread progress functionality in
order to determine when the following events have occured at least
once in all managed threads:

1.  The thread has returned from other code to a known state in the
    thread progress functionality, which is independent of any other
    code. 
2.  The thread has executed a full memory barrier.

These events, of course, need to occur ordered to other memory
operations. The operation of determining this begins by initiating the
thread progress operation. The thread that initiated the thread
progress operation after this poll for the completion of the
operation. Both of these events must occur at least once *after* the
thread progress operation has been initiated, and at least once
*before* the operation has completed in each managed thread. This is
ordered using communication via memory which makes it possible to draw
conclusion about the memory state after the thread progress operation
has completed. Lets call the progress made from initiation to
comletion for "thread progress".

Assuming that the thread progress functionality is efficient, a lot of
algorithms can both be simplified and made more efficient than using
the first approach that comes to mind. A couple of examples follows.

By being able to determine when the first event above has occurred we
can easily know when all managed threads have completed accesses to a
data structure. This can be determined the following way. We have an
implementation of some functionality `F` using a data structure
`D`. The reference to `D` is always looked up before `D` is being
accessed, and the references to `D` is always dropped before we leave
the code implementing `F`. If we remove the possibility to look up `D`
and then wait until the first event has occurred in all managed
threads, no managed threads can have any references to the data
structure `D`. This could for example have been achieved by using
reference counting, but the cache line containing the reference
counter would in this case be ping ponged between all processors
accessing `D` at every access.

By being able to determine when the second event has occurred it is
quite easy to do complex modifications of memory that needs to be seen
consistently by other threads without having to resort to locking. By
doing the modifications, then issuing a full memory barrier, then wait
until the second event has occurred in all managed threads, and then
publish the modifications, we know that all managed threads reading
this memory will get a consistent view of the modifications. Managed
threads reading this will not have to issue any extra memory barriers
at all.

Implementation of the Thread Progress Functionality
---------------------------------------------------

### Requirement on the Implementation ###

In order to be able to determine when all managed threads have reached
the states that we are interested in we need to communicate between
all involved threads. We of course want to minimize this
communication.

We also want threads to be able to determine when thread progress has
been made relatively fast. That is we need to have some balance
between comunication overhead and time to complete the operation.

### API ###

I will only present the most important functions in the API here.

*   `ErtsThrPrgrVal erts_thr_progress_later(void)` - Initiation of the
    operation. The thread progress value returned can be used testing
    for completion of the operation.
*   `int erts_thr_progress_has_reached(ErtsThrPrgrVal val)` - Returns
    a non zero value when we have reached the thread progress value
    passed as argument. That is, when a non zero value is returned the
    operation has completed.

When a thread calls `my_val = erts_thr_progress_later()` and waits for
`erts_thr_progress_has_reached(my_val)` to return a non zero value it
knows that thread progress has been made.

While waiting for `erts_thr_progress_has_reached()` to return a non
zero value we typically do not want to block waiting, but instead want
to continue working with other stuff. If we run out of other stuff to
work on we typically do want to block waiting until we have reached
the thread progress value that we are waiting for. In order to be able
to do this we provide functionality for waking up a thread when a
certain thread progress value has been reached:

*   `void erts_thr_progress_wakeup(ErtsSchedulerData *esdp,
    ErtsThrPrgrVal val)` - Request wake up. The calling thread will be
    woken when thread progress has reached val. 

Managed threads frequently need to update their thread progress by
calling the following functions:

*   `int erts_thr_progress_update(ErtsSchedulerData *esdp)` - Update
    thread progress. If a non zero value is returned
    `erts_thr_progress_leader_update()` has to be called without any
    locks held.
*   `int erts_thr_progress_leader_update(ErtsSchedulerData *esdp)` -
    Leader update thread progress.

Unmanaged threads can delay thread progress beeing made:

*   `ErtsThrPrgrDelayHandle erts_thr_progress_unmanaged_delay(void)` -
    Delay thread progress.
*   `void erts_thr_progress_unmanaged_continue(ErtsThrPrgrDelayHandle
    handle)` - Let thread progress continue.

Scheduler threads can schedule an operation to be executed by the
scheduler itself when thread progress has been made:

* `void erts_schedule_thr_prgr_later_op(void (*funcp)(void *), void
  *argp, ErtsThrPrgrLaterOp *memp)` - Schedule a call to `funcp`. The
  call `(*funcp)(argp)` will be executed when thread progress has been
  made since the call to `erts_schedule_thr_prgr_later_op()` was
  made.

### Implementation ###

In order to determine when the events has happened we use a global
counter that is incremented when all managed threads have called
`erts_thr_progress_update()` (or `erts_thr_progress_leader_update()`).
This could naively be implemented using a "thread confirmed" counter.
This would however cause an explosion of communication where all
involved processors would need to communicate with each other at each
update.

Instead of confirming at a global location each thread confirms that
it accepts in increment of the global counter in its own cache
line. These confirmation cache lines are located in sequence in an
array, and each confirmation cache line will only be written by one
and only one thread. One of the managed threads always have the leader
responsibility. This responsibility may jump between threads, but as
long as there are some activity in the system always one of them will
have the leader responsibility. The thread with the leader
responsibility will call `erts_thr_progress_leader_update()` which
will check that all other threads have confirmed an increment of the
global counter before doing the increment of the global counter. The
leader thread is the only thread reading the confirmation cache
lines.

Doing it this way we will get a communication pattern of information
going from the leader thread out to all other managed threads and then
back from the other threads to the leader thread. This since only the
leader thread will write to the global counter and all other threads
will only read it, and since each confirmation cache lines will only
be written by one specific thread and only read by the leader
thread. When each managed thread is distributed over different
processors, the communication between processors will be a reflection
of this communication pattern between threads.

The value returned from `erts_thr_progress_later()` equals the, by
this thread, latest confirmed value plus two. The global value may be
latest confirmed value or latest confirmed value minus one. In order
to be certain that all other managed threads actually will call
`erts_thr_progress_update()` at least once before we reach the value
returned from `erts_thr_progress_later()`, the global counter plus one
is not enough. This since all other threads may already have confirmed
current global value plus one at the time when we call
`erts_thr_progress_later()`. They are however guaranteed not to have
confirmed global value plus two at this time.

The above described implementation more or less minimizes the
comunication needed before we can increment the global counter. The
amount of communication in the system due to the thread progress
functionality however also depend on the frequency with which managed
threads call `erts_thr_progress_update()`. Today each scheduler thread
calls `erts_thr_progress_update()` more or less each time an Erlang
process is scheduled out. One way of further reducing communication
due to the thread progress functionality is to only call
`erts_thr_progress_update()` every second, or third time an Erlang
process is scheduled out, or even less frequently than that. However,
by doing updates of thread progress less frequently all operations
depending on the thread progress functionality will also take a longer
time.

#### Delay of Thread Progress by Unmanaged Threads ####

In order to implement delay of thread progress from unmanaged threads
we use two reference counters. One being `current` and one being
`waiting`. When an unmanaged thread wants to delay thread progress it
increments `current` and gets a handle back to the reference counter
it incremented. When it later wants to enable continuation of thread
progress it uses the handle to decrement the reference counter it
previously incremented.

When the leader threads is about to increment the global thread
progress counter it verifies that the `waiting` counter is zero before
doing so. If not zero, the leader isn't allowed to increment the
global counter, and needs to wait before it can do this. When it is
zero, it swaps the `waiting` and `current` counters before increasing
the global counter. From now on the new `waiting` counter will
decrease, so that it eventualy will reach zero, making it possible to
increment the global counter the next time. If we only used one
reference counter it would potentially be held above zero for ever by
different unmanaged threads.

When an unmanaged thread increment the `current` counter it will not
prevent the next increment of the global counter, but instead the
increment after that. This is sufficient since the global counter
needs to be incremented two times before thread progress has been
made. It is also desirable not to prevent the first increment, since
the likelyhood increases that the delay is withdrawn before any
increment of the global counter is delayed. That is, the operation
will cause as little disruption as possible.

However, this feature of delaying thread progress from unmanaged
threads should preferably be used as little as possible, since heavy
use of it will cause contention on the reference counter cache
lines. The functionality is however very useful in code which normally
only executes in managed threads, but which may under some infrequent
circumstances be executed in other threads.

#### Overhead ####

The overhead caused by the thread progress functionality is more or
less fixed using the same amount of schedulers regardless of the
number of uses of the functionality. Already today quite a lot of
functionality use it, and we plan to use it even more. When rewriting
old implementations of ERTS internal functionality to use the thread
progress functionality, this implies removing communication in the old
implementation. Otherwise it is simply no point rewriting the old
implementation to use the thread progress functionality. Since the
thread progress overhead is more or less fixed, the rewrite will cause
a reduction of the total communication in the system.

##### An Example #####

The main structure of an ETS table was originally managed using
reference counting. Already a long time ago we replaced this strategy
since the reference counter caused contention on each access of the
table. The solution used was to schedule "confirm deletion" jobs on
each scheduler in order to know when it was safe to deallocate the
table structure of a removed table. These confirm deletion jobs needed
to be allocated. That is, we had to allocate and deallocate as many
blocks as schedulers in order to deallocate one block. This of course
was a quite an expensive operation, but we only needed to do this once
when removing a table. It was more important to get rid of the
contention on the reference counter which was present on every
operation on the table.

When the thread progress functionality had been introduced, we could
remove the code implementing the "confirm deletion" jobs, and then
just schedule a thread progress later operation which deallocates the
structure. Besides simplifying the code a lot, we got an increase of
more than 10% of the number of transactions per second handled on a
mnesia tpcb benchmark executing on a quad core machine.
