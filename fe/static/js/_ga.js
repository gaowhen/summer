/**
 * Created by gaowhen on 15/7/21.
 */

if (!$('body').hasClass('dev')) {
	var hm = document.createElement('script')
	hm.src = '//hm.baidu.com/hm.js?001a4013ae38f6fb9d157d1ee374b41c'

	var s = document.getElementsByTagName('script')[0]
	s.parentNode.insertBefore(hm, s)
}
