/**
 * Created by gaowhen on 15/7/21.
 */

if (!$('body').hasClass('dev')) {
	// baidu
	var hm = document.createElement('script')
	hm.src = '//hm.baidu.com/hm.js?001a4013ae38f6fb9d157d1ee374b41c'

	var s = document.getElementsByTagName('script')[0]
	s.parentNode.insertBefore(hm, s)

	// google
	window['GoogleAnalyticsObject'] = 'ga'

	window['ga'] = window['ga'] ||
		function () {
			(window['ga'].q = window['ga'].q || []).push(arguments)
		}

	window['ga'].l = 1 * new Date()

	var a = document.createElement('script')
	a.src = '//www.google-analytics.com/analytics.js'
	var sc = document.getElementsByTagName('script')[0]

	sc.parentNode.insertBefore(a, sc)

	ga('create', 'UA-11027068-1', 'auto')
	ga('send', 'pageview')
}
