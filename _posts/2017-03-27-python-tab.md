---
layout: post
title: "Python console code completion"
author: "肖铁(Kevin)"
categories: python
---

```python
import sys
import readline
import rlcompleter

if sys.platform == 'darwin' and sys.version_info[0] == 2:
    readline.parse_and_bind("bind ^I rl_complete")
else:
    readline.parse_and_bind("tab: complete")
```

Save the file as name tab.py:
```shell
cd /Library/Python/2.7/site-packages
sudo vim tab.py
```

Then edit .bash_profile file:
```shell
echo "export PYTHONSTARTUP=/Library/Python/2.7/site-packages/tab.py" >> ~/.bash_profile
source ~/.bash_profile
```