title: "datetime"
date: 2015-07-13 14:39:33
tags:
categories:
---

You can parse the microseconds:

from datetime import datetime
date_posted = '2014-01-15T01:35:30.314Z'
datetime.strptime(date_posted, '%Y-%m-%dT%H:%M:%S.%fZ')
