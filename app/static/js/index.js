(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
$('.btn-build').on('click', function (e) {
	e.preventDefault()

	$.post('/build')
		.done(function (res) {
			console.log(res)
		})

	return false
})

$('.btn-del').on('click', function (e) {
	e.preventDefault()

	var $this = $(this)
	var uri = $this.attr('href')
	var $entry = $this.parents('.entry')

	$.post(uri)
		.done(function (res) {
			if (res.r) {
				$entry.slideUp()
			}
		})

	return false
})

},{}]},{},[1]);

//# sourceMappingURL=map/index.js.map