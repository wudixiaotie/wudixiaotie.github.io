---
layout: post
title:  "Beam Internal Doc -- Non-Blocking Code Loading"
author: "肖铁(Kevin)"
categories: erlang
---

##Introduction

在OTP R16之前，当虚拟机运行在单线程模式并且正在载入代码时候整个虚拟机会挂起，直到代码载入完成。这在虚拟机启动的时候不是个大问题，但当虚拟机在运行并且有部分负载的情况下，就有可能成为一个严重的问题。这个问题随着cpu核的数量增加，所耗费的时间也会因为等待所有调度器停止并挂起正在做的工作而增加。

在OTP R16版本，模块的载入不会阻塞虚拟机了。Erlang进程在整个载入过程中会继续不受干扰的执行。代码载入会有单独的Erlang进程去处理，就像其他普通的Erlang进程一样，被调度器调度。代码的载入完成后会对所有的进程可见，并且其一致性由原子级别的操作来保证。在SMP模式，非阻塞代码载入会提高载入或替换的实时性。

##The Load Phases

模块的载入分为2个阶段：

1. 预备阶段  
	预备阶段包含读取BEAM文件和被载入代码的所有准备工作，这些工作都是为了载入能顺利完成，防止对正在运行的其他代码产生干扰。
2. 完成阶段  
	完成阶段是使被载入的代码能被其他正在运行的代码访问，并且老版本的代码不能被访问。

准备阶段被设计为可以让多个负责载入代码的进程准备不同的模块，但是完成阶段这些准备好的进程只能依次完成。第二个等待载入的进程想进入完成阶段，必须要在第一个进程完成后，否则等待。这只会阻塞住Erlang进程，而调度器在第二个进程等待的时候会调度其他的工作，不会被阻塞住。

这个并行准备载入的能力不是经常使用，因为大部分的代码都是由code_server进程按顺序的载入。

{% highlight erlang %}
erlang:prepare_loading(Module, Code) -> LoaderState
erlang:finish_loading([LoaderState])
{% endhighlight %}

原理是 prepare_loading 可以同时被多个不同的模块调用，并返回一个包含所有准备的模块的内部状态的“magic binary”。函数 finish_loading 可以接收这些内部状态的列表，然后由他完成剩下的所有工作。

最近我们用BIF erlang:load_module， 这个函数会依次调用上述两个函数。finish_loading函数的参数会是一个只有单个模块状态的列表，因为我们没有使用多模块载入特性。

##The Finishing Sequence

在整个虚拟机执行期间，代码可以通过一系列数据结构被访问。这些可以访问代码的数据结构有：

* 输出列表。一个包含所有输出函数的实体。
* 模块列表。一个包含所有载入模块的实体。
* "beam_catches"。识别指令的跳转目的地。
* "beam_ranges"。函数的代码地址和源文件中的行之间的映射。

这些数据结构中最产用的就是“输出列表”，这个列表在运行期间被每个外部函数用来获得被调用者的地址。由于性能的原因，我们想要访问所有这些结构没有任何线程同步的开销。早期这会被紧急中断来解决。当数据结构有变动的时候整个虚拟机都停掉，平时的话他们是只读的。

R16的解决方案是复制这些代码访问结构体。我们有一套代码访问结构体被正在执行的代码读取。当新代码被载入的时候，这套代码访问结构体被复制了一份，并把新代码更新到这被复制的数据中，然后替换掉现有的数据。当前活动的数据集合由单独的原子变量（线程安全的无锁变量）the_active_code_index来识别。数据的替换是由一个原子级别打写操作来实现的。每当ERTS正在运行的代码要访问这些代码访问结构体的时候，都要读取the_active_code_index的值，这意味着每次函数调用都要执行一次原子级别的读操作。这个原子读操作所损失的性能非常小，因为这个操作不需要任何内存屏障（内存的访问顺序不一定和代码的编写顺序一致，这叫内存乱序访问。这是为了提高程序运行时的性能，但多CPU多线程的时候有可能有数据不同步。内存屏障的作用就是保证内存屏障之前的内存访问操作必定先于其之后完成，保证程序的运行顺序）就能被执行。这个解决方案还可以有效的保证代码载入操作的事务特性。正在运行的代码永远不会看见载入到一半的新代码。

完成阶段由BIF erlang:finish_loading函数按如下的顺序执行：

1. 抓住专属的“代码写权限”（暂停载入进程直到我们拿到）。
2. 把所有的有效访问数据都复制一份。这个副本叫做待命区域并由全局原子变量the_staging_code_index标识。
3. 把待命区域的访问数据全部更新成新的准备好的模块。
4. 调度一个thread progress event。使得未来的某个时间，所有的调度器已经获得并执行完一个完整的内存屏障。
5. 暂定载入进程。
6. 在thread progress之后，通过把原子变量the_staging_code_index的值赋给the_active_code_index来提交待命区域。
7. 释放掉“代码写权限”，来允许其他的进程集结待命新的代码。
8. 载入进程从erlang:finish_loading函数中返回。

##Thread Progress

在完成阶段的4-6步骤中，执行线程过程的时候，载入进程的等待是有必要的，是为了使进程在执行普通函数调用的时候能原子的读取the_active_code_index而不用耗费任何昂贵的内存屏障。当我们在第6步把新值写入the_active_code_index，一旦the_active_code_index可以被所有调度器访问，那么他们就能和从前一样看见更新后的活动访问数据了。

这样缺乏内存屏障的来读取the_active_code_index会产生一个有趣的结果。不同的进程不会在同一时间看见这些新的代码，这时间取决于对应的CPU核什么时候刷新它的硬件高速缓存。这听起来很不安全，但其实没关系。我们唯一需要保证的特性是新代码会在进程间通信的时候随之传播。也就是说某进程在收到一条被新代码发送的消息后，必须要保证它也能看见新的代码。怎么样来保证这一点呢？我们让所有的进程通讯都会涉及到内存屏障，这样才会使发送方写的内容肯定会被接收方读到。这个猥琐的内存屏障还能保证接收方会读到最新的the_active_code_index从而能看见最新的代码。这适用于所有类型的内部进程间通信（TCP，ETS，注册进程名称，追踪代码，drivers, NIFs等），而不仅仅是Erlang的消息。

##Code Index Reuse

想要优化第2步的复制操作， 就应该复用代码访问结构体。现有的解决方案是共有3套代码访问结构体，由代码索引0,1,2来标识，以便循环使用。我们不用每次载入代码操作都要初始化一套完整的代码访问结构体副本，而只需要更新最近的2次载入操作所做的改变就好。我们可以仅用2个代码索引0和1来实现，但是那会导致额外的等待，因为直到确保所有的调度器线程都不再使用待命区域的代码索引作为活动代码索引，我们不能开始复用它。但是有3个版本的代码索引的话，我们就可以保证不会引入额外的等待时间。Thread progress将会等待所有的调遣器都至少更新一次自己的代码。在thread progress结束之后，不会有通过the_active_code_index指向的旧有的值来访问代码结构体。

在两个版本和三个版本的代码访问结构之间的设计选择是内存消耗和代码加载等待时间之间的权衡。

##A Consistent Code View

一些原生的BIF可能需要获得与活动代码一致的快照视图。要做到这一点，重要的是只读取the_active_code_index一次，然后在BIF期间用该索引值做所有的代码访问。如果一个代码载入操作被并行执行，第二次读取the_active_code_index可能会得到不同的值，并由此获得不同的代码。

<br />
<br />

#=========================原文=========================

Non-Blocking Code Loading
=========================

Introduction
------------

Before OTP R16 when an Erlang code module was loaded, all other
execution in the VM were halted while the load operation was carried
out in single threaded mode. This might not be a big problem for
initial loading of modules during VM boot, but it can be a severe
problem for availability when upgrading modules or adding new code on
a VM with running payload. This problem grows with the number of cores
as both the time it takes to wait for all schedulers to stop increases
as well as the potential amount of halted ongoing work.

In OTP R16, modules are loaded without blocking the VM.
Erlang processes may continue executing undisturbed in parallel during
the entire load operation. The code loading is carried out by a normal
Erlang process that is scheduled like all the others. The load
operation is completed by making the loaded code visible to all
processes in a consistent way with one single atomic
instruction. Non-blocking code loading will improve real-time
characteristics when modules are loaded/upgraded on a running SMP
system.


The Load Phases
---------------

The loading of a module is divided into two phases; a *prepare phase*
and a *finishing phase*. The prepare phase contains reading the BEAM
file format and all the preparations of the loaded code that can
easily be done without interference with the running code. The
finishing phase will make the loaded (and prepared) code accessible
from the running code. Old module versions (replaced or deleted) will
also be made inaccessible by the finishing phase.

The prepare phase is designed to allow several "loader" processes to
prepare separate modules in parallel while the finishing phase can
only be done by one loader process at a time. A second loader process
trying to enter finishing phase will be suspended until the first
loader is done. This will only block the process, the scheduler is
free to schedule other work while the second loader is waiting. (See
`erts_try_seize_code_write_permission` and
`erts_release_code_write_permission`).

The ability to prepare several modules in parallel is not currently
used as almost all code loading is serialized by the code_server
process. The BIF interface is however prepared for this.

      erlang:prepare_loading(Module, Code) -> LoaderState
      erlang:finish_loading([LoaderState])

The idea is that `prepare_loading` could be called in parallel for
different modules and returns a "magic binary" containing the internal
state of each prepared module. Function `finish_loading` could take a
list of such states and do the finishing of all of them in one go.

Currenlty we use the legacy BIF `erlang:load_module` which is now
implemented in Erlang by calling the above two functions in
sequence. Function `finish_loading` is limited to only accepts a list
with one module state as we do not yet use the multi module loading
feature.


The Finishing Sequence
----------------------

During VM execution, code is accessed through a number of data
structures. These *code access structures* are

* Export table. One entry for every exported function.
* Module table. One entry for each loaded module.
* "beam_catches". Identifies jump destinations for catch instructions.
* "beam_ranges". Map code address to function and line in source file.

The most frequently used of these structures is the export table that
is accessed in run time for every executed external function call to
get the address of the callee. For performance reasons, we want to
access all these structures without any overhead from thread
synchronization. Earlier this was solved with an emergency break. Stop
the entire VM to mutate these code access structures, otherwise treat
them as read-only.

The solution in R16 is instead to *replicate* the code access
structures. We have one set of active structures read by the running
code. When new code is loaded the active structures are copied, the
copy is updated to include the newly loaded module and then a switch
is made to make the updated copy the new active set. The active set is
identified by a single global atomic variable
`the_active_code_index`. The switch can thus be made by a single
atomic write operation. The running code have to read this atomic
variable when using the active access structures, which means one
atomic read operation per external function call for example. The
performance penalty from this extra atomic read is however very small
as it can be done without any memory barriers at all (as described
below). With this solution we also preserve the transactional feature
of a load operation. Running code will never see the intermediate
result of a half loaded module.

The finishing phase is carried out in the following sequence by the
BIF `erlang:finish_loading`:

1. Seize exclusive code write permission (suspend process if needed
   until we get it).

2. Make a full copy of all the active access structures. This copy is
   called the staging area and is identified by the global atomic
   variable `the_staging_code_index`.

3. Update all access structures in the staging area to include the
   newly prepared module.

4. Schedule a thread progress event. That is a time in the future when
   all schedulers have yielded and executed a full memory barrier.

5. Suspend the loader process.

6. After thread progress, commit the staging area by assigning
   `the_staging_code_index` to `the_active_code_index`.

7. Release the code write permission allowing other processes to stage
   new code.

8. Resume the loader process allowing it to return from
   `erlang:finish_loading`.


### Thread Progress

The waiting for thread progress in 4-6 is necessary in order for
processes to read `the_active_code_index` atomic during normal
execution without any expensive memory barriers. When we write a new
value into `the_active_code_index` in step 6, we know that all
schedulers will see an updated and consistent view of all the new
active access structures once they become reachable through
`the_active_code_index`.

The total lack of memory barrier when reading `the_active_code_index`
has one interesting consequence however. Different processes may see
the new code at different point in time depending on when different
cores happen to refresh their hardware caches. This may sound unsafe
but it actually does not matter. The only property we must guarantee
is that the ability to see the new code must spread with process
communication. After receiving a message that was triggered by new
code, the receiver must be guaranteed to also see the new code. This
will be guaranteed as all types of process communication involves
memory barriers in order for the receiver to be sure to read what the
sender has written. This implicit memory barrier will then also make
sure that the receiver reads the new value of `the_active_code_index`
and thereby also sees the new code. This is true for all kinds of
inter process communication (TCP, ETS, process name registering,
tracing, drivers, NIFs, etc) not just Erlang messages.

### Code Index Reuse

To optimize the copy operation in step 2, code access structures are
reused. In current solution we have three sets of code access
structures, identified by a code index of 0, 1 and 2. These indexes
are used in a round robin fashion. Instead of having to initialize a
completely new copy of all access structures for every load operation
we just have to update with the changes that have happened since the
last two code load operations. We could get by with only two code
indexes (0 and 1), but that would require yet another round of waiting
for thread progress before step 2 in the `finish_loading` sequence. We
cannot start reusing a code index as staging area until we know that
no lingering scheduler thread is still using it as the active code
index. With three generations of code indexes, the waiting for thread
progress in step 4-6 will give this guarantee for us. Thread progress
will wait for all running schedulers to reschedule at least one
time. No ongoing execution reading code access structures reached from
an old value of `the_active_code_index` can exist after a second round
of thread progress.

The design choice between two or three generations of code access
structures is a trade-off between memory consumption and code loading
latency.

### A Consistent Code View

Some native BIFs may need to get a consistent snapshot view of the
active code. To do this it is important to only read
`the_active_code_index` one time and then use that index value for all
code accessing during the BIF. If a load operation is executed in
parallel, reading `the_active_code_index` a second time might result
in a different value, and thereby a different view of the code.
