(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({"/Users/gaowhen/Lab/flaskr/app/static/src/js/index.js":[function(require,module,exports){
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

},{}]},{},["/Users/gaowhen/Lab/flaskr/app/static/src/js/index.js"])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzdGF0aWMvc3JjL2pzL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJCgnLmJ0bi1idWlsZCcpLm9uKCdjbGljaycsIGZ1bmN0aW9uIChlKSB7XG5cdGUucHJldmVudERlZmF1bHQoKVxuXG5cdCQucG9zdCgnL2J1aWxkJylcblx0XHQuZG9uZShmdW5jdGlvbiAocmVzKSB7XG5cdFx0XHRjb25zb2xlLmxvZyhyZXMpXG5cdFx0fSlcblxuXHRyZXR1cm4gZmFsc2Vcbn0pXG5cbiQoJy5idG4tZGVsJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKGUpIHtcblx0ZS5wcmV2ZW50RGVmYXVsdCgpXG5cblx0dmFyICR0aGlzID0gJCh0aGlzKVxuXHR2YXIgdXJpID0gJHRoaXMuYXR0cignaHJlZicpXG5cdHZhciAkZW50cnkgPSAkdGhpcy5wYXJlbnRzKCcuZW50cnknKVxuXG5cdCQucG9zdCh1cmkpXG5cdFx0LmRvbmUoZnVuY3Rpb24gKHJlcykge1xuXHRcdFx0aWYgKHJlcy5yKSB7XG5cdFx0XHRcdCRlbnRyeS5zbGlkZVVwKClcblx0XHRcdH1cblx0XHR9KVxuXG5cdHJldHVybiBmYWxzZVxufSlcbiJdfQ==
