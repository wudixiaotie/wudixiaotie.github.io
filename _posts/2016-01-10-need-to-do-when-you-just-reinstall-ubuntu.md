---
layout: post
title:  "Need to do when you just reinstall linux"
author: "肖铁(Kevin)"
categories: linux
---

##when you type "rvm use ..." it comes up an "rvm not a function":
{% highlight console %}
vim ~/.bashrc
{% endhighlight %}

add 
{% highlight console %}
[[ -s "$HOME/.rvm/scripts/rvm" ]] && source "$HOME/.rvm/scripts/rvm"
{% endhighlight %}

at the end of the file. Then type:

{% highlight console %}
rvm use ruby-2.2.1 --default
{% endhighlight %}