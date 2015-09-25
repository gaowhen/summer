var $doc = $(document)

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

