---
layout: post
title:  "Linux commands"
date:   2015-12-30 16:10:17 +0800
categories: linux
---

#查看某个进程的线程(Check threads of a process):  
{% highlight shell %}
1. ps -ef -T  | grep beam.smp
2. lsof -p PID
{% endhighlight %}