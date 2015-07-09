$('.btn-build').on('click', function (e) {
	e.preventDefault()

	$.post('/build')
		.done(function (res) {
			console.log(res)
		})

	return false
})