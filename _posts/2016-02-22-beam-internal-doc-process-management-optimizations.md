---
layout: post
title:  "Beam Internal Doc -- ProcessManagementOptimizations!"
author: "肖铁(Kevin)"
categories: erlang
---

##Problems

在早期版本的运行时系统中，对于SMP的支持都是依靠锁来在多线程时保护数据的访问。在某些情况下，这不是问题，但在某些情况下，它确实是。加锁使得代码变得复杂，要确保所有需要锁的地方都加了锁，还要确保所有的锁都在一种次序之下被获取而不会产生死锁。按照正确的次序获取锁也经常会影响锁的释放，迫使线程去读取已经读取过的数据。更有利于bug的产生。为了尽可能的提高并行执行的能力而把锁的粒度做细，这导致代码的复杂度进一步提高。在程序运行的时候迫使线程获取锁的操作通常会导致重度锁竞争，从而使的可扩展性反而下降。

运行时系统内部的进程管理会受困于这些问题。当更改一个进程的状态从waiting到runnable时，这个进程就需要被加个锁。当把一个进程插入到运行队列的时候还是需要加一个锁来保证运行队列此时是被锁的。当在两个运行队列进行任务迁移的时候，被迁移的进程还有两个运行队列都要加锁。

最后一个例子在系统正常运行的时候是挺普遍的情况。举个例子，当一个调度器线程干完了自己队列里的所有任务，他就会从别的调度器线程的运行队列里偷任务来给自己做。当这个调度器线程查找目标的时候就会对涉及到的运行队列做很多锁操作，而当它真正开始做任务迁移的时候，又会对自己和对方的运行队列还有被迁移的进程加锁。而当一个调度器的运行队列空了的时候，一般其他的调度器的运行队列也空了，这导致大家都去搜索目标所以产生了大量的锁竞争。

##Solution

###Process

为了避免这种情况的发生，我们希望在对一个进程做些基本操作的时候不需要对这个进程加锁。一些基本的操作例如，在不同的运行队列之间迁移进程，检测我们是否需要把一个进程插入到某个运行队列，检测一个进程是否活着。

所有基本操作需要的信息都包含在进程的结构体中，这个结构体被进程status锁所保护，这些信息是分布在一系列不同的field中。这些被使用的field通常是状态field，用来存储少数不同状态。通过对这些信息的重新排序，我们很容易把这些信息存储在32位宽度的field中（只有12位被占用）。通过移动这些信息我们可以从进程的结构体中删除5个32位宽的field和1个指针field。这一举措也使我们能够轻松地阅读和使用原子内存操作改变状态。

###Run Queue

为使我们在对进程做基本操作的时候不需要加锁，我们最需要知道的是目标的运行队列里是否允许进程进行enqueue操作。这涉及到读取实际负载和负载均衡的信息的能力。

负载均衡功能会每隔固定的时间间隔触发一次。负载均衡会努力拉平系统中各个运行队列的长度。当负载均衡被触发的时候，关于每个运行队列的信息被收集在了一起，迁移路径和运行队列长度限制都被设定好。迁移路径和运行队列长度的限制被设定好后直到下次负载均衡之后才会被更改。每个运行队列里最重要的信息是自上次负载均衡后运行队列的最大长度。所有这些信息都被提前存储在了运行队列中。

当一个进程的状态变成可运行的时候，举个例子消息的接收，我们需要决定对哪个运行队列进行enqueue操作。前先这个操作可能导致进程所在的运行队列被锁住，直到进程的状态信息被改变完成。根据负载的情况，我们有时候不得不为另一个运行队列加锁，从而根据这个队列的信息来决定是否把任务迁移到这个队列中。

为了能决定使用哪个运行队列而不会给任何运行队列加锁，我们把所有的运行队列里关于负载均衡相关的信息从队列本身移到一个全局内存块中，也就是迁移路径和运行队列的限制。这些信息需要被经常更新，举个例子，如果我们把运行队列的最大长度保存在运行队列中，我们就要在操作这些信息时加锁，而如果放在一个全局内存块中，我们访问这些信息就可以用原子内存操作了。这使得在我们要决定要使用哪个运行队列时，我们不需要对任何运行队列加锁，然而当选定之后，就要给被选定的运行队列加锁并进行入队操作。

###Fixed Balancing Information

当要决定去选择哪个运行队列，我们需要读取原来的运行队列的“固定大小的负载均衡信息”。这些信息是全局的，在负载均衡操作的时候会修改，当不做负载均衡的时候是可读的。我们不希望在访问这些信息的时候需要锁操作。一个“读者”通过rwlock可以避免由于数据被频繁访问而产生的拥塞，但它不可避免的导致负载平衡时执行操作中断，因为这些信息是被非常频繁的访问。这些巨大的中断成本会随着调度器线程的数量增大而增加。

与其用一个全局锁来保护对这些信息的修改，我们在负载均衡期间重新写了一版这些数据。新版的数据和老版的数据不在同一个内存块中，而发布的时候创建一个写的内存屏障，并且创建一个指针指向这个新的内存块，指针被存储在一个全局变量中，这个是由原子写操作来完成。

当调度器需要读取这个信息的时候，他们通过原子读操作读取这个指针指向的信息，之后开启一个数据依赖的内存读屏障，这在大多数计算机体系结构中是空操作。有这种方式来读取信息会产生很少的消耗。

与其分配和释放储存不同版本的负载均衡信息的内存块，不如留着旧的内存块并在安全的情况时重用他们。为了能决定什么时候才能安全的重用一个内存块，我们需要使用之前提到的线程进度机制，来确保当我们要重用内存块的时候没有任何线程去引用它。

###Be Less Aggressive

我们用无锁运行队列实现一个测试的版本。这个实现在性能上并没有“每个队列一个锁”的版本优秀。我们因为没有进行足够的调查所以不知道为什么会这样。但既然有锁的版本性能反而好，我们就暂时留着它。至于无锁的版本，由于性能的问题我们只能考虑其他的解决方案。

之前，当一个运行队列中的进程被挂起的时候，我们把它从队列中移走。这涉及到给这个进程加锁，给这个运行队列加锁，把这个进程从“由双链表实现的队列”中移除。把一个进程从一个无锁队列移除更是复杂。如果不把它移除队列，而是留在队列中并标识它为挂起。当以后需要运行某个进程的时候我们就检查它是否是被挂起的，如果是就不执行。把进程留在队列中，它可能会再次恢复运行，如果它恢复则它可以被运行。

想在有锁的版本保留并实现这个方案，我们可以从每个进程的结构体中移除一个指针域，并且避免了对进程和队列的冗余操作，也避免了可能的竞争。

###Combined Modifications

通过对进程的状态管理和运行队列的管理的综合修改，我们可以做大量的工作来使得调度和迁移进程时不用加任何锁。由于之前的版本有很多锁，要改成无锁的版本，整个运行时系统都要重写，但是重写会使得代码简单并淘汰了很多地方的锁。当然主要好处当然是降低竞争。

###A Benchmark Result

当运行chameneosredux benchmark的时候，调度器频繁的完成自己工作后偷取别人的工作。不论是成功的任务迁移还是试图去迁移进程我们都想去优化。通过上述的改进，我们在一台Intel i7 酷睿超线程8核处理器的电脑中再次运行chameneosredux benchmark的时候，性能提高了25%-35%。

<br />
<br />

#=========================原文=========================

Process Management Optimizations
================================

Problems
--------

Early versions of the SMP support for the runtime system completely
relied on locking in order to protect data accesses from multiple
threads. In some cases this isn't that problematic, but in some cases
it really is. It complicates the code, ensuring all locks needed are
actually held, and ensuring that all locks are acquired in such an
order that no deadlock occur. Acquiring locks in the right order often
also involve releasing locks held, forcing threads to reread data
already read. A good recipe for creation of bugs. Trying to use more
fine-grained locking in order to increase possible parallelism in the
system makes the complexity situation even worse. Having to acquire a
bunch of locks when doing operations also often cause heavy lock
contention which cause poor scalability.

Management of processes internally in the runtime system suffered from
these problems. When changing state on a process, for example from
`waiting` to `runnable`, a lock on the process needed to be
locked. When inserting a process into a run queue also a lock
protecting the run queue had to be locked. When migrating a process
from one run queue to another run queue, locks on both run queues and
on the process had to be locked.

This last example is a quite common case in during normal
operation. For example, when a scheduler thread runs out of work it
tries to steal work from another scheduler threads run queue. When
searching for a victim to steal from there was a lot of juggling of
run queue locks involved, and during the actual theft finalized by
having to lock both run queues and the process. When one scheduler
runs out of work, often others also do, causing lots of lock
contention.

Solution
--------

### Process ###

In order to avoid these situations we wanted to be able to do most of
the fundamental operations on a process without having to acquire a
lock on the process. Some examples of such fundamental operations are,
moving a process between run queues, detecting if we need to insert it
into a run queue or not, detecting if it is alive or not.

All of this information in the process structure that was needed by
these operations was protected by the process `status` lock, but the
information was spread across a number of fields. The fields used was
typically state fields that could contain a small number of different
states. By reordering this information a bit we could *easily* fit
this information into a 32-bit wide field of bit flags (only 12-flags
were needed). By moving this information we could remove five 32-bit
wide fields and one pointer field from the process structure! The move
also enabled us to easily read and change the state using atomic
memory operations.

### Run Queue ###

As with processes we wanted to be able to do the most fundamental
operations without having to acquire a lock on it. The most important
being able to determine if we should enqueue a process in a specific
run queue or not. This involves being able to read actual load, and
load balancing information.

The load balancing functionality is triggered at repeated fixed
intervals. The load balancing more or less strives to even out run
queue lengths over the system. When balancing is triggered,
information about every run queue is gathered, migrations paths and
run queue length limits are set up. Migration paths and limits are
fixed until the next balancing has been done. The most important
information about each run queue is the maximum run queue length since
last balancing. All of this information were previously stored in the
run queues themselves.

When a process has become runnable, for example due to reception of a
message, we need to determine which run queue to enqueue it
in. Previously this at least involved locking the run queue that the
process currently was assigned to while holding the status lock on the
process. Depending on load we sometimes also had to acquire a lock on
another run queue in order to be able to determine if it should be
migrated to that run queue or not.

In order to be able to decide which run queue to use without having to
lock any run queues, we moved all fixed balancing information out of
the run queues into a global memory block. That is, migration paths
and run queue limits. Information that need to be frequently updated,
like for example maximum run queue length, were kept in the run queue,
but instead of operating on this information under locks we now use
atomic memory operations when accessing this information. This made it
possible to first determine which run queue to use, without locking
any run queues, and when decided, lock the chosen run queue and insert
the process.

#### Fixed Balancing Information ####

When determining which run queue to choose we need to read the fixed
balancing information that we moved out of the run queues. This
information is global, read only between load balancing operations,
but will be changed during a load balancing. We do not want to
introduce a global lock that needs to be acquired when accessing this
information. A reader optimized rwlock could avoid some of the
overhead since the data is most frequently read, but it would
unavoidably cause disruption during load balancing, since this
information is very frequently read. The likelihood of a large
disruption due to this also increase as number of schedulers grows.

Instead of using a global lock protecting modifications of this
information, we write a completely new version of it at each load
balancing. The new version is written in another memory block than the
previous one, and published by issuing a write memory barrier and then
storing a pointer to the new memory block in a global variable using
an atomic write operation.

When schedulers need to read this information, they read the pointer
to currently used information using an atomic read operation, and then
issue a data dependency read barrier, which on most architectures is a
no-op. That is, it is very little overhead getting access to this
information.

Instead of allocating and deallocating memory blocks for the different
versions of the balancing information we keep old memory blocks and
reuse them when it is safe to do so. In order to be able to determine
when it is safe to reuse a block we use the thread progress
functionality, ensuring that no threads have any references to the
memory block when we reuse it.

#### Be Less Aggressive ####

We implemented a test version using lock free run queues. This
implementation did however not perform as good as the version using
one lock per run queue. The reason for this was not investigated
enough to say why this was. Since the locked version performed better
we kept it, at least for now. The lock free version, however, forced
us to use other solutions, some of them we kept.

Previously when a process that was in a run queue got suspended, we
removed it from the queue straight away. This involved locking the
process, locking the run queue, and then unlinking it from the double
linked list implementing the queue. Removing a process from a lock
free queue gets really complicated. Instead, of removing it from the
queue, we just leave it in the queue and mark it as suspended. When
later selected for execution we check if the process is suspended, if
so just dropped it. During its time in the queue, it might also get
resumed again, if so execute it when it get selected for execution.

By keeping this part when reverting back to a locked implementation,
we could remove a pointer field in each process structure, and avoid
unnecessary operations on the process and the queue which might cause
contention.

### Combined Modifications ###

By combining the modifications of the process state management and the
run queue management, we can do large parts of the work involved when
managing processes with regards to scheduling and migration without
having any locks locked at all. In these situations we previously had
to have multiple locks locked. This of course caused a lot of rewrites
across large parts of the runtime system, but the rewrite both
simplified code and eliminated locking at a number of places. The
major benefit is, of course, reduced contention.

### A Benchmark Result ###

When running the chameneosredux benchmark, schedulers frequently run
out of work trying to steal work from each other. That is, either
succeeding in migrating, or trying to migrate processes which is a
scenario which we wanted to optimize. By the introduction of these
improvements, we got a speedup of 25-35% when running this benchmark
on a relatively new machine with an Intel i7 quad core processor with
hyper-threading using 8 schedulers.
