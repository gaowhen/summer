title: "解决 W3SVC Error 1717 错误"
date: 2008-06-24 08:33:59
tags:
id: 254
categories:
  - 经验技巧
---

最近使用[小黑](http://www.gaowhen.com/post/t43.html)的 IIS，发现总是不开机就启动
而是每次都要手动启动，有一次还无法启动，是因为 pplive 占据了 80 端口的原因，解决方法见另一篇文章  [[IIS 0x8ffe2740 错误](http://www.gaowhen.com/post/IIS.html)]  

今天手动启动 IIS 的时候，报错：
The service did not respond to the start or control request in a timely fashion.

检查后发现是由于 W3SVC(world wide web publishing) 服务没有启动造成，启动 W3SVC 服务，报错
w3svc error 1717 the interface is unknown

解决方法：
if you get a problem that your IIS won"t start or when you try to start WWW Publishing Service and it gives you the error: Error 1717: The interface is unknown.

Make sure your Event Log Service is started.

出现这个问题是因为关闭了Event Log服务，只需要开始 -> 运行 services.msc，找到Event Log，将其启动类型设置为自动，并启动它，即可解决这个问题。