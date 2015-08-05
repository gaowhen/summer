/**
 * Created by gaowhen on 15/7/21.
 */

if (!$('body').hasClass('dev')) {
	var hm = document.createElement('script')
	hm.src = '//hm.baidu.com/hm.js?001a4013ae38f6fb9d157d1ee374b41c'

	var s = document.getElementsByTagName('script')[0]
	s.parentNode.insertBefore(hm, s)

	(function (i, s, o, g, r, a, m) {
		i['GoogleAnalyticsObject'] = r;
		i[r] = i[r] || function () {
					(i[r].q = i[r].q || []).push(arguments)
				}, i[r].l = 1 * new Date();
		a = s.createElement(o),
				m = s.getElementsByTagName(o)[0];
		a.async = 1;
		a.src = g;
		m.parentNode.insertBefore(a, m)
	})(window, document, 'script', '//www.google-analytics.com/analytics.js', 'ga');

	ga('create', 'UA-11027068-1', 'auto');
	ga('send', 'pageview');

}
