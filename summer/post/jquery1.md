title: "Getting Started with jQuery(一)"
date: 2006-12-12 17:29:49
tags:
id: 9
categories:
  - Z-Blog
---

Getting Started with jQuery

1．安装
最新的版本可以在[http://jquery.com/src/](http://jquery.com/src/)下载到，这里提供一个练习用的包[http://jquery.bassistance.de/jquery-starterkit.zip](http://jquery.bassistance.de/jquery-starterkit.zip)。
下载此文件并解压。用你熟悉的编辑器打开starterkit.html 和custom.js(方便看到js和页面元素的对应关系) 并且用浏览器打开starterkit.html(查看效果)。

Hello jQuery 经典的例子

由于alert无需DOM的装载，所以简单的往函数里面放一个alert没有什么意义。这里我们尝试一下稍微复杂的东西，点击超链接的时候弹出一个alert。
$(document).ready(function() {
	$("a").click(function() {
		alert("Hello world!");
	});
});

![](/images/)

详解：$(“a”)是一个jQuery选择符，在这里，它取到了所有元素。$本身是jQuery “class”的别名，因此$()创建了一个新的jQuery 对象。下面调用的 click()函数是jQuery对象的一个方法。它指定给所有选定元素(这里是锚点元素)一个事件，并且当事件发生时执行指定函数。
它和下面的代码相似：
[Link](#)

Find me: Using selectors and events  找到我 使用选择符和事件

jQuery提供两种选择元素的方法。第一种是使用CSS 和XPath选择符的组合作为字符串传递给jQuery构造器(例：$("div > ul a"))。第二种方法使用jQuery对象的一些方法。两种方法可以组合使用。
作为尝试，我们选择并修改starterkit.html中的第一个ordered list。

![](/images/)

1.  First element
2.  Second element
3.  Third element这个list有一个ID “orderedlist”，在javascript中，我们使用document.getElementById("orderedlist")获取它，而在jQuery中，我们可以这样做：
$(document).ready(function() {
	$("# orderedlist ").addClass("red");
});
这只是简单的设置了orderedlist的背景颜色为红色，刷新starterkit.html，可以看到如下效果：

![](/images/)

第一个orderedlist背景变成了红色，第二个没有变化。

下面做点更复杂的，当鼠标悬浮在li元素上时，我们想往list中的最后一个元素里面添加/删除一些类。
$(document).ready(function() {
	$("#orderedlist li:last").hover(function() {
		$(this).addClass("green");
	}, function() {
		$(this).removeClass("green");
	});
});

![](/images/)

可以看到Third element变成了绿色。