#!/bin/sh

if [ -n "$1" ] ;then
  note=$1
else
  note="new post"
fi

git add -A
git commit -m "$note"
git push origin master