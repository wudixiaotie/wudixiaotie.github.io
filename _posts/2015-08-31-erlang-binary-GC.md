---
layout: post
title:  "erlang binary的GC"
date:   2015-08-31 16:00:00 +0800
categories: erlang
---

我自己写的文章居然被别人的博客转载了，然后大言不惭的说作者是他，真是服了。。。
============================== 
今天来说一下长期运行的项目会有内存越用越大的情况的发生原因。众所周知，erlang是运行在虚拟机上的，他的GC不是全局的而是针对进程单独GC。所以GC时整个系统不会产生中断，这是他的优点。那么既然有GC为什么还会有内存的增长呢？？
当我们运行这个命令（erlang:memory()）会发现，内存的增长主要是在binary上。要找到这个原因，就要知道GC里关于binary的处理。  

在erlang中，binary的存储位置一共有两处：  

1. size<=64 bytes的binary存储在每个进程单独的heap（堆）中。这种bianry叫做Heap-binary。
2. size>64 bytes的binary存储在虚拟机分配出来单独的heap（堆）中，而用到这个binary的进程的heap中只有一个这个binary的引用。这种binary叫做Refc-binaries。

在进程进行GC的时候Heap-binary会随着GC而被释放掉，因为他是只属于这个进程的。相对应的这个进程heap中存储的Refc-binary也会被释放掉，但是其引用的元binary不会被释放，除非所有引用过这个Refc-binary的进程都进行GC后才会被释放。 

这里说一下为什么Refc-binaries叫这个名字呢？这个名字全称是Reference-counted-binary，每当有个进程用到这个binary时，除了在自己进程heap中创建这个binary的引用以外，还要把记录这个binary的引用次数+1。只有当这个binary的引用次数为0的时候，才会把这个binary从专门的heap中释放掉。

在我们写erlang代码的时候，很容易遇到这种情况，<<A:8, B:16>> = C.在这里C本身是一个binary，A和B是C的sub-binary，在这个匹配语句中，erlang的VM不会创建2个新的binary，而是对C创建两个引用。这种引用叫做sub-binary。所以在VM中一共有4中binary，分别是：Heap-binary，Heap-binary的sub-binary，Refc-binary，Refc-binary的sub-binary。

<font color="red">
    <p>
        而不论是Refc-binary还是Refc-binary的sub-binary，这两种binary都适用刚才说的Refc的GC规则，所以才会导致erlang项目在长期运行后，内存会出现越用越大的情况。具体原因可以举个例子，如果系统中的某个erlang进程起到类似路由的功能，很多Refc-binary的传递都要到这个进程中中转，结果其实这个进程不会操作这些Refc-binary，而由于这个进程基本什么都不干，仅仅中转一下消息所以基本不会有GC的机会，导致了系统中的大量Refc-binary无法得到释放，所以系统内存binary会越用越大。
    <p>
    <p>
        针对这种情况怎么解决呢？在创建这些“关键”进程的时候，在选项中加入{fullsweep_after, 0}，这个选项的意思是如果有没用的binary，会立马释放掉。
    </p>
</font>

<font color="blue">
    <p>经过了一段时间的研究，发现上面红色字的部分完全说错了，但是我不打算改，而是标注出来，这样可以提醒我自己和大家，以后不太懂的时候别出来装逼了，被发现了就惨了。</p>
    <p>下面来说说研究结果：</p>
    <p>关于binary的GC有两种：</p>
    <ul>
        <li>
            <b>1.Heap的GC是分代GC。</b>
            <p>所谓分代是指数据存储分为young和old两代，最开始所有的Heap-binary都存储在young heap区域，然后当这个young heap空间不足的时候，VM就会对这个进程进行一次浅扫描（minor collection），给当前所有young heap里面的binary的扫描次数+1, 然后把还有用的binary移到新创建的young heap里，把扫描次数大于1的binary放到old heap中，然后删除原有的young heap。为什么这么做呢？因为根据统计学的说法，大部分数据的生存周期都比较短，最新的数据更容易不再被使用。</p>
            <p>当old heap空间不足的时候，VM就会对这个进程进行深扫描（major collection），把young&old heap的所有有用的数据放入新的young heap中，然后删除原来的young&old heap。</p>
        </li>
        <li>
            <b>2.Refc的GC是引用计数的GC。</b>
            <p>引用计数的GC上面已经说了，每个用到这个binary的进程都会把这个binary的引用存储在进程自己的Heap空间中，这个引用被叫做ProcBin，然后会给ProcBin在公共Heap里面的Object的计数器+1,进程GC的时候，只要永不到对应的ProcBin就会被GC掉，然后对应的公共Heap里面的Object的计数器-1，当计数器变为0的时候，这个binary被从公共Heap中释放掉。</p>
            <p>而{fullsweep_after, Integer}起作用的是对进程自己的Heap binary起作用，Integer的作用是表示，执行Integer次浅扫描后，直接执行深扫描，不用等待old heap满了。</p>
        </li>
    </ul>
    <p>那么这个东西能解决公共Heap区域内存溢出的问题么？</p>
    <p>我们假设一个导致内存溢出的情景，还是上面说的那个场景：</p>
    <p>如果系统中的某个erlang进程起到类似路由的功能，很多Refc-binary的传递都要到这个进程中中转，结果其实这个进程不会操作这些Refc-binary，而由于这个进程基本什么都不干，仅仅中转一下消息所以基本不会产生新的Heap binary，那么他的私有Heap里面存储的全是ProcBin，结果就是old heap区域怎么也不会满，而VM默认的fullsweep_after是65535,那么假如在65535次浅GC执行完之前很多的Refc-binary把公共Heap区域沾满了，导致没有新的内存可以分配，结果VM由于再接收新的Refc-binary后，没有内存可分配只能挂掉了，这就是传说中的内存泄漏。如果我们给这个路由进程的启动参数设置为{fullsweep_after, 5}，也就是5次浅GC后，来一次深GC，那么该进程Heap区域中无用的ProcBin会大幅减少，然后公共Heap区域的内存就会有增有减，保证了整个VM能持续运行。问题解决了！ ：）</p>
</font>
