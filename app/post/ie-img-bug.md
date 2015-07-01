title: "IE下img多余5像素空白"
date: 2009-06-08 12:56:28
tags:
id: 320
categories:
  - 经验技巧
---

<div>[IE下img多余5像素空白](http://www.qianduan.net/img-excess-ofe-5-pixel.html)

	版权所有，转载请注明出处，多谢！

* * *
</div>
嗯，开场先胡扯几句不相关地感言。最近的工作让我有了很多实践的机会，同时也让我收获颇丰。在群里聊天的时候也提到过，所有的学习过程，最好是理论－实践－再理论－再实践。。。的一个循环往复的过程。这里说的理论是个比较宽泛地概念，其中包括书本理论，也包括对实践地总结。只有理论没有实践，往往造成眼高手低，想得好，做得差；只一味地实践却不通过理论地学习和总结，看起来好像忙忙碌碌，到头来会两手空空。

最近地实践中，越来越觉得 li 元素中包含 a img 元素的时候会比较麻烦，需要注意，当然，问题还是一如既往的出现在 IE 下。以下为其中一例：

html
<pre lang="html4strict"><textarea class="code" rows="10" cols="50">&lt;ul&gt;&nbsp;&nbsp;&lt;li&gt;&lt;a&nbsp;href="#"&gt;&lt;img&nbsp;src="img/temp.jpg"&nbsp;alt=""&nbsp;/&gt;&lt;/a&gt;&lt;/li&gt;&nbsp;&nbsp;&lt;li&gt;&lt;a&nbsp;href="#"&gt;&lt;img&nbsp;src="img/temp.jpg"&nbsp;alt=""&nbsp;/&gt;&lt;/a&gt;&lt;/li&gt;&nbsp;&nbsp;&lt;li&gt;&lt;a&nbsp;href="#"&gt;&lt;img&nbsp;src="img/temp.jpg"&nbsp;alt=""&nbsp;/&gt;&lt;/a&gt;&lt;/li&gt;&nbsp;&nbsp;&lt;li&gt;&lt;a&nbsp;href="#"&gt;&lt;img&nbsp;src="img/temp.jpg"&nbsp;alt=""&nbsp;/&gt;&lt;/a&gt;&lt;/li&gt;&lt;/ul&gt;</textarea>
</pre>css
<pre lang="html4strict">ul{
	width: 280px;
}
ul li{
	display:block;
	height:57px;
	width:277px;
}</pre>其中 temp.jpg 尺寸为 277×57

Firefox 下的正常表现：
![demo-ff](/images/)
IE6 下的非正常表现：
![demo-ie](/images/)
很明显地可以看到 IE 中，li 的表现高度，并非我们设定的 57px，而是比其要高，这是因为 img 下面多出了 5px 的空白。

## 解决方法 一
使 li 浮动，并设置 img 为块级元素
<pre lang="html4strict">ul{
	width: 280px;
}
ul li{
	float:left;
	display:block;
	height:57px;
	width:277px;
}
img{
	display: block;
}</pre>

## 解决方法 二
设置 ul 的 font-size:0;
<pre lang="html4strict">ul{
	width: 280px;
	font-size: 0;
}
ul li{
	display:block;
	height:57px;
	width:277px;
}</pre>

## 解决方法 三
设置 img 的 vertical-align: bottom;
<pre lang="html4strict">ul{
	width: 280px;
	font-size: 0;
}
ul li{
	display:block;
	height:57px;
	width:277px;
}
img{
	vertical-align:bottom;
}</pre>

## 解决方法 四
设置 img 的 margin-bottom: -5px;
<pre lang="html4strict">ul{
	width: 280px;
	font-size: 0;
}
ul li{
	display:block;
	height:57px;
	width:277px;
}
img{
	margin-bottom: -5px;
}</pre>可以下载 [demo](http://cn.ziddu.com/download/328967/demo.zip.html) 来看