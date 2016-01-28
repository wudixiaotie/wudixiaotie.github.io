---
layout: post
title:  "Work Experience"
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

##Mysql store emoji
{% highlight sql %}
CREATE TABLE `story_comment` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT 'story id',
  `story_id` bigint(20) unsigned NOT NULL COMMENT 'story_id',
  `uid` bigint(20) unsigned NOT NULL COMMENT 'uid',
  `reply_uid` bigint(20) unsigned DEFAULT 0 NOT NULL COMMENT 'reply_uid',
  `content` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'content',
  `timestamp` bigint(20) NOT NULL COMMENT 'timestamp',
  `state` int(1) DEFAULT 0 NOT NULL COMMENT 'state',
  PRIMARY KEY (`id`),
  INDEX i_story_comment_uid_timestamp (uid, timestamp),
  INDEX i_story_comment_id_uid (id, uid),
  INDEX i_story_comment_story_id (story_id),
  INDEX i_story_comment_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
{% endhighlight %}
