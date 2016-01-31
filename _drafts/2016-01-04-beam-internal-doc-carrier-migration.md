---
layout: post
title:  "Beam Internal Doc -- Carrier Migration!"
author: "肖铁(Kevin)"
categories: erlang
---

#载体迁移（Carrier Migration）
  
ERTS的内存分配器把原始的内存区块当作为2种不同的memory chunks（今天的CPU不再是按字节访问内存，而是以64字节为单位的块chunk拿取，每个chunk称为一个缓存行cache line。）来管理。这种意义上的内存块叫做载体（carriers）。单块载体（Singleblock carriers）只包含一个大内存区块，多块载体（Multiblock carriers）包含多个内存区块。在unix系统中载体的内存是有mmap()函数分配的，但这并不重要。一个内存分配器实例通常管理若干个单块载体和多块载体。  

##问题  

当一个载体为空，例如一个空的单块载体，它会被释放掉。但是作为多块载体，他内部的内存区块有可能部分是空的，部分是有数据的，如果内存负载降低，由于大量的低利用率的多块载体的存在，内存分配器实例可能被卡住。内存使用经过一个高峰后，可以预见的是，由于数据分布在多个多块载体中，导致内存不能被全部回收释放。没有被完全使用的多块载体在内存负载再次增高的时候，空闲的部分会被重用。然而，既然每个调度器线程都有自己的一套内存分配器实例，而内存负载和CPU负载也没有必然的联系，就有可能出现这样一种状况，某些内存分配器实例有一大堆地低利用率的多块载体，另外的内存分配器实例则需要创建新的多块载体。这时，系统的多块载体需求量增加的同时实际内存需求量反而是下降的，这一切对erlang的开发人员来说都是不希望出现的。  

##解决方案：  
 
为了防止这种情况的出现，我们引入了一种新的机制--同种内存分配器实例之间的多块载体迁移。（我的理解：首先不同种的内存分配器不可以做载体迁移，为啥？因为每个种类的载体所占用的空间大小不一样，数据结构也不一样。每个内存分配器其实就是C里的结构体，要用的时候需要按照自己结构体的属性来分配大小，之所以有这么多种类的内存分配器就是因为需要存储不同的结构体。同种的内存分配器其实结构体是一样的，所以他们创建的载体也是一样的，所以可以做迁移）  

###空闲块的管理  

为了让一个载体从一个内存分配器实例删除并添加到另外一个内存分配器实例上，我们需要在内存分配器实例之间移动载体内空闲的区块的引用。内存分配器里具体存储“指向这个内存分配器所管理的内存块”的**数据结构**经常都指向的是同一个载体的不同位置。举个例子，当使用address order bestfit作为内存分配策略时，这个**数据结构**是一个跨越所有这个内存分配器所管理的载体的二叉搜索树。在具体的某个载体中的空闲内存块可以被潜在的每个载体引用并管理，并且这种类似的引用可以有很大的数量。也就是说，从二叉搜索树中除去“这样的载体中的空闲块”的工作将是巨大的。有一种解决这种问题的方法可能就是别迁移“这种含有很多空闲块的载体”，但是这会妨碍我们迁移“有潜在迁移需要的载体”，导致阻止我们解决通过块迁移能解决的大量内存碎片的问题。

给每个载体的空闲内存块建立一种数据结构（搜索树用来查找），给每个内存分配器所管理的所有载体建立另外一种数据结构（搜索树来查找），从而能用最优的方式完成添加和删除载体的操作。当某种内存分配器被允许了进行载体迁移时，我们就需要能实施载体迁移的内存分配策略。我们现在已经有3种不同的内存分配策略可以实施载体迁移。这些策略使用排序查找树来寻找载体，以便能找到满足条件的载体中内存地址最低的那个。在载体内部我们又用另外一个查找树，这个查找树技能满足address order first fit, address order best fit, 或者 best fit。这三种策略的缩写分别是aoff， aoffcaobf和aoffdbf。

###Carrier Pool

为了在不同的内存分配器实例之间迁移载体，我们把载体都放到一个载体池中。为了使载体迁移能够顺利完成，一个调度器线程需要把载体放入池子中，另一个调度器线程再把载体从池子里拿出来。

载体池是由一个无锁的，循环的，双链表。这个链表包含一个岗哨，也就是作为向池子里插入或取出时的起始位置。池子里的载体就是链表中的元素。

链表可以同时被所有的调度器线程修改。在修改期间双链表被允许变得有点“走形”。举个例子，用过next指针访问下一个元素后再用prev指针访问上个元素不一定就是你开始访问的那个元素了。但是下列的规则永远都是成立的：

* 不断的通过next指针来访问下个元素，总会到达链表的岗哨。
* 不断的通过prev指针来访问上个元素，总会到达链表的岗哨。
* 通过next或prev指针访问的元素肯定是在池子里的元素，或者曾经在池子中的元素。

当我们想找岗哨来插入一个新的元素到双链表中，我们要一直顺着next指针来找，并且总是跳过遇到的第一个元素。当我们试图取出一个元素时还是这样做，只不过是顺着priv指针来找。

通过从不同方向来插入和取出元素，我们尽量避免了多线程插入和取出元素时的竞争。当我们查找岗哨的时候为什么要跳过一个元素呢？因为这样可以尽量使得岗哨的next和prev指针保持未被修改的状态。这样做的好处是所有查找岗哨的操作都要读取岗哨的next和prev指针。如果我们改了next和prev指针的值，其他的处理器也要改自己的缓存行导致岗哨的数据不同步。（缓存行是什么？都知道CPU在运行的时候都是把数据从硬盘（hard drive）读取到内存（memory），每次只读取内存的数据而不是硬盘的，因为硬盘的IO太慢。但其实对CPU来说内存还是慢，所以都是cache从memory中拿数据，CPU读去cache。cpu不是按byte去访问cache，而是以64byte为单位的chunk。所以当你读一个特定的内存地址，整个缓存行将从主存换入缓存，并且访问同一个缓存行内的其它值的开销是很小的。但是在读取的时候如果把别的CPU需要的数据也读到你自己的cacheline中，就叫做伪共享。这种情况下，CPU1改动了自己的cache1的cacheline中的数据，cache1会把cacheline中的修改同步到内存中，然后CPU2的cache2中由于也有CPU1刚刚更改的数据，所以CPU2需要重新从内存中同步CPU2修改后的数据到自己的cache中。为了避免伪共享，这里erlang采用了既然大家都有这部分的数据，那我们就商量一下，都别改了，要改就改不是被大家共享的数据，所以才不改岗哨的next和prev指针，而是改他们指向的元素的next和prev指针）

元素中的prev和next区域存储了“指针”，“改动标识”，“删除标识”。在这些区域进行的操作都是原子的。当一个线程设置了一个区域的“改动标识”后，其他的线程则不允许去更改这个区域了。如果需要设置多个“改动标识”，通常都是从next区域开始设置，然后是它后面跟着的下个元素的prev区域，就这样顺着指针的顺序继续下去。这有效的保证了没有死锁的发生。

当一个载体从载体池中被移除的时候，我们会给这个操作标识一个“线程进度值”，当这个值被达到之前，不允许去操作该元素的next和prev区域。直到所有的线程的进度值都超过了我们开始设置的“线程进度值”，我们就知道这个载体被使用完了，这时并不是释放掉这个载体，而是把这个载体再次插入到载体池中。这样有效保证了在线程从池子中取出的元素永远是有效的。

###Migration

只要是允许载体迁移的内存分配器都有一个载体池，用来在所有调度器之间做载体迁移。不同调度器的同样类型的内存分配器共享一个载体池。

每个内存分配器都实时监控当前的多块载体的使用率。当某个内存分配器的总体使用率低于“abandon carrier utilization limit”时，每当它要释放掉某个载体时，会检查这个载体的使用率，如果这个载体的使用率也低于“abandon carrier utilization limit”，内存分配器就会从自己的“可用空闲块”数据结构体中删除这个载体并把它放回载体池中。

当载体被从内存分配器的“可用空闲块”数据结构体中删除后，载体不会被执行内存分配了。内存分配器把这个载体放入载体池后，内存分配器还是有责任释放里面的内存块。这种对载体有释放责任的内存分配器叫做雇主（employer）。

每个载体都有一个标识区域用来存储雇主信息，一个标识说明载体是否在载体池中，一个标识说明载体是否繁忙。载体池的载体如果正在被自己的雇主操作，雇主内存分配器就会给它标识上繁忙标识。如果这时另外的线程需要从载体池取载体，它会跳过这类有繁忙标识的载体不取。当一个载体被从池子中取出来的时候，载体的雇主信息就会变更，指向将它从池子中取出的内存分配器，未来其他的内存分配器需要对这个载体释放内存的时候，就会通过延迟释放功能对这个载体的新雇主发消息，让新雇主执行对这个载体的释放操作。

当一个载体已经全部都是空闲的内存块的时候，它会被从载体池中拿出。所有空的载体都会被传递给它的拥有者，好让其通过延迟释放功能来释放没用的内存。这种通过拥有者来释放载体的方式，让底层分配和释放内存变得很简单，不用考虑多线程的情况。在NUMA架构的时候，我们也不会让来自不同NUMA节点的载体混在一起。

简短来说：

* 内存分配器创建的载体归这个内存分配器所有
* 一个全部空闲的载体永远都是由它的“所有者”来释放
* 这种所属关系永远不会改变
* 内存分配器要使用某个载体，但是他并非所有者，这种行为叫做雇佣
* 一个雇主可以把自己雇佣的载体抛回载体池
* 载体池中的载体们不会重新分配
* 释放回载体池的载体还是和原雇主保持着雇佣关系
* 只有在载体从载体池中再次拿出时，该载体的雇佣关系才会变更

###Searching the pool

考虑到实时性，查找载体池的时间是有限的。我们只能查找有限数目的载体。如果这部分载体没有一个拥有足够多的空闲块来满足分配的需求，这次查找就会失败。一个载体也可能处于繁忙状态，这时意味着另外的线程正在对这个载体里的某些内存块进行释放，所以这中繁忙状态的载体在搜索载体池的时候也会被跳过。载体池是无锁的，我们也不想因为要等待某些线程的操作而阻塞载体池的读取。

###Before OTP 17.4

当一个内存分配器需要更多的载体空间时，它总是先检索自己的是否有正等待thread progress去释放的载体。如果没有这种载体，它才去载体池中检索。如果池子中也没有取出载体，它就分配一个新的载体。内存分配器不关心载体从那里来的，只要拿到载体，就把它放在自己的“空闲块数据结构体”中。

###After OTP 17.4

旧有的搜索算法有个问题就是每次搜索都是从池子中的同一位置开始，就是从岗哨那里。这可能导致搜索并发搜索过程中的竞争。更糟糕的是，每次都从岗哨搜索，如果第一次搜索失败后，很容易预测到未来还会有多次的失败，这时内存分配器会创建很多个新载体。这新的载体在不久后可能些被放入载体池，导致很低的载体使用率。如果向载体池中插入的数量高于取出的数量，会导致内存最终被耗尽。

上面说的那种载体池状态是由于一系列的（一簇）含有很多小碎片的载体位于岗哨附近。这种高度碎片化的载体中最大的空闲块对大部分内存分配器的分配请求来说也太小了，导致不能满足分配的需求。而由于每次搜索都是从岗哨开始，这种高度碎片化的载体最终都会被留在了岗哨周围（因为有效的载体都被从池子中取走了）。所有的搜索都要先跳过这一系列高速碎片化的载体才能找到有用的载体。当岗哨周围连续的“坏”载体的数量超过“每次搜索需要查找的载体数量”，未来的所有的搜索都会是失败的。

为了应对“坏簇”问题还有缓解竞争，搜索的时候都是从自己拥有的载体开始。也就那些被内存分配器创建的并且被抛弃会载体池中的载体。如果内存分配器的这些被抛弃到池子里的载体都不符合需求，那么和从前一样，继续搜索池子里的其他载体。所以这些内存分配器即便去载体池搜索，起始位置也是自己拥有的载体。

我们尽量选择这个线程自己创建的载体，这对增强NUMA架构的性能也有好处。而对于搜索载体池来说，每个内存分配器都有自己的入口，会有效的缓解竞争和“坏簇”问题。

内存分配器要在自己拥有的载体中执行第一次搜索，就需要有两个列表：pooled_list和traitor_list。这俩列表只有内存分配器自己能访问，并且列表只包含它拥有的载体。

<br />
<br />

#=========================原文=========================

Carrier Migration
=================

The ERTS memory allocators manage memory blocks in two types of raw
memory chunks. We call these chunks of raw memory
*carriers*. Singleblock carriers which only contain one large block,
and multiblock carriers which contain multiple blocks. A carrier is
typically created using `mmap()` on unix systems. However, how a
carrier is created is of minor importance. An allocator instance
typically manages a mixture of single- and multiblock carriers.

Problem
-------

When a carrier is empty, i.e. contains only one large free block, it
is deallocated. Since multiblock carriers can contain both allocated
blocks and free blocks at the same time, an allocator instance might
be stuck with a large amount of poorly utilized carriers if the memory
load decreases. After a peak in memory usage it is expected that not
all memory can be returned since the blocks still allocated are likely
to be dispersed over multiple carriers. Such poorly utilized carriers
can usually be reused if the memory load increases again. However,
since each scheduler thread manages its own set of allocator
instances, and memory load is not necessarily correlated to CPU load, we
might get into a situation where there are lots of poorly utilized
multiblock carriers on some allocator instances while we need to
allocate new multiblock carriers on other allocator instances. In
scenarios like this, the demand for multiblock carriers in the system
might increase at the same time as the actual memory demand in the
system has decreased which is both unwanted and quite unexpected for
the end user.

Solution
--------

In order to prevent scenarios like this we've implemented support for
migration of multiblock carriers between allocator instances of the
same type.

### Management of Free Blocks ###

In order to be able to remove a carrier from one allocator instance
and add it to another we need to be able to move references to the
free blocks of the carrier between the allocator instances. The
allocator instance specific data structure referring to the free
blocks it manages often refers to the same carrier from multiple
places. For example, when the address order bestfit strategy is used
this data structure is a binary search tree spanning all carriers that
the allocator instance manages. Free blocks in one specific carrier
can be referred to from potentially every other carrier that is
managed, and the amount of such references can be huge. That is, the
work of removing the free blocks of such a carrier from the search
tree will be huge. One way of solving this could be not to migrate
carriers that contain lots of free blocks, but this would prevent us
from migrating carriers that potentially need to be migrated in order
to solve the problem we set out to solve.

By using one data structure of free blocks in each carrier and an
allocator instance-wide data structure of carriers managed by the
allocator instance, the work needed in order to remove and add
carriers can be kept to a minimum. When migration of carriers is
enabled on a specific allocator type, we require that an allocation
strategy with such an implementation is used. Currently we've
implemented this for three different allocation strategies. All of
these strategies use a search tree of carriers sorted so that we can
find the carrier with the lowest address that can satisfy the
request. Internally in carriers we use yet another search tree that
either implement address order first fit, address order best fit,
or best fit. The abbreviations used for these different allocation
strategies are `aoff`, and `aoffcaobf`, `aoffcbf`.

### Carrier Pool ###

In order to migrate carriers between allocator instances we move them
through a pool of carriers. In order for a carrier migration to
complete, one scheduler needs to move the carrier into the pool, and
another scheduler needs to take the carrier out of the pool.

The pool is implemented as a lock-free, circular, double linked,
list. The list contains a sentinel which is used as the starting point
when inserting to, or fetching from, the pool. Carriers in the pool are
elements in this list.

The list can be modified by all scheduler threads
simultaneously. During modifications the double linked list is allowed
to get a bit "out of shape". For example, following the `next` pointer
to the next element and then following the `prev` pointer does not
always take you back to were you started. The following is however
always true:

*   Repeatedly following `next` pointers will eventually take you to the
    sentinel.
*   Repeatedly following `prev` pointers will eventually take you to the
    sentinel.
*   Following a `next` or a `prev` pointer will take you to either an
    element in the pool, or an element that used to be in the pool.

When inserting a new element we search for a place to insert the
element by only following `next` pointers, and we always begin by
skipping the first element encountered. When trying to fetch an
element we do the same thing, but instead only follow `prev` pointers.

By going different directions when inserting and fetching, we avoid
contention between threads inserting and threads fetching as much as
possible. By skipping one element when we begin searching, we preserve
the sentinel unmodified as much as possible. This is beneficial since
all search operations need to read the content of the sentinel. If we
were to modify the sentinel, the cache line containing the sentinel
would unnecessarily be bounced between processors.

The `prev` and `next` fields in the elements of the list contain the
value of the pointer, a modification marker, and a deleted
marker. Memory operations on these fields are done using atomic memory
operations. When a thread has set the modification marker in a field,
no-one except the thread that set the marker is allowed to modify the
field. If multiple modification markers need to be set, we always
begin with `next` fields followed by `prev` fields in the order
following the actual pointers. This guarantees that no deadlocks will
occur.

When a carrier is being removed from a pool, we mark it with a thread
progress value that needs to be reached before we are allowed to
modify the `next` and `prev` fields. That is, until we reach this
thread progress we are not allowed to insert the carrier into the pool
again, and we are not allowed to deallocate the carrier. This ensures
that threads inspecting the pool always will be able to traverse the
pool and reach valid elements. Once we have reached the thread
progress value that the carrier was tagged with, we know that no
threads may have references to it via the pool.

### Migration ###

There exists one pool for each allocator type enabling migration of
carriers between scheduler specific allocator instances of the same
allocator type.

Each allocator instance keeps track of the current utilization of its
multiblock carriers. When the total utilization falls below the "abandon
carrier utilization limit" it starts to inspect the utilization of the
current carrier when deallocations are made. If also the utilization
of the carrier falls below the "abandon carrier utilization limit" it
unlinks the carrier from its data structure of available free blocks
and inserts the carrier into the pool.

Since the carrier has been unlinked from the data structure of
available free blocks, no more allocations will be made in the
carrier. The allocator instance putting the carrier into the pool,
however, still has the responsibility of performing deallocations in
it while it remains in the pool. The allocator instance with this
deallocation responsibility is here called the **employer**.

Each carrier has a flag field containing information about the
employing allocator instance, a flag indicating if the carrier is in
the pool or not, and a flag indicating if it is busy or not. When the
carrier is in the pool, the employing allocator instance needs to mark it
as busy while operating on it. If another thread inspects it in order
to try to fetch it from the pool, it will skip it if it is busy. When
fetching the carrier from the pool, employment will change and further
deallocations in the carrier will be redirected to the new
employer using the delayed dealloc functionality.

If a carrier in the pool becomes empty, it will be withdrawn from the
pool. All carriers that become empty are also always passed to its
**owning** allocator instance for deallocation using the delayed
dealloc functionality. Since carriers this way always will be
deallocated by the owner that allocated the carrier, the
underlying functionality of allocating and deallocating carriers can
remain simple and doesn't have to bother about multiple threads. In a
NUMA system we will also not mix carriers originating from multiple
NUMA nodes.

In short:

* The allocator instance that created a carrier **owns** it.
* An empty carrier is always deallocated by its **owner**.
* **Ownership** never changes.
* The allocator instance that uses a carrier **employs** it.
* An **employer** can abandon a carrier into the pool.
* Pooled carriers are not allocated from.
* Deallocation in a pooled carrier is still performed by its **employer**.
* **Employment** can only change when a carrier is fetched from the pool.

### Searching the pool ###

To harbor real time characteristics, searching the pool is
limited. We only inspect a limited number of carriers. If none of
those carriers had a free block large enough to satisfy the allocation
request, the search will fail. A carrier in the pool can also be busy
if another thread is currently doing block deallocation work on the
carrier. A busy carrier will also be skipped by the search as it can
not satisfy the request. The pool is lock-free and we do not want to
block, waiting for the other thread to finish.

#### Before OTP 17.4 ####

When an allocator instance needs more carrier space, it always begins
by inspecting its own carriers that are waiting for thread progress
before they can be deallocated. If no such carrier could be found, it
then inspects the pool. If no carrier could be fetched from the pool,
it will allocate a new carrier. Regardless of where the allocator
instance gets the carrier from it the just links in the carrier into
its data structure of free blocks.

#### After OTP 17.4 ####

The old search algorithm had a problem as the search always started at
the same position in the pool, the sentinel. This could lead to
contention from concurrent searching processes. But even worse, it
could lead to a "bad" state when searches fail with a high rate
leading to new carriers instead being allocated. These new carriers
may later be inserted into the pool due to bad utilization. If the
frequency of insertions into the pool is higher than successful
fetching from the pool, memory will eventually get exhausted.

This "bad" state consists of a cluster of small and/or highly
fragmented carriers located at the sentinel in the pool. The largest free
block in such a "bad" carrier is rather small, making it unable to satisfy
most allocation requests. As the search always started at the
sentinel, any such "bad" carriers that had been left in the pool would
eventually cluster together at the sentinel. All searches first
have to skip past this cluster of "bad" carriers to reach a "good"
carrier. When the cluster gets to the same size as the search limit,
all searches will essentially fail.

To counter the "bad cluster" problem and also ease the contention, the
search will now always start by first looking at the allocators **own**
carriers. That is, carriers that were initially created by the
allocator itself and later had been abandoned to the pool. If none of
our own abandoned carrier would do, then the search continues into the
pool, as before, to look for carriers created by other
allocators. However, if we have at least one abandoned carrier of our
own that could not satisfy the request, we can use that as entry point
into the pool.

The result is that we prefer carriers created by the thread itself,
which is good for NUMA performance. And we get more entry points when
searching the pool, which will ease contention and clustering.

To do the first search among own carriers, every allocator instance
has two new lists: `pooled_list` and `traitor_list`. These lists are only
accessed by the allocator itself and they only contain the allocator's
own carriers. When an owned carrier is abandoned and put in the
pool, it is also linked into `pooled_list`. When we search our
`pooled_list` and find a carrier that is no longer in the pool, we
move that carrier from `pooled_list` to `traitor_list` as it is now
employed by another allocator. If searching `pooled_list` fails, we
also do a limited search of `traitor_list`. When finding an abandoned
carrier in `traitor_list` it is either employed or moved back to
`pooled_list` if it could not satisfy the allocation request.

When searching `pooled_list` and `traitor_list` we always start at the
point where the last search ended. This to avoid clustering
problems and increase the probability to find a "good" carrier. As
`pooled_list` and `traitor_list` are only accessed by the owning
allocator instance, they need no thread synchronization at all.

Furthermore, the search for own carriers that are scheduled
for deallocation is now done as the last search option. The idea is
that it is better to reuse a poorly utilized carrier than to
resurrect an empty carrier that was just about to be released back to
the OS.

### Result ###

The use of this strategy of abandoning carriers with poor utilization
and reusing them in allocator instances with an increased carrier
demand is extremely effective and completely eliminates the problems
that otherwise sometimes occurred when CPU load dropped while memory
load did not.

When using the `aoffcaobf` or `aoff` strategies compared to `gf` or
`bf`, we loose some performance since we get more modifications in the
data structure of free blocks. This performance penalty is however
reduced using the `aoffcbf` strategy. A tradeoff between memory
consumption and performance is however inevitable, and it is up to
the user to decide what is most important. 

Further work
------------

It would be quite easy to extend this to allow migration of multiblock
carriers between all allocator types. More or less the only obstacle
is maintenance of the statistics information.

