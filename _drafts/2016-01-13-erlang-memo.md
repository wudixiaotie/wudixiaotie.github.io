---
layout: post
title:  "Erlang Memo"
author: "肖铁(Kevin)"
categories: erlang
---

##二进制的中文怎么输出
{% highlight erlang %}
1> <<"测试"/utf8>>.
<<230,181,139,232,175,149>>
2> io:format("~ts~n",[<<230,181,139,232,175,149>>]).
测试
ok
{% endhighlight %}