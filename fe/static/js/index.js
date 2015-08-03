var $doc = $(document)

$doc.on('click', '.btn-build', function (e) {
	e.preventDefault()

	$.post('/build')
		.done(function (res) {
			console.log(res)
		})

	return false
})

$doc.on('click', '.btn-del', function (e) {
	e.preventDefault()

	var $this = $(this)
	var pid = $this.data('pid')
	var $entry = $this.parents('.entry')

	$.post('/posts/' + pid + '/del')
		.done(function (res) {
			if (res.r) {
				$entry.slideUp()
			}
		})

	return false
})

$doc.on('click', '.btn-deploy', function (e) {
	e.preventDefault()

	$.post('/deploy')
		.done(function (res) {
			console.log(res)
		})

	return false
})
