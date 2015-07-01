title: "Getting Started with jQuery(二)"
date: 2006-12-13 10:57:36
tags:
id: 11
categories:
  - Z-Blog
---

现在已经可以使用选择符和事件做很多事情了，但是还有更多可以做的。

$(document).ready(function() {
	$("#orderedlist").find("li").each(function(i) {
		$(this).html( $(this).html() + " BAM! " + i );
	});
});
find()可以进一步检索已经选择到的元素的下级元素，因此$("#orderedlist).find("li")和#orderedlist li 非常相似。each()在每一个元素上重复并且允许进一步的处理。很多方法，比如addClass()，使用each()。这个例子中，html()用来得到每一个li元素的文本，添加另外一些元素并把它们设置为元素的文本。

另外一个要经常面对的问题是调用那些jQuery没有涉及到的DOM元素。
$(document).ready(function() {
	// use this to reset a single form
	$("#reset").click(function() {
		$("#form")[0].reset();
	});
});
这些代码选择到ID为”form”的元素并调用第一个元素的reset()函数，如果有多个form，就要这么做了：
$(document).ready(function() {
	// use this to reset several forms at once
	$("#reset").click(function() {
		$("form").each(function() {
			this.reset();
		});
	});
});
这可以选择到所有的form元素，并且循环调用每一个的reset()。

另一个要面对的问题是不选择特定元素。jQuery为此提供了filter() 和 not()。filter()减少了符合filter描述的元素，而not()排除了所有符合描述的元素。
$(document).ready(function() {
	$("li").not("[ul]").css("border", "1px solid black");
});
这选择到了所有的li元素，并且从中排出了有ul子元素的li元素。因此，除有有ul子元素的li元素之外，所有的li元素都被设置了1px黑色边框。[]词法源自XPath，可以用来依照子元素和属性来过滤。或许你会想要得到所有有name属性的锚点。
$(document).ready(function() {
	$("a[@name]").background("#eee");
});
给所有有name属性的锚点添加了背景颜色。

较之依照name选择，更多的可能是依照她们的”href”属性选择，为了匹配其中的一部分，可以使用"*="
$(document).ready(function() {
	$("a[@href*=/content/gallery]").click(function() {
		// do something with all links that point somewhere to /content/gallery
	});
});

有一些场合需要选择之前或者之后的同胞元素。例如，一个FAQ页面，所有的答案开始都是隐藏的，在点击问题的时候才会显示。
$(document).ready(function() {
	$('#faq').find('dd').hide().end().find('dt').click(function() {
         var answer = $(this).next();
         if (answer.is(':visible')) {
             answer.slideUp();
         } else {
             answer.slideDown();
         }
     });
});
通过使用end()，第一个find()没被执行，所以对#faq的检索是从下一个find()开始的。
当click发生时，函数传递给了click()方法，$(this).next()用来找到下一个以dt开始的同胞元素。
作为对同胞的补充，也可以选择父元素
$(document).ready(function() {
	$("a").hover(function() {
		$(this).parents("p").addClass("highlight");
	}, function() {
		$(this).parents("p").removeClass("highlight");
	});
});