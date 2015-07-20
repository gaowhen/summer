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
