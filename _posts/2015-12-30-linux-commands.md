---
layout: post
title:  "Linux commands"
author: "肖铁(Kevin)"
categories: linux
---

###查看某个进程的线程(Check threads of a process):  
{% highlight console %}
1. $ ps -T -p <pid>
2. $ top -H -p <pid>
{% endhighlight %}

###网络相关信息:  
{% highlight console %}
$ netstat -apn | grep <Port>
$ netstat -st
{% endhighlight %}

###抓包:  
1. tcpdump 要用root权限去运行。
2. tcpdump的参数：  
    -D 表示查看网络适配器列表  
    -X 表示要显示抓取包的内容  
    -s 0 表示显示全部包的内容  
    -i 3 表示抓取网络适配器列表编号为3的设备  
    tcp port 8080 表示抓取经过8080端口的tcp包  

{% highlight console %}
$ tcpdump -X -s 0  -i 3 tcp port 8080
{% endhighlight %}