---
layout: post
title:  "Linux commands"
author: "肖铁(Kevin)"
categories: linux
---

###awk
2 lines into 1 line:  
```bash
ifconfig | awk 'ORS= NR%2 ? " " : "\n" { print }'
```

print row 2 column 3:  
```bash
ifconfig | awk 'NR == 2 { print $3 }'
```

###grep  
do not show "a":  
```bash
ifconfig | grep -v 'a'
```

show 2 line after context:  
```bash
ifconfig | grep -A 2 "inet"
```

show 1 line before context:  
```bash
ifconfig | grep -B 1 "inet"
```

###test  
if file exist then run commands
```bash
test -e .bashrc && source .bashrc
```

###${}
${var##*/}:该命令的作用是去掉变量var从左边算起的最后一个'/'字符及其左边的内容  
${var##*.}:该命令的作用是去掉变量var从左边算起的最后一个'.'字符及其左边的内容  

\#：表示从左边算起第一个  
%：表示从右边算起第一个  
\#\#：表示从左边算起最后一个  
%%：表示从右边算起最后一个  
＊：表示要删除的内容  

###查看某个进程的线程(Check threads of a process):  
{% highlight console %}
1. $ ps -T -p <pid>
2. $ top -H -p <pid>
{% endhighlight %}

###网络相关信息:  
{% highlight console %}
$ netstat -atln | grep <Port>
$ netstat -st
$ lsof -i -n
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

###alias
{% highlight console %}
alias gnw='git log --color --graph --pretty=format:'\''%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset'\'' --abbrev-commit --all'
alias l='ls -alFG'
alias ll='ls -AlFG'
{% endhighlight %}

###git:  
1.clone a branch from git origin:  
{% highlight console %}
git clone -b develop git@192.168.1.21:project
{% endhighlight %}

2.create a new feature branch from this branch  
{% highlight console %}
git checkout -b feature-001 develop
{% endhighlight %}

3.finish  
{% highlight console %}
git commit --no-verify -m "..."
git checkout develop
git pull
git diff --name-status develop feature
git diff develop feature
{% endhighlight %}

4.merge back  
{% highlight console %}
git merge --no-ff  feature
{% endhighlight %}

5.push to origin  
{% highlight console %}
git push origin develop
{% endhighlight %}

6.delete local branch  
{% highlight console %}
git branch -d feature
{% endhighlight %}

7.delete remote branch  
{% highlight console %}
git push origin --delete feature
{% endhighlight %}

8.if the branch still in `branch -a` then remove such stale branches  
{% highlight console %}
git branch -d -r origin/feature
{% endhighlight %}
