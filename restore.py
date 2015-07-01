# -*- coding: utf-8 -*-

# git fsck --cache --unreachable $(git for-each-ref --format="%(objectname)") > all

from subprocess import call

with open('./git.txt') as f:
    for line in f:
        blob = line.replace('unreachable blob ', '').replace('\n', '')
        filename = blob.decode('utf8')

        _f = open(filename + '.txt', "wb")
        call(['git', 'show', filename], stdout=_f)
