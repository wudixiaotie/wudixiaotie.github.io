---
layout: post
title:  "Heroku commands"
author: "肖铁(Kevin)"
categories: heroku
---

##Check how many dynos are running using the ps command:
{% highlight console %}
heroku ps
{% endhighlight %}

##Run bundle command:
{% highlight console %}
heroku run bundle exec <command>
{% endhighlight %}

##tail log:
{% highlight console %}
heroku logs --tail
{% endhighlight %}

##Change git after you change app name at website:
{% highlight console %}
heroku git:remote -a traffic-wudixiaotie
{% endhighlight %}

##Log level:
{% highlight console %}
heroku config:set LOG_LEVEL=DEBUG
{% endhighlight %}