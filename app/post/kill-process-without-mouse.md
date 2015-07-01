title: "全键盘操作终止进程"
date: 2008-10-08 11:09:43
tags:
id: 283
categories:
  - 经验技巧
---

昨天 [[远程登录](http://www.gaowhen.com/post/winxp-remote-desktop.html)] 实验室机器的时候，貌似机器有点死机。想着非得跑趟实验室不行了，就没管它。后来数次远程登录都非常顺畅，感觉有点奇怪，试了下键盘操作，没有任何问题，只是鼠标不起作用了而已。估计就是 IE 登录学校主页，加载中出了问题，貌似只要结束这个 Iexplore.exe 进程就可以了。

于是面临一个选择，要么真人现身实验室一次，要么无鼠标全键盘解决这个问题。我毫不犹豫的选择了后者。其实当时脑子里根本就没有前者的概念。

首先，远程登录的机器，直接 Ctrl+Alt+Delete 的话，启动的是本地任务管理器，所以要用另一个热键 Ctrl+Shift+Esc。
或者用命令行启动： Win+R 启动 Run（运行），输入 taskmgr.exe 也可以启动任务管理器。

![taskmgr](/images/ "taskmgr")

成功启动任务管理器之后，焦点默认是在 Applications 上，此时 Tab 切换的话，只能在 Task、 End Task、Switch、New Task 之间切换。当然这里面也有正在运行的程序，一种方法是用 Tab 将焦点切换到 Task 里，然后用上下键选择程序， Alt+E 终止程序。
不过貌似有时候不怎么奏效，或者奏效耗时比较长。另一种方法就是 Ctrl+Tab 将焦点切换到 Processes 上，然后上下键选择进程 iexplore.exe， Alt+E 中断进程就可以了。

问题解决了，省了我跑一趟实验室，哈哈哈哈哈。。。