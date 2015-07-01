title: "JavaScript(一)"
date: 2006-12-11 18:18:56
tags:
id: 8
categories:
  - Z-Blog
---

Javascript由浏览器解释运行

Javascript中的对象由属性(properties)和方法(methods)两个元素组成
	属性 是对象在实施其所需要行为的过程中，实现信息的转载单位，从而与变量相关联
	方法  是指对象能够按照设计者的意图而被执行，从而与特定的函数相联

Javascript可操作的对象来源
	浏览器环境和HTML标签语句所构成的现成对象(链接，图像，插件，HTML表单元素，浏览器细节等)
	Javascript内置类创建的对象，比如Date  Number
	Javascript编程，用户自己创建的对象。

Javascript代码的加入
	<script Language="JavaScript">
	代码；
           代码；
           </script>

一  Javascript标识放置在
           <head></head>之间时，在页面主体和其他代码之前装载，尤其是一些函数的代码。
	之间，可以实现某些部分动态的创建文档。

二  在HTML定义的标签中，直接写某些事件的简短代码，在按钮的标签中通过 onclick=javascript:函数名();　　
    调用函数写在<head></head>之间

三  使用库函数  
    在web页中加入<script src="js文件"></script>来引入Javascript库

Javascript访问页面HTML标签定义的对象的时候，采用层层限定的逐步收缩法
Javascript的文档对象模型(DOM)中，窗口(Window)是对象模型的顶端对象，通常来说窗口就是浏览器
窗口里是web页面，它的对象层次从文档(document)开始，可以用Window.document/document来引用它。
一般，有收集用户输入信息的文档，都至少包含一个表单(form)，可以通过document.forms[0]来访问第一个表单，
也可以通过表单的名(Name)来访问表单表单中会有很多Input对象，

正则表达式
    定义在一对   /   之间

元字符 
    "+"　　规定其前导字符必须在目标中连续出现一次或多次
    "*"　  规定其前导字符必须在目标中出现零次或连续多次
    "?"　  规定其前导字符必须在目标中连续出现零次或一次